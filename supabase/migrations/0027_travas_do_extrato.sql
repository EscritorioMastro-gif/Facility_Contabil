-- ==========================================================================
-- 0027_travas_do_extrato.sql
-- Travas na entrada do extrato (pedido do user em 2026-11-18). Regras em
-- backend/src/statements/travas.ts; aqui só o que o banco precisa guardar.
--
-- 1. EXTRATO NA EMPRESA ERRADA: o login de cliente com várias empresas subia
--    o extrato da JUNIOR CONFECÇÃO na VALTER CONFECÇÃO sem aviso. O leitor
--    agora devolve o CNPJ/CPF do titular (titular.py) e o nº da conta do
--    cabeçalho; o extrato guarda os dois (titular_doc, conta_chave). Um
--    documento ou uma conta já aceitos numa empresa ficam "dela": é daqui que
--    a API tira a ligação conta -> empresa (sem tabela à parte — excluir o
--    extrato desfaz a ligação junto).
-- 2. NUNCA O MESMO EXTRATO: a impressão (0023) passa a ser conferida em TODAS
--    as empresas do escritório (antes só na mesma empresa) — índice novo.
-- 3. EXTRATO QUE SE SOBREPÕE: quinzena + mês inteiro, mês + trimestre têm
--    impressões diferentes e duplicavam lançamentos. sobreposicao_extrato()
--    conta quantos lançamentos do extrato novo já existem na empresa.
-- 4. REGISTRO: `conferencia` guarda como o extrato passou pelas travas
--    (identificado pelo titular/conta, confirmado pelo usuário, liberado pelo
--    escritório — quem e quando).
-- ==========================================================================

alter table public.statements
  add column if not exists titular_doc text
    check (titular_doc is null or titular_doc ~ '^[0-9]{11}$' or titular_doc ~ '^[0-9]{14}$'),
  add column if not exists conta_chave text
    check (conta_chave is null or conta_chave ~ '^[1-9][0-9]{3,19}$'),
  add column if not exists conferencia jsonb;

comment on column public.statements.titular_doc is
  'CNPJ/CPF do titular lido no extrato (só dígitos), quando o leitor achou com segurança. Ver parser/app/parsers/titular.py.';
comment on column public.statements.conta_chave is
  'Nº da conta lido no extrato (cabeçalho do PDF/CSV ou ACCTID do OFX), só dígitos e sem zeros à esquerda. Liga a conta à empresa.';
comment on column public.statements.conferencia is
  'Como o extrato passou pelas travas de entrada: {identificacao: titular|conta|confirmado|liberado, confirmado_por, liberado[]}. Ver backend/src/statements/travas.ts.';

create index if not exists statements_owner_impressao_idx on public.statements (owner_id, impressao);
create index if not exists statements_owner_titular_idx on public.statements (owner_id, titular_doc)
  where titular_doc is not null;
create index if not exists statements_owner_conta_idx on public.statements (owner_id, conta_chave)
  where conta_chave is not null;

-- --------------------------------------------------------------------------
-- Quantos lançamentos do extrato novo já estão em outros extratos da empresa.
-- p_linhas: 'AAAA-MM-DD|centavos|direção' de cada lançamento (mesma linha da
-- impressão). Conta repetidos de verdade: dois Pix de R$ 50 no mesmo dia no
-- extrato novo só "batem" com dois iguais já gravados (least(novo, velho)).
-- Um jsonb só (o PostgREST corta resposta em 1000 linhas).
-- --------------------------------------------------------------------------
create or replace function public.sobreposicao_extrato(
  p_client uuid,
  p_linhas text[],
  p_excluir uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with novas as (
    select l as chave, count(*) as n
      from unnest(p_linhas) as l
     group by l
  ),
  faixa as (
    select min(split_part(chave, '|', 1))::date as de,
           max(split_part(chave, '|', 1))::date as ate
      from novas
  ),
  velhas as (
    select t.statement_id,
           t.data::text || '|' || round(t.valor * 100)::bigint::text || '|' || t.direction as chave
      from public.statements s
      join public.transactions t on t.statement_id = s.id
      cross join faixa f
     where s.client_id = p_client
       and s.status <> 'erro'
       and (p_excluir is null or s.id <> p_excluir)
       and t.data between f.de and f.ate
  ),
  na_empresa as (
    select chave, count(*) as n from velhas group by chave
  ),
  por_extrato as (
    select p.statement_id, sum(least(n.n, p.n)) as iguais
      from (select statement_id, chave, count(*) as n from velhas group by statement_id, chave) p
      join novas n using (chave)
     group by p.statement_id
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(n), 0) from novas),
    'iguais', (select coalesce(sum(least(n.n, e.n)), 0) from novas n join na_empresa e using (chave)),
    'extratos', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', s.id,
                 'arquivo_nome', s.arquivo_nome,
                 'period_start', s.period_start,
                 'period_end', s.period_end,
                 'origem_modulo', s.origem_modulo,
                 'status', s.status,
                 'created_at', s.created_at,
                 'iguais', x.iguais
               )
               order by x.iguais desc, s.created_at
             )
        from por_extrato x
        join public.statements s on s.id = x.statement_id
    ), '[]'::jsonb)
  )
$$;
revoke all on function public.sobreposicao_extrato(uuid, text[], uuid) from public, anon;
grant execute on function public.sobreposicao_extrato(uuid, text[], uuid) to authenticated, service_role;

comment on function public.sobreposicao_extrato is
  'Trava de extrato sobreposto: quantos lançamentos (data|centavos|direção, contando repetidos) do extrato novo já estão em outros extratos da empresa, e em quais.';
