/**
 * Migration 0028 (aprovação das classificações em partes) num Postgres de
 * verdade: o cliente aprova o que já classificou, cada parte fica registrada
 * (com IP), classificar o resto não conta como alteração, mexer no que já foi
 * aprovado conta. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, contar, lerMigration } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111';
const CLI = '33333333-3333-3333-3333-333333333333';
const A = 'c0000000-0000-0000-0000-00000000000a';
const S = 'd0000000-0000-0000-0000-00000000000a'; // mês feito em partes
const S_VAZIO = 'd0000000-0000-0000-0000-00000000000b'; // nada classificado
const K_VENDAS = 'f0000000-0000-0000-0000-0000000000a1';
const K_FORN = 'f0000000-0000-0000-0000-0000000000a2';
const K_ALUGUEL = 'f0000000-0000-0000-0000-0000000000a3';
const T1 = 'e0000000-0000-0000-0000-000000000001';
const T2 = 'e0000000-0000-0000-0000-000000000002';
const T3 = 'e0000000-0000-0000-0000-000000000003';
const T4 = 'e0000000-0000-0000-0000-000000000004';

const BASE = `
  insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values ('${ESC}', '${ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_VENDAS}', '${ESC}', '${A}', 'entrada', 'RECEBIMENTO DE VENDAS'),
    ('${K_FORN}', '${ESC}', '${A}', 'saida', 'FORNECEDORES'),
    ('${K_ALUGUEL}', '${ESC}', '${A}', 'saida', 'ALUGUEL');
`;

type Stmt = {
  aprovado_em: string | null;
  aprovado_qtd: number | null;
  aprovado_pendentes: number | null;
  classificacao_alterada_em: string | null;
};
const ms = (v: string | Date) => new Date(v).getTime();
type Log = { qtd: number; pendentes: number; novos: number | null; ip: string | null; email: string };

const extrato = async (db: PGlite, id: string) =>
  (
    await db.query<Stmt>(
      `select aprovado_em, aprovado_qtd, aprovado_pendentes, classificacao_alterada_em from public.statements where id = $1`,
      [id],
    )
  ).rows[0]!;

const aprovados = async (db: PGlite, stmt: string) =>
  Object.fromEntries(
    (
      await db.query<{ id: string; a: string | null }>(
        `select id, aprovado_classificacao_id as a from public.transactions where statement_id = $1 order by ordem`,
        [stmt],
      )
    ).rows.map((r) => [r.id, r.a]),
  );

const log = async (db: PGlite, stmt: string) =>
  (
    await db.query<Log>(
      `select qtd, pendentes, novos, ip, email from public.classificacao_aprovacoes where statement_id = $1 order by aprovado_em`,
      [stmt],
    )
  ).rows;

/** O portal salva a classificação com a secret key (update_transactions_classificacao_portal). */
const classificarPeloPortal = (db: PGlite, stmt: string, id: string, k: string | null) =>
  como(db, 'service_role', () =>
    db.query(`select public.update_transactions_classificacao_portal($1, $2::jsonb)`, [
      stmt,
      JSON.stringify([{ id, classificacao_id: k }]),
    ]),
  );

describe('migration 0028 — aprovação em partes', () => {
  let db: PGlite;
  const aprovar = (stmt: string, ip: string | null = '200.150.10.20') =>
    como(db, 'service_role', () =>
      db.query<{ r: { qtd: number; pendentes: number; novos: number } }>(
        `select public.aprovar_classificacao($1, $2, $3, $4) as r`,
        [stmt, CLI, 'cliente@teste.test', ip],
      ),
    );

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(`${BASE}
      insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
        ('${S}', '${ESC}', '${A}', 'mes.ofx', 'ofx', 'classificacao', 'classificacao'),
        ('${S_VAZIO}', '${ESC}', '${A}', 'vazio.ofx', 'ofx', 'classificacao', 'classificacao');
      insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, ignorado) values
        ('${T1}', '${ESC}', '${S}', 0, '2026-10-05', 1000.00, 'entrada', 'PIX VENDA', '${K_VENDAS}', false),
        ('${T2}', '${ESC}', '${S}', 1, '2026-10-06', 300.00, 'saida', 'BOLETO', '${K_FORN}', false),
        ('${T3}', '${ESC}', '${S}', 2, '2026-10-07', 200.00, 'saida', 'BOLETO 2', null, false),
        ('${T4}', '${ESC}', '${S}', 3, '2026-10-08', 80.00, 'saida', 'TARIFA', null, false),
        (gen_random_uuid(), '${ESC}', '${S}', 4, '2026-10-09', 999.00, 'saida', 'INATIVADO', null, true),
        (gen_random_uuid(), '${ESC}', '${S_VAZIO}', 0, '2026-10-05', 50.00, 'saida', 'SEM CLASSIFICACAO', null, false);
    `);
  }, 120_000);
  afterAll(async () => db?.close());

  it('aprova só o que já está classificado, com o que falta e o IP no registro', async () => {
    const { rows } = await aprovar(S);
    expect(rows[0]!.r).toMatchObject({ qtd: 2, pendentes: 2, novos: 2 });

    expect(await extrato(db, S)).toMatchObject({ aprovado_qtd: 2, aprovado_pendentes: 2, classificacao_alterada_em: null });
    expect(await aprovados(db, S)).toMatchObject({ [T1]: K_VENDAS, [T2]: K_FORN, [T3]: null, [T4]: null });
    expect(await log(db, S)).toEqual([
      { qtd: 2, pendentes: 2, novos: 2, ip: '200.150.10.20', email: 'cliente@teste.test' },
    ]);
  });

  it('aprovar de novo sem nada novo não duplica o registro', async () => {
    await expect(aprovar(S)).rejects.toThrow(/Nada novo para aprovar/);
    expect(await log(db, S)).toHaveLength(1);
  });

  it('classificar o que faltava NÃO é alteração; a próxima parte registra só os novos', async () => {
    await classificarPeloPortal(db, S, T3, K_FORN);
    expect((await extrato(db, S)).classificacao_alterada_em).toBeNull();

    const { rows } = await aprovar(S, null);
    expect(rows[0]!.r).toMatchObject({ qtd: 3, pendentes: 1, novos: 1 });
    expect(await extrato(db, S)).toMatchObject({ aprovado_qtd: 3, aprovado_pendentes: 1 });
    expect((await log(db, S)).map((l) => [l.qtd, l.pendentes, l.novos, l.ip])).toEqual([
      [2, 2, 2, '200.150.10.20'],
      [3, 1, 1, null],
    ]);
  });

  it('o escritório não classifica — nem o pendente (só o cliente: migration 0031)', async () => {
    await expect(
      como(db, ESC, () => db.query(`update public.transactions set classificacao_id = $2 where id = $1`, [T4, K_ALUGUEL])),
    ).rejects.toThrow(/só pelo cliente/);
    expect((await extrato(db, S)).classificacao_alterada_em).toBeNull();
    // continua parcial: o cliente aprovou 3 e faltava 1
    expect(await extrato(db, S)).toMatchObject({ aprovado_qtd: 3, aprovado_pendentes: 1 });
  });

  it('mudar um lançamento JÁ aprovado marca alterado; a nova aprovação conta só ele e o que faltava', async () => {
    await classificarPeloPortal(db, S, T4, K_ALUGUEL); // o que faltava: não é alteração
    expect((await extrato(db, S)).classificacao_alterada_em).toBeNull();
    await classificarPeloPortal(db, S, T2, K_ALUGUEL); // já aprovado: é
    const s = await extrato(db, S);
    expect(s.classificacao_alterada_em).not.toBeNull();
    expect(ms(s.classificacao_alterada_em!)).toBeGreaterThan(ms(s.aprovado_em!));

    const { rows } = await aprovar(S);
    expect(rows[0]!.r).toMatchObject({ qtd: 4, pendentes: 0, novos: 2 }); // T2 mudou + T4 novo
    expect(await extrato(db, S)).toMatchObject({ aprovado_qtd: 4, aprovado_pendentes: 0 });
    expect(await aprovados(db, S)).toMatchObject({ [T1]: K_VENDAS, [T2]: K_ALUGUEL, [T3]: K_FORN, [T4]: K_ALUGUEL });
    expect(await log(db, S)).toHaveLength(3);
  });

  it('apagar a classificação de um aprovado também é alteração', async () => {
    await classificarPeloPortal(db, S, T1, null);
    const s = await extrato(db, S);
    expect(ms(s.classificacao_alterada_em!)).toBeGreaterThan(ms(s.aprovado_em!));
  });

  it('sem nenhum lançamento classificado não aprova', async () => {
    await expect(aprovar(S_VAZIO)).rejects.toThrow(/pelo menos um lançamento/);
    expect((await extrato(db, S_VAZIO)).aprovado_em).toBeNull();
  });

  it('o login do escritório não grava a aprovação no lançamento nem a parcial no extrato', async () => {
    await expect(
      como(db, ESC, () =>
        db.query(`update public.transactions set aprovado_classificacao_id = $2 where id = $1`, [T3, K_VENDAS]),
      ),
    ).rejects.toThrow(/só é registrada pelo portal/);
    await expect(
      como(db, ESC, () =>
        db.query(
          `insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw, aprovado_classificacao_id)
           values ($1, $2, 9, '2026-10-10', 1, 'saida', 'X', $3)`,
          [ESC, S_VAZIO, K_FORN],
        ),
      ),
    ).rejects.toThrow(/só é registrada pelo portal/);
    await expect(
      como(db, ESC, () => db.query(`update public.statements set aprovado_pendentes = 5 where id = $1`, [S])),
    ).rejects.toThrow(/só é registrada pelo portal/);
    await expect(
      como(db, ESC, () => db.query(`select public.aprovar_classificacao($1, $2, 'x', 'y')`, [S, ESC])),
    ).rejects.toThrow(/permission denied/);
  });

  it('o escritório lê o IP no histórico', async () => {
    const ips = await como(db, ESC, () =>
      db.query<{ ip: string | null }>(`select ip from public.classificacao_aprovacoes where statement_id = $1 order by aprovado_em`, [S]),
    );
    expect(ips.rows.map((r) => r.ip)).toEqual(['200.150.10.20', null, '200.150.10.20']);
  });
});

describe('migration 0028 — o que já estava aprovado antes dela', () => {
  const S_OK = 'd0000000-0000-0000-0000-0000000000c1'; // aprovado e sem mudança
  const S_ALT = 'd0000000-0000-0000-0000-0000000000c2'; // aprovado e alterado depois
  const T_OK = 'e0000000-0000-0000-0000-0000000000c1';
  const T_ALT = 'e0000000-0000-0000-0000-0000000000c2';
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations('0028');
    await db.exec(`${BASE}
      insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
        ('${S_OK}', '${ESC}', '${A}', 'ok.ofx', 'ofx', 'classificacao', 'classificacao'),
        ('${S_ALT}', '${ESC}', '${A}', 'alt.ofx', 'ofx', 'classificacao', 'classificacao');
      insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, ignorado) values
        ('${T_OK}', '${ESC}', '${S_OK}', 0, '2026-10-05', 10.00, 'saida', 'A', '${K_FORN}', false),
        ('${T_ALT}', '${ESC}', '${S_ALT}', 0, '2026-10-05', 10.00, 'saida', 'B', '${K_FORN}', false);
    `);
    // aprovação do jeito da 0026 (tudo classificado, 3 argumentos)
    for (const s of [S_OK, S_ALT]) {
      await como(db, 'service_role', () =>
        db.query(`select public.aprovar_classificacao($1, $2, 'cliente@teste.test')`, [s, CLI]),
      );
    }
    await como(db, ESC, () =>
      db.query(`select public.update_transactions_classificacao($1, $2::jsonb)`, [
        S_ALT,
        JSON.stringify([{ id: T_ALT, classificacao_id: K_ALUGUEL }]),
      ]),
    );
    await db.exec(lerMigration('0028_aprovacao_em_partes.sql'));
  }, 120_000);
  afterAll(async () => db?.close());

  it('aprovado sem mudança: lançamentos marcados como aprovados e parcial = 0', async () => {
    expect(await extrato(db, S_OK)).toMatchObject({ aprovado_qtd: 1, aprovado_pendentes: 0, classificacao_alterada_em: null });
    expect(await aprovados(db, S_OK)).toEqual({ [T_OK]: K_FORN });
    // nada novo pra aprovar
    await expect(
      como(db, 'service_role', () =>
        db.query(`select public.aprovar_classificacao($1, $2, 'cliente@teste.test')`, [S_OK, CLI]),
      ),
    ).rejects.toThrow(/Nada novo para aprovar/);
  });

  it('alterado depois da aprovação: continua alterado e o cliente consegue aprovar de novo', async () => {
    const s = await extrato(db, S_ALT);
    expect(ms(s.classificacao_alterada_em!)).toBeGreaterThan(ms(s.aprovado_em!));
    expect(await aprovados(db, S_ALT)).toEqual({ [T_ALT]: null });
    const { rows } = await como(db, 'service_role', () =>
      db.query<{ r: { qtd: number; novos: number } }>(
        `select public.aprovar_classificacao($1, $2, 'cliente@teste.test') as r`,
        [S_ALT, CLI],
      ),
    );
    expect(rows[0]!.r).toMatchObject({ qtd: 1, novos: 1 });
    expect(await aprovados(db, S_ALT)).toEqual({ [T_ALT]: K_ALUGUEL });
  });

  it('o histórico antigo fica com pendentes = 0 e novos em branco', async () => {
    const h = await log(db, S_OK);
    expect(h).toEqual([{ qtd: 1, pendentes: 0, novos: null, ip: null, email: 'cliente@teste.test' }]);
    expect(await contar(db, `select count(*) as n from public.classificacao_aprovacoes`)).toBe(3);
  });
});
