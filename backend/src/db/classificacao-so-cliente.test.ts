/**
 * Migration 0031 (só o cliente classifica) num Postgres de verdade: o login do
 * escritório — administrador ou não — não muda a classificação de nenhum
 * lançamento, não altera nem apaga o que o cliente já aprovou, só o
 * administrador exclui extrato aprovado e classificação em uso não é
 * renomeada/excluída. O portal (secret key) e o trabalho contábil do
 * escritório (conta, histórico, inativar) seguem funcionando. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, contar } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111'; // conta principal (administra)
const EQP = '22222222-2222-2222-2222-222222222222'; // da equipe, sem administrar
const CLI = '33333333-3333-3333-3333-333333333333'; // login de cliente (portal)
const A = 'c0000000-0000-0000-0000-00000000000a';
const S = 'd0000000-0000-0000-0000-00000000000a'; // o cliente classificou e aprovou
const S_NOVO = 'd0000000-0000-0000-0000-00000000000b'; // recém-enviado, sem aprovação
const K_VENDAS = 'f0000000-0000-0000-0000-0000000000a1';
const K_FORN = 'f0000000-0000-0000-0000-0000000000a2';
const K_ALUGUEL = 'f0000000-0000-0000-0000-0000000000a3';
const K_LIVRE = 'f0000000-0000-0000-0000-0000000000a4'; // nunca usada
const T1 = 'e0000000-0000-0000-0000-000000000001'; // aprovado (VENDAS)
const T2 = 'e0000000-0000-0000-0000-000000000002'; // aprovado (FORNECEDORES)
const T3 = 'e0000000-0000-0000-0000-000000000003'; // pendente
const T9 = 'e0000000-0000-0000-0000-000000000009'; // extrato novo, sugestão da memória

const DADOS = `
  insert into auth.users (id, email) values
    ('${ESC}', 'escritorio@teste.test'), ('${EQP}', 'equipe@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values
    ('${ESC}', '${ESC}', true), ('${EQP}', '${ESC}', false);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_VENDAS}', '${ESC}', '${A}', 'entrada', 'RECEBIMENTO DE VENDAS'),
    ('${K_FORN}', '${ESC}', '${A}', 'saida', 'FORNECEDORES'),
    ('${K_ALUGUEL}', '${ESC}', '${A}', 'saida', 'ALUGUEL'),
    ('${K_LIVRE}', '${ESC}', '${A}', 'saida', 'NUNCA USADA');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
    ('${S}', '${ESC}', '${A}', 'outubro.ofx', 'ofx', 'classificacao', 'classificacao'),
    ('${S_NOVO}', '${ESC}', '${A}', 'novembro.ofx', 'ofx', 'classificacao', 'classificacao');
  insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, classificacao_origem) values
    ('${T1}', '${ESC}', '${S}', 0, '2026-10-05', 1000.00, 'entrada', 'PIX VENDA', '${K_VENDAS}', null),
    ('${T2}', '${ESC}', '${S}', 1, '2026-10-06', 300.00, 'saida', 'BOLETO', '${K_FORN}', null),
    ('${T3}', '${ESC}', '${S}', 2, '2026-10-07', 200.00, 'saida', 'TARIFA', null, null),
    ('${T9}', '${ESC}', '${S_NOVO}', 0, '2026-11-03', 310.00, 'saida', 'BOLETO', '${K_FORN}', 'conferir');
`;

type Lanc = { classificacao_id: string | null; classificacao_origem: string | null; valor: string; descricao_raw: string };

describe('migration 0031 — só o cliente classifica', () => {
  let db: PGlite;
  const lanc = async (id: string) =>
    (
      await db.query<Lanc>(
        `select classificacao_id, classificacao_origem, valor, descricao_raw from public.transactions where id = $1`,
        [id],
      )
    ).rows[0]!;
  const peloPortal = (stmt: string, id: string, k: string | null) =>
    como(db, 'service_role', () =>
      db.query(`select public.update_transactions_classificacao_portal($1, $2::jsonb)`, [
        stmt,
        JSON.stringify([{ id, classificacao_id: k }]),
      ]),
    );

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
    // o cliente aprova o que classificou: T1 e T2 (T3 fica pendente)
    await como(db, 'service_role', () =>
      db.query(`select public.aprovar_classificacao($1, $2, 'cliente@teste.test', '200.150.10.20')`, [S, CLI]),
    );
  }, 120_000);
  afterAll(async () => db?.close());

  it('a função que o escritório usava pra gravar classificação não existe mais', async () => {
    await expect(
      como(db, ESC, () =>
        db.query(`select public.update_transactions_classificacao($1, $2::jsonb)`, [
          S,
          JSON.stringify([{ id: T3, classificacao_id: K_ALUGUEL }]),
        ]),
      ),
    ).rejects.toThrow(/does not exist/);
  });

  it.each([
    ['o administrador', ESC],
    ['quem é da equipe', EQP],
  ])('%s não muda classificação: nem a aprovada, nem a pendente, nem a sugestão da memória', async (_quem, login) => {
    const tentar = (sql: string, params: unknown[]) => como(db, login, () => db.query(sql, params));
    await expect(
      tentar(`update public.transactions set classificacao_id = $2 where id = $1`, [T1, K_ALUGUEL]),
    ).rejects.toThrow(/só pelo cliente/);
    await expect(tentar(`update public.transactions set classificacao_id = null where id = $1`, [T2])).rejects.toThrow(
      /só pelo cliente/,
    );
    await expect(
      tentar(`update public.transactions set classificacao_id = $2 where id = $1`, [T3, K_ALUGUEL]),
    ).rejects.toThrow(/só pelo cliente/);
    await expect(
      tentar(`update public.transactions set classificacao_origem = null where id = $1`, [T9]),
    ).rejects.toThrow(/só pelo cliente/);

    expect((await lanc(T1)).classificacao_id).toBe(K_VENDAS);
    expect((await lanc(T2)).classificacao_id).toBe(K_FORN);
    expect((await lanc(T3)).classificacao_id).toBeNull();
    expect(await lanc(T9)).toMatchObject({ classificacao_id: K_FORN, classificacao_origem: 'conferir' });
  });

  it('o portal do cliente segue classificando', async () => {
    await peloPortal(S, T3, K_ALUGUEL);
    expect((await lanc(T3)).classificacao_id).toBe(K_ALUGUEL);
    await peloPortal(S_NOVO, T9, K_FORN); // aceitar a sugestão tira a marca
    expect(await lanc(T9)).toMatchObject({ classificacao_id: K_FORN, classificacao_origem: null });
  });

  it('o escritório segue com o trabalho contábil no lançamento aprovado (conta, histórico, inativar)', async () => {
    const { rows } = await como(db, EQP, () =>
      db.query<{ n: number }>(`select public.update_transactions_bulk($1, $2::jsonb) as n`, [
        S,
        JSON.stringify([
          { id: T1, conta_contabil: '1101', hist_code: '138', hist_complemento: 'venda', cod_complemento_hist: '0', ignorado: false },
        ]),
      ]),
    );
    expect(rows[0]!.n).toBe(1);
    const t = await db.query<{ conta_contabil: string; classificacao_id: string }>(
      `select conta_contabil, classificacao_id from public.transactions where id = $1`,
      [T1],
    );
    expect(t.rows[0]).toEqual({ conta_contabil: '1101', classificacao_id: K_VENDAS });
  });

  it('lançamento aprovado: o escritório não muda data, valor, tipo nem histórico; o não aprovado pode', async () => {
    for (const set of [`valor = 1`, `data = '2026-10-30'`, `direction = 'saida'`, `descricao_raw = 'OUTRA COISA'`]) {
      await expect(
        como(db, ESC, () => db.query(`update public.transactions set ${set} where id = $1`, [T1])),
      ).rejects.toThrow(/já foi aprovado pelo cliente/);
    }
    expect(await lanc(T1)).toMatchObject({ valor: '1000.00', descricao_raw: 'PIX VENDA' });

    await como(db, ESC, () => db.query(`update public.transactions set descricao_raw = 'BOLETO 123' where id = $1`, [T9]));
    expect((await lanc(T9)).descricao_raw).toBe('BOLETO 123');
  });

  it('classificação em lançamento aprovado não é renomeada; em uso não é excluída', async () => {
    await expect(
      como(db, ESC, () => db.query(`update public.classificacoes set nome = 'DISTRIBUIÇÃO DE LUCROS' where id = $1`, [K_FORN])),
    ).rejects.toThrow(/nome não pode mais mudar/);
    await expect(
      como(db, EQP, () => db.query(`delete from public.classificacoes where id = $1`, [K_FORN])),
    ).rejects.toThrow(/em uso/);
    // ALUGUEL está num lançamento (T3) que o cliente classificou e ainda não aprovou: não exclui, mas renomeia
    await expect(
      como(db, ESC, () => db.query(`delete from public.classificacoes where id = $1`, [K_ALUGUEL])),
    ).rejects.toThrow(/em uso/);
    await como(db, ESC, () => db.query(`update public.classificacoes set nome = 'ALUGUEL DO GALPÃO' where id = $1`, [K_ALUGUEL]));

    // desativar pode; a que nunca foi usada renomeia e exclui
    await como(db, ESC, () => db.query(`update public.classificacoes set ativo = false where id = $1`, [K_FORN]));
    await como(db, ESC, () => db.query(`update public.classificacoes set nome = 'OUTRO NOME' where id = $1`, [K_LIVRE]));
    await como(db, ESC, () => db.query(`delete from public.classificacoes where id = $1`, [K_LIVRE]));

    const nomes = await db.query<{ id: string; nome: string; ativo: boolean }>(
      `select id, nome, ativo from public.classificacoes order by id`,
    );
    expect(nomes.rows).toEqual([
      { id: K_VENDAS, nome: 'RECEBIMENTO DE VENDAS', ativo: true },
      { id: K_FORN, nome: 'FORNECEDORES', ativo: false },
      { id: K_ALUGUEL, nome: 'ALUGUEL DO GALPÃO', ativo: true },
    ]);
    expect((await lanc(T2)).classificacao_id).toBe(K_FORN);
  });

  it('o escritório ainda cria lançamento já preenchido pela memória (envio de extrato)', async () => {
    await como(db, EQP, () =>
      db.query(
        `insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, classificacao_origem)
         values ($1, $2, 1, '2026-11-04', 55.00, 'saida', 'BOLETO', $3, 'memoria')`,
        [ESC, S_NOVO, K_FORN],
      ),
    );
    expect(await contar(db, `select count(*) as n from public.transactions where statement_id = '${S_NOVO}'`)).toBe(2);
  });

  it('reimportar: o escritório não apaga lançamento aprovado; de extrato sem aprovação apaga', async () => {
    await expect(
      como(db, ESC, () => db.query(`delete from public.transactions where statement_id = $1`, [S])),
    ).rejects.toThrow(/não pode ser apagado/);
    expect(await contar(db, `select count(*) as n from public.transactions where statement_id = '${S}'`)).toBe(3);

    await como(db, EQP, () => db.query(`delete from public.transactions where statement_id = $1`, [S_NOVO]));
    expect(await contar(db, `select count(*) as n from public.transactions where statement_id = '${S_NOVO}'`)).toBe(0);
  });

  it('extrato aprovado: só o administrador exclui (lançamentos e aprovações vão junto)', async () => {
    await expect(
      como(db, EQP, () => db.query(`delete from public.statements where id = $1`, [S])),
    ).rejects.toThrow(/só quem administra o escritório/);
    expect(await contar(db, `select count(*) as n from public.statements where id = '${S}'`)).toBe(1);

    // sem aprovação, a equipe toda exclui
    await como(db, EQP, () => db.query(`delete from public.statements where id = $1`, [S_NOVO]));
    expect(await contar(db, `select count(*) as n from public.statements where id = '${S_NOVO}'`)).toBe(0);

    await como(db, ESC, () => db.query(`delete from public.statements where id = $1`, [S]));
    expect(await contar(db, `select count(*) as n from public.statements`)).toBe(0);
    expect(await contar(db, `select count(*) as n from public.transactions`)).toBe(0);
    expect(await contar(db, `select count(*) as n from public.classificacao_aprovacoes`)).toBe(0);
  });
});

describe('migration 0031 — portal do cliente', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
    await como(db, 'service_role', () =>
      db.query(`select public.aprovar_classificacao($1, $2, 'cliente@teste.test', null)`, [S, CLI]),
    );
  }, 120_000);
  afterAll(async () => db?.close());

  it('o cliente troca o que ele mesmo aprovou (fica aguardando nova aprovação) e exclui o próprio extrato', async () => {
    await como(db, 'service_role', () =>
      db.query(`select public.update_transactions_classificacao_portal($1, $2::jsonb)`, [
        S,
        JSON.stringify([{ id: T2, classificacao_id: K_ALUGUEL }]),
      ]),
    );
    const s = await db.query<{ alterado: boolean }>(
      `select classificacao_alterada_em > aprovado_em as alterado from public.statements where id = $1`,
      [S],
    );
    expect(s.rows[0]!.alterado).toBe(true);

    await como(db, 'service_role', () => db.query(`delete from public.statements where id = $1`, [S]));
    expect(await contar(db, `select count(*) as n from public.transactions where statement_id = '${S}'`)).toBe(0);
  });
});
