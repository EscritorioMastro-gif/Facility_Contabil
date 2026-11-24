-- ==========================================================================
-- 0032_uma_ligacao_extrato_cliente.sql
-- Conserta "Falha em listar importações" (produção, 2026-11-24).
--
-- A 0029 criou clients.saldo_inicial_extrato_id COM chave estrangeira pra
-- statements. Com ela, statements e clients passaram a ter DUAS ligações
-- (statements.client_id -> clients e esta, no sentido contrário), e o
-- PostgREST deixou de saber qual usar em
--     statements?select=...,client:clients(...)
-- Resposta: PGRST201 ("more than one relationship was found for 'statements'
-- and 'clients'") em toda leitura de extrato que traz o nome do cliente —
-- Histórico, abrir extrato, gerar o arquivo do Domínio, reimportar, travas de
-- entrada e o portal do cliente.
--
-- A coluna fica (só registra qual extrato moveu o saldo; ninguém junta por
-- ela). Sai a chave estrangeira, e o "on delete set null" dela vira trigger:
-- apagou o extrato, o cadastro deixa de apontar pra ele e o saldo continua.
--
-- Regra daqui pra frente: duas tabelas que a API junta têm UMA ligação só
-- (backend/src/db/ligacoes.test.ts confere).
-- ==========================================================================

alter table public.clients
  drop constraint if exists clients_saldo_inicial_extrato_id_fkey;

comment on column public.clients.saldo_inicial_extrato_id is
  'Extrato cujo arquivo do Domínio definiu o saldo_inicial (null = digitado no cadastro). Sem chave estrangeira de propósito: uma segunda ligação entre clients e statements quebra o embed do PostgREST (0032).';

create or replace function public.statements_solta_saldo_do_cliente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients
     set saldo_inicial_extrato_id = null
   where saldo_inicial_extrato_id = old.id;
  return null;
end;
$$;

revoke all on function public.statements_solta_saldo_do_cliente() from public, anon, authenticated;

drop trigger if exists statements_solta_saldo_do_cliente on public.statements;
create trigger statements_solta_saldo_do_cliente
  after delete on public.statements
  for each row execute function public.statements_solta_saldo_do_cliente();

-- o PostgREST relê as ligações entre as tabelas
notify pgrst, 'reload schema';
