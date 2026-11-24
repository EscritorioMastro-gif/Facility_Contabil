/**
 * Os três relatórios da Central do Vendedor da Shopee, lidos pelo NOME das
 * colunas (a Shopee muda a ordem e até repete nome de coluna de um mês pro
 * outro):
 *
 *   pedidos  — Minhas vendas > Exportar (Order.all.*.xlsx): uma linha por item
 *   renda    — Minha renda > Lançado (Income.lançado.*.xlsx): Summary, Renda,
 *              Service Fee Details, Shipping Fee Discrepancy
 *   carteira — Minha carteira > Transações (my_balance_transaction_report.*.xlsx)
 *
 * LGPD: só saem daqui as colunas abaixo. Nome, usuário, endereço, telefone e
 * CPF do comprador estão no arquivo, mas não são lidos.
 */
import type { Aba, Celula } from './xlsx.js';

export type StatusPedido = 'aguardando_envio' | 'enviado' | 'concluido' | 'cancelado' | 'devolvido' | 'outro';

export type ItemLido = { sku: string | null; descricao: string | null; preco: number; qtd: number; devolvidos: number };

export type PedidoLido = {
  pedido: string;
  status: StatusPedido;
  status_marketplace: string | null;
  status_devolucao: string | null;
  motivo_cancelamento: string | null;
  criado_em: string | null;
  enviado_em: string | null;
  concluido_em: string | null;
  valor_produtos: number;
  itens: ItemLido[];
};

export type RepasseLido = {
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

export type MovimentoLido = {
  chave: string;
  data: string;
  seq: number;
  tipo: string;
  descricao: string | null;
  pedido: string | null;
  categoria: CategoriaCarteira;
  valor: number;
  saldo_apos: number | null;
  status: string | null;
};

type Periodo = { de: string; ate: string } | null;

export type RelatorioShopee =
  | { tipo: 'pedidos'; loja: null; periodo: Periodo; pedidos: PedidoLido[] }
  | { tipo: 'renda'; loja: string | null; periodo: Periodo; repasses: RepasseLido[] }
  | { tipo: 'carteira'; loja: string | null; periodo: Periodo; movimentos: MovimentoLido[] };

export class RelatorioDesconhecido extends Error {
  constructor(
    msg = 'Este arquivo não parece um relatório da Shopee (pedidos, Minha renda ou transações da carteira).',
  ) {
    super(msg);
    this.name = 'RelatorioDesconhecido';
  }
}

// --------------------------------------------------------------------------- #
// Ajudantes
// --------------------------------------------------------------------------- #
const cents = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;
const limpo = (v: Celula): string => (v === null || v === undefined ? '' : String(v).trim());
const textoOuNulo = (v: Celula) => {
  const s = limpo(v);
  return s && s !== '-' ? s : null;
};

/** Número da célula (número do Excel, ou texto "1.234,56" / "1234.56"); vazio e "-" = 0. */
export function numero(v: Celula): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean' || v === null) return 0;
  let s = v.trim().replace(/^R\$\s*/, '');
  if (!s || s === '-') return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const dinheiro = (v: Celula) => reais(cents(numero(v)));

/** Data/hora de São Paulo do relatório ("2026-09-01 07:20", "2026-09-01", serial do Excel) → ISO com -03:00. */
export function dataHora(v: Celula): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`;
  }
  const s = limpo(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
    if (!br) return null;
    return `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? '00'}:${br[5] ?? '00'}:${br[6] ?? '00'}-03:00`;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`;
}
const dia = (v: Celula) => dataHora(v)?.slice(0, 10) ?? null;

type Indice = Map<string, number[]>;

/** A linha de cabeçalho (a que tem TODOS os nomes pedidos) e os índices por nome. */
function cabecalho(linhas: Aba, exigidos: string[]): { ix: Indice; dados: Aba } | null {
  for (let i = 0; i < Math.min(linhas.length, 40); i++) {
    const nomes = (linhas[i] ?? []).map((c) => limpo(c));
    if (exigidos.every((e) => nomes.includes(e))) {
      const ix: Indice = new Map();
      nomes.forEach((n, j) => {
        if (n) ix.set(n, [...(ix.get(n) ?? []), j]);
      });
      return { ix, dados: linhas.slice(i + 1) };
    }
  }
  return null;
}
const campo = (row: Celula[], ix: Indice, nome: string, k = 0): Celula => {
  const j = ix.get(nome)?.[k];
  return j === undefined ? null : (row[j] ?? null);
};
/** Soma de todas as colunas com esse nome (sem diferença de maiúscula) — a Shopee repete "Taxa de transação". */
const somaColunas = (row: Celula[], ix: Indice, nome: string) => {
  let c = 0;
  for (const [n, js] of ix) if (n.toLowerCase() === nome.toLowerCase()) for (const j of js) c += cents(numero(row[j] ?? null));
  return c;
};
const colunaQueComeca = (ix: Indice, prefixo: string) => [...ix.keys()].find((n) => n.toLowerCase().startsWith(prefixo.toLowerCase()));

/** "Nome de usuário (Vendedor)" e o período (De / Para) do cabeçalho do relatório. */
function infoDoCabecalho(linhas: Aba): { loja: string | null; periodo: Periodo } {
  let loja: string | null = null;
  let de: string | null = null;
  let ate: string | null = null;
  for (const l of linhas.slice(0, 40)) {
    const k = limpo(l[0] ?? null).toLowerCase();
    if (k.startsWith('nome de usuário') && k.includes('vendedor')) loja = textoOuNulo(l[1] ?? null);
    if (k === 'de') {
      de = dia(l[1] ?? null);
      // "De | 2026-09-01 | Para | 2026-10-31" (aba de ajustes) ou em duas linhas
      if (limpo(l[2] ?? null).toLowerCase() === 'para') ate = dia(l[3] ?? null);
    }
    if (k === 'para') ate = dia(l[1] ?? null);
  }
  return { loja, periodo: de && ate ? { de, ate } : null };
}

function periodoDas(datas: Array<string | null>): Periodo {
  const d = datas.filter((x): x is string => !!x).map((x) => x.slice(0, 10)).sort();
  return d.length ? { de: d[0]!, ate: d[d.length - 1]! } : null;
}

// --------------------------------------------------------------------------- #
// Pedidos
// --------------------------------------------------------------------------- #
export function normalizarStatus(status: string | null, devolucao: string | null, qtd: number, devolvidos: number): StatusPedido {
  if (devolucao && /aprovad/i.test(devolucao) && qtd > 0 && devolvidos >= qtd) return 'devolvido';
  const s = (status ?? '').toLowerCase();
  if (s.startsWith('conclu')) return 'concluido';
  if (s.startsWith('cancel')) return 'cancelado';
  if (s.startsWith('entregue') || s.startsWith('enviado') || s.includes('trânsito') || s.includes('transito')) return 'enviado';
  if (s.includes('a enviar') || s.includes('aguardando envio') || s.includes('preparando')) return 'aguardando_envio';
  if (s.startsWith('devolvid')) return 'devolvido';
  return 'outro';
}

function lerPedidos(linhas: Aba): RelatorioShopee {
  const cab = cabecalho(linhas, ['ID do pedido', 'Status do pedido', 'Quantidade']);
  if (!cab) throw new RelatorioDesconhecido();
  const { ix, dados } = cab;
  const porPedido = new Map<string, PedidoLido>();
  for (const row of dados) {
    const id = textoOuNulo(campo(row, ix, 'ID do pedido'));
    if (!id) continue;
    let p = porPedido.get(id);
    if (!p) {
      p = {
        pedido: id,
        status: 'outro',
        status_marketplace: textoOuNulo(campo(row, ix, 'Status do pedido')),
        status_devolucao: textoOuNulo(campo(row, ix, 'Status da Devolução / Reembolso')),
        motivo_cancelamento: textoOuNulo(campo(row, ix, 'Cancelar Motivo')),
        criado_em: dataHora(campo(row, ix, 'Data de criação do pedido')),
        enviado_em: dataHora(campo(row, ix, 'Tempo de Envio')),
        concluido_em: dataHora(campo(row, ix, 'Hora completa do pedido')),
        valor_produtos: 0,
        itens: [],
      };
      porPedido.set(id, p);
    }
    const nome = textoOuNulo(campo(row, ix, 'Nome do Produto'));
    const variacao = textoOuNulo(campo(row, ix, 'Nome da variação'));
    p.itens.push({
      sku: textoOuNulo(campo(row, ix, 'Número de referência SKU')) ?? textoOuNulo(campo(row, ix, 'Nº de referência do SKU principal')),
      descricao: nome ? (variacao ? `${nome} — ${variacao}` : nome).slice(0, 200) : null,
      preco: dinheiro(campo(row, ix, 'Preço acordado')),
      qtd: Math.round(numero(campo(row, ix, 'Quantidade'))),
      devolvidos: Math.round(numero(campo(row, ix, 'Returned quantity'))),
    });
  }
  const pedidos = [...porPedido.values()].map((p) => {
    const qtd = p.itens.reduce((s, i) => s + i.qtd, 0);
    const dev = p.itens.reduce((s, i) => s + i.devolvidos, 0);
    return {
      ...p,
      status: normalizarStatus(p.status_marketplace, p.status_devolucao, qtd, dev),
      valor_produtos: reais(p.itens.reduce((s, i) => s + cents(i.preco) * i.qtd, 0)),
    };
  });
  return { tipo: 'pedidos', loja: null, periodo: periodoDas(pedidos.map((p) => p.criado_em)), pedidos };
}

// --------------------------------------------------------------------------- #
// Renda
// --------------------------------------------------------------------------- #
function lerRenda(abas: Map<string, Aba>): RelatorioShopee {
  const renda = cabecalho(abas.get('Renda') ?? [], ['ID do pedido', 'Ver', 'Quantia total lançada (R$)']);
  if (!renda) throw new RelatorioDesconhecido('Não achei a aba "Renda" do relatório Minha renda.');
  const info = infoDoCabecalho(abas.get('Summary') ?? []);
  const ajustes = infoDoCabecalho(abas.get('Adjustment') ?? []);

  // as três partes da taxa de serviço, por pedido
  const partes = new Map<string, { tr: number; ad: number; it: number }>();
  const det = cabecalho(abas.get('Service Fee Details') ?? [], ['ID do pedido']);
  if (det) {
    for (const row of det.dados) {
      const id = textoOuNulo(campo(row, det.ix, 'ID do pedido'));
      if (!id) continue;
      partes.set(id, {
        tr: somaColunas(row, det.ix, 'Taxa de transação'),
        ad: somaColunas(row, det.ix, 'Taxa de serviço adicional'),
        it: somaColunas(row, det.ix, 'Taxa por item vendido'),
      });
    }
  }
  // frete a mais por peso
  const frete = new Map<string, { esperado: number; real: number }>();
  const fr = cabecalho(abas.get('Shipping Fee Discrepancy') ?? [], ['ID do pedido']);
  if (fr) {
    const esp = colunaQueComeca(fr.ix, 'Taxa de frete esperada');
    const real = colunaQueComeca(fr.ix, 'Taxa de frete real');
    if (esp && real) {
      for (const row of fr.dados) {
        const id = textoOuNulo(campo(row, fr.ix, 'ID do pedido'));
        if (id) frete.set(id, { esperado: dinheiro(campo(row, fr.ix, esp)), real: dinheiro(campo(row, fr.ix, real)) });
      }
    }
  }

  const { ix, dados } = renda;
  const c = (row: Celula[], nome: string) => cents(numero(campo(row, ix, nome)));
  const repasses: RepasseLido[] = [];
  for (const row of dados) {
    if (limpo(campo(row, ix, 'Ver')) !== 'Order') continue;
    const id = textoOuNulo(campo(row, ix, 'ID do pedido'));
    if (!id) continue;
    const v = {
      preco: c(row, 'Preço do produto'),
      reembolso: c(row, 'Valor do Reembolso'),
      cupom: c(row, 'Cupom'),
      incentivo_cupom: c(row, 'Incentivo de cupom'),
      voucher_loja: c(row, 'Voucher subsidiado pelo Seller') + c(row, 'Voucher compartilhado subsidiado pelo Seller'),
      frete_comprador: c(row, 'Taxa de frete paga pelo comprador'),
      frete_desconto: c(row, 'Desconto de frete pela Shopee'),
      frete_transportadora: c(row, 'Frete cobrado pelo parceiro logístico'),
      comissao_bruta: c(row, 'Taxa de comissão bruta'),
      comissao_liquida: c(row, 'Taxa de comissão líquida'),
      servico_bruta: c(row, 'Taxa de serviço bruta'),
      servico_liquida: c(row, 'Taxa de serviço líquida'),
      devolucao_facil: c(row, 'Taxa de Devolução Fácil Shopee'),
      liquido: c(row, 'Quantia total lançada (R$)'),
    };
    const explicado =
      v.preco + v.reembolso + v.cupom + v.incentivo_cupom + v.voucher_loja + v.frete_comprador + v.frete_desconto +
      v.frete_transportadora + v.comissao_liquida + v.servico_liquida + v.devolucao_facil;
    const pt = partes.get(id) ?? { tr: 0, ad: 0, it: 0 };
    const f = frete.get(id);
    repasses.push({
      pedido: id,
      criado_dia: dia(campo(row, ix, 'Data de criação do pedido')),
      pago_em: dia(campo(row, ix, 'Data de conclusão do pagamento')),
      preco: reais(v.preco),
      reembolso: reais(v.reembolso),
      cupom: reais(v.cupom),
      incentivo_cupom: reais(v.incentivo_cupom),
      voucher_loja: reais(v.voucher_loja),
      frete_comprador: reais(v.frete_comprador),
      frete_desconto: reais(v.frete_desconto),
      frete_transportadora: reais(v.frete_transportadora),
      comissao_bruta: reais(v.comissao_bruta),
      comissao_liquida: reais(v.comissao_liquida),
      servico_bruta: reais(v.servico_bruta),
      servico_liquida: reais(v.servico_liquida),
      transacao: reais(pt.tr),
      campanha: reais(pt.ad),
      por_item: reais(pt.it),
      devolucao_facil: reais(v.devolucao_facil),
      outros: reais(v.liquido - explicado),
      liquido: reais(v.liquido),
      frete_esperado: f?.esperado ?? null,
      frete_real: f?.real ?? null,
    });
  }
  return {
    tipo: 'renda',
    loja: info.loja ?? ajustes.loja,
    periodo: info.periodo ?? ajustes.periodo ?? periodoDas(repasses.map((r) => r.pago_em)),
    repasses,
  };
}

// --------------------------------------------------------------------------- #
// Carteira
// --------------------------------------------------------------------------- #
export function categoriaDoMovimento(tipo: string, descricao: string): CategoriaCarteira {
  const t = tipo.toLowerCase();
  const d = descricao.toLowerCase();
  if (t === 'renda do pedido') return 'renda_pedido';
  if (t === 'saques' || t === 'saque') return 'saque';
  if (/\bads\b/.test(d) || d.includes('anúncio')) return 'anuncios';
  if (d.includes('reembolso / devolu') || d.includes('reembolso/devolu')) return 'debito_devolucao';
  if (d.includes('difal')) return 'difal';
  if (d.includes('penaliza')) return 'penalidade';
  if (d.includes('objeto perdido')) return 'objeto_perdido';
  if (d.includes('logistics') || d.includes('compensação') || d.includes('compensacao')) return 'compensacao_logistica';
  return 'outro';
}

function lerCarteira(linhas: Aba): RelatorioShopee {
  const cab = cabecalho(linhas, ['Data', 'Tipo de transação', 'Valor']);
  if (!cab) throw new RelatorioDesconhecido();
  const { ix, dados } = cab;
  const info = infoDoCabecalho(linhas);
  const validas = dados.filter((row) => dataHora(campo(row, ix, 'Data')) && limpo(campo(row, ix, 'Tipo de transação')));
  const saldoCol = colunaQueComeca(ix, 'Balança após') ?? colunaQueComeca(ix, 'Saldo após');
  const movimentos: MovimentoLido[] = validas.map((row, i) => {
    const data = dataHora(campo(row, ix, 'Data'))!;
    const tipo = limpo(campo(row, ix, 'Tipo de transação'));
    const descricao = textoOuNulo(campo(row, ix, 'Descrição'));
    let valorC = cents(numero(campo(row, ix, 'Valor')));
    if (/sa[ií]da/i.test(limpo(campo(row, ix, 'Direção do dinheiro')))) valorC = -Math.abs(valorC);
    const saldo = saldoCol ? campo(row, ix, saldoCol) : null;
    const saldoC = saldo === null || limpo(saldo) === '' ? null : cents(numero(saldo));
    const pedido =
      textoOuNulo(campo(row, ix, 'ID do pedido')) ?? /pedido\s+#?([0-9A-Z]{12,20})\b/.exec(descricao ?? '')?.[1] ?? null;
    return {
      chave: `${data}|${tipo}|${pedido ?? ''}|${(valorC / 100).toFixed(2)}|${saldoC === null ? '' : (saldoC / 100).toFixed(2)}`,
      data,
      // o relatório vem do mais novo pro mais antigo: seq cresce com o tempo
      seq: validas.length - i,
      tipo,
      descricao: descricao ? descricao.slice(0, 300) : null,
      pedido,
      categoria: categoriaDoMovimento(tipo, descricao ?? ''),
      valor: reais(valorC),
      saldo_apos: saldoC === null ? null : reais(saldoC),
      status: textoOuNulo(campo(row, ix, 'Status')),
    };
  });
  return { tipo: 'carteira', loja: info.loja, periodo: info.periodo ?? periodoDas(movimentos.map((m) => m.data)), movimentos };
}

// --------------------------------------------------------------------------- #
/** Descobre qual relatório é e lê. */
export function lerRelatorioShopee(abas: Map<string, Aba>): RelatorioShopee {
  if (abas.has('Renda') && (abas.has('Service Fee Details') || abas.has('Summary'))) return lerRenda(abas);
  for (const linhas of abas.values()) {
    if (cabecalho(linhas, ['Data', 'Tipo de transação', 'Valor'])) return lerCarteira(linhas);
  }
  for (const linhas of abas.values()) {
    if (cabecalho(linhas, ['ID do pedido', 'Status do pedido', 'Quantidade'])) return lerPedidos(linhas);
  }
  throw new RelatorioDesconhecido();
}
