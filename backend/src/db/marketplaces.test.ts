/**
 * Migration 0034 (conferência de marketplaces) num Postgres de verdade: quem
 * vê e quem grava cada tabela, pedido repetido, trava de loja, carteira sem
 * duplicar, tabela de tarifas do login do cliente (o escritório só lê). Dados
 * fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, contar } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111'; // admin do escritório
const COLEGA = '22222222-2222-2222-2222-222222222222'; // mesmo escritório, sem ser admin
const OUTRO = '44444444-4444-4444-4444-444444444444'; // outro escritório
const CLI = '33333333-3333-3333-3333-333333333333'; // login de cliente
const A = 'c0000000-0000-0000-0000-00000000000a';
const B = 'c0000000-0000-0000-0000-00000000000b';

const DADOS = `
  insert into auth.users (id, email) values
    ('${ESC}', 'esc@teste.test'), ('${COLEGA}', 'colega@teste.test'),
    ('${OUTRO}', 'outro@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values
    ('${ESC}', '${ESC}', true), ('${COLEGA}', '${ESC}', false), ('${OUTRO}', '${OUTRO}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1'),
    ('${B}', '${ESC}', 'LOJA BETA', '22222222000122', '2');
`;

const inserirPedido = (pedido: string) =>
  `insert into public.marketplace_pedidos (client_id, marketplace, pedido, status, criado_em, concluido_em, itens, origem)
   values ('${A}', 'shopee', '${pedido}', 'concluido', '2026-11-01T10:00:00-03:00', '2026-11-05T10:00:00-03:00',
           '[{"preco": 50, "qtd": 2}]', 'excel')`;

const tarifa = (inicio: string, fim: string | null, min: number, max: number | null) =>
  `insert into public.marketplace_tarifas (owner_id, usuario_id, marketplace, vigencia_inicio, vigencia_fim, preco_min, preco_max,
                                          comissao_pct, transacao_pct, campanha_pct, por_item, por_pedido, preenchido_por_email)
   values ('${ESC}', '${CLI}', 'shopee', '${inicio}', ${fim ? `'${fim}'` : 'null'}, ${min}, ${max ?? 'null'},
           20, 1.4, 5, 4.5, 0.49, 'cliente@teste.test')`;

const carteira = (chave: string, categoria = 'renda_pedido') =>
  `insert into public.marketplace_carteira (client_id, marketplace, chave, data, tipo, pedido, categoria, valor, saldo_apos, origem)
   values ('${A}', 'shopee', '${chave}', '2026-11-12T10:00:00-03:00', 'Renda do pedido', '241101ABC', '${categoria}', 71, 171, 'excel')`;

const loja = (client: string, nome: string) =>
  `insert into public.marketplace_lojas (client_id, marketplace, loja) values ('${client}', 'shopee', '${nome}')`;

describe('migration 0034 — marketplaces', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('o escritório grava pedido, repasse, carteira e importação; o dono vem do escritório', async () => {
    await como(db, COLEGA, async () => {
      await db.exec(inserirPedido('241101ABC'));
      await db.exec(`
        insert into public.marketplace_repasses (client_id, marketplace, pedido, criado_dia, pago_em, preco, comissao_bruta,
                                                 comissao_liquida, servico_bruta, servico_liquida, devolucao_facil, liquido, origem)
        values ('${A}', 'shopee', '241101ABC', '2026-11-01', '2026-11-12', 100, -18.6, -18.6, -12.9, -12.9, -0.49, 68.01, 'excel');
      `);
      await db.exec(carteira('k1'));
      await db.exec(`insert into public.marketplace_importacoes (client_id, marketplace, tipo, arquivo, linhas, importado_por_email)
                     values ('${A}', 'shopee', 'renda', 'Income.xlsx', 1, 'colega@teste.test')`);
    });
    for (const t of ['marketplace_pedidos', 'marketplace_repasses', 'marketplace_carteira', 'marketplace_importacoes']) {
      const p = await db.query<{ owner_id: string }>(`select owner_id from public.${t} limit 1`);
      expect(p.rows[0]).toEqual({ owner_id: ESC });
    }
  });

  it('o mesmo pedido / movimento da carteira não entra duas vezes (reimportar = atualizar)', async () => {
    await expect(como(db, ESC, () => db.exec(inserirPedido('241101ABC')))).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      como(db, ESC, () =>
        db.exec(`insert into public.marketplace_repasses (client_id, marketplace, pedido, liquido, origem)
                 values ('${A}', 'shopee', '241101ABC', 1, 'excel')`),
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(como(db, ESC, () => db.exec(carteira('k1')))).rejects.toThrow(/duplicate key|unique/i);
    await como(db, ESC, () => db.exec(carteira('k2', 'debito_devolucao')));
    await expect(como(db, ESC, () => db.exec(carteira('k3', 'qualquer')))).rejects.toThrow(/check/i);
  });

  it('trava de loja: uma loja por empresa e a mesma loja não entra em duas empresas', async () => {
    await como(db, ESC, () => db.exec(loja(A, 'loja_alfa')));
    await expect(como(db, ESC, () => db.exec(loja(A, 'outra')))).rejects.toThrow(/duplicate key|unique/i);
    await expect(como(db, ESC, () => db.exec(loja(B, ' LOJA_ALFA')))).rejects.toThrow(/duplicate key|unique/i);
    await como(db, ESC, () => db.exec(loja(B, 'loja_beta')));
  });

  it('situação, marketplace e itens fora do formato são recusados', async () => {
    await expect(como(db, ESC, () => db.exec(inserirPedido('X1').replace("'concluido'", "'pago'")))).rejects.toThrow(/check/i);
    await expect(como(db, ESC, () => db.exec(inserirPedido('X2').replace("'shopee'", "'amazon'")))).rejects.toThrow(/check/i);
    await expect(
      como(db, ESC, () => db.exec(inserirPedido('X3').replace(`'[{"preco": 50, "qtd": 2}]'`, `'{"preco": 50}'`))),
    ).rejects.toThrow(/check/i);
  });

  it('tabela de tarifas: só o portal grava (secret key); o escritório, nem o admin, altera', async () => {
    await como(db, 'service_role', () => db.exec(tarifa('2026-10-01', null, 0, 79.99)));
    await expect(como(db, ESC, () => db.exec(tarifa('2026-10-01', null, 80, 199.99)))).rejects.toThrow(/row-level security/i);
    await como(db, ESC, () => db.exec(`update public.marketplace_tarifas set comissao_pct = 99`));
    await como(db, ESC, () => db.exec(`delete from public.marketplace_tarifas`));
    expect(await contar(db, `select count(*) as n from public.marketplace_tarifas where comissao_pct = 20`)).toBe(1);
    // o escritório lê (pra ver a conferência e quem preencheu)
    expect(await como(db, COLEGA, () => contar(db, `select count(*) as n from public.marketplace_tarifas`))).toBe(1);
  });

  it('faixa e vigência ao contrário, ou % acima de 100, são recusadas', async () => {
    await expect(como(db, 'service_role', () => db.exec(tarifa('2026-10-01', '2026-09-01', 0, 10)))).rejects.toThrow(/check/i);
    await expect(como(db, 'service_role', () => db.exec(tarifa('2026-10-01', null, 50, 10)))).rejects.toThrow(/check/i);
    await expect(
      como(db, 'service_role', () => db.exec(tarifa('2026-10-01', null, 0, 10).replace('20, 1.4, 5', '20, 1.4, 101'))),
    ).rejects.toThrow(/check/i);
  });

  it('outro escritório não vê nada; login de cliente não toca as tabelas direto', async () => {
    for (const t of [
      'marketplace_pedidos',
      'marketplace_repasses',
      'marketplace_carteira',
      'marketplace_lojas',
      'marketplace_importacoes',
      'marketplace_tarifas',
    ]) {
      expect(await como(db, OUTRO, () => contar(db, `select count(*) as n from public.${t}`))).toBe(0);
      expect(await como(db, CLI, () => contar(db, `select count(*) as n from public.${t}`), 'cliente')).toBe(0);
    }
    await expect(como(db, CLI, () => db.exec(inserirPedido('DO-CLIENTE')), 'cliente')).rejects.toThrow(/row-level security/i);
    await expect(como(db, null, () => contar(db, `select count(*) as n from public.marketplace_pedidos`))).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('excluir a empresa leva o que foi importado dela; excluir o login leva a tabela dele', async () => {
    await db.exec(`delete from public.clients where id = '${A}'`);
    for (const t of ['marketplace_pedidos', 'marketplace_repasses', 'marketplace_carteira', 'marketplace_importacoes']) {
      expect(await contar(db, `select count(*) as n from public.${t}`)).toBe(0);
    }
    expect(await contar(db, `select count(*) as n from public.marketplace_lojas`)).toBe(1); // a da empresa B fica
    expect(await contar(db, `select count(*) as n from public.marketplace_tarifas`)).toBe(1);
    await db.exec(`delete from auth.users where id = '${CLI}'`);
    expect(await contar(db, `select count(*) as n from public.marketplace_tarifas`)).toBe(0);
  });
});

describe('migration 0034 — chamados em lote', () => {
  let db: PGlite;
  const abrir = (sub: string, pedidos: string[], numero: string | null = null, papel?: string) =>
    como(
      db,
      sub,
      () =>
        db.query<{ r: { id: string; pedidos: number } }>(
          `select public.abrir_chamado_marketplace($1, 'shopee', $2::text[], $3, '2026-11-24', 'obs', 'esc@teste.test') as r`,
          [A, pedidos, numero],
        ),
      papel,
    );
  const chamadoDe = async (pedido: string) =>
    (await db.query<{ chamado_id: string | null }>(`select chamado_id from public.marketplace_pedidos where pedido = $1`, [pedido]))
      .rows[0]!.chamado_id;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
    for (const p of ['P1', 'P2', 'P3']) await como(db, ESC, () => db.exec(inserirPedido(p)));
  }, 120_000);
  afterAll(async () => db?.close());

  it('abre um chamado com um lote de pedidos', async () => {
    const { rows } = await abrir(ESC, ['P1', 'P2'], 'SHP-123');
    expect(rows[0]!.r.pedidos).toBe(2);
    const id = rows[0]!.r.id;
    expect(await chamadoDe('P1')).toBe(id);
    expect(await chamadoDe('P2')).toBe(id);
    expect(await chamadoDe('P3')).toBeNull();
    const c = await db.query<{ owner_id: string; numero: string; aberto_em: Date; aberto_por_email: string }>(
      `select owner_id, numero, aberto_em, aberto_por_email from public.marketplace_chamados where id = $1`,
      [id],
    );
    expect(c.rows[0]).toMatchObject({ owner_id: ESC, numero: 'SHP-123', aberto_por_email: 'esc@teste.test' });
  });

  it('pedido que já está em chamado recusa o lote inteiro (nada fica pela metade)', async () => {
    await expect(abrir(ESC, ['P2', 'P3'])).rejects.toMatchObject({ code: 'MP409' });
    expect(await chamadoDe('P3')).toBeNull();
    expect(await contar(db, `select count(*) as n from public.marketplace_chamados`)).toBe(1);
  });

  it('pedido que não existe, ou lote vazio, é recusado', async () => {
    await expect(abrir(ESC, ['P3', 'NAO-EXISTE'])).rejects.toThrow(/não encontrado.*NAO-EXISTE/);
    await expect(abrir(ESC, [])).rejects.toThrow(/pelo menos um pedido/);
    expect(await chamadoDe('P3')).toBeNull();
  });

  it('o nº do chamado não se repete na mesma empresa (sem diferença de maiúscula)', async () => {
    await expect(abrir(ESC, ['P3'], 'shp-123 ')).rejects.toThrow(/duplicate key|unique/i);
    const { rows } = await abrir(ESC, ['P3'], null);
    expect(rows[0]!.r.pedidos).toBe(1);
  });

  it('excluir o chamado libera os pedidos', async () => {
    const id = await chamadoDe('P1');
    await como(db, ESC, () => db.query(`delete from public.marketplace_chamados where id = $1`, [id]));
    expect(await chamadoDe('P1')).toBeNull();
    expect(await chamadoDe('P2')).toBeNull();
    expect(await chamadoDe('P3')).not.toBeNull();
  });

  it('outro escritório não abre chamado na empresa; anônimo nem chama a função', async () => {
    await expect(abrir(OUTRO, ['P1'])).rejects.toThrow(/Empresa não encontrada/);
    await expect(abrir(CLI, ['P1'], null, 'cliente')).rejects.toThrow(/Empresa não encontrada/);
    await expect(
      como(db, null, () => db.query(`select public.abrir_chamado_marketplace($1, 'shopee', '{P1}', null, '2026-11-24', null, 'x')`, [A])),
    ).rejects.toThrow(/permission denied/);
  });
});
