/**
 * Migration 0027 (travas na entrada do extrato) num Postgres de verdade:
 * sobreposicao_extrato() e os checks das colunas novas. Dados fictícios.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations, como } from '../test/pglite.js';

const ESC = '11111111-1111-1111-1111-111111111111';
const OUTRO_ESC = '22222222-2222-2222-2222-222222222222';
const A = 'c0000000-0000-0000-0000-00000000000a';
const B = 'c0000000-0000-0000-0000-00000000000b';
const X = 'c0000000-0000-0000-0000-0000000000ff'; // de outro escritório
const S_QUINZENA = 'd0000000-0000-0000-0000-00000000000a'; // A: 01 a 15/10
const S_B = 'd0000000-0000-0000-0000-00000000000b'; // B: mesmos lançamentos (outra empresa não conta)
const S_ERRO = 'd0000000-0000-0000-0000-0000000000e1'; // A, com erro — não conta
const S_X = 'd0000000-0000-0000-0000-0000000000ff'; // outro escritório

const DADOS = `
  insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test'), ('${OUTRO_ESC}', 'outro@teste.test');
  insert into public.escritorio_membros (user_id, escritorio_id, admin) values
    ('${ESC}', '${ESC}', true), ('${OUTRO_ESC}', '${OUTRO_ESC}', true);
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1'),
    ('${B}', '${ESC}', 'LOJA BETA', '22222222000122', '2'),
    ('${X}', '${OUTRO_ESC}', 'LOJA DE OUTRO', '33333333000133', '3');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status, origem_modulo, period_start, period_end) values
    ('${S_QUINZENA}', '${ESC}', '${A}', 'quinzena.pdf', 'pdf', 'classificacao', 'classificacao', '2026-10-01', '2026-10-15'),
    ('${S_B}', '${ESC}', '${B}', 'beta.pdf', 'pdf', 'classificacao', 'classificacao', '2026-10-01', '2026-10-31'),
    ('${S_ERRO}', '${ESC}', '${A}', 'erro.pdf', 'pdf', 'erro', 'classificacao', null, null),
    ('${S_X}', '${OUTRO_ESC}', '${X}', 'x.pdf', 'pdf', 'classificacao', 'classificacao', null, null);
  insert into public.transactions (owner_id, statement_id, ordem, data, valor, direction, descricao_raw) values
    ('${ESC}', '${S_QUINZENA}', 0, '2026-10-02', 50.00, 'saida', 'PIX 1'),
    ('${ESC}', '${S_QUINZENA}', 1, '2026-10-02', 50.00, 'saida', 'PIX 2 (mesmo valor e dia)'),
    ('${ESC}', '${S_QUINZENA}', 2, '2026-10-05', 1200.00, 'entrada', 'RECEBIMENTO'),
    ('${ESC}', '${S_QUINZENA}', 3, '2026-10-10', 15.90, 'saida', 'TARIFA'),
    ('${ESC}', '${S_B}', 0, '2026-10-20', 99.00, 'saida', 'B'),
    ('${ESC}', '${S_ERRO}', 0, '2026-10-25', 10.00, 'saida', 'ERRO'),
    ('${OUTRO_ESC}', '${S_X}', 0, '2026-10-26', 10.00, 'saida', 'X');
`;

type Sobreposicao = {
  total: number;
  iguais: number;
  extratos: Array<{ id: string; arquivo_nome: string; iguais: number }>;
};

describe('migration 0027 — travas do extrato', () => {
  let db: PGlite;
  const sobre = (cliente: string, linhas: string[], excluir: string | null = null, quem: string | null = ESC) =>
    como(db, quem, async () =>
      (
        await db.query<{ r: Sobreposicao }>(`select public.sobreposicao_extrato($1::uuid, $2::text[], $3::uuid) as r`, [
          cliente,
          linhas,
          excluir,
        ])
      ).rows[0]!.r,
    );

  // o mês inteiro, que contém a quinzena já importada
  const MES = [
    '2026-10-02|5000|saida',
    '2026-10-02|5000|saida',
    '2026-10-05|120000|entrada',
    '2026-10-10|1590|saida',
    '2026-10-20|9900|saida',
    '2026-10-25|1000|saida',
    '2026-10-26|1000|saida',
    '2026-10-30|777|entrada',
  ];

  beforeAll(async () => {
    db = await bancoComMigrations();
    await db.exec(DADOS);
  }, 120_000);
  afterAll(async () => db?.close());

  it('conta os lançamentos que já estão em outro extrato da mesma empresa (repetidos contam certo)', async () => {
    const r = await sobre(A, MES);
    expect(r.total).toBe(8);
    // 2 Pix de 50 + recebimento + tarifa; o de 20/10 é da BETA, o de 25/10 é de extrato com erro, o de 26/10 de outro escritório
    expect(r.iguais).toBe(4);
    expect(r.extratos).toEqual([expect.objectContaining({ id: S_QUINZENA, arquivo_nome: 'quinzena.pdf', iguais: 4 })]);
  });

  it('um Pix de 50 no extrato novo só bate com um dos dois já gravados', async () => {
    const r = await sobre(A, ['2026-10-02|5000|saida']);
    expect(r).toMatchObject({ total: 1, iguais: 1 });
  });

  it('o extrato que está sendo reimportado não conta contra ele mesmo', async () => {
    const r = await sobre(A, MES, S_QUINZENA);
    expect(r).toMatchObject({ total: 8, iguais: 0, extratos: [] });
  });

  it('login de outro escritório não enxerga nada', async () => {
    const r = await sobre(A, MES, null, OUTRO_ESC);
    expect(r.iguais).toBe(0);
  });

  it('titular_doc e conta_chave só aceitam o formato certo', async () => {
    await expect(db.exec(`update public.statements set titular_doc = '123' where id = '${S_B}'`)).rejects.toThrow();
    await expect(db.exec(`update public.statements set conta_chave = '0123' where id = '${S_B}'`)).rejects.toThrow();
    await db.exec(
      `update public.statements set titular_doc = '22222222000122', conta_chave = '2905360744' where id = '${S_B}'`,
    );
  });
});
