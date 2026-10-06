-- ==========================================================================
-- 0019_remove_modulo_contabil.sql
-- O módulo Contábil (C1-C11) saiu do sistema (pedido do escritório,
-- 2026-10-06). Apaga as tabelas e a função dele — mas só se estiverem VAZIAS:
-- com qualquer registro, a migration para e não apaga nada (roda numa
-- transação só).
-- chart_accounts (0001) não é do módulo Contábil e fica.
-- ==========================================================================

do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'plano_contas', 'historicos_padrao', 'periodos_contabeis', 'saldos_contabeis',
    'lancamentos', 'lancamento_partidas', 'lancamento_modelos',
    'lancamento_modelo_partidas', 'contabil_auditoria'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception 'A tabela % tem % registro(s) — remoção do módulo Contábil cancelada, nada foi apagado.', t, n;
      end if;
    end if;
  end loop;
end $$;

-- filhas antes das mães (chaves estrangeiras)
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
