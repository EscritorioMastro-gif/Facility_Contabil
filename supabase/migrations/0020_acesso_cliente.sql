-- ==========================================================================
-- 0020_acesso_cliente.sql
-- Login do CLIENTE (portal): o escritório convida o e-mail do cliente, que
-- define a própria senha (Supabase Auth — guardada só como hash) e acessa
-- apenas o módulo Classificação das empresas liberadas pra ele. Um login pode
-- ter várias empresas.
--
-- Quem é cliente: auth.users.raw_app_meta_data.papel = 'cliente' (só o
-- backend, com a secret key, consegue gravar app_metadata). Sem papel =
-- escritório, como sempre foi.
--
-- O login de cliente NUNCA lê/grava as tabelas direto: o backend atende o
-- portal com a secret key, conferindo antes se a empresa é dele. As regras
-- "sem_login_de_cliente" abaixo (RESTRICTIVE) garantem isso no banco — pra
-- logins do escritório elas são sempre verdadeiras e não mudam nada.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- cliente_acessos — login do cliente ↔ empresa (clients) que ele pode ver
-- --------------------------------------------------------------------------
create table public.cliente_acessos (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  unique (client_id, user_id)
);
create index cliente_acessos_user_idx on public.cliente_acessos (user_id);
create index cliente_acessos_client_idx on public.cliente_acessos (client_id);
create index cliente_acessos_email_idx on public.cliente_acessos (lower(email));

alter table public.cliente_acessos enable row level security;
create policy cliente_acessos_select on public.cliente_acessos for select
  using (owner_id = auth.uid());
create policy cliente_acessos_insert on public.cliente_acessos for insert
  with check (owner_id = auth.uid());
create policy cliente_acessos_delete on public.cliente_acessos for delete
  using (owner_id = auth.uid());

comment on table public.cliente_acessos is
  'Empresas (clients) que cada login de cliente (auth.users com app_metadata.papel = cliente) pode ver no portal — só o módulo Classificação. owner_id = escritório que liberou.';

-- --------------------------------------------------------------------------
-- statements.enviado_por — extrato enviado pelo próprio cliente no portal
-- --------------------------------------------------------------------------
alter table public.statements
  add column if not exists enviado_por uuid references auth.users (id) on delete set null;

comment on column public.statements.enviado_por is
  'Login do cliente que enviou o extrato pelo portal (módulo Classificação). Null = enviado pelo escritório.';

-- --------------------------------------------------------------------------
-- Login de cliente não acessa nenhuma tabela/arquivo direto (só pelo backend)
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'chart_accounts', 'mapping_rules', 'statements', 'transactions',
    'export_files', 'classificacoes', 'cliente_acessos'
  ]
  loop
    execute format($f$
      create policy %1$I_sem_login_de_cliente on public.%1$I
        as restrictive for all to authenticated
        using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente')
        with check ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente');
    $f$, t);
  end loop;
end $$;

create policy storage_sem_login_de_cliente on storage.objects
  as restrictive for all to authenticated
  using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente')
  with check ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente');

-- --------------------------------------------------------------------------
-- Classificação gravada pelo portal (backend com a secret key). A função do
-- escritório (update_transactions_classificacao) filtra owner_id = auth.uid(),
-- que é nulo com a secret key — por isso uma irmã, só pra service_role.
-- --------------------------------------------------------------------------
create or replace function public.update_transactions_classificacao_portal(
  p_statement uuid,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  update public.transactions t
  set
    classificacao_id = u.classificacao_id,
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(
    id uuid,
    classificacao_id uuid
  )
  where t.id = u.id
    and t.statement_id = p_statement;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.update_transactions_classificacao_portal(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_transactions_classificacao_portal(uuid, jsonb) to service_role;

comment on function public.update_transactions_classificacao_portal is
  'Portal do cliente: grava a classificação dos lançamentos de um extrato. Só a service_role executa — o backend confere antes se o extrato é de uma empresa liberada pro login.';
