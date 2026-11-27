/**
 * Conferência de marketplaces (migration 0034) — as regras, sem banco:
 *
 * 1. PAGAMENTO: concluído há PRAZO_DIAS (7) ou mais sem pagamento = "enviado e
 *    não pago" — o que se cobra do marketplace.
 * 2. TARIFA, contra a tabela do cliente vigente na data de CRIAÇÃO do pedido,
 *    em duas partes (é assim que o cliente quer ver):
 *      comissão = % × preço do produto
 *      taxas    = transação % + Campanha de Destaque % (sobre o preço)
 *                 + R$ por item vendido + R$ por pedido (Devolução Fácil)
 *    A base é o "Preço do produto" do relatório de renda menos o que foi
 *    devolvido ANTES do pagamento e menos o voucher da própria loja (conferido
 *    nas amostras: R$ 49,99 com voucher de R$ 2,50 paga 18% sobre R$ 47,49);
 *    a taxa por item vai na proporção do valor que ficou depois da devolução;
 *    cada % é arredondado no centavo. O cobrado
 *    é a tarifa BRUTA (o cupom da Shopee vem como desconto na líquida e é
 *    compensado — não é cobrança a mais nem a menos).
 * 3. DEVOLUÇÃO depois do pagamento: a Shopee debita da carteira o que a loja
 *    recebeu pelos itens devolvidos (sem a taxa de R$ 0,49). Débito maior que
 *    isso, ou débito sem devolução aprovada, vira chamado.
 * 4. PACOTE PERDIDO: pedido cancelado por "pacote perdido" tem que ter
 *    compensação na carteira.
 * 5. FRETE A MAIS por peso: o que a loja pagou de frete (comprador + desconto
 *    da Shopee − transportadora < 0). Informativo — o cadastro do produto está
 *    com o peso errado.
 *
 * Só CNPJ (uma tabela por login de cliente).
 */

export const PRAZO_DIAS = 7;
/** Diferença abaixo disso (por parte, por pedido) é arredondamento. */
export const TOLERANCIA_TARIFA = 0.02;
/** Pacote perdido: a Shopee fala em até 7 dias úteis; depois de 30 dias corridos sem compensação, vira chamado. */
export const DIAS_COMPENSACAO = 30;

export type StatusPedido = 'aguardando_envio' | 'enviado' | 'concluido' | 'cancelado' | 'devolvido' | 'outro';

export type Item = { preco: number; qtd: number; devolvidos?: number; sku?: string | null; descricao?: string | null };

export type Pedido = {
  pedido: string;
  status: StatusPedido;
  criado_em: string | null;
  concluido_em: string | null;
  status_devolucao?: string | null;
  motivo_cancelamento?: string | null;
  itens: Item[];
  chamado_aberto_em?: string | null;
  chamado_resolvido_em?: string | null;
};

export type Repasse = {
  pedido: string;
  criado_dia: string | null;
  pago_em: string | null;
  preco: number;
  reembolso: number;
  cupom: number;
  incentivo_cupom: number;
  voucher_loja: number;
  frete_comprador: number;
  frete_desconto: number;
  frete_transportadora: number;
  comissao_bruta: number;
  comissao_liquida: number;
  servico_bruta: number;
  servico_liquida: number;
  transacao: number;
  campanha: number;
  por_item: number;
  devolucao_facil: number;
  /** programa de afiliados: a comissão do afiliado e a taxa da Shopee sobre ela (que vem dentro da taxa de serviço) */
  afiliados_comissao?: number;
  afiliados_servico?: number;
  /** desconto do Pix (volta em desconto nas taxas, como o cupom da Shopee) */
  pix?: number;
  /** frete de volta da devolução */
  envio_reverso?: number;
  outros: number;
  liquido: number;
  frete_esperado: number | null;
  frete_real: number | null;
};

export type CategoriaCarteira =
  | 'renda_pedido'
  | 'debito_devolucao'
  | 'compensacao_logistica'
  | 'objeto_perdido'
  | 'difal'
  | 'penalidade'
  | 'anuncios'
  | 'saque'
  | 'outro';

export type Movimento = {
  pedido: string | null;
  data: string;
  seq: number;
  categoria: CategoriaCarteira;
  valor: number;
  saldo_apos: number | null;
  tipo?: string;
  descricao?: string | null;
};

export type Tarifa = {
  vigencia_inicio: string; // AAAA-MM-DD
  vigencia_fim: string | null;
  preco_min: number;
  preco_max: number | null;
  comissao_pct: number;
  transacao_pct: number;
  campanha_pct: number;
  por_item: number;
  por_pedido: number;
};

/**
 * pago          — tem pagamento (renda ou carteira)
 * aguardando    — concluído há menos de PRAZO_DIAS (ou sem data de conclusão)
 * nao_pago      — concluído há PRAZO_DIAS ou mais e nada de pagamento
 * em_andamento  — ainda não concluído (aguardando envio, enviado, entregue…)
 * devolvido     — devolvido por inteiro (antes ou sem pagamento)
 * cancelado     — cancelado (não deveria ser pago)
 */
export type SituacaoPagamento = 'pago' | 'aguardando' | 'nao_pago' | 'em_andamento' | 'devolvido' | 'cancelado';

/**
 * ok              — cobrado = esperado (± tolerância)
 * cobrado_a_mais  — a comissão OU as taxas vieram acima da tabela
 * cobrado_a_menos — veio abaixo (informativo)
 * sem_tabela      — algum item sem faixa/vigência na tabela do cliente
 * tabela_ambigua  — mais de uma faixa serve pro mesmo item (tabela mal preenchida)
 * sem_repasse     — ainda não dá pra conferir
 */
export type SituacaoTarifa = 'ok' | 'cobrado_a_mais' | 'cobrado_a_menos' | 'sem_tabela' | 'tabela_ambigua' | 'sem_repasse';
export type SituacaoParte = 'ok' | 'a_mais' | 'a_menos';

/** Uma parte da tarifa (comissão ou taxas): esperado × cobrado. */
export type ParteTarifa = { esperada: number; cobrada: number; diferenca: number; situacao: SituacaoParte };

export type TaxasEsperadas = { comissao: number; transacao: number; campanha: number; por_item: number; por_pedido: number; itens: number };

export type Devolucao = {
  /** devolvido ao comprador ANTES do pagamento (positivo) */
  antes: number;
  /** debitado da carteira DEPOIS do pagamento (positivo) */
  depois: number;
  /** o máximo que a Shopee podia debitar (o que a loja recebeu, sem a taxa de R$ 0,49) */
  limite: number | null;
  /** compensação da Shopee (produto perdido na volta) */
  compensado: number;
  situacao: 'ok' | 'debitado_a_mais' | 'sem_solicitacao';
  a_mais: number;
};

export type ConferenciaPedido = {
  pedido: string;
  status: StatusPedido;
  pagamento: SituacaoPagamento;
  /** dias inteiros desde a conclusão (null sem data) */
  dias_desde_conclusao: number | null;
  /** o que entrou pela venda (líquido do relatório de renda, ou o crédito da carteira) */
  recebido: number;
  /** recebido − débitos de devolução + compensações */
  recebido_final: number;
  pago_em: string | null;
  tarifa: {
    situacao: SituacaoTarifa;
    comissao: ParteTarifa | null;
    taxas: ParteTarifa | null;
    esperado: TaxasEsperadas | null;
    /** a quantidade de itens veio da taxa por item (sem o relatório de pedidos) */
    itens_estimados: boolean;
    /** cobrado − esperado no total (positivo = cobrou a mais) */
    diferenca: number | null;
  };
  devolucao: Devolucao | null;
  frete_a_mais: { valor: number; esperado: number | null; real: number | null } | null;
  perdido: { situacao: 'compensado' | 'aguardando' | 'sem_compensacao'; compensado: number } | null;
  /** quanto o pedido pagou de cupom da Shopee e quanto voltou de desconto nas taxas */
  cupom: { cupom: number; desconto_taxas: number } | null;
  /** o pagamento desmontado, pra mostrar ao cliente (custos positivos, pela tarifa BRUTA) */
  extrato: Extrato | null;
  chamado: 'nenhum' | 'aberto' | 'resolvido';
};

export type Extrato = {
  preco: number;
  /** devolvido ao comprador antes do pagamento */
  devolvido_antes: number;
  voucher_loja: number;
  /** base das taxas %: preço − devolvido antes − voucher da loja */
  base: number;
  comissao: number;
  transacao: number;
  campanha: number;
  por_item: number;
  devolucao_facil: number;
  /** cupom da Shopee e desconto do Pix que a loja pagou, e o que voltou em desconto nas taxas */
  cupom: number;
  pix: number;
  desconto_taxas: number;
  /** comissão do afiliado + a taxa da Shopee sobre ela */
  afiliados: number;
  frete: { comprador: number; desconto_shopee: number; transportadora: number; loja_pagou: number };
  /** frete de volta da devolução */
  envio_reverso: number;
  outros: number;
  liquido: number;
  /** débito da devolução depois do pagamento e compensações (carteira) */
  debito_devolucao: number;
  compensacao: number;
};

/**
 * O pagamento desmontado. As partes da taxa de serviço vêm LÍQUIDAS no
 * relatório; com cupom, a bruta de transação e campanha vem da tabela (as
 * esperadas) e o resto é a taxa por item — sem tabela, rateia na proporção.
 */
export function extratoDoRepasse(rep: Repasse, esperado: TaxasEsperadas | null, debitoC = 0, compensadoC = 0): Extrato {
  const srvB = -c(rep.servico_bruta);
  const afilServ = -c(rep.afiliados_servico ?? 0);
  let tr: number;
  let camp: number;
  if (c(rep.servico_bruta) === c(rep.servico_liquida) || c(rep.servico_liquida) === 0) {
    tr = -c(rep.transacao);
    camp = -c(rep.campanha);
  } else if (esperado) {
    tr = c(esperado.transacao);
    camp = c(esperado.campanha);
  } else {
    const f = c(rep.servico_bruta) / c(rep.servico_liquida);
    tr = Math.round(-c(rep.transacao) * f);
    camp = Math.round(-c(rep.campanha) * f);
  }
  const frete = c(rep.frete_comprador) + c(rep.frete_desconto) + c(rep.frete_transportadora);
  return {
    preco: rep.preco,
    devolvido_antes: r(-c(rep.reembolso)),
    voucher_loja: r(-c(rep.voucher_loja)),
    base: r(Math.max(0, c(rep.preco) + c(rep.reembolso) + c(rep.voucher_loja))),
    comissao: r(-c(rep.comissao_bruta)),
    transacao: r(tr),
    campanha: r(camp),
    por_item: r(srvB - tr - camp - afilServ),
    devolucao_facil: r(-c(rep.devolucao_facil)),
    cupom: r(-(c(rep.cupom) + c(rep.incentivo_cupom))),
    pix: r(-c(rep.pix ?? 0)),
    desconto_taxas: r(c(rep.comissao_liquida) - c(rep.comissao_bruta) + c(rep.servico_liquida) - c(rep.servico_bruta)),
    afiliados: r(-c(rep.afiliados_comissao ?? 0) + afilServ),
    frete: {
      comprador: rep.frete_comprador,
      desconto_shopee: rep.frete_desconto,
      transportadora: r(-c(rep.frete_transportadora)),
      loja_pagou: r(Math.max(0, -frete)),
    },
    envio_reverso: r(-c(rep.envio_reverso ?? 0)),
    outros: r(-c(rep.outros)),
    liquido: rep.liquido,
    debito_devolucao: r(-debitoC),
    compensacao: r(compensadoC),
  };
}

export type ResumoConferencia = {
  pedidos: number;
  por_pagamento: Record<SituacaoPagamento, number>;
  nao_pago_valor: number;
  recebido: number;
  /** pedidos cobrados a mais (comissão ou taxas), e quanto */
  tarifa_cobrada_a_mais: { pedidos: number; valor: number };
  comissao_a_mais: { pedidos: number; valor: number };
  taxas_a_mais: { pedidos: number; valor: number };
  tarifa_sem_tabela: number;
  devolucoes: { pedidos: number; antes: number; depois: number; debitado_a_mais: { pedidos: number; valor: number }; sem_solicitacao: number };
  frete_a_mais: { pedidos: number; valor: number };
  perdidos: { pedidos: number; sem_compensacao: number };
};

const c = (v: number) => Math.round(v * 100);
const r = (cent: number) => (cent === 0 ? 0 : cent / 100);
const centavos = (v: number) => r(c(v));
const DIA_MS = 24 * 60 * 60 * 1000;

/** Data (AAAA-MM-DD) do instante no fuso de São Paulo — a vigência da tabela é por dia de calendário. */
export function diaEmSaoPaulo(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** % sobre a base, arredondado no centavo (meio pra cima), em centavos. */
const pct = (baseC: number, p: number) => Math.round((baseC * p) / 100 + 1e-9);

/** Situação do pagamento de um pedido. */
export function situacaoPagamento(
  p: Pick<Pedido, 'status' | 'concluido_em'>,
  repasse: Pick<Repasse, 'preco' | 'reembolso'> | null,
  creditoCarteira: boolean,
  agora: Date,
  prazoDias = PRAZO_DIAS,
): { situacao: SituacaoPagamento; dias: number | null } {
  const dias = p.concluido_em ? Math.floor((agora.getTime() - Date.parse(p.concluido_em)) / DIA_MS) : null;
  if (repasse && c(repasse.preco + repasse.reembolso) <= 0) return { situacao: 'devolvido', dias };
  if (repasse || creditoCarteira) return { situacao: 'pago', dias };
  if (p.status === 'cancelado') return { situacao: 'cancelado', dias };
  if (p.status === 'devolvido') return { situacao: 'devolvido', dias };
  if (p.status !== 'concluido') return { situacao: 'em_andamento', dias };
  if (dias === null || dias < prazoDias) return { situacao: 'aguardando', dias };
  return { situacao: 'nao_pago', dias };
}

const vigentesNo = (tabela: Tarifa[], dia: string) =>
  tabela.filter((t) => t.vigencia_inicio <= dia && (t.vigencia_fim === null || dia <= t.vigencia_fim));
const faixasDo = (vigentes: Tarifa[], preco: number) =>
  vigentes.filter((t) => preco >= t.preco_min && (t.preco_max === null || preco <= t.preco_max));

/**
 * As cinco partes esperadas do pedido pela tabela vigente no dia da criação.
 * Sem os itens (sem o relatório de pedidos), a quantidade sai da própria taxa
 * por item cobrada — `itens_estimados`.
 */
export function tarifaEsperada(
  p: Pick<Pedido, 'itens' | 'criado_em'>,
  rep: Repasse,
  tabela: Tarifa[],
): { esperado: TaxasEsperadas; itens_estimados: boolean } | { erro: 'sem_tabela' | 'tabela_ambigua' } {
  const dia = rep.criado_dia ?? (p.criado_em ? diaEmSaoPaulo(p.criado_em) : null);
  if (!dia) return { erro: 'sem_tabela' };
  const vigentes = vigentesNo(tabela, dia);
  if (!vigentes.length) return { erro: 'sem_tabela' };
  const precoC = c(rep.preco);
  // a % é sobre o preço menos o devolvido antes do pagamento e menos o voucher da
  // própria loja (o cupom da Shopee não mexe na base)
  const ficouC = Math.max(0, precoC + c(rep.reembolso));
  const baseC = Math.max(0, ficouC + c(rep.voucher_loja));
  // devolução ANTES do pagamento: a taxa por item vai na proporção do valor que ficou
  const fatia = precoC > 0 ? ficouC / precoC : 0;

  const itens = p.itens.filter((i) => i.qtd > 0);
  if (itens.length && baseC > 0) {
    // agrupa por faixa da tabela (preço unitário)
    const grupos = new Map<Tarifa, { baseC: number; qtd: number }>();
    for (const it of itens) {
      const fx = faixasDo(vigentes, it.preco);
      if (!fx.length) return { erro: 'sem_tabela' };
      if (fx.length > 1) return { erro: 'tabela_ambigua' };
      const g = grupos.get(fx[0]!) ?? { baseC: 0, qtd: 0 };
      g.baseC += c(it.preco) * it.qtd;
      g.qtd += it.qtd;
      grupos.set(fx[0]!, g);
    }
    // uma faixa só: a base é o preço do relatório de renda (o mesmo que a Shopee usa)
    if (grupos.size === 1) grupos.values().next().value!.baseC = baseC;
    else for (const g of grupos.values()) g.baseC = precoC > 0 ? Math.round((g.baseC * baseC) / precoC) : 0;
    let com = 0;
    let tr = 0;
    let camp = 0;
    let item = 0;
    let qtd = 0;
    for (const [t, g] of grupos) {
      com += pct(g.baseC, t.comissao_pct);
      tr += pct(g.baseC, t.transacao_pct);
      camp += pct(g.baseC, t.campanha_pct);
      item += c(t.por_item) * g.qtd;
      qtd += g.qtd;
    }
    const porPedido = Math.max(...[...grupos.keys()].map((t) => c(t.por_pedido)));
    return {
      esperado: {
        comissao: r(com),
        transacao: r(tr),
        campanha: r(camp),
        por_item: r(Math.round(item * fatia)),
        por_pedido: r(porPedido),
        itens: Math.round(qtd * fatia),
      },
      itens_estimados: false,
    };
  }

  // sem itens: faixa pelo preço (1 unidade) — ou a única faixa vigente
  let fx = vigentes.length === 1 ? vigentes : faixasDo(vigentes, r(baseC));
  if (!fx.length) fx = faixasDo(vigentes, rep.preco);
  if (!fx.length) return { erro: 'sem_tabela' };
  if (fx.length > 1) return { erro: 'tabela_ambigua' };
  const t = fx[0]!;
  const com = pct(baseC, t.comissao_pct);
  const tr = pct(baseC, t.transacao_pct);
  const camp = pct(baseC, t.campanha_pct);
  // a quantidade que explica a taxa por item cobrada (o resto da taxa de serviço, sem a do afiliado)
  const restoItem = -c(rep.servico_bruta) + c(rep.afiliados_servico ?? 0) - tr - camp;
  const qtd = baseC === 0 ? 0 : c(t.por_item) > 0 ? Math.max(0, Math.round(restoItem / c(t.por_item))) : 0;
  return {
    esperado: {
      comissao: r(com),
      transacao: r(tr),
      campanha: r(camp),
      por_item: r(c(t.por_item) * qtd),
      por_pedido: r(c(t.por_pedido)),
      itens: qtd,
    },
    itens_estimados: p.itens.length === 0,
  };
}

function parte(esperadaC: number, cobradaC: number): ParteTarifa {
  const dif = cobradaC - esperadaC;
  return {
    esperada: r(esperadaC),
    cobrada: r(cobradaC),
    diferenca: r(dif),
    situacao: dif > c(TOLERANCIA_TARIFA) ? 'a_mais' : dif < -c(TOLERANCIA_TARIFA) ? 'a_menos' : 'ok',
  };
}

const somaC = (ms: Movimento[], cat: CategoriaCarteira[]) => ms.filter((m) => cat.includes(m.categoria)).reduce((s, m) => s + c(m.valor), 0);

export function conferirPedido(
  p: Pedido,
  rep: Repasse | null,
  movimentos: Movimento[],
  tabela: Tarifa[],
  agora: Date,
  prazoDias = PRAZO_DIAS,
): ConferenciaPedido {
  const creditoC = somaC(movimentos, ['renda_pedido']);
  const { situacao, dias } = situacaoPagamento(p, rep, creditoC !== 0, agora, prazoDias);
  const recebidoC = rep ? c(rep.liquido) : creditoC;
  const debitoC = somaC(movimentos, ['debito_devolucao']);
  const compensadoC = somaC(movimentos, ['compensacao_logistica', 'objeto_perdido']);

  // tarifa
  let tarifa: ConferenciaPedido['tarifa'] = {
    situacao: 'sem_repasse',
    comissao: null,
    taxas: null,
    esperado: null,
    itens_estimados: false,
    diferenca: null,
  };
  if (rep) {
    const esp = tarifaEsperada(p, rep, tabela);
    if ('erro' in esp) {
      tarifa = { ...tarifa, situacao: esp.erro };
    } else {
      const e = esp.esperado;
      const comissao = parte(c(e.comissao), -c(rep.comissao_bruta));
      // a taxa da Shopee sobre a comissão do afiliado vem dentro da taxa de serviço,
      // mas não é da tabela da loja — fica de fora da comparação
      const taxas = parte(
        c(e.transacao) + c(e.campanha) + c(e.por_item) + c(e.por_pedido),
        -c(rep.servico_bruta) + c(rep.afiliados_servico ?? 0) - c(rep.devolucao_facil),
      );
      const algumaAMais = comissao.situacao === 'a_mais' || taxas.situacao === 'a_mais';
      const algumaAMenos = comissao.situacao === 'a_menos' || taxas.situacao === 'a_menos';
      tarifa = {
        situacao: algumaAMais ? 'cobrado_a_mais' : algumaAMenos ? 'cobrado_a_menos' : 'ok',
        comissao,
        taxas,
        esperado: e,
        itens_estimados: esp.itens_estimados,
        diferenca: r(c(comissao.diferenca) + c(taxas.diferenca)),
      };
    }
  }

  // devolução
  let devolucao: Devolucao | null = null;
  const antesC = rep ? -c(rep.reembolso) : 0;
  if (antesC > 0 || debitoC < 0) {
    // o que a loja recebeu (sem os R$ 0,49) — se a venda já saiu NEGATIVA (devolvida
    // antes do pagamento e a loja pagou o frete), o limite é zero, não negativo
    const limiteC = rep ? Math.max(0, c(rep.liquido) - c(rep.devolucao_facil)) : null;
    const aMaisC = debitoC < 0 && limiteC !== null && -debitoC > limiteC ? -debitoC - limiteC : 0;
    // só dá pra dizer "sem solicitação" com o relatório de pedidos (situação da devolução e itens devolvidos)
    const temSituacao = p.itens.length > 0;
    const devolveuItens = p.itens.some((i) => (i.devolvidos ?? 0) > 0);
    const semSolicitacao =
      debitoC < 0 && temSituacao && !devolveuItens && !/aprovad|reembols|devolu/i.test(p.status_devolucao ?? '');
    devolucao = {
      antes: r(antesC),
      depois: r(-debitoC),
      limite: limiteC === null ? null : r(limiteC),
      compensado: r(compensadoC),
      situacao: aMaisC > c(TOLERANCIA_TARIFA) ? 'debitado_a_mais' : semSolicitacao ? 'sem_solicitacao' : 'ok',
      a_mais: aMaisC > c(TOLERANCIA_TARIFA) ? r(aMaisC) : 0,
    };
  }

  // frete a mais
  let frete_a_mais: ConferenciaPedido['frete_a_mais'] = null;
  if (rep) {
    const pagoC = -(c(rep.frete_comprador) + c(rep.frete_desconto) + c(rep.frete_transportadora));
    if (pagoC > 0) frete_a_mais = { valor: r(pagoC), esperado: rep.frete_esperado, real: rep.frete_real };
  }

  // pacote perdido
  let perdido: ConferenciaPedido['perdido'] = null;
  if (p.status === 'cancelado' && /perdid|extravi/i.test(p.motivo_cancelamento ?? '')) {
    const desde = p.criado_em ? Math.floor((agora.getTime() - Date.parse(p.criado_em)) / DIA_MS) : null;
    perdido = {
      situacao: compensadoC > 0 ? 'compensado' : desde !== null && desde < DIAS_COMPENSACAO ? 'aguardando' : 'sem_compensacao',
      compensado: r(compensadoC),
    };
  }

  // cupom da Shopee e desconto do Pix: o que a loja pagou × o desconto que voltou nas taxas
  let cupom: ConferenciaPedido['cupom'] = null;
  if (rep && (c(rep.cupom) !== 0 || c(rep.incentivo_cupom) !== 0 || c(rep.pix ?? 0) !== 0)) {
    cupom = {
      cupom: r(-(c(rep.cupom) + c(rep.incentivo_cupom) + c(rep.pix ?? 0))),
      desconto_taxas: r(c(rep.comissao_liquida) - c(rep.comissao_bruta) + c(rep.servico_liquida) - c(rep.servico_bruta)),
    };
  }

  return {
    pedido: p.pedido,
    status: p.status,
    pagamento: situacao,
    dias_desde_conclusao: dias,
    recebido: r(recebidoC),
    recebido_final: r(recebidoC + debitoC + compensadoC),
    pago_em: rep?.pago_em ?? movimentos.find((m) => m.categoria === 'renda_pedido')?.data.slice(0, 10) ?? null,
    tarifa,
    devolucao,
    frete_a_mais,
    perdido,
    cupom,
    extrato: rep ? extratoDoRepasse(rep, tarifa.esperado, debitoC, compensadoC) : null,
    chamado: p.chamado_resolvido_em ? 'resolvido' : p.chamado_aberto_em ? 'aberto' : 'nenhum',
  };
}

/** Vale abrir chamado: não pago, cobrado a mais, débito de devolução errado, pacote perdido sem compensação. */
export const precisaDeChamado = (x: ConferenciaPedido) =>
  x.pagamento === 'nao_pago' ||
  x.tarifa.comissao?.situacao === 'a_mais' ||
  x.tarifa.taxas?.situacao === 'a_mais' ||
  (x.devolucao !== null && x.devolucao.situacao !== 'ok') ||
  x.perdido?.situacao === 'sem_compensacao';

/** Confere todos os pedidos de uma empresa e resume. */
export function conferir(
  pedidos: Pedido[],
  repasses: Repasse[],
  movimentos: Movimento[],
  tabela: Tarifa[],
  agora: Date,
  prazoDias = PRAZO_DIAS,
): { pedidos: ConferenciaPedido[]; resumo: ResumoConferencia } {
  const repDe = new Map(repasses.map((x) => [x.pedido, x]));
  const movDe = new Map<string, Movimento[]>();
  for (const m of movimentos) {
    if (!m.pedido) continue;
    const lista = movDe.get(m.pedido);
    if (lista) lista.push(m);
    else movDe.set(m.pedido, [m]);
  }

  const resultado = pedidos.map((p) =>
    conferirPedido(p, repDe.get(p.pedido) ?? null, movDe.get(p.pedido) ?? [], tabela, agora, prazoDias),
  );
  const valorDo = new Map(pedidos.map((p) => [p.pedido, p.itens.reduce((s, i) => s + c(i.preco) * i.qtd, 0)]));

  const resumo: ResumoConferencia = {
    pedidos: resultado.length,
    por_pagamento: { pago: 0, aguardando: 0, nao_pago: 0, em_andamento: 0, devolvido: 0, cancelado: 0 },
    nao_pago_valor: 0,
    recebido: 0,
    tarifa_cobrada_a_mais: { pedidos: 0, valor: 0 },
    comissao_a_mais: { pedidos: 0, valor: 0 },
    taxas_a_mais: { pedidos: 0, valor: 0 },
    tarifa_sem_tabela: 0,
    devolucoes: { pedidos: 0, antes: 0, depois: 0, debitado_a_mais: { pedidos: 0, valor: 0 }, sem_solicitacao: 0 },
    frete_a_mais: { pedidos: 0, valor: 0 },
    perdidos: { pedidos: 0, sem_compensacao: 0 },
  };
  const soma = { naoPago: 0, recebido: 0, tarifa: 0, com: 0, tax: 0, antes: 0, depois: 0, debMais: 0, frete: 0 };
  for (const x of resultado) {
    resumo.por_pagamento[x.pagamento]++;
    soma.recebido += c(x.recebido_final);
    if (x.pagamento === 'nao_pago') soma.naoPago += valorDo.get(x.pedido) ?? 0;
    const comMais = x.tarifa.comissao?.situacao === 'a_mais';
    const taxMais = x.tarifa.taxas?.situacao === 'a_mais';
    if (comMais || taxMais) {
      resumo.tarifa_cobrada_a_mais.pedidos++;
      soma.tarifa += (comMais ? c(x.tarifa.comissao!.diferenca) : 0) + (taxMais ? c(x.tarifa.taxas!.diferenca) : 0);
    }
    if (comMais) {
      resumo.comissao_a_mais.pedidos++;
      soma.com += c(x.tarifa.comissao!.diferenca);
    }
    if (taxMais) {
      resumo.taxas_a_mais.pedidos++;
      soma.tax += c(x.tarifa.taxas!.diferenca);
    }
    if (x.tarifa.situacao === 'sem_tabela' || x.tarifa.situacao === 'tabela_ambigua') resumo.tarifa_sem_tabela++;
    if (x.devolucao) {
      resumo.devolucoes.pedidos++;
      soma.antes += c(x.devolucao.antes);
      soma.depois += c(x.devolucao.depois);
      if (x.devolucao.situacao === 'debitado_a_mais') {
        resumo.devolucoes.debitado_a_mais.pedidos++;
        soma.debMais += c(x.devolucao.a_mais);
      }
      if (x.devolucao.situacao === 'sem_solicitacao') resumo.devolucoes.sem_solicitacao++;
    }
    if (x.frete_a_mais) {
      resumo.frete_a_mais.pedidos++;
      soma.frete += c(x.frete_a_mais.valor);
    }
    if (x.perdido) {
      resumo.perdidos.pedidos++;
      if (x.perdido.situacao === 'sem_compensacao') resumo.perdidos.sem_compensacao++;
    }
  }
  resumo.nao_pago_valor = r(soma.naoPago);
  resumo.recebido = r(soma.recebido);
  resumo.tarifa_cobrada_a_mais.valor = r(soma.tarifa);
  resumo.comissao_a_mais.valor = r(soma.com);
  resumo.taxas_a_mais.valor = r(soma.tax);
  resumo.devolucoes.antes = r(soma.antes);
  resumo.devolucoes.depois = r(soma.depois);
  resumo.devolucoes.debitado_a_mais.valor = r(soma.debMais);
  resumo.frete_a_mais.valor = r(soma.frete);
  return { pedidos: resultado, resumo };
}

/** Faixas que se sobrepõem (vigência e preço) — o cliente precisa corrigir antes de salvar. */
export function sobreposicoes(tabela: Pick<Tarifa, 'vigencia_inicio' | 'vigencia_fim' | 'preco_min' | 'preco_max'>[]): Array<[number, number]> {
  const pares: Array<[number, number]> = [];
  const fim = (t: (typeof tabela)[number]) => t.vigencia_fim ?? '9999-12-31';
  const teto = (t: (typeof tabela)[number]) => t.preco_max ?? Number.POSITIVE_INFINITY;
  for (let i = 0; i < tabela.length; i++) {
    for (let j = i + 1; j < tabela.length; j++) {
      const a = tabela[i]!;
      const b = tabela[j]!;
      const datas = a.vigencia_inicio <= fim(b) && b.vigencia_inicio <= fim(a);
      const precos = a.preco_min <= teto(b) && b.preco_min <= teto(a);
      if (datas && precos) pares.push([i, j]);
    }
  }
  return pares;
}

export { centavos };
