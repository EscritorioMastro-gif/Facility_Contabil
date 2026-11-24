/**
 * Custos da loja com o marketplace, mês a mês (pedido do user em 2026-11-24):
 * cada cobrança, o total pago, o que ficou para a loja e as médias, pra ele
 * ajustar o preço dos produtos.
 *
 * O mês é o da CARTEIRA (a data em que o dinheiro entrou ou saiu), e a conta
 * fecha com ela:
 *
 *   vendas − devolvido + compensações − custos = Σ movimentos da carteira (sem saques)
 *
 *   - vendas: "Preço do produto" de cada pedido pago no mês;
 *   - devolvido: o reembolso antes do pagamento + o preço dos itens devolvidos
 *     depois (o débito da carteira menos as taxas que a Shopee devolveu);
 *   - custos: comissão e taxas pela BRUTA, Devolução Fácil, voucher da loja,
 *     cupom da Shopee no líquido (o que a loja pagou − o desconto que voltou
 *     nas taxas; normalmente zero), frete a mais, anúncios, penalidade, DIFAL.
 *
 * As taxas aplicadas (18,6%, R$ 4,50…) saem dos próprios pagamentos, por dia
 * de criação do pedido — não dependem da tabela do cliente.
 */
import { diaEmSaoPaulo, type Movimento, type Repasse } from './conferencia.js';

export const CATEGORIAS_CUSTO = [
  'comissao',
  'transacao',
  'campanha',
  'por_item',
  'devolucao_facil',
  'voucher_loja',
  'cupom_shopee',
  'frete_a_mais',
  'anuncios',
  'penalidade',
  'difal',
  'outros',
] as const;
export type CategoriaCusto = (typeof CATEGORIAS_CUSTO)[number];

type Rotulos = Record<string, number>;

export type CustosMes = {
  mes: string;
  pedidos: number;
  itens: number;
  /** pedidos sem a quantidade de itens (sem relatório de pedidos e sem dar pra deduzir) */
  itens_sem_dado: number;
  vendas: number;
  devolvido: number;
  vendas_liquidas: number;
  compensacao: number;
  custos: Record<CategoriaCusto, number>;
  total_custos: number;
  /** o que ficou para a loja, pela conta */
  recebido: number;
  /** Σ movimentos da carteira no mês, sem os saques */
  carteira: number;
  saques: number;
  /** crédito de pedido na carteira sem o relatório de renda (não dá pra separar as taxas) */
  sem_detalhe: { pedidos: number; valor: number };
  fecha: boolean;
  diferenca: number;
  /** vezes em que o saldo da carteira andou diferente da transação listada */
  saldo: { quebras: number; valor: number };
  /** taxas aplicadas: rótulo → nº de pedidos (por item: nº de itens) */
  aplicadas: { comissao: Rotulos; transacao: Rotulos; campanha: Rotulos; por_item: Rotulos; por_pedido: Rotulos };
};

export type TaxasDoDia = { comissao: number; transacao: number; campanha: number; por_item: number; por_pedido: number };

const c = (v: number) => Math.round(v * 100);
const r = (x: number) => (x === 0 ? 0 : x / 100);
const pctRotulo = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const reaisRotulo = (cent: number) => `R$ ${(cent / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const vazio = (): Record<CategoriaCusto, number> =>
  Object.fromEntries(CATEGORIAS_CUSTO.map((k) => [k, 0])) as Record<CategoriaCusto, number>;
const mesDe = (iso: string) => diaEmSaoPaulo(iso).slice(0, 7);
const semCupom = (x: Repasse) => c(x.servico_bruta) === c(x.servico_liquida) && c(x.comissao_bruta) === c(x.comissao_liquida);
/** A base das taxas %: preço − devolvido antes do pagamento − voucher da própria loja. */
const base = (x: Repasse) => Math.max(0, c(x.preco) + c(x.reembolso) + c(x.voucher_loja));

/** % sobre a base em centavos, arredondado no centavo (meio pra cima). */
const pctDe = (baseC: number, p: number) => Math.round((baseC * p) / 100 + 1e-9);

/**
 * Os custos de um pagamento, em centavos positivos. A soma = preço + reembolso − líquido.
 * As três partes da taxa de serviço vêm LÍQUIDAS no relatório; com cupom da
 * Shopee, a bruta de cada uma sai das taxas do dia (transação e campanha pela
 * %, o resto é a taxa por item) — sem as taxas do dia, rateia na proporção.
 */
export function custosDoRepasse(x: Repasse, taxas?: TaxasDoDia): Record<CategoriaCusto, number> {
  const o = vazio();
  o.comissao = -c(x.comissao_bruta);
  const srvB = c(x.servico_bruta);
  const srvL = c(x.servico_liquida);
  if (srvB === srvL || srvL === 0) {
    o.transacao = -c(x.transacao);
    o.campanha = -c(x.campanha);
    o.por_item = srvL === 0 ? -srvB - o.transacao - o.campanha : -c(x.por_item);
  } else if (taxas) {
    o.transacao = pctDe(base(x), taxas.transacao);
    o.campanha = pctDe(base(x), taxas.campanha);
    o.por_item = -srvB - o.transacao - o.campanha;
  } else {
    const f = srvB / srvL;
    o.transacao = Math.round(-c(x.transacao) * f);
    o.campanha = Math.round(-c(x.campanha) * f);
    o.por_item = -srvB - o.transacao - o.campanha;
  }
  o.devolucao_facil = -c(x.devolucao_facil);
  o.voucher_loja = -c(x.voucher_loja);
  o.cupom_shopee = -(c(x.cupom) + c(x.incentivo_cupom) + c(x.comissao_liquida) - c(x.comissao_bruta) + srvL - srvB);
  o.frete_a_mais = -(c(x.frete_comprador) + c(x.frete_desconto) + c(x.frete_transportadora));
  o.outros = -c(x.outros);
  for (const k of CATEGORIAS_CUSTO) o[k] = o[k] || 0; // sem "-0"
  return o;
}

const moda = (xs: number[]) => {
  const n = new Map<number, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
};

/**
 * As taxas que a Shopee aplicou, por dia de criação do pedido: a % mais comum
 * do dia (pedidos sem cupom e sem devolução, de R$ 10 pra cima — abaixo disso o
 * arredondamento no centavo distorce); R$ por item e por pedido, o valor mais
 * comum.
 */
export function taxasObservadas(repasses: Repasse[], unidades: Map<string, number>): Map<string, TaxasDoDia> {
  const porDia = new Map<string, Repasse[]>();
  for (const x of repasses) {
    if (!x.criado_dia || base(x) <= 0) continue;
    const lista = porDia.get(x.criado_dia);
    if (lista) lista.push(x);
    else porDia.set(x.criado_dia, [x]);
  }
  const out = new Map<string, TaxasDoDia>();
  for (const [dia, xs] of porDia) {
    // só pedido sem cupom mostra a taxa "cheia" nas partes da taxa de serviço
    const limpos = xs.filter((x) => semCupom(x) && c(x.reembolso) === 0 && base(x) >= 1000);
    if (!limpos.length) continue;
    const taxa = (f: (x: Repasse) => number) => moda(limpos.map((x) => Math.round((-c(f(x)) / base(x)) * 1000))) / 10;
    const porItem = limpos
      .map((x) => {
        const u = unidades.get(x.pedido);
        return u ? Math.round(-c(x.por_item) / u) : null;
      })
      .filter((v): v is number => v !== null && v > 0);
    out.set(dia, {
      comissao: taxa((x) => x.comissao_bruta),
      transacao: taxa((x) => x.transacao),
      campanha: taxa((x) => x.campanha),
      por_item: r(porItem.length ? moda(porItem) : moda(limpos.map((x) => -c(x.por_item)).filter((v) => v > 0))),
      por_pedido: r(moda(xs.map((x) => -c(x.devolucao_facil)))),
    });
  }
  // dia só com pedido de cupom (ou pequeno): as taxas do dia limpo mais perto (antes; senão, depois)
  const limposOrdenados = [...out.keys()].sort();
  if (limposOrdenados.length) {
    for (const dia of porDia.keys()) {
      if (out.has(dia)) continue;
      const antes = limposOrdenados.filter((d) => d <= dia).at(-1);
      out.set(dia, out.get(antes ?? limposOrdenados[0]!)!);
    }
  }
  return out;
}

/** O dia mais recente com taxa observada — base do simulador de preço. */
export function taxasAtuais(obs: Map<string, TaxasDoDia>): (TaxasDoDia & { desde: string }) | null {
  const dias = [...obs.keys()].sort();
  if (!dias.length) return null;
  const ult = obs.get(dias[dias.length - 1]!)!;
  // desde quando valem as mesmas taxas
  let desde = dias[dias.length - 1]!;
  for (let i = dias.length - 2; i >= 0; i--) {
    const o = obs.get(dias[i]!)!;
    if (o.comissao !== ult.comissao || o.transacao !== ult.transacao || o.campanha !== ult.campanha || o.por_item !== ult.por_item) break;
    desde = dias[i]!;
  }
  return { ...ult, desde };
}

function novoMes(mes: string): CustosMes & { _c: Record<string, number> } {
  return {
    mes,
    pedidos: 0,
    itens: 0,
    itens_sem_dado: 0,
    vendas: 0,
    devolvido: 0,
    vendas_liquidas: 0,
    compensacao: 0,
    custos: vazio(),
    total_custos: 0,
    recebido: 0,
    carteira: 0,
    saques: 0,
    sem_detalhe: { pedidos: 0, valor: 0 },
    fecha: true,
    diferenca: 0,
    saldo: { quebras: 0, valor: 0 },
    aplicadas: { comissao: {}, transacao: {}, campanha: {}, por_item: {}, por_pedido: {} },
    _c: {},
  };
}
const soma = (o: Rotulos, k: string, n: number) => {
  if (n) o[k] = (o[k] ?? 0) + n;
};

/**
 * Custos por mês. `unidades`: itens de cada pedido que pagaram tarifa (do
 * relatório de pedidos); sem ela, sai da taxa por item.
 */
export function custosPorMes(
  movimentos: Movimento[],
  repasses: Repasse[],
  unidades: Map<string, number>,
): { meses: CustosMes[]; total: CustosMes; taxas_atuais: (TaxasDoDia & { desde: string }) | null } {
  const repDe = new Map(repasses.map((x) => [x.pedido, x]));
  const obs = taxasObservadas(repasses, unidades);
  const meses = new Map<string, ReturnType<typeof novoMes>>();
  const ordem = [...movimentos].sort((a, b) => Date.parse(a.data) - Date.parse(b.data) || a.seq - b.seq);

  const unidadesDe = (x: Repasse): number | null => {
    const u = unidades.get(x.pedido);
    if (u !== undefined) return u;
    const fixa = x.criado_dia ? obs.get(x.criado_dia)?.por_item : undefined;
    return fixa ? Math.round(-c(x.por_item) / c(fixa)) : null;
  };

  let anterior: Movimento | null = null;
  for (const m of ordem) {
    const mes = mesDe(m.data);
    const acc = meses.get(mes) ?? novoMes(mes);
    meses.set(mes, acc);
    const v = c(m.valor);
    const k = acc._c;
    const add = (chave: string, x: number) => (k[chave] = (k[chave] ?? 0) + x);

    // o saldo anda junto com a transação?
    if (anterior && anterior.saldo_apos !== null && m.saldo_apos !== null) {
      const dif = c(m.saldo_apos) - c(anterior.saldo_apos) - v;
      if (dif !== 0) {
        acc.saldo.quebras++;
        add('quebra', dif);
      }
    }
    anterior = m;

    if (m.categoria === 'saque') {
      add('saques', v);
      continue;
    }
    add('carteira', v);
    const x = m.pedido ? repDe.get(m.pedido) : undefined;
    switch (m.categoria) {
      case 'renda_pedido': {
        if (!x) {
          acc.sem_detalhe.pedidos++;
          add('sem_detalhe', v);
          break;
        }
        acc.pedidos++;
        add('vendas', c(x.preco));
        add('devolvido', -c(x.reembolso));
        const cs = custosDoRepasse(x, x.criado_dia ? obs.get(x.criado_dia) : undefined);
        for (const cat of CATEGORIAS_CUSTO) add(`c:${cat}`, cs[cat]);
        const u = unidadesDe(x);
        if (u === null) acc.itens_sem_dado++;
        else acc.itens += u;
        const t = x.criado_dia ? obs.get(x.criado_dia) : undefined;
        if (t && base(x) > 0) {
          soma(acc.aplicadas.comissao, pctRotulo(t.comissao), 1);
          soma(acc.aplicadas.transacao, pctRotulo(t.transacao), 1);
          if (t.campanha) soma(acc.aplicadas.campanha, pctRotulo(t.campanha), 1);
          if (u) soma(acc.aplicadas.por_item, reaisRotulo(c(t.por_item)), u);
        }
        if (c(x.devolucao_facil)) soma(acc.aplicadas.por_pedido, reaisRotulo(-c(x.devolucao_facil)), 1);
        break;
      }
      case 'debito_devolucao': {
        if (!x) {
          add('devolvido', -v);
          break;
        }
        // devolução total = o que a loja recebeu, sem a taxa de R$ 0,49; parcial = a proporção
        const cheio = -(c(x.liquido) - c(x.devolucao_facil));
        const f = cheio ? v / cheio : 0;
        const cs = custosDoRepasse(x, x.criado_dia ? obs.get(x.criado_dia) : undefined);
        let devolvidas = 0;
        for (const cat of CATEGORIAS_CUSTO) {
          if (cat === 'devolucao_facil') continue;
          const y = Math.round(f * cs[cat]);
          add(`c:${cat}`, -y);
          devolvidas += y;
        }
        add('devolvido', -v + devolvidas);
        const u = unidadesDe(x);
        if (u) acc.itens -= Math.round(f * u);
        break;
      }
      case 'compensacao_logistica':
      case 'objeto_perdido':
        add('compensacao', v);
        break;
      case 'anuncios':
        add('c:anuncios', -v);
        break;
      case 'penalidade':
        add('c:penalidade', -v);
        break;
      case 'difal':
        add('c:difal', -v);
        break;
      default:
        add('c:outros', -v);
    }
  }

  const fechar = (acc: ReturnType<typeof novoMes>): CustosMes => {
    const k = acc._c;
    const g = (chave: string) => k[chave] ?? 0;
    const custos = vazio();
    let total = 0;
    for (const cat of CATEGORIAS_CUSTO) {
      custos[cat] = r(g(`c:${cat}`));
      total += g(`c:${cat}`);
    }
    const liquidas = g('vendas') - g('devolvido');
    const recebido = liquidas + g('compensacao') - total + g('sem_detalhe');
    const { _c, ...resto } = acc;
    void _c;
    return {
      ...resto,
      vendas: r(g('vendas')),
      devolvido: r(g('devolvido')),
      vendas_liquidas: r(liquidas),
      compensacao: r(g('compensacao')),
      custos,
      total_custos: r(total),
      recebido: r(recebido),
      carteira: r(g('carteira')),
      saques: r(g('saques')),
      sem_detalhe: { pedidos: acc.sem_detalhe.pedidos, valor: r(g('sem_detalhe')) },
      fecha: recebido === g('carteira'),
      diferenca: r(g('carteira') - recebido),
      saldo: { quebras: acc.saldo.quebras, valor: r(g('quebra')) },
    };
  };

  const lista = [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes));
  const total = novoMes('total');
  for (const m of lista) {
    total.pedidos += m.pedidos;
    total.itens += m.itens;
    total.itens_sem_dado += m.itens_sem_dado;
    total.sem_detalhe.pedidos += m.sem_detalhe.pedidos;
    total.saldo.quebras += m.saldo.quebras;
    for (const [chave, x] of Object.entries(m._c)) total._c[chave] = (total._c[chave] ?? 0) + x;
    for (const tipo of ['comissao', 'transacao', 'campanha', 'por_item', 'por_pedido'] as const)
      for (const [rot, n] of Object.entries(m.aplicadas[tipo])) soma(total.aplicadas[tipo], rot, n);
  }
  return { meses: lista.map(fechar), total: fechar(total), taxas_atuais: taxasAtuais(obs) };
}
