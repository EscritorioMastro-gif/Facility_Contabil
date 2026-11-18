/**
 * Migration 0026 (aprovação das classificações pelo cliente) num Postgres de
 * verdade: quem pode aprovar, o que fica registrado e quando a aprovação deixa
 * de valer. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, contar } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111';
const CLI = '33333333-3333-3333-3333-333333333333';
const A = 'c0000000-0000-0000-0000-00000000000a';
const S_OK = 'd0000000-0000-0000-0000-00000000000a'; // tudo classificado
const S_PEND = 'd0000000-0000-0000-0000-00000000000b'; // um lançamento sem classificação
const K_VENDAS = 'f0000000-0000-0000-0000-0000000000a1';
const K_FORN = 'f0000000-0000-0000-0000-0000000000a2';
const K_ALUGUEL = 'f0000000-0000-0000-0000-0000000000a3';
const T1 = 'e0000000-0000-0000-0000-000000000001';
const T2 = 'e0000000-0000-0000-0000-000000000002';
const T3 = 'e0000000-0000-0000-0000-000000000003';

const DADOS = `
  insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values ('${ESC}', '${ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_VENDAS}', '${ESC}', '${A}', 'entrada', 'RECEBIMENTO DE VENDAS'),
    ('${K_FORN}', '${ESC}', '${A}', 'saida', 'FORNECEDORES'),
    ('${K_ALUGUEL}', '${ESC}', '${A}', 'saida', 'ALUGUEL');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
    ('${S_OK}', '${ESC}', '${A}', 'ok.ofx', 'ofx', 'classificacao', 'classificacao'),
    ('${S_PEND}', '${ESC}', '${A}', 'pend.ofx', 'ofx', 'classificacao', 'classificacao');
  insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, ignorado) values
    ('${T1}', '${ESC}', '${S_OK}', 0, '2026-10-05', 1000.00, 'entrada', 'PIX VENDA', '${K_VENDAS}', false),
    ('${T2}', '${ESC}', '${S_OK}', 1, '2026-10-06', 300.00, 'saida', 'BOLETO', '${K_FORN}', false),
    ('${T3}', '${ESC}', '${S_OK}', 2, '2026-10-07', 200.00, 'saida', 'BOLETO 2', '${K_FORN}', false),
    (gen_random_uuid(), '${ESC}', '${S_OK}', 3, '2026-10-08', 999.00, 'saida', 'INATIVADO', null, true),
    (gen_random_uuid(), '${ESC}', '${S_PEND}', 0, '2026-10-05', 50.00, 'saida', 'SEM CLASSIFICACAO', null, false);
`;

type Stmt = {
  aprovado_em: string | null;
  aprovado_por: string | null;
  aprovado_por_email: string | null;
  aprovado_qtd: number | null;
  classificacao_alterada_em: string | null;
};

describe('migration 0026 — aprovação das classificações pelo cliente', () => {
  let db: PGlite;
  const aprovar = (stmt: string) =>
    como(db, 'service_role', () =>
      db.query<{ r: { qtd: number; assinatura: string } }>(
        `select public.aprovar_classificacao($1, $2, $3) as r`,
        [stmt, CLI, 'cliente@teste.test'],
      ),
    );
  const extrato = async (id: string) =>
    (
      await db.query<Stmt>(
        `select aprovado_em, aprovado_por, aprovado_por_email, aprovado_qtd, classificacao_alterada_em
           from public.statements where id = $1`,
        [id],
      )
    ).rows[0]!;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('registra quem aprovou, quando, quantos lançamentos, o resumo e a assinatura', async () => {
    const { rows } = await aprovar(S_OK);
    expect(rows[0]!.r.qtd).toBe(3); // o inativado fica de fora
    expect(rows[0]!.r.assinatura).toMatch(/^[0-9a-f]{64}$/);

    const s = await extrato(S_OK);
    expect(s.aprovado_em).not.toBeNull();
    expect(s.aprovado_por).toBe(CLI);
    expect(s.aprovado_por_email).toBe('cliente@teste.test');
    expect(s.aprovado_qtd).toBe(3);
    expect(s.classificacao_alterada_em).toBeNull();

    const h = (
      await db.query<{ email: string; qtd: number; entradas: string; saidas: string; resumo: unknown }>(
        `select email, qtd, entradas, saidas, resumo from public.classificacao_aprovacoes where statement_id = $1`,
        [S_OK],
      )
    ).rows;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ email: 'cliente@teste.test', qtd: 3 });
    expect(Number(h[0]!.entradas)).toBe(1000);
    expect(Number(h[0]!.saidas)).toBe(500);
    expect(
      (h[0]!.resumo as Array<{ direction: string; nome: string; qtd: number; total: number }>).map((r) => [
        r.direction,
        r.nome,
        Number(r.qtd),
        Number(r.total),
      ]),
    ).toEqual([
      ['entrada', 'RECEBIMENTO DE VENDAS', 1, 1000],
      ['saida', 'FORNECEDORES', 2, 500],
    ]);
  });

  it('sem nenhum lançamento classificado não aprova (em partes: migration 0028)', async () => {
    await expect(aprovar(S_PEND)).rejects.toThrow(/pelo menos um lançamento/);
    expect((await extrato(S_PEND)).aprovado_em).toBeNull();
  });

  it('mudar uma classificação depois marca o extrato como alterado; mexer em outra coisa não', async () => {
    await como(db, ESC, () => db.query(`update public.transactions set conta_contabil = '1101' where id = $1`, [T1]));
    expect((await extrato(S_OK)).classificacao_alterada_em).toBeNull();

    // salvar a mesma classificação de novo também não conta
    await como(db, ESC, () =>
      db.query(`select public.update_transactions_classificacao($1, $2::jsonb)`, [
        S_OK,
        JSON.stringify([{ id: T2, classificacao_id: K_FORN }]),
      ]),
    );
    expect((await extrato(S_OK)).classificacao_alterada_em).toBeNull();

    await como(db, ESC, () =>
      db.query(`select public.update_transactions_classificacao($1, $2::jsonb)`, [
        S_OK,
        JSON.stringify([{ id: T3, classificacao_id: K_ALUGUEL }]),
      ]),
    );
    const s = await extrato(S_OK);
    expect(s.classificacao_alterada_em).not.toBeNull();
    expect(new Date(s.classificacao_alterada_em!).getTime()).toBeGreaterThan(new Date(s.aprovado_em!).getTime());

    // o cliente aprova de novo: volta a valer, e o histórico guarda as duas
    await aprovar(S_OK);
    const s2 = await extrato(S_OK);
    expect(new Date(s2.aprovado_em!).getTime()).toBeGreaterThan(new Date(s2.classificacao_alterada_em!).getTime());
    expect(await contar(db, `select count(*) as n from public.classificacao_aprovacoes where statement_id = '${S_OK}'`)).toBe(2);
  });

  it('o login do escritório não marca aprovação e ninguém altera o histórico', async () => {
    await expect(
      como(db, ESC, () => db.query(`update public.statements set aprovado_em = now() where id = $1`, [S_PEND])),
    ).rejects.toThrow(/só é registrada pelo portal/);
    await expect(
      como(db, ESC, () =>
        db.query(
          `insert into public.statements (owner_id, client_id, arquivo_nome, formato, status, origem_modulo, aprovado_em)
           values ($1, $2, 'x.ofx', 'ofx', 'classificacao', 'classificacao', now())`,
          [ESC, A],
        ),
      ),
    ).rejects.toThrow(/só é registrada pelo portal/);
    await expect(
      como(db, ESC, () => db.query(`select public.aprovar_classificacao($1, $2, 'x')`, [S_PEND, ESC])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      como(db, ESC, () =>
        db.query(
          `insert into public.classificacao_aprovacoes (owner_id, statement_id, client_id, email, qtd, entradas, saidas, resumo, assinatura)
           values ($1, $2, $3, 'x', 1, 0, 0, '[]', 'x')`,
          [ESC, S_PEND, A],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      como(db, 'service_role', () => db.query(`delete from public.classificacao_aprovacoes`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      como(db, 'service_role', () => db.query(`update public.classificacao_aprovacoes set email = 'outro'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('o escritório lê o histórico; o login de cliente não lê direto', async () => {
    const doEscritorio = await como(db, ESC, () => contar(db, `select count(*) as n from public.classificacao_aprovacoes`));
    expect(doEscritorio).toBe(2);
    const doCliente = await como(
      db,
      CLI,
      () => contar(db, `select count(*) as n from public.classificacao_aprovacoes`),
      'cliente',
    );
    expect(doCliente).toBe(0);
  });

  it('excluir o extrato leva o histórico junto', async () => {
    await como(db, ESC, () => db.query(`delete from public.statements where id = $1`, [S_OK]));
    expect(await contar(db, `select count(*) as n from public.classificacao_aprovacoes`)).toBe(0);
  });
});
