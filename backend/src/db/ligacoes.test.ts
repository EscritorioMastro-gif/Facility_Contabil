/**
 * Duas tabelas que a API junta têm UMA ligação só (migration 0032).
 *
 * O backend lê `statements` com `client:clients(...)`, sem dizer por qual
 * chave estrangeira. Se as duas tabelas tiverem mais de uma ligação — foi o
 * que a 0029 fez com clients.saldo_inicial_extrato_id — o PostgREST responde
 * PGRST201 e TODA leitura de extrato com o nome do cliente cai ("Falha em
 * listar importações", 2026-11-24). Os testes das rotas usam um Supabase de
 * mentira e não enxergam isso; este confere no banco de verdade.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bancoComMigrations } from '../test/pglite.js';

/** Pares de tabelas do sistema com mais de uma chave estrangeira entre si (em qualquer sentido). */
async function paresComMaisDeUmaLigacao(db: PGlite) {
  const { rows } = await db.query<{ tabelas: string; chaves: string[] }>(`
    select least(a.relname, b.relname) || ' <-> ' || greatest(a.relname, b.relname) as tabelas,
           array_agg(c.conname::text order by c.conname) as chaves
      from pg_constraint c
      join pg_class a on a.oid = c.conrelid
      join pg_class b on b.oid = c.confrelid
      join pg_namespace n on n.oid = a.relnamespace
     where c.contype = 'f'
       and n.nspname = 'public'
       and b.relnamespace = a.relnamespace
       and a.oid <> b.oid
     group by 1
    having count(*) > 1
  `);
  return rows;
}

describe('ligações entre as tabelas (embed do PostgREST)', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations();
  }, 120_000);
  afterAll(async () => db?.close());

  it('nenhum par de tabelas tem mais de uma chave estrangeira entre si', async () => {
    // se precisar mesmo de uma segunda ligação: todo select que junta as duas
    // tabelas tem que dizer qual usar (ex.: client:clients!client_id(...))
    expect(await paresComMaisDeUmaLigacao(db)).toEqual([]);
  });

  it('o defeito que a 0032 conserta: antes dela, statements e clients tinham duas', async () => {
    const antes = await bancoComMigrations('0032');
    try {
      expect(await paresComMaisDeUmaLigacao(antes)).toEqual([
        {
          tabelas: 'clients <-> statements',
          chaves: ['clients_saldo_inicial_extrato_id_fkey', 'statements_client_id_fkey'],
        },
      ]);
    } finally {
      await antes.close();
    }
  }, 120_000);

  it('apagar o extrato que definiu o saldo solta a ligação no cadastro e mantém o saldo', async () => {
    const ESC = '11111111-1111-1111-1111-111111111111';
    const A = 'c0000000-0000-0000-0000-00000000000a';
    const S = 'd0000000-0000-0000-0000-00000000000a';
    await db.exec(`
      insert into auth.users (id, email) values ('${ESC}', 'escritorio@teste.test');
      insert into public.escritorio_membros (user_id, escritorio_id, admin) values ('${ESC}', '${ESC}', true);
      insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code, saldo_inicial) values
        ('${A}', '${ESC}', 'LOJA ALFA', '11111111000111', '1', 500.00);
      insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status) values
        ('${S}', '${ESC}', '${A}', 'setembro.ofx', 'ofx', 'gerado');
      update public.clients
         set saldo_inicial = 990.50, saldo_inicial_extrato_id = '${S}', saldo_inicial_ate = '2026-09-30', saldo_inicial_em = now()
       where id = '${A}';
      delete from public.statements where id = '${S}';
    `);
    const { rows } = await db.query<{ saldo: string; extrato: string | null; ate: string | null }>(
      `select saldo_inicial::text as saldo, saldo_inicial_extrato_id as extrato, saldo_inicial_ate::text as ate
         from public.clients where id = $1`,
      [A],
    );
    expect(rows).toEqual([{ saldo: '990.50', extrato: null, ate: '2026-09-30' }]);
  });
});
