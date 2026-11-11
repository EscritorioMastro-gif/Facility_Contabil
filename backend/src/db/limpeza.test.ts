/**
 * Migration 0024 (limpeza de 2026-11-11) num Postgres de verdade: o banco
 * montado do zero fica sem o que o sistema não usa, e tabela com registro
 * para a limpeza sem apagar nada.
 */
import { describe, expect, it } from 'vitest';
import { bancoComMigrations, lerMigration } from '../test/pglite.js';

const LIMPEZA = '0024_limpa_tabelas_sem_uso.sql';
const existe = async (db: Awaited<ReturnType<typeof bancoComMigrations>>, t: string) =>
  (await db.query<{ r: string | null }>(`select to_regclass('public.${t}')::text as r`)).rows[0]!.r !== null;

describe('migration 0024 — tabelas sem uso', () => {
  it('banco montado do zero: sem chart_accounts nem tabelas do Contábil; o que o sistema usa continua', async () => {
    const db = await bancoComMigrations();
    try {
      for (const t of ['chart_accounts', 'plano_contas', 'lancamentos', 'historicos_padrao']) {
        expect(await existe(db, t), t).toBe(false);
      }
      for (const t of ['clients', 'statements', 'transactions', 'mapping_rules', 'export_files', 'classificacoes', 'classificacoes_gerais']) {
        expect(await existe(db, t), t).toBe(true);
      }
    } finally {
      await db.close();
    }
  }, 120_000);

  it('chart_accounts com registro: a limpeza para e não apaga nada', async () => {
    const db = await bancoComMigrations(LIMPEZA);
    try {
      await db.exec(`
        insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@b.test');
        insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code)
          values ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'X', '11111111000111', '1');
        insert into public.chart_accounts (owner_id, client_id, codigo_reduzido, nome)
          values ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001', '10', 'CAIXA');
      `);
      await expect(db.exec(`begin; ${lerMigration(LIMPEZA)} commit;`)).rejects.toThrow(/chart_accounts tem 1 registro/);
      await db.exec('rollback');
      expect(await existe(db, 'chart_accounts')).toBe(true);
    } finally {
      await db.close();
    }
  }, 120_000);
});
