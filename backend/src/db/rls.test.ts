/**
 * Regras de acesso (RLS) testadas num Postgres DE VERDADE (PGlite, em memória):
 * todas as migrations rodam sobre um "Supabase mínimo" (papéis anon /
 * authenticated / service_role, auth.uid(), auth.jwt(), storage) e cada caso
 * entra como um login diferente. Os testes dos routers usam um Supabase falso
 * e não enxergam RLS — este arquivo é o que garante que um login não vê o que
 * não deve.
 *
 * Cenário = produção em 2026-10-06, antes da 0022: dois logins do escritório
 * (documentos@ e gabriel@) com 2 clientes cada, liberações de acesso feitas
 * pelo gabriel@, e um login de cliente (portal).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const PASTA = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const MIGRATIONS = readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
const ESCRITORIO_UNICO = '0022_escritorio_unico.sql';
const lerMigration = (f: string) =>
  // pgcrypto não existe no PGlite; gen_random_uuid() já é nativo do Postgres
  readFileSync(PASTA + f, 'utf8').replace(/create extension[^;]*;/gi, '');

const SUPABASE_MINIMO = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
`;

const DOC = '11111111-1111-1111-1111-111111111111'; // documentos@ — 1º login (conta principal)
const GAB = '22222222-2222-2222-2222-222222222222'; // gabriel@ — 2º login do escritório
const CLI = '33333333-3333-3333-3333-333333333333'; // login de cliente (portal)
const NOVO = '44444444-4444-4444-4444-444444444444'; // criado DEPOIS da 0022, fora da equipe
const C_GABRIEL = 'c0000000-0000-0000-0000-000000000001';
const C_PEDRO = 'c0000000-0000-0000-0000-000000000002';
const C_BELLA = 'c0000000-0000-0000-0000-000000000003';
const C_LILI = 'c0000000-0000-0000-0000-000000000004';
const S_BELLA = 'd0000000-0000-0000-0000-000000000001';
const T_BELLA = 'e0000000-0000-0000-0000-000000000001';

const ANTES_DA_0022 = `
  insert into auth.users (id, email, raw_app_meta_data, created_at) values
    ('${DOC}', 'documentos@escritorio.test', '{"provider":"email"}', '2026-10-05 15:54-03'),
    ('${GAB}', 'gabriel@escritorio.test', '{"provider":"email"}', '2026-10-06 14:53-03'),
    ('${CLI}', 'cliente@empresa.test', '{"provider":"email","papel":"cliente"}', '2026-10-06 15:58-03');
  insert into public.clients (id, owner_id, razao_social, cnpj, dominio_code) values
    ('${C_GABRIEL}', '${DOC}', 'GABRIEL PINHEIRO PEREIRA', '11111111000111', '5'),
    ('${C_PEDRO}', '${DOC}', 'PEDRO HENRIQUE', '22222222222', '6'),
    ('${C_BELLA}', '${GAB}', 'BELLA STORE', '33333333000133', '7'),
    ('${C_LILI}', '${GAB}', 'LILI CONFECCAO', '44444444000144', '8');
  insert into public.cliente_acessos (owner_id, client_id, user_id, email) values
    ('${GAB}', '${C_BELLA}', '${CLI}', 'cliente@empresa.test'),
    ('${GAB}', '${C_LILI}', '${CLI}', 'cliente@empresa.test');
  insert into public.statements (id, owner_id, client_id, arquivo_nome, formato, status) values
    ('${S_BELLA}', '${GAB}', '${C_BELLA}', 'agosto.ofx', 'ofx', 'revisao');
  insert into public.transactions (id, owner_id, statement_id, ordem, data, valor, direction, descricao_raw) values
    ('${T_BELLA}', '${GAB}', '${S_BELLA}', 1, '2026-08-01', 10, 'entrada', 'PIX RECEBIDO');
  insert into storage.objects (bucket_id, name) values
    ('statements', '${GAB}/${S_BELLA}/agosto.ofx');
`;

async function bancoComMigrations(ate: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_MINIMO);
  for (const f of MIGRATIONS.filter((m) => m < ate)) await db.exec(lerMigration(f));
  return db;
}

/** Roda `fn` como o login `sub` (null = anônimo), como o PostgREST faz. */
async function como<T>(db: PGlite, sub: string | null, fn: () => Promise<T>, papel?: string): Promise<T> {
  const claims = sub
    ? JSON.stringify({ sub, role: 'authenticated', aud: 'authenticated', app_metadata: papel ? { papel } : {} })
    : '';
  await db.exec(`set role ${sub ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

const contar = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);

describe('escritório único (0022) — regras de acesso num Postgres de verdade', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await bancoComMigrations(ESCRITORIO_UNICO);
    await db.exec(ANTES_DA_0022);
    await db.exec(lerMigration(ESCRITORIO_UNICO));
    await db.exec(`insert into auth.users (id, email, created_at) values ('${NOVO}', 'novo@escritorio.test', now())`);
  }, 120_000);
  afterAll(async () => db?.close());

  it('a equipe de hoje entra no escritório da conta principal (o 1º login), como administradora', async () => {
    const { rows } = await db.query<{ user_id: string; escritorio_id: string; admin: boolean }>(
      'select user_id, escritorio_id, admin from public.escritorio_membros order by user_id',
    );
    expect(rows).toEqual([
      { user_id: DOC, escritorio_id: DOC, admin: true },
      { user_id: GAB, escritorio_id: DOC, admin: true },
    ]);
  });

  it('o que o gabriel@ cadastrou passou pro escritório; criado_por guarda quem cadastrou', async () => {
    const { rows } = await db.query<{ razao_social: string; owner_id: string; criado_por: string }>(
      'select razao_social, owner_id, criado_por from public.clients order by razao_social',
    );
    expect(rows.every((r) => r.owner_id === DOC)).toBe(true);
    expect(rows.find((r) => r.razao_social === 'BELLA STORE')?.criado_por).toBe(GAB);
    expect(rows.find((r) => r.razao_social === 'PEDRO HENRIQUE')?.criado_por).toBe(DOC);
    for (const t of ['statements', 'transactions', 'cliente_acessos']) {
      expect(await contar(db, `select count(*)::int n from public.${t} where owner_id <> '${DOC}'`)).toBe(0);
    }
    expect(await contar(db, `select count(*)::int n from public.statements where criado_por = '${GAB}'`)).toBe(1);
  });

  it('os dois logins da equipe veem os MESMOS clientes, extratos e liberações', async () => {
    for (const login of [DOC, GAB]) {
      await como(db, login, async () => {
        expect(await contar(db, 'select count(*)::int n from public.clients')).toBe(4);
        expect(await contar(db, 'select count(*)::int n from public.statements')).toBe(1);
        expect(await contar(db, 'select count(*)::int n from public.transactions')).toBe(1);
        expect(await contar(db, 'select count(*)::int n from public.cliente_acessos')).toBe(2);
      });
    }
  });

  it('login fora da equipe, login de cliente e anônimo não veem nada', async () => {
    for (const [login, papel] of [[NOVO, undefined], [CLI, 'cliente'], [null, undefined]] as const) {
      await como(
        db,
        login,
        async () => {
          expect(await contar(db, 'select count(*)::int n from public.clients')).toBe(0);
          expect(await contar(db, 'select count(*)::int n from public.transactions')).toBe(0);
          expect(await contar(db, 'select count(*)::int n from storage.objects')).toBe(0);
        },
        papel,
      );
    }
  });

  it('cadastro novo de um membro nasce do escritório, com criado_por = quem cadastrou', async () => {
    const r = await como(db, GAB, () =>
      db.query<{ owner_id: string; criado_por: string }>(
        `insert into public.clients (razao_social, cnpj, dominio_code)
         values ('CLIENTE NOVO', '55555555000155', '9') returning owner_id, criado_por`,
      ),
    );
    expect(r.rows[0]).toEqual({ owner_id: DOC, criado_por: GAB });
    await como(db, DOC, async () => {
      expect(await contar(db, `select count(*)::int n from public.clients where razao_social = 'CLIENTE NOVO'`)).toBe(1);
    });
  });

  it('membro não grava com outro dono; login de fora não grava nada', async () => {
    await expect(
      como(db, GAB, () =>
        db.query(`insert into public.clients (owner_id, razao_social, cnpj, dominio_code)
                  values ('${GAB}', 'X', '66666666000166', '1')`),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      como(db, NOVO, () =>
        db.query(`insert into public.clients (razao_social, cnpj, dominio_code) values ('Y', '77777777000177', '1')`),
      ),
    ).rejects.toThrow();
  });

  it('funções de lote: qualquer membro grava no escritório; login de fora não alcança nada', async () => {
    const lote = JSON.stringify([{ id: T_BELLA, conta_contabil: '123', hist_code: '138', ignorado: false }]);
    const membro = await como(db, DOC, () =>
      db.query<{ n: number }>(`select public.update_transactions_bulk('${S_BELLA}', $1::jsonb) n`, [lote]),
    );
    expect(membro.rows[0]!.n).toBe(1);
    const fora = await como(db, NOVO, () =>
      db.query<{ n: number }>(`select public.update_transactions_bulk('${S_BELLA}', $1::jsonb) n`, [lote]),
    );
    expect(fora.rows[0]!.n).toBe(0);

    const memoria = JSON.stringify([{ direction: 'entrada', pattern: 'PIX RECEBIDO', conta_contabil: '123' }]);
    await como(db, GAB, () => db.query(`select public.learn_classifications('${C_BELLA}', $1::jsonb)`, [memoria]));
    const { rows } = await db.query<{ owner_id: string }>('select owner_id from public.mapping_rules');
    expect(rows).toEqual([{ owner_id: DOC }]);
  });

  it('Storage: arquivo antigo na pasta pessoal do gabriel@ continua visível pra equipe; fora dela, não', async () => {
    await como(db, DOC, async () => {
      expect(await contar(db, 'select count(*)::int n from storage.objects')).toBe(1);
    });
    await como(db, GAB, () =>
      db.query(`insert into storage.objects (bucket_id, name) values ('statements', '${DOC}/novo/setembro.ofx')`),
    );
    await expect(
      como(db, GAB, () =>
        db.query(`insert into storage.objects (bucket_id, name) values ('statements', '${NOVO}/x/y.ofx')`),
      ),
    ).rejects.toThrow(/row-level security/);
    await como(db, NOVO, async () => {
      expect(await contar(db, 'select count(*)::int n from storage.objects')).toBe(0);
    });
  });

  it('a lista da equipe não sai pela API pública', async () => {
    await expect(como(db, GAB, () => db.query('select * from public.escritorio_membros'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('login de cliente segue barrado mesmo se alguém o colocar na equipe (regra restritiva da 0020)', async () => {
    await db.query(`insert into public.escritorio_membros (user_id, escritorio_id) values ('${CLI}', '${DOC}')`);
    try {
      await como(db, CLI, async () => {
        expect(await contar(db, 'select count(*)::int n from public.clients')).toBe(0);
      }, 'cliente');
    } finally {
      await db.query(`delete from public.escritorio_membros where user_id = '${CLI}'`);
    }
  });

  it('apagar a conta principal não leva mais os dados junto (fica bloqueado)', async () => {
    await expect(db.query(`delete from auth.users where id = '${DOC}'`)).rejects.toThrow(/foreign key/);
    expect(await contar(db, 'select count(*)::int n from public.clients')).toBe(5);
  });

  it('tirar alguém da equipe corta o acesso na hora', async () => {
    await db.query(`delete from public.escritorio_membros where user_id = '${GAB}'`);
    await como(db, GAB, async () => {
      expect(await contar(db, 'select count(*)::int n from public.clients')).toBe(0);
    });
  });
});

describe('escritório único (0022) — CNPJ repetido entre dois logins', () => {
  it('a migration para com a explicação e não muda nada', async () => {
    const db = await bancoComMigrations(ESCRITORIO_UNICO);
    try {
      await db.exec(`
        insert into auth.users (id, email, created_at) values
          ('${DOC}', 'documentos@escritorio.test', '2026-10-05'), ('${GAB}', 'gabriel@escritorio.test', '2026-10-06');
        insert into public.clients (owner_id, razao_social, cnpj, dominio_code) values
          ('${DOC}', 'MESMA EMPRESA', '11111111000111', '5'), ('${GAB}', 'MESMA EMPRESA', '11111111000111', '5');
      `);
      await expect(db.exec(lerMigration(ESCRITORIO_UNICO))).rejects.toThrow(/mesmo CNPJ/);
      const tabela = await db.query<{ t: string | null }>(`select to_regclass('public.escritorio_membros')::text t`);
      expect(tabela.rows[0]!.t).toBeNull();
      expect(await contar(db, `select count(*)::int n from public.clients where owner_id = '${GAB}'`)).toBe(1);
    } finally {
      await db.close();
    }
  }, 120_000);
});
