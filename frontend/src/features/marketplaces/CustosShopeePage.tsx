import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CarregandoLinhas, ErroCarregar, PageHeader, Segmented, Vazio } from '@/components/ui';
import { IconSacola } from '@/components/icons';
import { useClients } from '@/features/clients/api';
import { useCustosShopee, type CategoriaCusto, type CustosMes, type TaxasAtuais } from './api';
import { dataCurta, reais } from './formato';

/** "AAAA-MM" de hoje, em São Paulo, e N meses antes. */
const mesDeHoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
function mesesAntes(mes: string, n: number) {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (mes: string) => `${NOME_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const pct = (v: number, casas = 1) =>
  `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');

const NOME: Record<CategoriaCusto, string> = {
  comissao: 'Comissão',
  transacao: 'Taxa de transação',
  campanha: 'Campanha de Destaque',
  por_item: 'Taxa por item vendido',
  devolucao_facil: 'Devolução Fácil (por pedido)',
  voucher_loja: 'Voucher da loja',
  cupom_shopee: 'Cupom da Shopee (líquido)',
  frete_a_mais: 'Frete a mais por peso',
  anuncios: 'Anúncios (recarga)',
  penalidade: 'Penalidade',
  difal: 'DIFAL cobrado na fiscalização',
  outros: 'Outros',
};
const OPCIONAL: Partial<Record<CategoriaCusto, true>> = { campanha: true, anuncios: true };
const GRUPOS: Array<[string, CategoriaCusto[]]> = [
  ['Percentuais (sobre o preço)', ['comissao', 'transacao', 'campanha']],
  ['Fixas (por item e por pedido)', ['por_item', 'devolucao_facil']],
  ['Outras cobranças', ['anuncios', 'voucher_loja', 'cupom_shopee', 'frete_a_mais', 'penalidade', 'difal', 'outros']],
];
const OUTRAS = GRUPOS[2]![1];
/** Sem taxa observada nos pagamentos: a tabela que a Shopee divulgou em 28/10/2026. */
const PADRAO: TaxasAtuais = { comissao: 18.6, transacao: 1.4, campanha: 5, por_item: 4.5, por_pedido: 0.49, desde: '' };

/** "18% em 787 pedidos · 18,6% em 622" ou "R$ 4,50 × 696 itens". */
function aplicada(m: CustosMes, cat: CategoriaCusto): string | null {
  const a =
    cat === 'comissao' || cat === 'transacao' || cat === 'campanha'
      ? m.aplicadas[cat]
      : cat === 'por_item'
        ? m.aplicadas.por_item
        : cat === 'devolucao_facil'
          ? m.aplicadas.por_pedido
          : null;
  if (!a || !Object.keys(a).length) return null;
  const unidade = cat === 'por_item' ? 'itens' : 'pedidos';
  return Object.entries(a)
    .map(([rot, n]) => (cat === 'por_item' || cat === 'devolucao_facil' ? `${rot} × ${inteiro(n)} ${unidade}` : `${rot} em ${inteiro(n)} ${unidade}`))
    .join(' · ');
}

/**
 * Custos da loja com a Shopee, mês a mês (pela data da carteira): cada
 * cobrança com a taxa aplicada, o total pago × o que ficou para a loja, as
 * médias e um simulador de preço. A conta fecha com a carteira.
 */
export function CustosShopeePage() {
  const { data: clients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  useEffect(() => {
    if (!clientId && clients?.length === 1) setClientId(clients[0]!.id);
  }, [clients, clientId]);
  const [ate, setAte] = useState(mesDeHoje());
  const [de, setDe] = useState(mesesAntes(mesDeHoje(), 2));
  const { data, isLoading, error } = useCustosShopee(clientId, de, ate);
  const [sel, setSel] = useState<string>('total');
  useEffect(() => setSel('total'), [clientId, de, ate]);

  const m = useMemo(() => (data ? (sel === 'total' ? data.total : data.meses.find((x) => x.mes === sel)) ?? data.total : null), [data, sel]);

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Custos Shopee"
        descricao="Tudo o que a loja pagou à Shopee no mês — cada cobrança, a taxa aplicada, o total pago e o que ficou para a loja — e um simulador para ajustar o preço dos produtos. Pela data em que o dinheiro mexeu na carteira."
        acoes={
          <Link to="/marketplaces/shopee" className="btn-ghost">
            Conferência Shopee
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Empresa</span>
          <select className="input min-w-64" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— escolha a empresa —</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razao_social}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">De</span>
          <input className="input w-40" type="month" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Até</span>
          <input className="input w-40" type="month" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </label>
      </div>

      {!clientId ? (
        <div className="card">
          <Vazio icone={<IconSacola className="h-6 w-6" />} titulo="Escolha a empresa para ver os custos com a Shopee" />
        </div>
      ) : de > ate ? (
        <p className="alert alert-warn">O mês inicial vem depois do final.</p>
      ) : isLoading ? (
        <div className="card">
          <CarregandoLinhas />
        </div>
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : data && m ? (
        data.sem_carteira || !data.meses.length ? (
          <div className="card">
            <Vazio
              icone={<IconSacola className="h-6 w-6" />}
              titulo="Nenhum movimento da carteira neste período"
              texto="Os custos saem das transações da carteira junto com o relatório Minha renda. Importe os dois na Conferência Shopee."
            />
          </div>
        ) : (
          <>
            <Segmented
              label="Mês"
              value={sel}
              onChange={setSel}
              options={[...data.meses.map((x) => ({ value: x.mes, label: rotuloMes(x.mes) })), { value: 'total', label: 'Período todo' }]}
            />
            <Avisos meses={data.meses} />
            <Resumo m={m} />
            <Cobrancas m={m} />
            <Comparacao meses={data.meses} total={data.total} sel={sel} />
            <Simulador taxas={data.taxas_atuais} total={data.total} />
          </>
        )
      ) : null}
    </section>
  );
}

function Avisos({ meses }: { meses: CustosMes[] }) {
  const naoFecha = meses.filter((x) => !x.fecha);
  const semDetalhe = meses.filter((x) => x.sem_detalhe.pedidos);
  const quebras = meses.filter((x) => x.saldo.quebras);
  if (!naoFecha.length && !semDetalhe.length && !quebras.length) {
    return <p className="text-xs text-slate-500">A conta de cada mês fecha com a carteira da Shopee, ao centavo.</p>;
  }
  return (
    <div className="space-y-2">
      {semDetalhe.map((x) => (
        <p key={`sd-${x.mes}`} className="alert alert-warn">
          {rotuloMes(x.mes)}: {x.sem_detalhe.pedidos} pagamento(s) na carteira sem o relatório Minha renda ({reais(x.sem_detalhe.valor)}) —
          entram no que ficou para a loja, mas sem separar as taxas. Importe a renda desse período.
        </p>
      ))}
      {naoFecha
        .filter((x) => !x.sem_detalhe.pedidos)
        .map((x) => (
          <p key={`nf-${x.mes}`} className="alert alert-warn">
            {rotuloMes(x.mes)}: a conta não fecha com a carteira em {reais(x.diferenca)}.
          </p>
        ))}
      {quebras.map((x) => (
        <p key={`q-${x.mes}`} className="alert alert-info">
          {rotuloMes(x.mes)}: o saldo da carteira andou {reais(x.saldo.valor)} diferente das transações listadas ({x.saldo.quebras}{' '}
          vez(es)) — vale pedir explicação à Shopee.
        </p>
      ))}
    </div>
  );
}

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className="text-xl font-semibold tabular-nums text-slate-900">{valor}</p>
      {detalhe && <p className="text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}

function Resumo({ m }: { m: CustosMes }) {
  const liq = m.vendas_liquidas;
  const fixas = m.custos.por_item + m.custos.devolucao_facil;
  const ticket = m.pedidos ? liq / m.pedidos : 0;
  return (
    <div className="card space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao rotulo="Vendas (sem devoluções)" valor={reais(liq)} detalhe={`${inteiro(m.pedidos)} pedidos · ${inteiro(m.itens)} itens`} />
        <Cartao rotulo="Pago à Shopee" valor={reais(m.total_custos)} detalhe={liq ? `${pct(m.total_custos / liq)} das vendas` : undefined} />
        <Cartao rotulo="Ficou para a loja" valor={reais(m.recebido)} detalhe={m.compensacao ? `com ${reais(m.compensacao)} de compensação` : 'entrou na carteira'} />
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Médias</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Cartao rotulo="Ticket médio" valor={reais(ticket)} detalhe={m.pedidos ? `${(m.itens / m.pedidos).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} itens por pedido` : undefined} />
          <Cartao rotulo="Custo médio por pedido" valor={reais(m.pedidos ? m.total_custos / m.pedidos : 0)} detalhe={liq ? `${pct(m.total_custos / liq)} do ticket` : undefined} />
          <Cartao
            rotulo="Custo médio por item"
            valor={m.itens ? reais(m.total_custos / m.itens) : '—'}
            detalhe={m.itens_sem_dado ? `aproximado: ${m.itens_sem_dado} pedido(s) sem a quantidade` : 'todas as cobranças'}
          />
          <Cartao rotulo="Taxas fixas por pedido" valor={reais(m.pedidos ? fixas / m.pedidos : 0)} detalhe={ticket ? `${pct(fixas / m.pedidos / ticket)} do ticket` : undefined} />
        </div>
      </div>
    </div>
  );
}

function Cobrancas({ m }: { m: CustosMes }) {
  const liq = m.vendas_liquidas || 1;
  const max = Math.max(...Object.values(m.custos).map((v) => Math.abs(v)), 0.01);
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Cada cobrança paga à Shopee</h2>
      {GRUPOS.map(([titulo, cats]) => {
        const sub = cats.reduce((s, c) => s + m.custos[c], 0);
        const linhas = cats.filter((c) => Math.abs(m.custos[c]) >= 0.005 || c === 'cupom_shopee');
        return (
          <div key={titulo} className="mb-3">
            <div className="flex justify-between border-b border-slate-200 px-1 pb-1 pt-2 text-sm font-medium text-slate-700">
              <span>{titulo}</span>
              <span className="tabular-nums">
                {reais(sub)} · {pct(sub / liq, 2)}
              </span>
            </div>
            {linhas.map((c) => {
              const v = m.custos[c];
              const rot = aplicada(m, c);
              return (
                <div
                  key={c}
                  className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_140px] items-center gap-3 rounded-md px-1 py-1.5 hover:bg-slate-50"
                  title={`${NOME[c]}: ${reais(v)} (${pct(v / liq, 2)} das vendas)`}
                >
                  <span className="text-sm text-slate-700">
                    {NOME[c]}
                    {OPCIONAL[c] && <span className="ml-1 text-xs text-slate-400">opcional</span>}
                    {rot && <span className="block text-xs text-slate-400">{rot}</span>}
                    {c === 'cupom_shopee' && <span className="block text-xs text-slate-400">o que a loja pagou − o desconto que a Shopee devolveu nas taxas</span>}
                  </span>
                  <div className="h-3.5">
                    <div className="h-3.5 rounded-r bg-sky-600" style={{ width: `${Math.max(0.5, (Math.abs(v) / max) * 100)}%` }} />
                  </div>
                  <span className="text-right text-sm tabular-nums">
                    {reais(v)} <span className="text-xs text-slate-400">{pct(v / liq, 2)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="text-xs text-slate-400">
        Devoluções não são custo: saem das vendas, e a Shopee devolve a comissão e as taxas dos itens devolvidos (fica só a Devolução Fácil).
      </p>
    </div>
  );
}

function Comparacao({ meses, total, sel }: { meses: CustosMes[]; total: CustosMes; sel: string }) {
  const media = total.total_custos / (total.total_custos + total.recebido || 1);
  // segue o mês escolhido em cima; "Período todo" mostra mês a mês e o total
  const doMes = sel === 'total' ? null : meses.find((x) => x.mes === sel) ?? null;
  const linhas = doMes ? [doMes] : [...meses, total];
  // a % do custo de cada mês (pago ÷ o que entrou) e a média do período
  const pctDe = (x: CustosMes) => x.total_custos / (x.total_custos + x.recebido || 1);
  const custoDosMeses = doMes ? [doMes] : meses;
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">
        Pago à Shopee × ficou para a loja{doMes ? ` — ${rotuloMes(doMes.mes)}` : ', mês a mês'}
      </h2>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-slate-500">Custo de cada mês:</span>
        {custoDosMeses.map((x) => (
          <span key={x.mes} className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600" title={`${reais(x.total_custos)} pago à Shopee`}>
            {rotuloMes(x.mes)} <b className="tabular-nums text-slate-900">{pct(pctDe(x))}</b>
          </span>
        ))}
        <span className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-slate-600" title={`${reais(total.total_custos)} pago no período`}>
          Média do período <b className="tabular-nums text-slate-900">{pct(media)}</b>
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-600" />
          Ficou para a loja
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-orange-500" />
          Pago à Shopee
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-slate-800" />
          Média do período ({pct(media)})
        </span>
      </div>
      {linhas.map((x) => {
        const p = x.total_custos;
        const r = x.recebido;
        const t = p + r || 1;
        return (
          <div
            key={x.mes}
            className={`grid grid-cols-[70px_minmax(0,1fr)_170px] items-center gap-3 rounded-md px-1 py-1.5 ${x.mes === 'total' ? 'bg-slate-50' : ''}`}
            title={`Pago à Shopee ${reais(p)} · ficou para a loja ${reais(r)}`}
          >
            <span className="text-sm text-slate-700">{x.mes === 'total' ? 'Período' : rotuloMes(x.mes)}</span>
            <div className="relative flex h-6 gap-0.5">
              <div className="flex items-center rounded-l bg-sky-600 pl-1.5 text-xs text-white" style={{ width: `${Math.max(0, (r / t) * 100)}%` }}>
                {pct(r / t, 0)}
              </div>
              <div className="flex items-center rounded-r bg-orange-500 pl-1.5 text-xs text-white" style={{ width: `${Math.max(0, (p / t) * 100)}%` }}>
                {pct(p / t, 0)}
              </div>
              <div className="absolute -bottom-1 -top-1 w-0.5 bg-slate-800" style={{ left: `${(1 - media) * 100}%` }} />
            </div>
            <span className="text-right text-xs tabular-nums text-slate-600">
              {reais(p)} pago
              <br />
              <span className="text-slate-400">{reais(r)} ficou</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Simulador({ taxas, total }: { taxas: TaxasAtuais | null; total: CustosMes }) {
  const t = taxas ?? PADRAO;
  const extraPct = total.vendas_liquidas ? OUTRAS.reduce((s, c) => s + total.custos[c], 0) / total.vendas_liquidas : 0;
  const [preco, setPreco] = useState('49,99');
  const [itens, setItens] = useState('1');
  const [alvo, setAlvo] = useState('30,00');
  const [campanha, setCampanha] = useState(t.campanha > 0);
  const [extras, setExtras] = useState(true);
  // "49,99", "1.234,56" ou "49.99"
  const n = (s: string) => {
    const x = s.trim();
    return Number(x.includes(',') ? x.replace(/\./g, '').replace(',', '.') : x);
  };
  const p = n(preco);
  const q = Math.max(1, Math.round(n(itens) || 1));
  const a = n(alvo);
  const valido = p > 0 && Number.isFinite(a) && a >= 0;
  const perc = (t.comissao + t.transacao + (campanha ? t.campanha : 0)) / 100 + (extras ? extraPct : 0);
  const fixo = t.por_item + t.por_pedido / q;
  const custo = p * perc + fixo;
  const precoAlvo = (a + fixo) / (1 - perc);
  const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return (
    <div className="card space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Simulador de preço</h2>
        <p className="text-xs text-slate-500">
          {taxas
            ? `Pelas taxas que a Shopee aplicou nos pedidos criados desde ${dataCurta(taxas.desde)}`
            : 'Pela tabela da Shopee de 28/10/2026 (sem pagamentos no período)'}
          : comissão {num(t.comissao)}%, transação {num(t.transacao)}%, Campanha de Destaque {num(t.campanha)}%, {reais(t.por_item)} por item e{' '}
          {reais(t.por_pedido)} por pedido. A sobra é antes do custo do produto.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Preço de venda (R$)</span>
          <input className="input" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Itens por pedido</span>
          <input className="input" inputMode="numeric" value={itens} onChange={(e) => setItens(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Quero que sobre por item (R$)</span>
          <input className="input" inputMode="decimal" value={alvo} onChange={(e) => setAlvo(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-5 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={campanha} onChange={(e) => setCampanha(e.target.checked)} />
          Campanha de Destaque ({num(t.campanha)}%, opcional)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
          Outras cobranças médias do período ({pct(extraPct, 2)})
        </label>
      </div>
      {!valido ? (
        <p className="text-sm text-red-600">Preencha o preço e o valor desejado com números positivos.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Cartao rotulo="Taxas fixas" valor={reais(fixo)} detalhe={`${reais(t.por_item)} + ${reais(t.por_pedido / q)} · ${pct(fixo / p)} do preço`} />
          <Cartao rotulo="Taxas percentuais" valor={reais(p * perc)} detalhe={`${pct(perc, 1)} do preço`} />
          <Cartao rotulo="Sobra por item" valor={reais(p - custo)} detalhe={`a Shopee fica com ${pct(custo / p)}`} />
          <Cartao
            rotulo="Preço para sobrar o desejado"
            valor={perc < 1 ? reais(precoAlvo) : '—'}
            detalhe={
              perc >= 1
                ? 'as taxas passam de 100%'
                : Math.abs(precoAlvo - p) < 0.005
                  ? 'igual ao preço atual'
                  : precoAlvo > p
                    ? `${reais(precoAlvo - p)} acima do preço atual`
                    : `${reais(p - precoAlvo)} abaixo do preço atual`
            }
          />
        </div>
      )}
    </div>
  );
}
