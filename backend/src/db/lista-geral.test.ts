/**
 * Migration 0023 num Postgres de verdade (PGlite): lista geral de
 * classificações (só administrador mexe), memória da classificação e a
 * impressão dos extratos que já estavam no banco (trava de duplicado).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como, contar, lerMigration } from '../test/pglite.js';
import { impressaoDoExtrato } from '../statements/impressao.js';

const MIGRATION = '0023_lista_geral_memoria_duplicado.sql';

const DOC = '11111111-1111-1111-1111-111111111111'; // conta principal (administra)
const EQUIPE = '22222222-2222-2222-2222-222222222222'; // da equipe, sem administrar
const CLI = '33333333-3333-3333-3333-333333333333'; // login de cliente (portal)
const C1 = 'c0000000-0000-0000-0000-000000000001';
const C2 = 'c0000000-0000-0000-0000-000000000002';
const S_SET = 'd0000000-0000-0000-0000-000000000001'; // C1, setembro (classificado)
const S_OUT = 'd0000000-0000-0000-0000-000000000002'; // C1, outubro (o "novo")
const S_C2 = 'd0000000-0000-0000-0000-000000000003'; // C2
const K_ENERGIA = 'f0000000-0000-0000-0000-000000000001';
const K_ALUGUEL = 'f0000000-0000-0000-0000-000000000002';
const K_SALARIO = 'f0000000-0000-0000-0000-000000000003';
const K_C2 = 'f0000000-0000-0000-0000-000000000004';

const ANTES_DA_0023 = `
  insert into auth.users (id, email, raw_app_meta_data) values
    ('${DOC}', 'documentos@escritorio.test', '{}'),
    ('${EQUIPE}', 'equipe@escritorio.test', '{}'),
    ('${CLI}', 'cliente@empresa.test', '{"papel":"cliente"}');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values
    ('${DOC}', '${DOC}', true),
    ('${EQUIPE}', '${DOC}', false);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${C1}', '${DOC}', 'EMPRESA UM', '11111111000111', '1'),
    ('${C2}', '${DOC}', 'EMPRESA DOIS', '22222222000122', '2');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_ENERGIA}', '${DOC}', '${C1}', 'saida', 'ENERGIA'),
    ('${K_ALUGUEL}', '${DOC}', '${C1}', 'saida', 'ALUGUEL'),
    ('${K_SALARIO}', '${DOC}', '${C1}', 'saida', 'SALARIO'),
    ('${K_C2}', '${DOC}', '${C2}', 'saida', 'ENERGIA');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status) values
    ('${S_SET}', '${DOC}', '${C1}', 'setembro.ofx', 'ofx', 'classificacao'),
    ('${S_OUT}', '${DOC}', '${C1}', 'outubro.ofx', 'ofx', 'classificacao'),
    ('${S_C2}', '${DOC}', '${C2}', 'c2.ofx', 'ofx', 'classificacao');
  insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id) values
    ('${DOC}', '${S_SET}', 0, '2026-09-02', 150.00, 'saida', 'ENERGISA  conta', '${K_ENERGIA}'),
    ('${DOC}', '${S_SET}', 1, '2026-09-05', 1200.00, 'saida', 'PIX JOAO', '${K_ALUGUEL}'),
    ('${DOC}', '${S_SET}', 2, '2026-09-06', 1200.00, 'saida', 'PIX JOAO', '${K_SALARIO}'),
    ('${DOC}', '${S_SET}', 3, '2026-09-09', 0.35, 'saida', 'PIX JOAO', '${K_SALARIO}'),
    ('${DOC}', '${S_SET}', 4, '2026-09-10', 9.90, 'entrada', 'ENERGISA CONTA', null),
    ('${DOC}', '${S_OUT}', 0, '2026-10-02', 160.00, 'saida', 'ENERGISA CONTA', '${K_ALUGUEL}'),
    ('${DOC}', '${S_C2}', 0, '2026-10-02', 99.00, 'saida', 'ENERGISA CONTA', '${K_C2}');
`;

describe('migration 0023 — lista geral, memória e trava de duplicado', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations(MIGRATION);
    await db.exec(ANTES_DA_0023);
    await db.exec(lerMigration(MIGRATION));
  }, 120_000);
  afterAll(async () => db?.close());

  it('extratos que já estavam no banco ganham a mesma impressão que a API calcula', async () => {
    const { rows } = await db.query<{ impressao: string }>(`select impressao from public.statements where id = '${S_SET}'`);
    const lidos = [
      { date: '2026-09-02', amount_cents: 15_000, direction: 'saida' as const },
      { date: '2026-09-05', amount_cents: 120_000, direction: 'saida' as const },
      { date: '2026-09-06', amount_cents: 120_000, direction: 'saida' as const },
      { date: '2026-09-09', amount_cents: 35, direction: 'saida' as const },
      { date: '2026-09-10', amount_cents: 990, direction: 'entrada' as const },
    ];
    expect(rows[0]!.impressao).toBe(impressaoDoExtrato(lidos));
  });

  it('lista geral: a equipe vê, só administrador inclui/exclui; cliente e anônimo não alcançam', async () => {
    await como(db, DOC, () =>
      db.exec(`insert into public.classificacoes_gerais (direction, nome) values ('saida', 'LIMPEZA E HIGIENE')`),
    );
    const { rows } = await db.query<{ owner_id: string; criado_por: string }>(
      'select owner_id, criado_por from public.classificacoes_gerais',
    );
    expect(rows).toEqual([{ owner_id: DOC, criado_por: DOC }]);

    expect(await como(db, EQUIPE, () => contar(db, 'select count(*) as n from public.classificacoes_gerais'))).toBe(1);
    await expect(
      como(db, EQUIPE, () => db.exec(`insert into public.classificacoes_gerais (direction, nome) values ('saida', 'OUTRA')`)),
    ).rejects.toThrow(/row-level security/);
    await como(db, EQUIPE, () => db.exec(`delete from public.classificacoes_gerais`));
    expect(await contar(db, 'select count(*) as n from public.classificacoes_gerais')).toBe(1);

    expect(await como(db, CLI, () => contar(db, 'select count(*) as n from public.classificacoes_gerais'), 'cliente')).toBe(0);
    await expect(como(db, null, () => contar(db, 'select count(*) as n from public.classificacoes_gerais'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('o mesmo nome (sem diferença de maiúsculas/espaços) não entra duas vezes na lista geral', async () => {
    await expect(
      como(db, DOC, () => db.exec(`insert into public.classificacoes_gerais (direction, nome) values ('saida', ' limpeza e higiene')`)),
    ).rejects.toThrow(/duplicate key/);
  });

  it('excluir da lista geral não tira de quem já escolheu (fica avulsa)', async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.classificacoes_gerais limit 1`);
    await db.exec(`update public.classificacoes set geral_id = '${rows[0]!.id}' where id = '${K_ENERGIA}'`);
    await como(db, DOC, () => db.exec(`delete from public.classificacoes_gerais where id = '${rows[0]!.id}'`));
    const c = await db.query<{ geral_id: string | null }>(`select geral_id from public.classificacoes where id = '${K_ENERGIA}'`);
    expect(c.rows).toEqual([{ geral_id: null }]);
  });

  it('memória: mesma descrição (sem diferença de maiúsculas/espaços) e direção, só da empresa, sem o próprio extrato', async () => {
    const r = await como(db, DOC, () =>
      db.query<{ m: Array<Record<string, unknown>> }>(
        `select public.memoria_classificacao($1, $2, $3) as m`,
        [C1, ['energisa conta', 'PIX JOAO', 'NUNCA VISTO'], S_OUT],
      ),
    );
    const usos = r.rows[0]!.m.map((u) => [u.descricao, u.direction, u.classificacao_id, u.usos]).sort();
    expect(usos).toEqual(
      [
        ['energisa conta', 'saida', K_ENERGIA, 1], // ENERGISA  conta (setembro); outubro (o próprio) e C2 não contam
        ['PIX JOAO', 'saida', K_ALUGUEL, 1],
        ['PIX JOAO', 'saida', K_SALARIO, 2],
      ].sort(),
    );
  });

  it('memória: sugestão ainda não conferida não conta, e gravar a classificação tira a marca', async () => {
    await db.exec(
      `update public.transactions set classificacao_origem = 'conferir' where statement_id = '${S_SET}' and descricao_raw = 'ENERGISA  conta'`,
    );
    const sem = await como(db, DOC, () =>
      db.query<{ m: unknown[] }>(`select public.memoria_classificacao($1, $2, null) as m`, [C1, ['ENERGISA CONTA']]),
    );
    // sobra só outubro (ALUGUEL), já que setembro está "conferir"
    expect(sem.rows[0]!.m).toEqual([
      expect.objectContaining({ descricao: 'ENERGISA CONTA', classificacao_id: K_ALUGUEL, usos: 1 }),
    ]);

    const { rows } = await db.query<{ id: string }>(
      `select id from public.transactions where statement_id = '${S_SET}' and descricao_raw = 'ENERGISA  conta'`,
    );
    // quem grava a classificação é o portal do cliente (migration 0031)
    await como(db, 'service_role', () =>
      db.query(`select public.update_transactions_classificacao_portal($1, $2::jsonb)`, [
        S_SET,
        JSON.stringify([{ id: rows[0]!.id, classificacao_id: K_ENERGIA }]),
      ]),
    );
    const t = await db.query<{ classificacao_origem: string | null }>(
      `select classificacao_origem from public.transactions where id = '${rows[0]!.id}'`,
    );
    expect(t.rows).toEqual([{ classificacao_origem: null }]);
  });

  it('memória: login de cliente e anônimo não leem nada pela API pública', async () => {
    const cli = await como(
      db,
      CLI,
      () => db.query<{ m: unknown[] }>(`select public.memoria_classificacao($1, $2, null) as m`, [C1, ['PIX JOAO']]),
      'cliente',
    );
    expect(cli.rows[0]!.m).toEqual([]);
    await expect(
      como(db, null, () => db.query(`select public.memoria_classificacao($1, $2, null)`, [C1, ['PIX JOAO']])),
    ).rejects.toThrow(/permission denied/);
    // a secret key (portal) lê
    const svc = await como(db, 'service_role', () =>
      db.query<{ m: unknown[] }>(`select public.memoria_classificacao($1, $2, null) as m`, [C1, ['PIX JOAO']]),
    );
    expect(svc.rows[0]!.m).toHaveLength(2);
  });
});
