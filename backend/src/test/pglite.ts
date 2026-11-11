/**
 * Postgres DE VERDADE (PGlite, em memória) com um "Supabase mínimo" (papéis
 * anon / authenticated / service_role, auth.uid(), auth.jwt(), storage) pra
 * rodar as migrations e testar RLS e funções do banco como cada login.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const PASTA = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
export const MIGRATIONS = readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();

export const lerMigration = (f: string) =>
  // pgcrypto não existe no PGlite; gen_random_uuid() já é nativo do Postgres
  readFileSync(PASTA + f, 'utf8').replace(/create extension[^;]*;/gi, '');

export const SUPABASE_MINIMO = `
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

/** Banco com o Supabase mínimo e as migrations ANTES de `ate` (sem `ate`, todas). */
export async function bancoComMigrations(ate?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_MINIMO);
  for (const f of MIGRATIONS.filter((m) => ate === undefined || m < ate)) await db.exec(lerMigration(f));
  return db;
}

/** Roda `fn` como o login `sub` (null = anônimo; 'service_role' = a secret key), como o PostgREST faz. */
export async function como<T>(db: PGlite, sub: string | null, fn: () => Promise<T>, papel?: string): Promise<T> {
  if (sub === 'service_role') {
    await db.exec('set role service_role');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }
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

export const contar = async (db: PGlite, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0]!.n);
