/**
 * Migration 0025 (dashboard do módulo Classificação) num Postgres de verdade:
 * o que entra na conta e o que fica de fora. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111';
const CLI = '33333333-3333-3333-3333-333333333333';
const A = 'c0000000-0000-0000-0000-00000000000a';
const B = 'c0000000-0000-0000-0000-00000000000b';
const S_A = 'd0000000-0000-0000-0000-00000000000a'; // A, módulo Classificação
const S_B = 'd0000000-0000-0000-0000-00000000000b'; // B, módulo Classificação
const S_IMP = 'd0000000-0000-0000-0000-0000000000c1'; // A, Importação direta — fica de fora
const S_ERRO = 'd0000000-0000-0000-0000-0000000000c2'; // A, com erro — fica de fora
const K_SHOPEE_A = 'f0000000-0000-0000-0000-0000000000a1';
const K_FORN_A = 'f0000000-0000-0000-0000-0000000000a2';
const K_SHOPEE_B = 'f0000000-0000-0000-0000-0000000000b1';
const K_SHEIN_B = 'f0000000-0000-0000-0000-0000000000b2';

const DADOS = `
  insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test'), ('${CLI}', 'cliente@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values ('${ESC}', '${ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1'),
    ('${B}', '${ESC}', 'LOJA BETA', '22222222000122', '2');
  insert into public.classificacoes (id, owner_id, client_id, direction, nome) values
    ('${K_SHOPEE_A}', '${ESC}', '${A}', 'entrada', 'RECEBIMENTO SHOPEE'),
    ('${K_FORN_A}', '${ESC}', '${A}', 'saida', 'FORNECEDORES'),
    ('${K_SHOPEE_B}', '${ESC}', '${B}', 'entrada', 'Recebimento Shopee'),
    ('${K_SHEIN_B}', '${ESC}', '${B}', 'entrada', 'RECEBIMENTO SHEIN');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo) values
    ('${S_A}', '${ESC}', '${A}', 'a.ofx', 'ofx', 'classificacao', 'classificacao'),
    ('${S_B}', '${ESC}', '${B}', 'b.ofx', 'ofx', 'revisao', 'classificacao'),
    ('${S_IMP}', '${ESC}', '${A}', 'imp.ofx', 'ofx', 'revisao', 'importacao'),
    ('${S_ERRO}', '${ESC}', '${A}', 'erro.ofx', 'ofx', 'erro', 'classificacao');
  insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw, classificacao_id, ignorado) values
    ('${ESC}', '${S_A}', 0, '2026-09-05', 1000.00, 'entrada', 'PIX SHOPEE', '${K_SHOPEE_A}', false),
    ('${ESC}', '${S_A}', 1, '2026-10-05', 500.00, 'entrada', 'PIX SHOPEE', '${K_SHOPEE_A}', false),
    ('${ESC}', '${S_A}', 2, '2026-10-06', 300.00, 'saida', 'BOLETO', '${K_FORN_A}', false),
    ('${ESC}', '${S_A}', 3, '2026-10-07', 999.00, 'saida', 'INATIVADO', '${K_FORN_A}', true),
    ('${ESC}', '${S_A}', 4, '2026-10-08', 40.00, 'saida', 'SEM CLASSIFICACAO', null, false),
    ('${ESC}', '${S_A}', 5, '2025-01-10', 7000.00, 'entrada', 'FORA DO PERIODO', '${K_SHOPEE_A}', false),
    ('${ESC}', '${S_B}', 0, '2026-10-10', 250.00, 'entrada', 'PIX SHOPEE', '${K_SHOPEE_B}', false),
    ('${ESC}', '${S_B}', 1, '2026-10-11', 750.00, 'entrada', 'PIX SHEIN', '${K_SHEIN_B}', false),
    ('${ESC}', '${S_IMP}', 0, '2026-10-12', 9999.00, 'entrada', 'IMPORTACAO DIRETA', '${K_SHOPEE_A}', false);
`;

type Dash = {
  por_classificacao: Array<{ direction: string; nome: string; total: number; qtd: number }>;
  por_mes: Array<{ mes: string; receitas: number; despesas: number }>;
  por_mes_classificacao: Array<{ mes: string; direction: string; nome: string; total: number; qtd: number }>;
  pendentes: { qtd: number; total: number };
};

describe('migration 0025 — dashboard do módulo Classificação', () => {
  let db: PGlite;
  const dash = (clients: string[], de: string | null, ate: string | null, quem: string | null = ESC, papel?: string) =>
    como(
      db,
      quem,
      async () =>
        (
          await db.query<{ d: Dash }>(`select public.dashboard_classificacao($1::uuid[], $2::date, $3::date) as d`, [
            clients,
            de,
            ate,
          ])
        ).rows[0]!.d,
      papel,
    );

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('soma por classificação (mesmo nome em empresas diferentes junta), só classificados e ativos', async () => {
    const d = await dash([A, B], '2026-09-01', '2026-10-31');
    expect(d.por_classificacao.map((l) => [l.direction, l.nome.toUpperCase(), Number(l.total), Number(l.qtd)])).toEqual([
      ['entrada', 'RECEBIMENTO SHOPEE', 1750, 3],
      ['entrada', 'RECEBIMENTO SHEIN', 750, 1],
      ['saida', 'FORNECEDORES', 300, 1],
    ]);
    expect(d.por_mes.map((m) => [m.mes, Number(m.receitas), Number(m.despesas)])).toEqual([
      ['2026-09', 1000, 0],
      ['2026-10', 1500, 300],
    ]);
    expect(
      d.por_mes_classificacao.map((l) => [l.mes, l.direction, l.nome.toUpperCase(), Number(l.total), Number(l.qtd)]),
    ).toEqual([
      ['2026-09', 'entrada', 'RECEBIMENTO SHOPEE', 1000, 1],
      ['2026-10', 'entrada', 'RECEBIMENTO SHEIN', 750, 1],
      ['2026-10', 'entrada', 'RECEBIMENTO SHOPEE', 750, 2],
      ['2026-10', 'saida', 'FORNECEDORES', 300, 1],
    ]);
    expect(d.pendentes).toEqual({ qtd: 1, total: 40 });
  });

  it('respeita a empresa e o período', async () => {
    const soA = await dash([A], '2026-10-01', '2026-10-31');
    expect(soA.por_classificacao.map((l) => [l.nome, Number(l.total)])).toEqual([
      ['RECEBIMENTO SHOPEE', 500],
      ['FORNECEDORES', 300],
    ]);
    const tudo = await dash([A], null, null);
    expect(Number(tudo.por_classificacao.find((l) => l.direction === 'entrada')!.total)).toBe(8500); // inclui 2025
  });

  it('login de cliente não lê nada direto (só pela API, com a secret key)', async () => {
    const d = await dash([A, B], null, null, CLI, 'cliente');
    expect(d).toEqual({ por_classificacao: [], por_mes: [], por_mes_classificacao: [], pendentes: { qtd: 0, total: 0 } });
    const svc = await dash([B], null, null, 'service_role');
    expect(svc.por_classificacao).toHaveLength(2);
  });
});
