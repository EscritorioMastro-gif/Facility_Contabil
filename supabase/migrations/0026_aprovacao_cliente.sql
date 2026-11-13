-- ==========================================================================
-- 0026_aprovacao_cliente.sql
-- Aprovação das classificações pelo cliente (pedido do user em 2026-11-12).
--
-- O login de cliente, ao terminar o mês no portal, declara que conferiu as
-- classificações do extrato e aprova. Fica registrado quem aprovou (login e
-- e-mail), quando, quantos lançamentos, o resumo por classificação e uma
-- assinatura (sha256) do estado exato de cada lançamento naquele momento.
-- Se alguém mexer numa classificação depois, o extrato passa a aparecer como
-- "alterado depois da aprovação" até o cliente aprovar de novo.
--
-- Só o portal aprova: o backend chama aprovar_classificacao com a secret key
-- depois de conferir que o extrato é de uma empresa do login. O login do
-- escritório não consegue marcar aprovação, nem pela API nem direto no banco.
-- O histórico de aprovações não se altera nem se apaga (só some junto com o
-- extrato).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Última aprovação + última mudança de classificação, no próprio extrato
-- (a lista de extratos mostra a situação sem ler o histórico).
-- --------------------------------------------------------------------------
alter table public.statements
  add column if not exists aprovado_em timestamptz,
  add column if not exists aprovado_por uuid references auth.users (id) on delete set null,
  add column if not exists aprovado_por_email text,
  add column if not exists aprovado_qtd integer,
  add column if not exists classificacao_alterada_em timestamptz;

comment on column public.statements.aprovado_em is
  'Última aprovação das classificações pelo cliente (portal). Vale enquanto classificacao_alterada_em não for posterior.';
comment on column public.statements.classificacao_alterada_em is
  'Última vez que a classificação de algum lançamento do extrato mudou (trigger em transactions).';

-- --------------------------------------------------------------------------
-- Histórico
-- --------------------------------------------------------------------------
create table if not exists public.classificacao_aprovacoes (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete restrict,
  statement_id  uuid not null references public.statements (id) on delete cascade,
  client_id     uuid not null references public.clients (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  email         text not null,
  aprovado_em   timestamptz not null default now(),
  qtd           integer not null,
  entradas      numeric(14, 2) not null,
  saidas        numeric(14, 2) not null,
  -- [{direction, nome, qtd, total}] na hora da aprovação
  resumo        jsonb not null,
  -- sha256 de "lançamento:classificação" (na ordem do extrato) na hora da aprovação
  assinatura    text not null
);
create index if not exists classificacao_aprovacoes_stmt_idx
  on public.classificacao_aprovacoes (statement_id, aprovado_em desc);

alter table public.classificacao_aprovacoes enable row level security;
revoke all on table public.classificacao_aprovacoes from anon, authenticated;
grant select on table public.classificacao_aprovacoes to authenticated;
-- nem a secret key altera ou apaga um registro (o cascade do extrato roda como dono da tabela)
revoke update, delete, truncate on table public.classificacao_aprovacoes from service_role;

create policy classificacao_aprovacoes_select on public.classificacao_aprovacoes for select to authenticated
  using (
    owner_id = (select public.escritorio_atual())
    and (select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente'
  );

comment on table public.classificacao_aprovacoes is
  'Aprovações das classificações de um extrato pelo cliente (portal): quem, quando, quantos lançamentos, resumo e assinatura. Só se inclui.';

-- --------------------------------------------------------------------------
-- Aprovação (só a service_role, pelo portal)
-- --------------------------------------------------------------------------
create or replace function public.aprovar_classificacao(
  p_statement uuid,
  p_user uuid,
  p_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  r record;
  pendentes integer;
  quando timestamptz;
begin
  select id, owner_id, client_id, status, origem_modulo
    into s
    from public.statements
   where id = p_statement
     for update;
  if not found or s.origem_modulo is distinct from 'classificacao' then
    raise exception 'Extrato não encontrado.' using errcode = 'P0002';
  end if;
  if s.status not in ('classificacao', 'revisao', 'gerado') then
    raise exception 'Esse extrato não pode ser aprovado (status %).', s.status using errcode = '22023';
  end if;

  select count(*) into pendentes
    from public.transactions
   where statement_id = p_statement and not ignorado and classificacao_id is null;
  if pendentes > 0 then
    raise exception 'Ainda há % lançamento(s) sem classificação — classifique todos antes de aprovar.', pendentes
      using errcode = '22023';
  end if;

  with ativos as (
    select t.id, t.ordem, t.direction, t.valor, t.classificacao_id, btrim(c.nome) as nome
      from public.transactions t
      left join public.classificacoes c on c.id = t.classificacao_id
     where t.statement_id = p_statement and not t.ignorado
  ),
  por_nome as (
    select direction, nome, count(*) as qtd, sum(valor) as total
      from ativos
     group by direction, nome
  )
  select
    (select count(*) from ativos)::integer as qtd,
    coalesce((select sum(valor) from ativos where direction = 'entrada'), 0) as entradas,
    coalesce((select sum(valor) from ativos where direction = 'saida'), 0) as saidas,
    coalesce((select jsonb_agg(jsonb_build_object('direction', direction, 'nome', nome, 'qtd', qtd, 'total', total)
                               order by direction, total desc, nome)
                from por_nome), '[]'::jsonb) as resumo,
    encode(sha256(convert_to(coalesce(
      (select string_agg(id::text || ':' || classificacao_id::text, ',' order by ordem, id) from ativos), ''
    ), 'UTF8')), 'hex') as assinatura
    into r;

  if r.qtd = 0 then
    raise exception 'O extrato não tem lançamentos para aprovar.' using errcode = '22023';
  end if;

  insert into public.classificacao_aprovacoes
    (owner_id, statement_id, client_id, user_id, email, qtd, entradas, saidas, resumo, assinatura)
  values
    (s.owner_id, p_statement, s.client_id, p_user, coalesce(nullif(btrim(p_email), ''), '(sem e-mail)'),
     r.qtd, r.entradas, r.saidas, r.resumo, r.assinatura)
  returning aprovado_em into quando;

  update public.statements
     set aprovado_em = quando,
         aprovado_por = p_user,
         aprovado_por_email = coalesce(nullif(btrim(p_email), ''), '(sem e-mail)'),
         aprovado_qtd = r.qtd
   where id = p_statement;

  return jsonb_build_object('aprovado_em', quando, 'qtd', r.qtd, 'assinatura', r.assinatura);
end;
$$;

revoke all on function public.aprovar_classificacao(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.aprovar_classificacao(uuid, uuid, text) to service_role;

comment on function public.aprovar_classificacao is
  'Portal do cliente: registra a aprovação das classificações de um extrato (todos os lançamentos ativos classificados). Só a service_role executa — o backend confere antes se o extrato é de uma empresa liberada pro login.';

-- --------------------------------------------------------------------------
-- Mudou a classificação de algum lançamento → marca no extrato
-- --------------------------------------------------------------------------
create or replace function public.marcar_classificacao_alterada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.statements s
     set classificacao_alterada_em = now()
   where s.id in (
     select n.statement_id
       from novas n
       join antigas o on o.id = n.id
      where n.classificacao_id is distinct from o.classificacao_id
   );
  return null;
end;
$$;

revoke all on function public.marcar_classificacao_alterada() from public, anon, authenticated;

drop trigger if exists transactions_classificacao_alterada on public.transactions;
create trigger transactions_classificacao_alterada
  after update on public.transactions
  referencing old table as antigas new table as novas
  for each statement execute function public.marcar_classificacao_alterada();

-- --------------------------------------------------------------------------
-- Login do escritório (ou anônimo) não grava aprovação nem a data de mudança
-- --------------------------------------------------------------------------
create or replace function public.statements_protege_aprovacao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.aprovado_em is not null or new.aprovado_por is not null or new.aprovado_por_email is not null
       or new.aprovado_qtd is not null or new.classificacao_alterada_em is not null then
      raise exception 'A aprovação do cliente só é registrada pelo portal do cliente.' using errcode = '42501';
    end if;
  elsif new.aprovado_em is distinct from old.aprovado_em
     or new.aprovado_por is distinct from old.aprovado_por
     or new.aprovado_por_email is distinct from old.aprovado_por_email
     or new.aprovado_qtd is distinct from old.aprovado_qtd
     or new.classificacao_alterada_em is distinct from old.classificacao_alterada_em then
    raise exception 'A aprovação do cliente só é registrada pelo portal do cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists statements_protege_aprovacao on public.statements;
create trigger statements_protege_aprovacao
  before insert or update on public.statements
  for each row execute function public.statements_protege_aprovacao();
