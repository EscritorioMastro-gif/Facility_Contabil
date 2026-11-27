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
 *     cupom da Shopee e desconto do Pix no líquido (o que a loja pagou − o
 *     desconto que voltou nas taxas; normalmente zero), afiliados (comissão +
 *     a taxa da Shopee sobre ela), frete a mais, frete de devolução, anúncios,
 *     penalidade, DIFAL.
 *
 * As taxas aplicadas (18,6%, R$ 4,50…) saem dos próprios pagamentos — não
 * dependem da tabela do cliente. Loja com itens de preços diferentes paga
 * taxas por FAIXA de preço (2ª loja, 2026-11-25: 18,6% + R$ 4,50 até R$ 79,99;
 * 12,6% + R$ 16 de R$ 80 a 99,99; 12,6% + R$ 20 de R$ 100 a 199,99): os rótulos
 * saem de cada pedido e o simulador recebe as faixas observadas.
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
  'afiliados',
  'frete_a_mais',
  'frete_devolucao',
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
  // a taxa da Shopee sobre a comissão do afiliado vem dentro da taxa de serviço
  const afilServ = -c(x.afiliados_servico ?? 0);
  if (srvB === srvL || srvL === 0) {
    o.transacao = -c(x.transacao);
    o.campanha = -c(x.campanha);
  } else if (taxas) {
    o.transacao = pctDe(base(x), taxas.transacao);
    o.campanha = pctDe(base(x), taxas.campanha);
  } else {
    const f = srvB / srvL;
    o.transacao = Math.round(-c(x.transacao) * f);
    o.campanha = Math.round(-c(x.campanha) * f);
  }
  // por item = o resto da taxa de serviço (nunca a coluna do detalhe, que já veio dobrada)
  o.por_item = -srvB - o.transacao - o.campanha - afilServ;
  o.devolucao_facil = -c(x.devolucao_facil);
  o.voucher_loja = -c(x.voucher_loja);
  o.cupom_shopee = -(c(x.cupom) + c(x.incentivo_cupom) + c(x.pix ?? 0) + c(x.comissao_liquida) - c(x.comissao_bruta) + srvL - srvB);
  o.afiliados = -c(x.afiliados_comissao ?? 0) + afilServ;
  o.frete_a_mais = -(c(x.frete_comprador) + c(x.frete_desconto) + c(x.frete_transportadora));
  o.frete_devolucao = -c(x.envio_reverso ?? 0);
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

/** Taxas de uma faixa de preço do item, como a Shopee aplicou (preços por item, em reais). */
export type FaixaObservada = TaxasDoDia & { preco_min: number; preco_max: number; pedidos: number };

/**
 * As faixas de preço que a Shopee aplicou nos pedidos criados desde `desde`:
 * cada pedido sem devolução, de R$ 10 pra cima e com a quantidade de itens
 * (relatório de pedidos), mostra a sua comissão, transação, campanha e R$ por
 * item; pedidos com as mesmas taxas formam uma faixa (do menor ao maior preço
 * por item visto). Faixa com 1 pedido só fica de fora (é pedido com itens de
 * duas faixas, ou arredondamento); se duas faixas se cruzam no preço, vale a
 * mais recente (a taxa mudou no meio).
 */
export function faixasObservadas(
  repasses: Repasse[],
  unidades: Map<string, number>,
  obs: Map<string, TaxasDoDia>,
  desde: string,
): FaixaObservada[] {
  const grupos = new Map<string, { t: TaxasDoDia; min: number; max: number; n: number; ultimo: string }>();
  for (const x of repasses) {
    const u = unidades.get(x.pedido);
    const b = base(x);
    if (!x.criado_dia || x.criado_dia < desde || c(x.reembolso) !== 0 || b < 1000 || !u) continue;
    const cs = custosDoRepasse(x, obs.get(x.criado_dia));
    if (cs.por_item <= 0 || cs.por_item % u !== 0) continue;
    const t: TaxasDoDia = {
      comissao: Math.round((cs.comissao * 1000) / b) / 10,
      transacao: Math.round((cs.transacao * 1000) / b) / 10,
      campanha: Math.round((cs.campanha * 1000) / b) / 10,
      por_item: r(cs.por_item / u),
      por_pedido: r(cs.devolucao_facil),
    };
    const k = JSON.stringify(t);
    const unit = Math.round(b / u);
    const g = grupos.get(k) ?? { t, min: unit, max: unit, n: 0, ultimo: x.criado_dia };
    g.min = Math.min(g.min, unit);
    g.max = Math.max(g.max, unit);
    g.n++;
    if (x.criado_dia > g.ultimo) g.ultimo = x.criado_dia;
    grupos.set(k, g);
  }
  const todos = [...grupos.values()].reduce((s, g) => s + g.n, 0);
  const validos = [...grupos.values()].filter((g) => g.n >= 2 || g.n === todos);
  // se duas se cruzam no preço, fica a que apareceu por último
  const ficam = validos.filter((g) => !validos.some((h) => h !== g && h.min <= g.max && g.min <= h.max && h.ultimo > g.ultimo));
  return ficam
    .sort((a, b) => a.min - b.min)
    .map((g) => ({ ...g.t, preco_min: r(g.min), preco_max: r(g.max), pedidos: g.n }));
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
): {
  meses: CustosMes[];
  total: CustosMes;
  taxas_atuais: (TaxasDoDia & { desde: string }) | null;
  faixas: FaixaObservada[];
} {
  const repDe = new Map(repasses.map((x) => [x.pedido, x]));
  const obs = taxasObservadas(repasses, unidades);
  const meses = new Map<string, ReturnType<typeof novoMes>>();
  const ordem = [...movimentos].sort((a, b) => Date.parse(a.data) - Date.parse(b.data) || a.seq - b.seq);
  const custosDe = (x: Repasse) => custosDoRepasse(x, x.criado_dia ? obs.get(x.criado_dia) : undefined);

  // as taxas por item que a loja paga, em centavos (vistas em 2+ pedidos com a
  // quantidade de itens, ou a mais comum de algum dia) — com faixas de preço, a
  // do dia pode não ser a do pedido
  const vistos = new Map<number, number>();
  for (const x of repasses) {
    const u = unidades.get(x.pedido);
    if (!u || c(x.reembolso) !== 0) continue;
    const pi = custosDe(x).por_item;
    if (pi > 0 && pi % u === 0) vistos.set(pi / u, (vistos.get(pi / u) ?? 0) + 1);
  }
  for (const t of obs.values()) if (c(t.por_item) > 0) vistos.set(c(t.por_item), Math.max(2, vistos.get(c(t.por_item)) ?? 0));
  const valoresPorItem = [...vistos.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([v]) => v);

  /** itens do pedido: do relatório de pedidos; sem ele, a taxa por item cobrada ÷ uma taxa por item da loja (só se der certinho) */
  const unidadesDe = (x: Repasse, porItemC: number): number | null => {
    const u = unidades.get(x.pedido);
    if (u !== undefined) return u;
    const devolveuAntes = c(x.reembolso) !== 0;
    if (porItemC <= 0) return devolveuAntes ? 0 : null;
    const dia = x.criado_dia ? c(obs.get(x.criado_dia)?.por_item ?? 0) : 0;
    for (const v of [dia, ...valoresPorItem]) {
      if (v <= 0) continue;
      const q = Math.round(porItemC / v);
      if (q >= 1 && Math.abs(q * v - porItemC) <= q) return q;
    }
    // devolução parcial antes do pagamento: a taxa por item vem proporcional ao valor que ficou
    return devolveuAntes && dia > 0 ? Math.round(porItemC / dia) : null;
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
        const cs = custosDe(x);
        for (const cat of CATEGORIAS_CUSTO) add(`c:${cat}`, cs[cat]);
        const u = unidadesDe(x, cs.por_item);
        if (u === null) acc.itens_sem_dado++;
        else acc.itens += u;
        const t = x.criado_dia ? obs.get(x.criado_dia) : undefined;
        const b = base(x);
        if (t && b > 0) {
          // a taxa do próprio pedido (com faixas de preço, a do dia pode não ser a dele);
          // abaixo de R$ 10 o arredondamento no centavo distorce a % — fica a do dia
          const propria = (custo: number, doDia: number) => (b >= 1000 ? Math.round((custo * 1000) / b) / 10 : doDia);
          soma(acc.aplicadas.comissao, pctRotulo(propria(cs.comissao, t.comissao)), 1);
          soma(acc.aplicadas.transacao, pctRotulo(propria(cs.transacao, t.transacao)), 1);
          const camp = propria(cs.campanha, t.campanha);
          if (camp) soma(acc.aplicadas.campanha, pctRotulo(camp), 1);
          if (u) {
            const porUn = cs.por_item % u === 0 && valoresPorItem.includes(cs.por_item / u) ? cs.por_item / u : c(t.por_item);
            soma(acc.aplicadas.por_item, reaisRotulo(porUn), u);
          }
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
        // (venda que já saiu negativa: não há o que devolver de taxa — o débito todo é devolução)
        const cheio = -(c(x.liquido) - c(x.devolucao_facil));
        const f = cheio < 0 ? v / cheio : 0;
        const cs = custosDe(x);
        let devolvidas = 0;
        for (const cat of CATEGORIAS_CUSTO) {
          // os R$ 0,49 e o frete de volta não voltam
          if (cat === 'devolucao_facil' || cat === 'frete_devolucao') continue;
          const y = Math.round(f * cs[cat]);
          add(`c:${cat}`, -y);
          devolvidas += y;
        }
        add('devolvido', -v + devolvidas);
        const u = unidadesDe(x, cs.por_item);
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
  // faixas de preço desde a última mudança de taxa; com poucos pedidos, os últimos 30 dias
  const atuais = taxasAtuais(obs);
  let faixas: FaixaObservada[] = [];
  if (atuais) {
    faixas = faixasObservadas(repasses, unidades, obs, atuais.desde);
    if (faixas.reduce((s, f) => s + f.pedidos, 0) < 10) {
      const ultimo = [...obs.keys()].sort().at(-1)!;
      const mes = new Date(Date.parse(`${ultimo}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
      if (mes < atuais.desde) faixas = faixasObservadas(repasses, unidades, obs, mes);
    }
  }
  return { meses: lista.map(fechar), total: fechar(total), taxas_atuais: atuais, faixas };
}
