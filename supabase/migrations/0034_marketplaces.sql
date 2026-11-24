-- ==========================================================================
-- 0034_marketplaces.sql
-- Conferência de marketplaces (pedido do user em 2026-11-23/24). Começa pela
-- Shopee; a estrutura serve pros outros (Mercado Livre, Shein…) — basta
-- liberar o nome no check. Só conta CNPJ (o escritório não atende loja em CPF).
--
-- O que a conferência faz (backend/src/marketplaces/conferencia.ts e custos.ts):
--   * pedido concluído há 7 dias ou mais sem pagamento = "enviado e não pago";
--   * comissão e taxas cobradas × a tabela de tarifas do cliente (cinco
--     partes: comissão %, transação %, Campanha de Destaque %, R$ por item e
--     R$ por pedido), pela data de CRIAÇÃO do pedido;
--   * devolução: o débito da Shopee não pode passar do que a loja recebeu
--     pelos itens devolvidos; débito sem devolução aprovada; pacote perdido
--     sem compensação; frete a mais por peso;
--   * custos do mês pela data em que o dinheiro mexeu na carteira, fechando
--     com o saldo da carteira.
--
-- Os dados entram pelos três relatórios da Central do Vendedor (origem
-- 'excel'): pedidos (Order.all), renda (Income: Minha renda) e carteira
-- (my_balance_transaction_report). Depois, pela API (origem 'api'). O backend
-- lê o arquivo em memória e só grava as colunas abaixo — o arquivo não é
-- guardado.
--
-- LGPD: NADA do comprador (nome, usuário, endereço, CPF, telefone) é gravado.
--
-- TRAVA DE LOJA: cada empresa tem UMA loja (o "nome de usuário do vendedor"
-- que vem nos relatórios) e cada loja é de UMA empresa do escritório —
-- relatório de outra loja é recusado antes de gravar qualquer coisa.
--
-- TABELA DE TARIFAS: é do LOGIN DO CLIENTE — ele preenche uma vez no portal e
-- vale pra todas as empresas dele (a responsabilidade pelos números é dele).
-- O escritório só consulta. Empresa com mais de um login que preencheu: vale
-- a tabela salva por último.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- A loja de cada empresa no marketplace (trava contra relatório trocado)
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_lojas (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id     uuid not null references public.clients (id) on delete cascade,
  marketplace   text not null check (marketplace in ('shopee')),
  -- nome de usuário do vendedor, como vem no relatório
  loja          text not null check (btrim(loja) <> ''),
  created_at    timestamptz not null default now(),
  unique (client_id, marketplace)
);
-- a mesma loja não entra em duas empresas do escritório
create unique index if not exists marketplace_lojas_loja_idx
  on public.marketplace_lojas (owner_id, marketplace, lower(btrim(loja)));

comment on table public.marketplace_lojas is
  'A loja (nome de usuário do vendedor) de cada empresa no marketplace. Relatório de outra loja é recusado.';

-- --------------------------------------------------------------------------
-- Chamados abertos no marketplace — em LOTE: vários pedidos num chamado só.
-- Cada pedido entra em UM chamado só (pra não duplicar): a ligação é a coluna
-- marketplace_pedidos.chamado_id. O nº do chamado é opcional (pode vir depois)
-- e não se repete na mesma empresa.
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_chamados (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id             uuid not null references public.clients (id) on delete cascade,
  marketplace           text not null check (marketplace in ('shopee')),
  -- nº do chamado/protocolo no marketplace (vazio = ainda não informado)
  numero                text check (numero is null or btrim(numero) <> ''),
  -- o dia em que o chamado foi aberto no marketplace
  aberto_em             date not null,
  aberto_por_email      text not null,
  obs                   text,
  -- o lote inteiro resolvido (cada pedido também pode ser resolvido sozinho)
  resolvido_em          date,
  resolvido_por_email   text,
  created_at            timestamptz not null default now()
);
create unique index if not exists marketplace_chamados_numero_idx
  on public.marketplace_chamados (client_id, marketplace, lower(btrim(numero)))
  where numero is not null;
create index if not exists marketplace_chamados_empresa_idx
  on public.marketplace_chamados (client_id, marketplace, aberto_em desc);

comment on table public.marketplace_chamados is
  'Chamado aberto no marketplace com um lote de pedidos (não pagos / cobrados a mais). Cada pedido entra em um chamado só (marketplace_pedidos.chamado_id).';

-- --------------------------------------------------------------------------
-- Pedidos (relatório de pedidos: uma linha por item, juntada por pedido)
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_pedidos (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id             uuid not null references public.clients (id) on delete cascade,
  marketplace           text not null check (marketplace in ('shopee')),
  pedido                text not null check (btrim(pedido) <> ''),
  -- situação normalizada (a original fica em status_marketplace)
  status                text not null check (status in ('aguardando_envio', 'enviado', 'concluido', 'cancelado', 'devolvido', 'outro')),
  status_marketplace    text,
  -- "Solicitação aprovada"… (vazio = sem pedido de devolução)
  status_devolucao      text,
  -- só o motivo (ex.: "Pacote perdido em trânsito"), nada do comprador
  motivo_cancelamento   text,
  criado_em             timestamptz,
  enviado_em            timestamptz,
  concluido_em          timestamptz,
  -- Σ preço × qtd dos itens (sem frete)
  valor_produtos        numeric(14, 2),
  -- quanto o comprador pagou
  valor_total           numeric(14, 2),
  -- [{sku, descricao, preco, qtd, devolvidos}] — preço unitário que vale pra faixa da tarifa
  itens                 jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array'),
  origem                text not null check (origem in ('excel', 'api')),
  importado_em          timestamptz not null default now(),
  -- o chamado em que o pedido entrou (um só); excluir o chamado libera o pedido
  chamado_id                   uuid references public.marketplace_chamados (id) on delete set null,
  -- este pedido resolvido (sem esperar o lote inteiro)
  chamado_resolvido_em         date,
  chamado_resolvido_por_email  text,
  unique (client_id, marketplace, pedido)
);
create index if not exists marketplace_pedidos_chamado_idx
  on public.marketplace_pedidos (chamado_id) where chamado_id is not null;
create index if not exists marketplace_pedidos_criacao_idx
  on public.marketplace_pedidos (client_id, marketplace, criado_em);

comment on table public.marketplace_pedidos is
  'Pedidos de marketplace de cada empresa (relatório de pedidos da Central do Vendedor ou API). Sem dados do comprador.';

-- --------------------------------------------------------------------------
-- Repasses: o pagamento de cada pedido (relatório Minha renda). Valores com o
-- sinal do relatório: o que a loja paga vem NEGATIVO.
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_repasses (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id             uuid not null references public.clients (id) on delete cascade,
  marketplace           text not null check (marketplace in ('shopee')),
  pedido                text not null check (btrim(pedido) <> ''),
  -- a vigência da tabela vai pela data de criação do pedido
  criado_dia            date,
  -- "Data de conclusão do pagamento"
  pago_em               date,
  -- "Preço do produto": a base da comissão e das taxas percentuais
  preco                 numeric(14, 2) not null default 0,
  -- devolvido ao comprador ANTES do pagamento (negativo)
  reembolso             numeric(14, 2) not null default 0,
  -- cupom da Shopee (a Shopee devolve em desconto na comissão/serviço) e o incentivo
  cupom                 numeric(14, 2) not null default 0,
  incentivo_cupom       numeric(14, 2) not null default 0,
  -- voucher da própria loja (custo da loja)
  voucher_loja          numeric(14, 2) not null default 0,
  frete_comprador       numeric(14, 2) not null default 0,
  frete_desconto        numeric(14, 2) not null default 0,
  frete_transportadora  numeric(14, 2) not null default 0,
  -- bruta = pela tabela; líquida = depois do desconto do cupom da Shopee
  comissao_bruta        numeric(14, 2) not null default 0,
  comissao_liquida      numeric(14, 2) not null default 0,
  servico_bruta         numeric(14, 2) not null default 0,
  servico_liquida       numeric(14, 2) not null default 0,
  -- as três partes da taxa de serviço (líquidas, como vêm no detalhe)
  transacao             numeric(14, 2) not null default 0,
  campanha              numeric(14, 2) not null default 0,
  por_item              numeric(14, 2) not null default 0,
  devolucao_facil       numeric(14, 2) not null default 0,
  -- o que as colunas acima não explicam do líquido (Pix, AMP, moedas…)
  outros                numeric(14, 2) not null default 0,
  -- "Quantia total lançada"
  liquido               numeric(14, 2) not null,
  -- frete a mais por peso (aba Shipping Fee Discrepancy)
  frete_esperado        numeric(14, 2),
  frete_real            numeric(14, 2),
  origem                text not null check (origem in ('excel', 'api')),
  importado_em          timestamptz not null default now(),
  unique (client_id, marketplace, pedido)
);
create index if not exists marketplace_repasses_pago_idx
  on public.marketplace_repasses (client_id, marketplace, pago_em);

comment on table public.marketplace_repasses is
  'Pagamento de cada pedido (Minha renda): preço, reembolso, cupons, frete, comissão e taxas (bruta e líquida) e o líquido. Valores com o sinal do relatório.';

-- --------------------------------------------------------------------------
-- Carteira: cada movimento do saldo (relatório de transações da carteira).
-- É a base dos custos do mês e das cobranças que não estão na renda
-- (penalidade, anúncios), e fecha com o saldo.
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_carteira (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id     uuid not null references public.clients (id) on delete cascade,
  marketplace   text not null check (marketplace in ('shopee')),
  -- data|tipo|pedido|valor|saldo — reimportar o mesmo período não duplica
  chave         text not null check (btrim(chave) <> ''),
  data          timestamptz not null,
  -- a ordem no relatório (do mais antigo pro mais novo), pra conferir o saldo no mesmo segundo
  seq           integer not null default 0,
  tipo          text not null,
  descricao     text,
  pedido        text,
  categoria     text not null check (categoria in (
                  'renda_pedido', 'debito_devolucao', 'compensacao_logistica', 'objeto_perdido',
                  'difal', 'penalidade', 'anuncios', 'saque', 'outro')),
  -- com sinal: entrada positiva, saída negativa
  valor         numeric(14, 2) not null,
  saldo_apos    numeric(14, 2),
  status        text,
  origem        text not null check (origem in ('excel', 'api')),
  importado_em  timestamptz not null default now(),
  unique (client_id, marketplace, chave)
);
create index if not exists marketplace_carteira_data_idx
  on public.marketplace_carteira (client_id, marketplace, data);
create index if not exists marketplace_carteira_pedido_idx
  on public.marketplace_carteira (client_id, marketplace, pedido) where pedido is not null;

comment on table public.marketplace_carteira is
  'Movimentos da carteira do vendedor (relatório de transações): renda dos pedidos, ajustes, penalidades, anúncios, saques. Com sinal.';

-- --------------------------------------------------------------------------
-- O que foi importado (qual relatório, período, quem)
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_importacoes (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default public.escritorio_atual() references auth.users (id) on delete restrict,
  client_id             uuid not null references public.clients (id) on delete cascade,
  marketplace           text not null check (marketplace in ('shopee')),
  tipo                  text not null check (tipo in ('pedidos', 'renda', 'carteira')),
  arquivo               text not null,
  loja                  text,
  periodo_de            date,
  periodo_ate           date,
  linhas                integer not null default 0,
  importado_por_email   text not null,
  importado_em          timestamptz not null default now()
);
create index if not exists marketplace_importacoes_empresa_idx
  on public.marketplace_importacoes (client_id, marketplace, importado_em desc);

comment on table public.marketplace_importacoes is
  'Relatórios do marketplace importados por empresa: tipo, período, linhas e quem importou.';

-- --------------------------------------------------------------------------
-- Tabela de tarifas do LOGIN DO CLIENTE (vale pra todas as empresas dele), com vigência
-- --------------------------------------------------------------------------
create table if not exists public.marketplace_tarifas (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users (id) on delete restrict,
  -- o login do cliente dono da tabela
  usuario_id            uuid not null references auth.users (id) on delete cascade,
  marketplace           text not null check (marketplace in ('shopee')),
  -- vale pela data de CRIAÇÃO do pedido
  vigencia_inicio       date not null,
  -- vazio = em vigor
  vigencia_fim          date,
  -- faixa pelo PREÇO UNITÁRIO do item, com os dois extremos inclusos (ex.: 8,00 a 79,99)
  preco_min             numeric(14, 2) not null default 0 check (preco_min >= 0),
  preco_max             numeric(14, 2),
  -- % sobre o preço do produto
  comissao_pct          numeric(6, 3) not null check (comissao_pct >= 0 and comissao_pct <= 100),
  transacao_pct         numeric(6, 3) not null default 0 check (transacao_pct >= 0 and transacao_pct <= 100),
  -- Campanha de Destaque (taxa de serviço adicional) — opcional; 0 = fora da campanha
  campanha_pct          numeric(6, 3) not null default 0 check (campanha_pct >= 0 and campanha_pct <= 100),
  -- R$ por unidade vendida e R$ por pedido (Devolução Fácil)
  por_item              numeric(14, 2) not null default 0 check (por_item >= 0),
  por_pedido            numeric(14, 2) not null default 0 check (por_pedido >= 0),
  obs                   text,
  -- quem preencheu esta faixa e quando — a responsabilidade é do cliente
  preenchido_por_email  text not null,
  preenchido_em         timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_fim >= vigencia_inicio),
  check (preco_max is null or preco_max >= preco_min)
);
create index if not exists marketplace_tarifas_usuario_idx
  on public.marketplace_tarifas (usuario_id, marketplace, vigencia_inicio);

comment on table public.marketplace_tarifas is
  'Tarifas do marketplace de cada LOGIN DE CLIENTE (vale pra todas as empresas dele): comissão, transação e Campanha de Destaque em %, R$ por item e por pedido, por faixa de preço e vigência. Preenchida pelo cliente no portal; o escritório só lê.';

-- --------------------------------------------------------------------------
-- Quem vê o quê. Escritório: lê tudo do escritório; grava os dados importados
-- e os chamados; tabela de tarifas, só lê. Login de cliente nunca toca as
-- tabelas direto: o portal usa a secret key conferindo as empresas do login.
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['marketplace_lojas', 'marketplace_chamados', 'marketplace_pedidos', 'marketplace_repasses',
                           'marketplace_carteira', 'marketplace_importacoes', 'marketplace_tarifas']
  loop
    execute format('alter table public.%1$I enable row level security', t);
    execute format('revoke all on table public.%1$I from anon', t);
    execute format('drop policy if exists %1$I_select on public.%1$I', t);
    execute format('drop policy if exists %1$I_insert on public.%1$I', t);
    execute format('drop policy if exists %1$I_update on public.%1$I', t);
    execute format('drop policy if exists %1$I_delete on public.%1$I', t);
    execute format('drop policy if exists %1$I_sem_login_de_cliente on public.%1$I', t);
    execute format($f$
      create policy %1$I_sem_login_de_cliente on public.%1$I
        as restrictive for all to authenticated
        using ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente')
        with check ((select coalesce(auth.jwt() -> 'app_metadata' ->> 'papel', '')) <> 'cliente')
    $f$, t);
    execute format($f$
      create policy %1$I_select on public.%1$I for select to authenticated
        using (owner_id = (select public.escritorio_atual()))
    $f$, t);
  end loop;

  foreach t in array array['marketplace_lojas', 'marketplace_chamados', 'marketplace_pedidos', 'marketplace_repasses',
                           'marketplace_carteira', 'marketplace_importacoes']
  loop
    execute format($f$
      create policy %1$I_insert on public.%1$I for insert to authenticated
        with check (owner_id = (select public.escritorio_atual()))
    $f$, t);
    execute format($f$
      create policy %1$I_update on public.%1$I for update to authenticated
        using (owner_id = (select public.escritorio_atual()))
        with check (owner_id = (select public.escritorio_atual()))
    $f$, t);
    execute format($f$
      create policy %1$I_delete on public.%1$I for delete to authenticated
        using (owner_id = (select public.escritorio_atual()))
    $f$, t);
  end loop;
end $$;
-- marketplace_tarifas: sem policy de escrita pro login do escritório (só o portal, com a secret key)

-- --------------------------------------------------------------------------
-- Abrir um chamado com um lote de pedidos — tudo ou nada. Pedido que já está
-- em outro chamado recusa o lote inteiro (erro MP409, com a lista em detail).
-- Roda como quem chama: o escritório (RLS) ou o portal (secret key, depois de
-- o backend conferir as empresas do login).
-- --------------------------------------------------------------------------
create or replace function public.abrir_chamado_marketplace(
  p_client uuid,
  p_marketplace text,
  p_pedidos text[],
  p_numero text,
  p_aberto_em date,
  p_obs text,
  p_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid;
  v_chamado uuid;
  v_faltam text[];
  v_ocupados jsonb;
  n integer;
begin
  select owner_id into v_owner from public.clients where id = p_client;
  if not found then
    raise exception 'Empresa não encontrada.' using errcode = 'P0002';
  end if;
  if coalesce(array_length(p_pedidos, 1), 0) = 0 then
    raise exception 'Escolha pelo menos um pedido.' using errcode = '22023';
  end if;

  -- trava os pedidos do lote (dois chamados ao mesmo tempo não pegam o mesmo pedido)
  perform 1
     from public.marketplace_pedidos
    where client_id = p_client and marketplace = p_marketplace and pedido = any (p_pedidos)
      for update;

  select array_agg(x order by x) into v_faltam
    from unnest(p_pedidos) as x
   where not exists (
     select 1 from public.marketplace_pedidos p
      where p.client_id = p_client and p.marketplace = p_marketplace and p.pedido = x
   );
  if v_faltam is not null then
    raise exception 'Pedido(s) não encontrado(s): %', array_to_string(v_faltam, ', ') using errcode = 'P0002';
  end if;

  select jsonb_agg(
           jsonb_build_object('pedido', p.pedido, 'numero', c.numero, 'aberto_em', c.aberto_em)
           order by p.pedido
         )
    into v_ocupados
    from public.marketplace_pedidos p
    join public.marketplace_chamados c on c.id = p.chamado_id
   where p.client_id = p_client and p.marketplace = p_marketplace and p.pedido = any (p_pedidos);
  if v_ocupados is not null then
    raise exception 'Há pedido(s) que já estão em outro chamado.'
      using errcode = 'MP409', detail = v_ocupados::text;
  end if;

  insert into public.marketplace_chamados (owner_id, client_id, marketplace, numero, aberto_em, aberto_por_email, obs)
  values (v_owner, p_client, p_marketplace, nullif(btrim(coalesce(p_numero, '')), ''), p_aberto_em,
          coalesce(nullif(btrim(p_email), ''), '(sem e-mail)'), nullif(btrim(coalesce(p_obs, '')), ''))
  returning id into v_chamado;

  update public.marketplace_pedidos
     set chamado_id = v_chamado, chamado_resolvido_em = null, chamado_resolvido_por_email = null
   where client_id = p_client and marketplace = p_marketplace and pedido = any (p_pedidos) and chamado_id is null;
  get diagnostics n = row_count;

  return jsonb_build_object('id', v_chamado, 'pedidos', n);
end;
$$;

revoke all on function public.abrir_chamado_marketplace(uuid, text, text[], text, date, text, text) from public, anon;
grant execute on function public.abrir_chamado_marketplace(uuid, text, text[], text, date, text, text) to authenticated, service_role;

comment on function public.abrir_chamado_marketplace is
  'Abre um chamado com um lote de pedidos (tudo ou nada). Pedido já em outro chamado recusa o lote (MP409, lista em detail).';
