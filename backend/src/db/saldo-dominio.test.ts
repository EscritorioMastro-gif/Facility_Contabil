/**
 * Migration 0029 (o saldo do cadastro anda ao gerar o arquivo do Domínio) num
 * Postgres de verdade: avancar_saldo_cliente() e o trigger do saldo digitado.
 * Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111';
const OUTRO_ESC = '22222222-2222-2222-2222-222222222222';
const CLIENTE_LOGIN = '33333333-3333-3333-3333-333333333333'; // login do portal (papel cliente)
const A = 'c0000000-0000-0000-0000-00000000000a';
const S_AGO = 'd0000000-0000-0000-0000-0000000000a8'; // A: agosto
const S_SET = 'd0000000-0000-0000-0000-0000000000a9'; // A: setembro
const S_OUT = 'd0000000-0000-0000-0000-0000000000aa'; // A: outubro, puxado da Classificação

const DADOS = `
  insert into auth.users (id, email) values
    ('${ESC}', 'escritorio@teste.test'), ('${OUTRO_ESC}', 'outro@teste.test'), ('${CLIENTE_LOGIN}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values
    ('${ESC}', '${ESC}', true), ('${OUTRO_ESC}', '${OUTRO_ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code, saldo_inicial) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1', 1000.00);
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo, period_start, period_end, saldo_inicial) values
    ('${S_AGO}', '${ESC}', '${A}', 'agosto.pdf', 'pdf', 'revisao', 'importacao', '2026-08-01', '2026-08-31', 1000.00),
    ('${S_SET}', '${ESC}', '${A}', 'setembro.pdf', 'pdf', 'revisao', 'importacao', '2026-09-01', '2026-09-30', 1250.00),
    ('${S_OUT}', '${ESC}', '${A}', 'outubro.pdf', 'pdf', 'revisao', 'classificacao', '2026-10-01', '2026-10-31', 1000.00);
  insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw, ignorado) values
    ('${ESC}', '${S_AGO}', 0, '2026-08-05', 300.00, 'entrada', 'RECEBIMENTO', false),
    ('${ESC}', '${S_AGO}', 1, '2026-08-10', 50.00, 'saida', 'TARIFA', false),
    ('${ESC}', '${S_SET}', 0, '2026-09-05', 1000.00, 'entrada', 'RECEBIMENTO', false),
    ('${ESC}', '${S_SET}', 1, '2026-09-10', 200.00, 'saida', 'FORNECEDOR', false),
    ('${ESC}', '${S_SET}', 2, '2026-09-11', 40.50, 'saida', 'TARIFA (inativada: o banco cobrou igual)', true),
    ('${ESC}', '${S_OUT}', 0, '2026-10-03', 9.50, 'saida', 'TARIFA', false);
`;

type Resultado = { atualizado: boolean; saldo_final: number; saldo: number; ate: string | null };
type Cadastro = {
  saldo_inicial: string;
  saldo_inicial_extrato_id: string | null;
  saldo_inicial_ate: string | null;
  saldo_inicial_em: string | null;
};

describe('migration 0029 — saldo do cadastro anda com o arquivo do Domínio', () => {
  let db: PGlite;

  const avancar = (stmt: string, quem: string | null = ESC, papel?: string) =>
    como(
      db,
      quem,
      async () =>
        (await db.query<{ r: Resultado }>('select public.avancar_saldo_cliente($1::uuid) as r', [stmt])).rows[0]!.r,
      papel,
    );

  const cadastro = async () =>
    (
      await db.query<Cadastro>(
        `select saldo_inicial::text, saldo_inicial_extrato_id, saldo_inicial_ate::text, saldo_inicial_em::text
           from public.clients where id = '${A}'`,
      )
    ).rows[0]!;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('gerar setembro: o saldo final (inativados inclusos) vira o saldo do cadastro', async () => {
    const r = await avancar(S_SET);
    // 1250 + 1000 − 200 − 40,50
    expect(r).toMatchObject({ atualizado: true, ate: '2026-09-30' });
    expect(Number(r.saldo)).toBe(2009.5);
    expect(await cadastro()).toMatchObject({
      saldo_inicial: '2009.50',
      saldo_inicial_extrato_id: S_SET,
      saldo_inicial_ate: '2026-09-30',
    });
    expect((await cadastro()).saldo_inicial_em).not.toBeNull();
    // e o saldo_final do extrato acompanha
    const { rows } = await db.query<{ f: string }>(`select saldo_final::text as f from public.statements where id = '${S_SET}'`);
    expect(rows[0]!.f).toBe('2009.50');
  });

  it('gerar agosto DEPOIS de setembro não volta o saldo pra trás', async () => {
    const r = await avancar(S_AGO);
    expect(r).toMatchObject({ atualizado: false, ate: '2026-09-30' });
    expect(Number(r.saldo_final)).toBe(1250);
    expect(await cadastro()).toMatchObject({ saldo_inicial: '2009.50', saldo_inicial_extrato_id: S_SET });
  });

  it('gerar setembro de novo depois de mexer nele atualiza (mesmo período)', async () => {
    await db.exec(`update public.transactions set valor = 250.00 where statement_id = '${S_SET}' and ordem = 1`);
    const r = await avancar(S_SET);
    expect(r.atualizado).toBe(true);
    expect((await cadastro()).saldo_inicial).toBe('1959.50');
  });

  it('mexer em outro campo do cadastro (ou salvar o mesmo saldo) mantém a ligação com o extrato', async () => {
    await como(db, ESC, () =>
      db.exec(`update public.clients set razao_social = 'LOJA ALFA LTDA', saldo_inicial = 1959.50 where id = '${A}'`),
    );
    expect(await cadastro()).toMatchObject({ saldo_inicial_extrato_id: S_SET, saldo_inicial_ate: '2026-09-30' });
  });

  it('saldo digitado no cadastro vale até o próximo arquivo — de qualquer período', async () => {
    await como(db, ESC, () => db.exec(`update public.clients set saldo_inicial = 1000.00 where id = '${A}'`));
    expect(await cadastro()).toMatchObject({
      saldo_inicial: '1000.00',
      saldo_inicial_extrato_id: null,
      saldo_inicial_ate: null,
      saldo_inicial_em: null,
    });

    // recomeçando de agosto: agora agosto move o saldo
    const r = await avancar(S_AGO);
    expect(r).toMatchObject({ atualizado: true, ate: '2026-08-31' });
    expect((await cadastro()).saldo_inicial).toBe('1250.00');
  });

  it('extrato puxado da Classificação segue a mesma regra', async () => {
    const r = await avancar(S_OUT);
    expect(r).toMatchObject({ atualizado: true, ate: '2026-10-31' });
    expect((await cadastro()).saldo_inicial).toBe('990.50');
  });

  it('login de outro escritório, login de cliente e anônimo não mexem no saldo', async () => {
    await expect(avancar(S_SET, OUTRO_ESC)).rejects.toThrow(/Importação não encontrada/);
    await expect(avancar(S_SET, CLIENTE_LOGIN, 'cliente')).rejects.toThrow(/Importação não encontrada/);
    await expect(avancar(S_SET, null)).rejects.toThrow(/permission denied/);
    expect((await cadastro()).saldo_inicial).toBe('990.50');
  });

  it('apagar o extrato que definiu o saldo mantém o valor; sem extratos, o cliente sai normalmente', async () => {
    await db.exec(`delete from public.statements where id = '${S_OUT}'`);
    expect(await cadastro()).toMatchObject({ saldo_inicial: '990.50', saldo_inicial_extrato_id: null });

    // a ligação nova com o extrato não trava a exclusão do cliente
    await db.exec(`update public.clients set saldo_inicial_extrato_id = '${S_SET}' where id = '${A}'`);
    await db.exec(`delete from public.statements where client_id = '${A}'`);
    await db.exec(`delete from public.clients where id = '${A}'`);
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.clients where id = '${A}'`);
    expect(rows[0]!.n).toBe(0);
  });
});
