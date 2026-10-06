-- 0021 — Endurecimento de segurança (auditoria de 2026-10-06)
--
-- 1. public._migrations (controle do runner de migrations) foi criada no schema
--    que a API do Supabase expõe, SEM RLS e com as permissões padrão dos papéis
--    da API. Com a chave pública (que está no código da tela, por natureza),
--    qualquer pessoa conseguia ler e ALTERAR essa tabela — por exemplo, marcar
--    uma migration futura de segurança como "já aplicada" para ela nunca rodar.
--    Agora: RLS ligada sem nenhuma política (ninguém passa pela API) e sem
--    permissão para anon/authenticated. O runner usa a conexão direta (dono do
--    banco), que não passa pela RLS.
--
-- 2. Regras de acesso por dono reescritas com (select auth.uid()): mesmo efeito,
--    mas o Postgres calcula o usuário UMA vez por consulta em vez de uma vez por
--    linha (recomendação do Supabase — faz diferença com 10.000 lançamentos).
--    E passam a valer só para o papel "authenticated" (anon já não via nada,
--    porque auth.uid() é nulo; agora nem chega a avaliar a regra).
--
-- 3. set_updated_at com search_path fixo (aviso do Security Advisor).
--
-- Tudo dentro da transação do runner: as regras antigas só somem junto com a
-- criação das novas (não existe janela sem regra).

-- 1 ---------------------------------------------------------------------------
create table if not exists public._migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public._migrations enable row level security;
revoke all on table public._migrations from anon, authenticated;

-- 2 ---------------------------------------------------------------------------
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
        using (owner_id = (select auth.uid()));
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (owner_id = (select auth.uid()));
      create policy %1$I_update on public.%1$I for update to authenticated
        using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
      create policy %1$I_delete on public.%1$I for delete to authenticated
        using (owner_id = (select auth.uid()));
    $f$, t);
  end loop;
end $$;

drop policy if exists cliente_acessos_select on public.cliente_acessos;
drop policy if exists cliente_acessos_insert on public.cliente_acessos;
drop policy if exists cliente_acessos_delete on public.cliente_acessos;
create policy cliente_acessos_select on public.cliente_acessos for select to authenticated
  using (owner_id = (select auth.uid()));
create policy cliente_acessos_insert on public.cliente_acessos for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy cliente_acessos_delete on public.cliente_acessos for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Storage: arquivos dos extratos e do Domínio; a 1ª pasta do caminho é o dono.
drop policy if exists "statements_read_own" on storage.objects;
drop policy if exists "statements_insert_own" on storage.objects;
drop policy if exists "statements_update_own" on storage.objects;
drop policy if exists "statements_delete_own" on storage.objects;
drop policy if exists "exports_read_own" on storage.objects;
drop policy if exists "exports_insert_own" on storage.objects;
drop policy if exists "exports_update_own" on storage.objects;
drop policy if exists "exports_delete_own" on storage.objects;

create policy "statements_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "statements_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "statements_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "statements_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "exports_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "exports_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "exports_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "exports_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 3 ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = '';
