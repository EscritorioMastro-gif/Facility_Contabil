/**
 * Migration 0033 (aprovar = aceitar as sugestões da memória) num Postgres de
 * verdade: ao aprovar, a marca de memória/sugestão sai dos lançamentos
 * aprovados; o pendente e o inativado ficam como estão; a sugestão aprovada
 * passa a contar na memória; e o que já estava aprovado antes da 0033 perde a
 * marca na própria migration. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, lerMigration } from '../test/pglite.js';

const MIGRATION = '0033_aprovar_aceita_sugestoes.sql';
const ESC = '11111111-1111-1111-1111-111111111111';
const CLI = '33333333-3333-3333-3333-333333333333';
const A = 'c0000000-0000-0000-0000-00000000000a';
const S = 'd0000000-0000-0000-0000-00000000000a';
const S_OUTRO = 'd0000000-0000-0000-0000-00000000000b'; // ainda sem aprovação
const K_FORN = 'f0000000-0000-0000-0000-0000000000a2';
const K_ENERGIA = 'f0000000-0000-0000-0000-0000000000a3';
const T_SUG = 'e0000000-0000-0000-0000-000000000001'; // sugestão (conferir)
const T_MEM = 'e0000000-0000-0000-0000-000000000002'; // memória
const T_MAO = 'e0000000-0000-0000-0000-000000000003'; // escolhida pelo cliente
const T_PEND = 'e0000000-0000-0000-0000-000000000004'; // sem classificação
const T_INAT = 'e0000000-0000-0000-0000-000000000005'; // inativado, com sugestão
const T_OUTRO = 'e0000000-0000-0000-0000-000000000006'; // sugestão em extrato não aprovado

const DADOS = `
  insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values ('${ESC}', '${ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_FORN}', '${ESC}', '${A}', 'saida', 'FORNECEDORES'),
    ('${K_ENERGIA}', '${ESC}', '${A}', 'saida', 'ENERGIA');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
    ('${S}', '${ESC}', '${A}', 'outubro.ofx', 'ofx', 'classificacao', 'classificacao'),
    ('${S_OUTRO}', '${ESC}', '${A}', 'novembro.ofx', 'ofx', 'classificacao', 'classificacao');
  insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, classificacao_origem, ignorado) values
    ('${T_SUG}', '${ESC}', '${S}', 0, '2026-10-02', 289.50, 'saida', 'PIX DISTRIBUIDOR', '${K_FORN}', 'conferir', false),
    ('${T_MEM}', '${ESC}', '${S}', 1, '2026-10-05', 260.00, 'saida', 'ENERGISA', '${K_ENERGIA}', 'memoria', false),
    ('${T_MAO}', '${ESC}', '${S}', 2, '2026-10-08', 100.00, 'saida', 'BOLETO', '${K_FORN}', null, false),
    ('${T_PEND}', '${ESC}', '${S}', 3, '2026-10-09', 50.00, 'saida', 'TARIFA', null, null, false),
    ('${T_INAT}', '${ESC}', '${S}', 4, '2026-10-10', 9.00, 'saida', 'ESTORNO', '${K_FORN}', 'conferir', true),
    ('${T_OUTRO}', '${ESC}', '${S_OUTRO}', 0, '2026-11-03', 300.00, 'saida', 'PIX OUTRO FORNECEDOR', '${K_FORN}', 'conferir', false);
`;

type Marca = { o: string | null; a: string | null };
const marcas = async (db: PGlite) =>
  Object.fromEntries(
    (
      await db.query<{ id: string } & Marca>(
        `select id, classificacao_origem as o, aprovado_classificacao_id as a from public.transactions order by ordem, id`,
      )
    ).rows.map((r) => [r.id, { o: r.o, a: r.a }]),
  ) as Record<string, Marca>;

const aprovar = (db: PGlite, stmt: string) =>
  como(db, 'service_role', () =>
    db.query<{ r: { qtd: number; pendentes: number; novos: number } }>(
      `select public.aprovar_classificacao($1, $2, 'cliente@teste.test', '200.150.10.20') as r`,
      [stmt, CLI],
    ),
  );

/** A memória da empresa pra uma descrição (sugestão não conferida não conta). */
const memoria = async (db: PGlite, descricao: string) =>
  (
    await como(db, 'service_role', () =>
      db.query<{ m: Array<{ classificacao_id: string }> }>(`select public.memoria_classificacao($1, $2, null) as m`, [
        A,
        [descricao],
      ]),
    )
  ).rows[0]!.m.map((u) => u.classificacao_id);

describe('migration 0033 — aprovar aceita as sugestões da memória', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('antes de aprovar, a sugestão segue marcada e não conta na memória', async () => {
    expect((await marcas(db))[T_SUG]).toEqual({ o: 'conferir', a: null });
    expect(await memoria(db, 'PIX DISTRIBUIDOR')).toEqual([]);
  });

  it('aprovar tira a marca de sugestão e de memória do que foi aprovado', async () => {
    const { rows } = await aprovar(db, S);
    expect(rows[0]!.r).toMatchObject({ qtd: 3, pendentes: 1, novos: 3 });

    const m = await marcas(db);
    expect(m[T_SUG]).toEqual({ o: null, a: K_FORN });
    expect(m[T_MEM]).toEqual({ o: null, a: K_ENERGIA });
    expect(m[T_MAO]).toEqual({ o: null, a: K_FORN });
  });

  it('o pendente, o inativado e o extrato não aprovado ficam como estavam', async () => {
    const m = await marcas(db);
    expect(m[T_PEND]).toEqual({ o: null, a: null });
    expect(m[T_INAT]).toEqual({ o: 'conferir', a: null });
    expect(m[T_OUTRO]).toEqual({ o: 'conferir', a: null });
  });

  it('a sugestão aprovada passa a contar na memória dos próximos extratos', async () => {
    expect(await memoria(db, 'PIX DISTRIBUIDOR')).toEqual([K_FORN]);
  });

  it('aprovar não conta como alteração depois da aprovação, e sem nada novo não aprova de novo', async () => {
    const s = await db.query<{ alterada: string | null }>(
      `select classificacao_alterada_em as alterada from public.statements where id = $1`,
      [S],
    );
    expect(s.rows[0]!.alterada).toBeNull();
    await expect(aprovar(db, S)).rejects.toThrow(/Nada novo para aprovar/);
  });
});

describe('migration 0033 — o que já estava aprovado como sugestão', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations(MIGRATION);
    await db.exec(DADOS);
    // aprovação do jeito antigo: a marca de sugestão ficava
    await aprovar(db, S);
    expect((await marcas(db))[T_SUG]).toEqual({ o: 'conferir', a: K_FORN });
    await db.exec(lerMigration(MIGRATION));
  }, 120_000);
  afterAll(async () => db?.close());

  it('lançamento aprovado deixa de aparecer como sugestão; o resto não muda', async () => {
    const m = await marcas(db);
    expect(m[T_SUG]).toEqual({ o: null, a: K_FORN });
    expect(m[T_MEM]).toEqual({ o: null, a: K_ENERGIA });
    expect(m[T_INAT]).toEqual({ o: 'conferir', a: null });
    expect(m[T_OUTRO]).toEqual({ o: 'conferir', a: null });
  });
});
