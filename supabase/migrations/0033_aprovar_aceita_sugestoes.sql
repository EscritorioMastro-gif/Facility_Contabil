-- ==========================================================================
-- 0033_aprovar_aceita_sugestoes.sql
-- Aprovar = aceitar as sugestões da memória (pedido do user em 2026-11-24).
--
-- O lançamento que vem classificado pela memória aparece com o selo
-- "memória" ou "sugestão" (transactions.classificacao_origem). Até aqui o
-- cliente precisava clicar em "Aceitar as sugestões" E DEPOIS em "Salvar e
-- aprovar"; quem só aprovava ficava com o lançamento "sugestão" + "aprovado"
-- ao mesmo tempo.
--
-- Agora a aprovação já é o aceite: ao aprovar, a marca de memória/sugestão sai
-- de todo lançamento aprovado (classificado e não inativado) e fica só o
-- "aprovado". Como sugestão aprovada passa a contar como classificação
-- escolhida, ela também entra na memória dos próximos extratos.
--
-- Mesma assinatura da 0028: a API que está no ar segue chamando igual.
-- ==========================================================================

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

  -- guarda em cada lançamento a classificação que o cliente acabou de aprovar;
  -- aprovou = conferiu: a marca de memória/sugestão sai do que foi aprovado
  update public.transactions
     set aprovado_classificacao_id = case when ignorado then null else classificacao_id end,
         classificacao_origem = case when ignorado or classificacao_id is null then classificacao_origem else null end
   where statement_id = p_statement
     and (aprovado_classificacao_id is distinct from (case when ignorado then null else classificacao_id end)
          or (not ignorado and classificacao_id is not null and classificacao_origem is not null));

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
  'Portal do cliente: registra a aprovação das classificações de um extrato — dos lançamentos JÁ classificados (pode ser parcial) — e tira deles a marca de memória/sugestão (aprovar = aceitar). Só a service_role executa; o backend confere antes se o extrato é de uma empresa liberada pro login.';

comment on column public.transactions.classificacao_origem is
  'Classificação preenchida pela memória e ainda não conferida: memoria = a descrição sempre teve essa; conferir = já teve outras (sugestão). Null = escolhida por alguém, aprovada pelo cliente (0033) ou vazia.';

-- --------------------------------------------------------------------------
-- O que o cliente já tinha aprovado sem clicar em "Aceitar as sugestões":
-- lançamento aprovado do jeito que está deixa de aparecer como sugestão.
-- --------------------------------------------------------------------------
update public.transactions
   set classificacao_origem = null
 where classificacao_origem is not null
   and not ignorado
   and classificacao_id is not null
   and aprovado_classificacao_id = classificacao_id;
