-- ==========================================================================
-- 0029_saldo_avanca_no_dominio.sql
-- O saldo do cadastro do cliente (clients.saldo_inicial) anda sozinho: ao
-- gerar o arquivo do Domínio de um extrato, o saldo FINAL dele vira o saldo do
-- cadastro — o ponto de partida do próximo extrato, tanto na importação manual
-- quanto no extrato puxado do módulo Classificação.
--
--   clients.saldo_inicial_extrato_id -> extrato cujo arquivo moveu o saldo
--   clients.saldo_inicial_ate        -> fim do período desse extrato
--   clients.saldo_inicial_em         -> quando o arquivo foi gerado
--
-- Os três vazios = saldo digitado no cadastro. Digitar outro saldo no cadastro
-- limpa os três (trigger abaixo): vale o digitado até o próximo arquivo gerado.
-- Gerar o arquivo de um período ANTERIOR ao que já moveu o saldo (ex.: gerar
-- agosto de novo depois de setembro) não volta o saldo pra trás.
-- ==========================================================================

alter table public.clients
  add column if not exists saldo_inicial_extrato_id uuid
    references public.statements (id) on delete set null,
  add column if not exists saldo_inicial_ate date,
  add column if not exists saldo_inicial_em timestamptz;

comment on column public.clients.saldo_inicial is
  'Saldo da conta bancária no início do próximo extrato. Digitado no cadastro ou, ao gerar o arquivo do Domínio, o saldo final do extrato (avancar_saldo_cliente).';
comment on column public.clients.saldo_inicial_extrato_id is
  'Extrato cujo arquivo do Domínio definiu o saldo_inicial (null = digitado no cadastro).';
comment on column public.clients.saldo_inicial_ate is
  'Fim do período do extrato que definiu o saldo_inicial — arquivo de período anterior não volta o saldo.';
comment on column public.clients.saldo_inicial_em is
  'Quando o arquivo do Domínio definiu o saldo_inicial.';

-- --------------------------------------------------------------------------
-- Saldo digitado no cadastro: some a ligação com o extrato
-- --------------------------------------------------------------------------
create or replace function public.clients_saldo_digitado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- avancar_saldo_cliente() sempre grava um saldo_inicial_em novo; saldo que
  -- muda sem isso foi digitado (cadastro, SQL...)
  if new.saldo_inicial is distinct from old.saldo_inicial
     and new.saldo_inicial_em is not distinct from old.saldo_inicial_em then
    new.saldo_inicial_extrato_id := null;
    new.saldo_inicial_ate := null;
    new.saldo_inicial_em := null;
  end if;
  return new;
end;
$$;

revoke all on function public.clients_saldo_digitado() from public, anon, authenticated;

drop trigger if exists clients_saldo_digitado on public.clients;
create trigger clients_saldo_digitado
  before update on public.clients
  for each row execute function public.clients_saldo_digitado();

-- --------------------------------------------------------------------------
-- Arquivo do Domínio gerado: saldo final do extrato -> saldo do cadastro
-- --------------------------------------------------------------------------
create or replace function public.avancar_saldo_cliente(p_statement uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s record;
  c record;
  v_final numeric(14, 2);
  v_ate date;
begin
  select id, client_id, saldo_inicial, period_end
    into s
    from public.statements
   where id = p_statement;
  if not found then
    raise exception 'Importação não encontrada.' using errcode = 'P0002';
  end if;

  -- mesma conta do saldo_final (0006): TODOS os lançamentos, inativados
  -- inclusos — o saldo do banco mexeu de qualquer jeito
  select coalesce(s.saldo_inicial, 0)
           + coalesce(sum(case when t.direction = 'entrada' then t.valor else -t.valor end), 0),
         coalesce(s.period_end, max(t.data))
    into v_final, v_ate
    from public.transactions t
   where t.statement_id = s.id;

  update public.statements
     set saldo_final = v_final
   where id = s.id
     and saldo_final is distinct from v_final;

  select id, saldo_inicial, saldo_inicial_ate
    into c
    from public.clients
   where id = s.client_id
     for update;
  if not found then
    raise exception 'Cliente não encontrado.' using errcode = 'P0002';
  end if;

  -- já tem saldo de um período mais novo: não volta pra trás
  if c.saldo_inicial_ate is not null and (v_ate is null or v_ate < c.saldo_inicial_ate) then
    return jsonb_build_object(
      'atualizado', false,
      'saldo_final', v_final,
      'saldo', c.saldo_inicial,
      'ate', c.saldo_inicial_ate
    );
  end if;

  update public.clients
     set saldo_inicial = v_final,
         saldo_inicial_extrato_id = s.id,
         saldo_inicial_ate = v_ate,
         saldo_inicial_em = clock_timestamp()
   where id = c.id;

  return jsonb_build_object(
    'atualizado', true,
    'saldo_final', v_final,
    'saldo', v_final,
    'ate', v_ate
  );
end;
$$;

revoke all on function public.avancar_saldo_cliente(uuid) from public, anon;
grant execute on function public.avancar_saldo_cliente(uuid) to authenticated, service_role;
