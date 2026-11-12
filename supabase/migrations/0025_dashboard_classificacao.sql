-- ==========================================================================
-- 0025_dashboard_classificacao.sql
-- Dashboard do módulo Classificação (pedido do user em 2026-11-12): total de
-- receitas por classificação de entrada (Shopee, Shein...) e de despesas por
-- classificação de saída, de uma empresa ou de todas as empresas do mesmo
-- cliente, num período.
--
-- A conta é feita aqui (não na API) porque um ano de várias empresas passa
-- fácil dos 10 mil lançamentos que a API lê de uma vez.
--
-- Regras (decididas com o user):
--   - só extratos do módulo Classificação, sem os com erro;
--   - só lançamentos classificados e não inativados entram nos totais; os sem
--     classificação são contados à parte ("pendentes");
--   - a mesma classificação em empresas diferentes (a lista própria é a mesma
--     nas empresas do mesmo login) soma junto, pelo nome.
--
-- security invoker: o login do escritório só alcança o próprio escritório
-- (RLS); o portal do cliente chama com a secret key depois de conferir as
-- empresas do login.
-- ==========================================================================

create or replace function public.dashboard_classificacao(
  p_clients uuid[],
  p_de date default null,
  p_ate date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select t.direction, t.valor, t.data, t.classificacao_id, c.nome
      from public.transactions t
      join public.statements s on s.id = t.statement_id
      left join public.classificacoes c on c.id = t.classificacao_id
     where s.client_id = any(p_clients)
       and s.origem_modulo = 'classificacao'
       and s.status <> 'erro'
       and not t.ignorado
       and (p_de is null or t.data >= p_de)
       and (p_ate is null or t.data <= p_ate)
  ),
  classificados as (
    select * from base where classificacao_id is not null
  ),
  por_nome as (
    select direction,
           min(btrim(nome)) as nome,
           sum(valor) as total,
           count(*) as qtd
      from classificados
     group by direction, lower(btrim(nome))
  ),
  por_mes as (
    select to_char(date_trunc('month', data), 'YYYY-MM') as mes,
           coalesce(sum(valor) filter (where direction = 'entrada'), 0) as receitas,
           coalesce(sum(valor) filter (where direction = 'saida'), 0) as despesas
      from classificados
     group by 1
  ),
  -- as roscas "no mês": cada classificação em cada mês do período
  por_mes_nome as (
    select to_char(date_trunc('month', data), 'YYYY-MM') as mes,
           direction,
           min(btrim(nome)) as nome,
           sum(valor) as total,
           count(*) as qtd
      from classificados
     group by 1, direction, lower(btrim(nome))
  )
  select jsonb_build_object(
    'por_classificacao',
      coalesce((select jsonb_agg(jsonb_build_object('direction', direction, 'nome', nome, 'total', total, 'qtd', qtd)
                                 order by direction, total desc, nome)
                  from por_nome), '[]'::jsonb),
    'por_mes',
      coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'receitas', receitas, 'despesas', despesas) order by mes)
                  from por_mes), '[]'::jsonb),
    'por_mes_classificacao',
      coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'direction', direction, 'nome', nome,
                                                    'total', total, 'qtd', qtd)
                                 order by mes, direction, total desc, nome)
                  from por_mes_nome), '[]'::jsonb),
    'pendentes',
      (select jsonb_build_object('qtd', count(*), 'total', coalesce(sum(valor), 0))
         from base where classificacao_id is null)
  )
$$;

revoke all on function public.dashboard_classificacao(uuid[], date, date) from public, anon;
grant execute on function public.dashboard_classificacao(uuid[], date, date) to authenticated, service_role;

comment on function public.dashboard_classificacao is
  'Dashboard do módulo Classificação: totais por classificação (entrada/saída), por mês, por classificação em cada mês e os pendentes, das empresas pedidas num período.';
