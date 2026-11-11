-- ==========================================================================
-- 0023_lista_geral_memoria_duplicado.sql
-- Pedido do user em 2026-11-11, módulo Classificação:
--
-- 1. LISTA GERAL de classificações do escritório (LIMPEZA E HIGIENE, ENERGIA
--    ELÉTRICA...). Só administrador da equipe inclui/exclui; o cliente escolhe
--    dela o que entra na lista própria (`classificacoes`, por empresa — a API
--    mantém a mesma lista em todas as empresas do mesmo login de cliente).
--    `classificacoes.geral_id` diz de qual item da lista geral veio.
-- 2. MEMÓRIA da classificação: descrição já classificada antes (mesma empresa)
--    vem classificada no extrato novo — `transactions.classificacao_origem`
--    ('memoria' = sempre foi essa; 'conferir' = já teve outras, sugestão).
--    Calculada direto dos lançamentos já classificados (memoria_classificacao),
--    então trocar uma classificação ou excluir um extrato já muda a memória.
-- 3. TRAVA DE EXTRATO DUPLICADO: `statements.impressao` = sha256 dos
--    lançamentos (data|centavos|direção, em ordem). Mesmo extrato em outro
--    formato (PDF x OFX) dá a mesma impressão. A API recusa importar de novo.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. lista geral
-- --------------------------------------------------------------------------
create table if not exists public.classificacoes_gerais (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  direction   text not null check (direction in ('entrada', 'saida')),
  nome        text not null check (btrim(nome) <> ''),
  criado_por  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists classificacoes_gerais_nome_uq
  on public.classificacoes_gerais (owner_id, direction, lower(btrim(nome)));

comment on table public.classificacoes_gerais is
  'Lista geral de classificações do escritório. Só administrador da equipe inclui/exclui; os clientes escolhem dela a lista própria (classificacoes).';

-- o login é administrador da equipe do escritório? (escritorio_membros não sai pela API)
create or replace function public.sou_admin_do_escritorio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select m.admin from public.escritorio_membros m where m.user_id = auth.uid()), false)
$$;
revoke all on function public.sou_admin_do_escritorio() from public, anon;
grant execute on function public.sou_admin_do_escritorio() to authenticated, service_role;

alter table public.classificacoes_gerais enable row level security;
revoke all on table public.classificacoes_gerais from anon;

drop policy if exists classificacoes_gerais_select on public.classificacoes_gerais;
drop policy if exists classificacoes_gerais_insert on public.classificacoes_gerais;
drop policy if exists classificacoes_gerais_update on public.classificacoes_gerais;
drop policy if exists classificacoes_gerais_delete on public.classificacoes_gerais;
drop policy if exists classificacoes_gerais_sem_login_de_cliente on public.classificacoes_gerais;

-- a equipe toda vê (e usa); só administrador mexe
create policy classificacoes_gerais_select on public.classificacoes_gerais for select to authenticated
  using (owner_id = (select public.escritorio_atual()));
create policy classificacoes_gerais_insert on public.classificacoes_gerais for insert to authenticated
  with check (owner_id = (select public.escritorio_atual()) and (select public.sou_admin_do_escritorio()));
create policy classificacoes_gerais_update on public.classificacoes_gerais for update to authenticated
  using (owner_id = (select public.escritorio_atual()) and (select public.sou_admin_do_escritorio()))
  with check (owner_id = (select public.escritorio_atual()) and (select public.sou_admin_do_escritorio()));
create policy classificacoes_gerais_delete on public.classificacoes_gerais for delete to authenticated
  using (owner_id = (select public.escritorio_atual()) and (select public.sou_admin_do_escritorio()));
-- login de cliente nunca toca a tabela direto (o portal lê pela API, com a secret key)
create policy classificacoes_gerais_sem_login_de_cliente on public.classificacoes_gerais
  as restrictive for all to authenticated
  using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente')
  with check ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente');

-- item da lista própria -> de qual item da lista geral veio (null = avulsa,
-- criada pelo escritório). Excluir da lista geral não tira de quem já escolheu.
alter table public.classificacoes
  add column if not exists geral_id uuid references public.classificacoes_gerais (id) on delete set null;
create index if not exists classificacoes_geral_idx on public.classificacoes (geral_id);

comment on column public.classificacoes.geral_id is
  'Item da lista geral (classificacoes_gerais) de onde veio. Null = classificação avulsa, criada pelo escritório.';

-- --------------------------------------------------------------------------
-- 2. memória da classificação
-- --------------------------------------------------------------------------
alter table public.transactions
  add column if not exists classificacao_origem text
    check (classificacao_origem in ('memoria', 'conferir'));

comment on column public.transactions.classificacao_origem is
  'Classificação preenchida pela memória: memoria = a descrição sempre teve essa; conferir = já teve outras (sugestão). Null = escolhida por alguém (ou vazia).';

-- Mesma chave do backend (rules/match.ts memoryKey): espaços colapsados, sem
-- espaço nas pontas, maiúsculas.
create or replace function public.chave_memoria(texto text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(btrim(regexp_replace(coalesce(texto, ''), '\s+', ' ', 'g')))
$$;

-- Para cada descrição do extrato novo: as classificações que lançamentos com a
-- mesma descrição (e direção) já tiveram NESSA empresa, com quantas vezes e a
-- data mais recente. Sugestão não conferida ('conferir') não conta como
-- memória. Um jsonb só (o PostgREST corta resposta em 1000 linhas).
create or replace function public.memoria_classificacao(
  p_client uuid,
  p_descricoes text[],
  p_excluir uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with novas as (
    select distinct d as descricao, public.chave_memoria(d) as chave
      from unnest(p_descricoes) as d
     where public.chave_memoria(d) <> ''
  ),
  usos as (
    select n.descricao, t.direction, t.classificacao_id, count(*) as usos, max(t.data) as ultima
      from novas n
      join public.transactions t on public.chave_memoria(t.descricao_raw) = n.chave
      join public.statements s on s.id = t.statement_id
      join public.classificacoes c on c.id = t.classificacao_id
     where s.client_id = p_client
       and c.client_id = p_client
       and c.ativo
       and not t.ignorado
       and t.classificacao_origem is distinct from 'conferir'
       and (p_excluir is null or t.statement_id <> p_excluir)
     group by n.descricao, t.direction, t.classificacao_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'descricao', descricao, 'direction', direction, 'classificacao_id', classificacao_id,
      'usos', usos, 'ultima', ultima
    )),
    '[]'::jsonb
  )
  from usos
$$;
revoke all on function public.memoria_classificacao(uuid, text[], uuid) from public, anon;
grant execute on function public.memoria_classificacao(uuid, text[], uuid) to authenticated, service_role;

comment on function public.memoria_classificacao is
  'Memória do módulo Classificação: classificações já usadas por descrição na empresa (para pré-preencher o extrato novo).';

-- Gravar a classificação = alguém escolheu: a marca de memória/sugestão sai.
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
    classificacao_origem = null,
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
    classificacao_origem = null,
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

-- --------------------------------------------------------------------------
-- 3. trava de extrato duplicado
-- --------------------------------------------------------------------------
alter table public.statements add column if not exists impressao text;
create index if not exists statements_impressao_idx on public.statements (client_id, impressao);

comment on column public.statements.impressao is
  'sha256 dos lançamentos lidos (data|centavos|direção, ordenados) — o mesmo extrato importado de novo (até em outro formato) dá a mesma impressão. Ver backend/src/statements/impressao.ts.';

-- extratos que já estão no banco (mesma conta do backend)
update public.statements s
   set impressao = x.h
  from (
    select l.statement_id,
           encode(sha256(convert_to(string_agg(l.linha, E'\n' order by l.linha collate "C"), 'UTF8')), 'hex') as h
      from (
        select t.statement_id,
               t.data::text || '|' || round(t.valor * 100)::bigint::text || '|' || t.direction as linha
          from public.transactions t
      ) l
     group by l.statement_id
  ) x
 where x.statement_id = s.id
   and s.impressao is null
   and s.status <> 'erro';
