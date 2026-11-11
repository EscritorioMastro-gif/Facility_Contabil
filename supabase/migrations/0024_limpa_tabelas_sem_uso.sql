-- ==========================================================================
-- 0024_limpa_tabelas_sem_uso.sql
-- Limpeza pedida pelo user em 2026-11-11: fora do banco tudo o que o sistema
-- não usa mais.
--
-- - O que sobrar do módulo Contábil (retirado em 2026-10-06). A 0019 já apagava
--   essas tabelas; os arquivos 0009–0016 e 0019 saíram do repositório e esta
--   migration cobre qualquer banco que ainda as tenha.
-- - chart_accounts (0001): plano de contas da 1ª versão, nunca lido nem gravado
--   pelo sistema.
--
-- Mesma trava da 0019: tabela com algum registro faz a migration parar sem
-- apagar nada (roda numa transação só).
-- ==========================================================================

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'chart_accounts',
    'plano_contas', 'historicos_padrao', 'periodos_contabeis', 'saldos_contabeis',
    'lancamentos', 'lancamento_partidas', 'lancamento_modelos',
    'lancamento_modelo_partidas', 'contabil_auditoria'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'A tabela % tem % registro(s) — limpeza cancelada, nada foi apagado.', t, n;
      end if;
    end if;
  end loop;
end $$;

drop table if exists public.contabil_auditoria;
drop table if exists public.lancamento_modelo_partidas;
drop table if exists public.lancamento_modelos;
drop table if exists public.lancamento_partidas;
drop table if exists public.lancamentos;
drop table if exists public.saldos_contabeis;
drop table if exists public.periodos_contabeis;
drop table if exists public.historicos_padrao;
drop table if exists public.plano_contas;
drop function if exists public.relink_plano_contas_parents(uuid);

drop table if exists public.chart_accounts;
