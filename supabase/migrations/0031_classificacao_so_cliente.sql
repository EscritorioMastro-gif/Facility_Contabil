-- ==========================================================================
-- 0031_classificacao_so_cliente.sql
-- Só o cliente classifica (pedido do user em 2026-11-24).
--
-- No módulo Classificação quem escolhe a classificação de cada lançamento é o
-- cliente, e é ele quem responde por ela. Até aqui qualquer login da equipe do
-- escritório conseguia trocar o que o cliente classificou (a tela só avisava
-- "alterado após aprovação"). Numa autuação o cliente podia alegar que foi o
-- escritório quem mexeu.
--
-- A partir daqui, para o login do escritório (inclusive o administrador), pela
-- tela, pela API ou direto no banco:
--
-- 1. a classificação de um lançamento não muda (só o portal do cliente grava);
-- 2. lançamento que o cliente já aprovou não tem data, valor, tipo nem
--    histórico alterados, e não é apagado (reimportar o extrato apagaria);
-- 3. extrato com aprovação do cliente só é excluído por quem administra o
--    escritório (o histórico de aprovações vai junto);
-- 4. classificação que está em lançamento aprovado não é renomeada, e
--    classificação em uso não é excluída (só desativada) — senão o nome do que
--    o cliente aprovou mudaria sem tocar no lançamento.
--
-- O portal do cliente grava com a secret key (service_role) e segue como está.
-- Cascade e "set null" das chaves estrangeiras rodam como dono da tabela e
-- também passam. O escritório continua enviando extrato (a memória pré-preenche
-- na criação do lançamento) e definindo conta contábil, histórico e inativado.
-- ==========================================================================

-- A função que o escritório usava pra gravar a classificação sai de cena.
drop function if exists public.update_transactions_classificacao(uuid, jsonb);

-- --------------------------------------------------------------------------
-- 1 e 2. Lançamento: classificação é do cliente; aprovado não muda
-- --------------------------------------------------------------------------
create or replace function public.transactions_protege_classificacao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.classificacao_id is distinct from old.classificacao_id
     or new.classificacao_origem is distinct from old.classificacao_origem then
    raise exception 'A classificação dos lançamentos é feita só pelo cliente, no acesso dele — o escritório só consulta.'
      using errcode = '42501';
  end if;
  if old.aprovado_classificacao_id is not null
     and (new.data is distinct from old.data
          or new.valor is distinct from old.valor
          or new.direction is distinct from old.direction
          or new.descricao_raw is distinct from old.descricao_raw
          or new.statement_id is distinct from old.statement_id) then
    raise exception 'Este lançamento já foi aprovado pelo cliente — data, valor, tipo e histórico não podem mais mudar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.transactions_protege_classificacao() from public, anon, authenticated;

drop trigger if exists transactions_protege_classificacao on public.transactions;
create trigger transactions_protege_classificacao
  before update of classificacao_id, classificacao_origem, data, valor, direction, descricao_raw, statement_id
  on public.transactions
  for each row execute function public.transactions_protege_classificacao();

create or replace function public.transactions_protege_exclusao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and old.aprovado_classificacao_id is not null then
    raise exception 'Este lançamento já foi aprovado pelo cliente e não pode ser apagado — trocar o arquivo do extrato apagaria o que ele classificou.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.transactions_protege_exclusao() from public, anon, authenticated;

drop trigger if exists transactions_protege_exclusao on public.transactions;
create trigger transactions_protege_exclusao
  before delete on public.transactions
  for each row execute function public.transactions_protege_exclusao();

-- --------------------------------------------------------------------------
-- 3. Extrato com aprovação do cliente: só o administrador exclui
-- --------------------------------------------------------------------------
create or replace function public.statements_protege_exclusao()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and old.aprovado_em is not null
     and not coalesce(public.sou_admin_do_escritorio(), false) then
    raise exception 'Este extrato tem classificações aprovadas pelo cliente — só quem administra o escritório pode excluir.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.statements_protege_exclusao() from public, anon, authenticated;

drop trigger if exists statements_protege_exclusao on public.statements;
create trigger statements_protege_exclusao
  before delete on public.statements
  for each row execute function public.statements_protege_exclusao();

-- --------------------------------------------------------------------------
-- 4. Classificação em uso: não renomeia o que o cliente aprovou, não exclui
-- --------------------------------------------------------------------------
create index if not exists transactions_aprovado_classificacao_idx
  on public.transactions (aprovado_classificacao_id)
  where aprovado_classificacao_id is not null;

create or replace function public.classificacoes_protege_uso()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' then
    if new.nome is distinct from old.nome
       and exists (select 1 from public.transactions t where t.aprovado_classificacao_id = old.id) then
      raise exception 'Essa classificação já está em lançamentos aprovados pelo cliente — o nome não pode mais mudar.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if exists (
    select 1 from public.transactions t
     where t.classificacao_id = old.id or t.aprovado_classificacao_id = old.id
  ) then
    raise exception 'Essa classificação está em uso em lançamentos — desative em vez de excluir.'
      using errcode = '42501';
  end if;
  return old;
end;
$$;

revoke all on function public.classificacoes_protege_uso() from public, anon, authenticated;

drop trigger if exists classificacoes_protege_uso on public.classificacoes;
create trigger classificacoes_protege_uso
  before update of nome or delete on public.classificacoes
  for each row execute function public.classificacoes_protege_uso();

comment on function public.transactions_protege_classificacao is
  'Só o portal do cliente grava a classificação de um lançamento; lançamento já aprovado pelo cliente não tem data, valor, tipo nem histórico alterados pelo login do escritório.';
comment on function public.transactions_protege_exclusao is
  'Login do escritório não apaga lançamento que o cliente já aprovou (a exclusão do extrato inteiro, por cascade, é controlada em statements_protege_exclusao).';
comment on function public.statements_protege_exclusao is
  'Extrato com aprovação do cliente só é excluído pelo administrador do escritório (ou pelo portal, enquanto está no módulo Classificação).';
comment on function public.classificacoes_protege_uso is
  'Login do escritório não renomeia classificação que está em lançamento aprovado pelo cliente nem exclui classificação em uso.';
