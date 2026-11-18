-- ==========================================================================
-- 0028_aprovacao_em_partes.sql
-- Aprovação das classificações EM PARTES (pedido do user em 2026-11-18).
--
-- Antes (0026) o cliente só aprovava com TODOS os lançamentos classificados.
-- Agora o botão do portal é "Salvar e aprovar": salva o que ele classificou e
-- aprova o que já está classificado, mesmo faltando lançamento. Num mês feito
-- em partes, cada parte fica no histórico (quem, quando, IP, quantos
-- aprovados, quantos novos nesta parte, quantos ainda faltavam).
--
-- 1. transactions.aprovado_classificacao_id: a classificação de cada
--    lançamento no momento em que o cliente a aprovou. É por ela que se sabe
--    o que já foi aprovado e o que é novo.
-- 2. "Alterado depois da aprovação" passa a ser só mudança num lançamento que
--    o cliente JÁ aprovou. Classificar um lançamento que estava pendente (o
--    resto do mês) não conta como alteração.
-- 3. statements.aprovado_pendentes: quantos faltavam na última aprovação
--    (> 0 = aprovação parcial).
-- 4. classificacao_aprovacoes ganha pendentes, novos e ip.
--
-- aprovar_classificacao ganha p_ip (com default): a API antiga, que chama com
-- 3 argumentos, continua funcionando até a nova ser publicada.
-- ==========================================================================

alter table public.statements
  add column if not exists aprovado_pendentes integer;

comment on column public.statements.aprovado_pendentes is
  'Lançamentos ainda sem classificação na última aprovação do cliente (> 0 = aprovação parcial: o cliente aprovou aprovado_qtd e faltavam estes).';

alter table public.transactions
  add column if not exists aprovado_classificacao_id uuid;

comment on column public.transactions.aprovado_classificacao_id is
  'Classificação deste lançamento quando o cliente aprovou (portal). Nulo = ainda não aprovado. Só a função aprovar_classificacao grava.';

alter table public.classificacao_aprovacoes
  add column if not exists pendentes integer not null default 0,
  add column if not exists novos integer,
  add column if not exists ip text check (ip is null or length(ip) <= 64);

comment on column public.classificacao_aprovacoes.qtd is
  'Lançamentos classificados que o cliente aprovou nesta vez (os pendentes ficam de fora).';
comment on column public.classificacao_aprovacoes.pendentes is
  'Lançamentos ainda sem classificação nesta aprovação (> 0 = parcial).';
comment on column public.classificacao_aprovacoes.novos is
  'Quantos lançamentos entraram (ou mudaram de classificação) nesta aprovação em relação à anterior. Nulo nas aprovações de antes da 0028.';
comment on column public.classificacao_aprovacoes.ip is
  'IP de quem aprovou (CF-Connecting-IP no Render).';

-- --------------------------------------------------------------------------
-- O que já estava aprovado (0026 exigia tudo classificado): marca cada
-- lançamento com a classificação aprovada. Extrato "alterado depois da
-- aprovação" fica sem marca — não dá pra saber o que era — e continua
-- aparecendo como alterado até o cliente aprovar de novo.
-- --------------------------------------------------------------------------
update public.statements
   set aprovado_pendentes = 0
 where aprovado_em is not null
   and aprovado_pendentes is null;

update public.transactions t
   set aprovado_classificacao_id = t.classificacao_id
  from public.statements s
 where s.id = t.statement_id
   and s.aprovado_em is not null
   and (s.classificacao_alterada_em is null or s.classificacao_alterada_em <= s.aprovado_em)
   and not t.ignorado
   and t.classificacao_id is not null
   and t.aprovado_classificacao_id is null;

-- --------------------------------------------------------------------------
-- Aprovação (só a service_role, pelo portal)
-- --------------------------------------------------------------------------
drop function if exists public.aprovar_classificacao(uuid, uuid, text);

create or replace function public.aprovar_classificacao(
  p_statement uuid,
  p_user uuid,
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  r record;
  quando timestamptz;
  v_email text := coalesce(nullif(btrim(p_email), ''), '(sem e-mail)');
  v_ip text := left(nullif(btrim(coalesce(p_ip, '')), ''), 64);
begin
  select id, owner_id, client_id, status, origem_modulo, aprovado_em, classificacao_alterada_em
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

  with ativos as (
    select t.id, t.ordem, t.direction, t.valor, t.classificacao_id, t.aprovado_classificacao_id, btrim(c.nome) as nome
      from public.transactions t
      left join public.classificacoes c on c.id = t.classificacao_id
     where t.statement_id = p_statement and not t.ignorado
  ),
  classificados as (
    select * from ativos where classificacao_id is not null
  ),
  por_nome as (
    select direction, nome, count(*) as qtd, sum(valor) as total
      from classificados
     group by direction, nome
  )
  select
    (select count(*) from classificados)::integer as qtd,
    (select count(*) from ativos where classificacao_id is null)::integer as pendentes,
    (select count(*) from classificados where classificacao_id is distinct from aprovado_classificacao_id)::integer as novos,
    coalesce((select sum(valor) from classificados where direction = 'entrada'), 0) as entradas,
    coalesce((select sum(valor) from classificados where direction = 'saida'), 0) as saidas,
    coalesce((select jsonb_agg(jsonb_build_object('direction', direction, 'nome', nome, 'qtd', qtd, 'total', total)
                               order by direction, total desc, nome)
                from por_nome), '[]'::jsonb) as resumo,
    encode(sha256(convert_to(coalesce(
      (select string_agg(id::text || ':' || classificacao_id::text, ',' order by ordem, id) from classificados), ''
    ), 'UTF8')), 'hex') as assinatura
    into r;

  if r.qtd = 0 then
    raise exception 'Classifique pelo menos um lançamento antes de aprovar.' using errcode = '22023';
  end if;
  -- nada mudou desde a última aprovação (e ela segue valendo): não duplica o registro
  if r.novos = 0
     and s.aprovado_em is not null
     and not coalesce(s.classificacao_alterada_em > s.aprovado_em, false) then
    raise exception 'Nada novo para aprovar — o que está classificado já foi aprovado.' using errcode = '22023';
  end if;

  insert into public.classificacao_aprovacoes
    (owner_id, statement_id, client_id, user_id, email, qtd, entradas, saidas, resumo, assinatura, pendentes, novos, ip)
  values
    (s.owner_id, p_statement, s.client_id, p_user, v_email,
     r.qtd, r.entradas, r.saidas, r.resumo, r.assinatura, r.pendentes, r.novos, v_ip)
  returning aprovado_em into quando;

  -- guarda em cada lançamento a classificação que o cliente acabou de aprovar
  update public.transactions
     set aprovado_classificacao_id = case when ignorado then null else classificacao_id end
   where statement_id = p_statement
     and aprovado_classificacao_id is distinct from (case when ignorado then null else classificacao_id end);

  update public.statements
     set aprovado_em = quando,
         aprovado_por = p_user,
         aprovado_por_email = v_email,
         aprovado_qtd = r.qtd,
         aprovado_pendentes = r.pendentes
   where id = p_statement;

  return jsonb_build_object(
    'aprovado_em', quando,
    'qtd', r.qtd,
    'pendentes', r.pendentes,
    'novos', r.novos,
    'assinatura', r.assinatura
  );
end;
$$;

revoke all on function public.aprovar_classificacao(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.aprovar_classificacao(uuid, uuid, text, text) to service_role;

comment on function public.aprovar_classificacao is
  'Portal do cliente: registra a aprovação das classificações de um extrato — dos lançamentos JÁ classificados (pode ser parcial). Só a service_role executa; o backend confere antes se o extrato é de uma empresa liberada pro login.';

-- --------------------------------------------------------------------------
-- "Alterado depois da aprovação" = mudou a classificação de um lançamento que
-- o cliente já tinha aprovado. Classificar um pendente não conta.
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
        and o.aprovado_classificacao_id is not null
        and n.classificacao_id is distinct from n.aprovado_classificacao_id
   );
  return null;
end;
$$;

revoke all on function public.marcar_classificacao_alterada() from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- Login do escritório (ou anônimo) não grava aprovação — nem no extrato, nem
-- no lançamento
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
       or new.aprovado_qtd is not null or new.aprovado_pendentes is not null
       or new.classificacao_alterada_em is not null then
      raise exception 'A aprovação do cliente só é registrada pelo portal do cliente.' using errcode = '42501';
    end if;
  elsif new.aprovado_em is distinct from old.aprovado_em
     or new.aprovado_por is distinct from old.aprovado_por
     or new.aprovado_por_email is distinct from old.aprovado_por_email
     or new.aprovado_qtd is distinct from old.aprovado_qtd
     or new.aprovado_pendentes is distinct from old.aprovado_pendentes
     or new.classificacao_alterada_em is distinct from old.classificacao_alterada_em then
    raise exception 'A aprovação do cliente só é registrada pelo portal do cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.transactions_protege_aprovacao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.aprovado_classificacao_id is not null)
     or (tg_op = 'UPDATE' and new.aprovado_classificacao_id is distinct from old.aprovado_classificacao_id) then
    raise exception 'A aprovação do cliente só é registrada pelo portal do cliente.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_protege_aprovacao on public.transactions;
create trigger transactions_protege_aprovacao
  before insert or update of aprovado_classificacao_id on public.transactions
  for each row execute function public.transactions_protege_aprovacao();
