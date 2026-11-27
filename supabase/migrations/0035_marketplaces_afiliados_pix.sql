-- ============================================================================
-- 0035 — Shopee: colunas da "Minha renda" que a 1ª loja não usava
-- ============================================================================
-- A 2ª loja analisada (2026-11-25) trouxe cobranças que até aqui caíam em
-- "outros" (ou sumiam): o programa de afiliados, o desconto no Pix e o frete
-- de devolução. Com coluna própria, o custo do mês mostra cada uma pelo nome e
-- a conferência não acusa a taxa de afiliado como "tarifa cobrada a mais".
-- Valores com o sinal do relatório (cobrança = negativo). Linhas antigas
-- ficam com 0 — o que já estava em "outros" continua lá até reimportar.
-- ============================================================================

alter table public.marketplace_repasses
  -- "Taxa de comissão Afiliados do Vendedor" (aba Renda): a comissão que a
  -- loja paga ao afiliado que trouxe a venda
  add column if not exists afiliados_comissao numeric(14, 2) not null default 0,
  -- "Taxa de Serviço Afiliados do Vendedor" (aba Service Fee Details): a taxa
  -- da Shopee sobre a comissão do afiliado; vem DENTRO da taxa de serviço
  add column if not exists afiliados_servico  numeric(14, 2) not null default 0,
  -- "Ajuste por pagamento via PIX": desconto do Pix, que a Shopee devolve em
  -- desconto na comissão/serviço (como o cupom dela)
  add column if not exists pix                numeric(14, 2) not null default 0,
  -- "Taxa de envio reverso": frete de volta da devolução, pago pela loja
  add column if not exists envio_reverso      numeric(14, 2) not null default 0;

comment on column public.marketplace_repasses.afiliados_comissao is
  'Comissão paga ao afiliado (Taxa de comissão Afiliados do Vendedor), negativa.';
comment on column public.marketplace_repasses.afiliados_servico is
  'Taxa da Shopee sobre a comissão do afiliado (dentro da taxa de serviço), negativa.';
comment on column public.marketplace_repasses.pix is
  'Desconto do pagamento via Pix (Ajuste por pagamento via PIX), negativo; volta em desconto nas taxas.';
comment on column public.marketplace_repasses.envio_reverso is
  'Frete de volta da devolução (Taxa de envio reverso), negativo.';
