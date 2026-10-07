-- ==========================================================================
-- 0022_escritorio_unico.sql — todos os logins do escritório no MESMO espaço
--
-- Até aqui cada login do escritório só via o que ELE cadastrou (owner_id =
-- auth.uid()): com dois logins (documentos@ e gabriel@), os clientes de um
-- "sumiam" pro outro. Agora:
--
--   * public.escritorio_membros: cada login da equipe aponta pro escritório.
--     O escritório é identificado pelo id do 1º login (a conta principal) —
--     o que já é dele não muda de dono.
--   * public.escritorio_atual(): o escritório de quem está logado; null = não
--     é da equipe → não vê nada. Login de CLIENTE (portal) nunca é membro.
--   * as regras de acesso passam de "owner_id = auth.uid()" para
--     "owner_id = escritório de quem está logado";
--   * os dados dos outros logins da equipe passam pro escritório;
--   * criado_por (clientes e extratos): quem cadastrou de verdade;
--   * apagar um login NÃO apaga mais os dados (on delete cascade → restrict):
--     antes, apagar a conta principal no painel do Supabase levava todos os
--     clientes, extratos e lançamentos junto — e o plano free não tem backup.
--
-- Tudo dentro da transação do runner: se qualquer passo falhar, nada muda.
-- ==========================================================================

-- 1. equipe ------------------------------------------------------------------
create table if not exists public.escritorio_membros (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  escritorio_id uuid not null references auth.users (id) on delete restrict,
  admin         boolean not null default false,
  criado_em     timestamptz not null default now()
);
create index if not exists escritorio_membros_escritorio_idx on public.escritorio_membros (escritorio_id);
-- só o backend (secret key) e as funções abaixo leem; pela API pública, ninguém
alter table public.escritorio_membros enable row level security;
revoke all on table public.escritorio_membros from anon, authenticated;

comment on table public.escritorio_membros is
  'Logins da equipe do escritório. escritorio_id = id da conta principal (dona dos dados). Login de cliente (portal) nunca entra aqui.';

-- 2. escritório de quem está logado ------------------------------------------
create or replace function public.escritorio_atual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.escritorio_id from public.escritorio_membros m where m.user_id = auth.uid()
$$;
revoke all on function public.escritorio_atual() from public, anon;
grant execute on function public.escritorio_atual() to authenticated, service_role;

-- 1ª pasta do caminho no Storage é do escritório? (a do escritório — onde tudo
-- é gravado daqui pra frente — ou a pessoal de alguém da equipe, pra arquivo antigo)
create or replace function public.pasta_do_escritorio(pasta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.escritorio_membros m
     where m.escritorio_id = public.escritorio_atual()
       and (m.escritorio_id::text = pasta or m.user_id::text = pasta)
  )
$$;
revoke all on function public.pasta_do_escritorio(text) from public, anon;
grant execute on function public.pasta_do_escritorio(text) to authenticated, service_role;

-- 3. a equipe de hoje: todo login que não é de cliente entra no escritório do
--    1º login criado (a conta principal). Todos como administradores.
do $$
declare
  dono uuid;
begin
  select u.id into dono
    from auth.users u
   where coalesce(u.raw_app_meta_data ->> 'papel', '') <> 'cliente'
   order by u.created_at, u.id
   limit 1;
  if dono is null then
    return; -- banco novo, sem login: o 1º que usar o sistema vira a conta principal (backend)
  end if;
  insert into public.escritorio_membros (user_id, escritorio_id, admin)
  select u.id, dono, true
    from auth.users u
   where coalesce(u.raw_app_meta_data ->> 'papel', '') <> 'cliente'
  on conflict (user_id) do nothing;
end $$;

-- 4. quem cadastrou de verdade (ANTES de juntar: hoje o dono É quem cadastrou)
alter table public.clients add column if not exists criado_por uuid references auth.users (id) on delete set null;
alter table public.statements add column if not exists criado_por uuid references auth.users (id) on delete set null;
update public.clients set criado_por = owner_id where criado_por is null;
update public.statements set criado_por = coalesce(enviado_por, owner_id) where criado_por is null;
alter table public.clients alter column criado_por set default auth.uid();
alter table public.statements alter column criado_por set default auth.uid();
comment on column public.clients.criado_por is 'Login que cadastrou o cliente (o dono, owner_id, é o escritório).';
comment on column public.statements.criado_por is 'Login que subiu o extrato — da equipe ou o cliente pelo portal.';

-- 5. os dados dos outros logins da equipe passam pro escritório ---------------
do $$
declare
  esc uuid;
  t text;
begin
  select m.escritorio_id into esc from public.escritorio_membros m limit 1;
  if esc is null then
    return;
  end if;

  -- clients tem unique (owner_id, cnpj): o mesmo CNPJ em dois logins não cabe
  -- num escritório só — pára aqui sem mudar nada
  if exists (
    select 1
      from public.clients c
     where c.owner_id in (select m.user_id from public.escritorio_membros m)
     group by c.cnpj
    having count(*) > 1
  ) then
    raise exception 'O mesmo CNPJ está cadastrado em mais de um login do escritório — exclua a duplicata e rode as migrations de novo.';
  end if;

  foreach t in array array[
    'clients', 'chart_accounts', 'mapping_rules', 'statements', 'transactions',
    'export_files', 'classificacoes', 'cliente_acessos'
  ]
  loop
    execute format(
      'update public.%I set owner_id = $1
        where owner_id <> $1 and owner_id in (select m.user_id from public.escritorio_membros m)',
      t
    ) using esc;
  end loop;
end $$;

-- 6. dono de cadastro novo = escritório de quem cadastra; apagar login não
--    apaga mais os dados
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'chart_accounts', 'mapping_rules', 'statements', 'transactions',
    'export_files', 'classificacoes', 'cliente_acessos'
  ]
  loop
    execute format($f$
      alter table public.%1$I alter column owner_id set default public.escritorio_atual();
      alter table public.%1$I drop constraint if exists %1$I_owner_id_fkey;
      alter table public.%1$I add constraint %1$I_owner_id_fkey
        foreign key (owner_id) references auth.users (id) on delete restrict;
    $f$, t);
  end loop;
end $$;

-- 7. regras de acesso: dono = escritório de quem está logado ------------------
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'chart_accounts', 'mapping_rules', 'statements', 'transactions', 'export_files', 'classificacoes'
  ]
  loop
    execute format($f$
      drop policy if exists %1$I_select on public.%1$I;
      drop policy if exists %1$I_insert on public.%1$I;
      drop policy if exists %1$I_update on public.%1$I;
      drop policy if exists %1$I_delete on public.%1$I;
      create policy %1$I_select on public.%1$I for select to authenticated
        using (owner_id = (select public.escritorio_atual()));
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (owner_id = (select public.escritorio_atual()));
      create policy %1$I_update on public.%1$I for update to authenticated
        using (owner_id = (select public.escritorio_atual()))
        with check (owner_id = (select public.escritorio_atual()));
      create policy %1$I_delete on public.%1$I for delete to authenticated
        using (owner_id = (select public.escritorio_atual()));
    $f$, t);
  end loop;
end $$;

drop policy if exists cliente_acessos_select on public.cliente_acessos;
drop policy if exists cliente_acessos_insert on public.cliente_acessos;
drop policy if exists cliente_acessos_delete on public.cliente_acessos;
create policy cliente_acessos_select on public.cliente_acessos for select to authenticated
  using (owner_id = (select public.escritorio_atual()));
create policy cliente_acessos_insert on public.cliente_acessos for insert to authenticated
  with check (owner_id = (select public.escritorio_atual()));
create policy cliente_acessos_delete on public.cliente_acessos for delete to authenticated
  using (owner_id = (select public.escritorio_atual()));

-- Storage: arquivos dos extratos e do Domínio
drop policy if exists "statements_read_own" on storage.objects;
drop policy if exists "statements_insert_own" on storage.objects;
drop policy if exists "statements_update_own" on storage.objects;
drop policy if exists "statements_delete_own" on storage.objects;
drop policy if exists "exports_read_own" on storage.objects;
drop policy if exists "exports_insert_own" on storage.objects;
drop policy if exists "exports_update_own" on storage.objects;
drop policy if exists "exports_delete_own" on storage.objects;

create policy "statements_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'statements' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "statements_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "statements_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'statements' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "statements_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'statements' and public.pasta_do_escritorio((storage.foldername(name))[1]));

create policy "exports_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'exports' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "exports_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'exports' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "exports_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'exports' and public.pasta_do_escritorio((storage.foldername(name))[1]));
create policy "exports_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'exports' and public.pasta_do_escritorio((storage.foldername(name))[1]));

-- 8. funções que filtravam/gravavam pelo login → escritório -------------------
create or replace function public.update_transactions_bulk(
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
    conta_contabil       = nullif(btrim(u.conta_contabil), ''),
    hist_code            = nullif(btrim(u.hist_code), ''),
    hist_complemento     = u.hist_complemento,
    cod_complemento_hist = coalesce(nullif(btrim(u.cod_complemento_hist), ''), '0'),
    ignorado             = coalesce(u.ignorado, false),
    origem_preenchimento = coalesce(nullif(btrim(u.origem_preenchimento), ''), t.origem_preenchimento),
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(
    id                   uuid,
    conta_contabil       text,
    hist_code            text,
    hist_complemento     text,
    cod_complemento_hist text,
    ignorado             boolean,
    origem_preenchimento text
  )
  where t.id = u.id
    and t.statement_id = p_statement
    and t.owner_id = (select public.escritorio_atual());

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.update_transactions_classificacao(
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
    and t.statement_id = p_statement
    and t.owner_id = (select public.escritorio_atual());

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.learn_classifications(p_client uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.mapping_rules (
    owner_id, client_id, direction, match_type, pattern,
    conta_contabil, hist_code, hist_complemento_template,
    auto, prioridade, hits, last_used_at
  )
  select
    public.escritorio_atual(), p_client, r.direction, 'exact', r.pattern,
    r.conta_contabil, nullif(btrim(r.hist_code), ''), nullif(btrim(r.hist_complemento), ''),
    true, 50, 1, now()
  from (
    -- uma linha por memória: a mesma (direção, descrição, conta) repetida fica
    -- só com a última ocorrência (mesmo resultado de gravar uma por uma).
    select distinct on (e.val->>'direction', e.val->>'pattern', e.val->>'conta_contabil')
      e.val->>'direction'        as direction,
      e.val->>'pattern'          as pattern,
      e.val->>'conta_contabil'   as conta_contabil,
      e.val->>'hist_code'        as hist_code,
      e.val->>'hist_complemento' as hist_complemento
    from jsonb_array_elements(p_rows) with ordinality as e(val, ord)
    where btrim(coalesce(e.val->>'pattern', '')) <> ''
      and btrim(coalesce(e.val->>'conta_contabil', '')) <> ''
    order by e.val->>'direction', e.val->>'pattern', e.val->>'conta_contabil', e.ord desc
  ) r
  on conflict (client_id, direction, match_type, pattern, coalesce(conta_contabil, '')) do update set
    hits = public.mapping_rules.hits + 1,
    hist_code = excluded.hist_code,
    hist_complemento_template = excluded.hist_complemento_template,
    ativo = true,
    last_used_at = now(),
    updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;
