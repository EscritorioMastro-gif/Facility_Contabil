import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { formatMoney, formatPct as pct } from '@/lib/format';
import { useClients } from '@/features/clients/api';
import { useDashboard, type Dashboard, type ItemDashboard, type MesDashboard } from './api';
import { MapaArvore, Rosca } from './graficos';

/**
 * Dashboard do módulo Classificação (pedido de 2026-11-12): receitas por
 * classificação de entrada e despesas por classificação de saída, com valor e
 * % do total, evolução por mês e o que falta classificar. Cliente: todas as
 * empresas dele ou uma; escritório: uma empresa, ou todas as do mesmo cliente.
 * Só lançamentos classificados e não inativados entram nos totais.
 *
 * Três blocos (escolhidos com o user): roscas, mapa de árvore (todas as
 * classificações) e tabela + receitas x despesas por mês — tudo no período
 * De/Até (o user tirou o seletor de mês só das roscas em 2026-11-13).
 */

const COR_RECEITA = '#1baf7a';
const COR_DESPESA = '#eb6834';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const nomeMes = (m: string) => `${MESES_LONGOS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
/** "Outubro/2026" (um mês só) ou "dez/25 a nov/26" */
const rotuloPeriodo = (de: string, ate: string) => (de === ate ? nomeMes(de) : `${rotuloMes(de)} a ${rotuloMes(ate)}`);

function mesAtual(deslocamento = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + deslocamento);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const ultimoDia = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return `${mes}-${String(new Date(a!, m!, 0).getDate()).padStart(2, '0')}`;
};

export function DashboardPage() {
  const { ehCliente } = useAuth();
  const { data: empresas, isLoading: carregandoEmpresas } = useClients({ ativo: 'true' });
  const [escolhida, setEscolhida] = useState('');
  const [grupo, setGrupo] = useState(true);
  const [de, setDe] = useState(mesAtual(-11));
  const [ate, setAte] = useState(mesAtual());

  // escritório precisa escolher a empresa; cliente sem escolha = todas as dele
  const clientId = escolhida || (!ehCliente && empresas?.length === 1 ? empresas[0]!.id : '');
  const periodoOk = de && ate && de <= ate;
  const pronto = (ehCliente || !!clientId) && !!periodoOk;
  const { data, isLoading, error } = useDashboard(
    { client_id: clientId || undefined, grupo: !ehCliente && grupo, de: `${de}-01`, ate: ate ? ultimoDia(ate) : '' },
    { enabled: pronto },
  );

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Receitas e despesas por classificação, com o valor e o percentual de cada uma sobre o total. Entram só os
          lançamentos classificados (os inativados ficam de fora).
        </p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4 text-sm">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Empresa</span>
          <select
            className="input h-9 min-w-[16rem]"
            value={clientId}
            onChange={(e) => setEscolhida(e.target.value)}
            disabled={carregandoEmpresas}
          >
            {ehCliente ? (
              <option value="">Todas as minhas empresas</option>
            ) : (
              <option value="">{carregandoEmpresas ? 'Carregando…' : 'Escolha a empresa…'}</option>
            )}
            {empresas?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razao_social}
              </option>
            ))}
          </select>
        </label>
        {!ehCliente && (
          <label className="flex h-9 items-center gap-2 text-slate-600" title="Empresas liberadas para o mesmo login de cliente">
            <input type="checkbox" checked={grupo} onChange={(e) => setGrupo(e.target.checked)} />
            Somar todas as empresas do mesmo cliente
          </label>
        )}
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">De</span>
          <input type="month" className="input h-9 w-40" value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Até</span>
          <input type="month" className="input h-9 w-40" value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        {!periodoOk && <span className="h-9 self-end text-xs text-red-600">O mês inicial tem que vir antes do final.</span>}
      </div>

      {!pronto ? (
        <p className="card p-6 text-sm text-slate-400">Escolha a empresa.</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : error || !data ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Falha ao carregar o dashboard'}
        </p>
      ) : (
        <>
          {data.empresas.length > 1 && (
            <p className="text-xs text-slate-500">
              Somando {data.empresas.length} empresas: {data.empresas.map((e) => e.razao_social).join(', ')}.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Numero rotulo="Receitas no período" valor={formatMoney(data.totais.receitas_cents)} />
            <Numero rotulo="Despesas no período" valor={formatMoney(data.totais.despesas_cents)} />
            <Numero
              rotulo="Resultado"
              valor={formatMoney(data.totais.resultado_cents)}
              tom={data.totais.resultado_cents < 0 ? 'text-red-700' : undefined}
            />
            <Numero
              rotulo="Sem classificação"
              valor={`${data.pendentes.qtd} lançamento(s)`}
              detalhe={
                data.pendentes.qtd ? (
                  <Link to="/classificacao/historico" className="text-brand-600 hover:underline">
                    {formatMoney(data.pendentes.total_cents)} · classificar
                  </Link>
                ) : null
              }
            />
          </div>

          <Graficos data={data} periodo={rotuloPeriodo(de, ate)} />
        </>
      )}
    </section>
  );
}

function Numero({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: React.ReactNode; tom?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${tom ?? 'text-slate-800'}`}>{valor}</p>
      {detalhe && <p className="text-xs">{detalhe}</p>}
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-slate-500">{titulo}</h2>
      {/* grid-cols-1 = minmax(0, 1fr): a tabela larga rola dentro do cartão, não estica a página no celular */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>
    </div>
  );
}

/** Tudo no período escolhido em De/Até (pra ver um mês só, De e Até no mesmo mês). */
function Graficos({ data, periodo }: { data: Dashboard; periodo: string }) {
  return (
    <>
      <Bloco titulo={`Por classificação — ${periodo}`}>
        <Rosca
          titulo="Receitas"
          itens={data.receitas}
          total={data.totais.receitas_cents}
          vazio="Nenhuma receita classificada nesse período."
        />
        <Rosca
          titulo="Despesas"
          itens={data.despesas}
          total={data.totais.despesas_cents}
          vazio="Nenhuma despesa classificada nesse período."
        />
      </Bloco>
      <Bloco titulo="Todas as classificações">
        <MapaArvore titulo="Receitas" itens={data.receitas} total={data.totais.receitas_cents} tom="receitas" />
        <MapaArvore titulo="Despesas" itens={data.despesas} total={data.totais.despesas_cents} tom="despesas" />
      </Bloco>
      <Bloco titulo="Detalhe do período">
        <Tabela titulo="Receitas por classificação" itens={data.receitas} total={data.totais.receitas_cents} />
        <Tabela titulo="Despesas por classificação" itens={data.despesas} total={data.totais.despesas_cents} />
      </Bloco>
      <PorMes meses={data.meses} />
    </>
  );
}

/** Tabela (valor e % do total) que copia pro Excel. */
function Tabela({ titulo, itens, total }: { titulo: string; itens: ItemDashboard[]; total: number }) {
  const [copiado, setCopiado] = useState(false);
  const qtd = itens.reduce((a, i) => a + i.qtd, 0);

  async function copiar() {
    const num = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const linhas = [
      ['Classificação', 'Lançamentos', 'Valor', '% do total'],
      ...itens.map((i) => [i.nome, String(i.qtd), num(i.total_cents), pct(i.percentual)]),
      ['Total', String(qtd), num(total), total ? '100,0%' : ''],
    ];
    try {
      await navigator.clipboard.writeText(linhas.map((l) => l.join('\t')).join('\n'));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">{titulo}</p>
        <p className="text-sm tabular-nums text-slate-500">Total {formatMoney(total)}</p>
      </div>

      {!itens.length ? (
        <p className="text-sm text-slate-400">Nenhum lançamento classificado nesse período.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Classificação</th>
                  <th className="px-3 py-2 text-right font-medium">Lançamentos</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="py-2 pl-3 text-right font-medium">% do total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {itens.map((i) => (
                  <tr key={i.nome}>
                    <td className="py-1.5 pr-3 text-slate-700">{i.nome}</td>
                    <td className="px-3 py-1.5 text-right text-slate-600">{i.qtd}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{formatMoney(i.total_cents)}</td>
                    <td className="py-1.5 pl-3 text-right text-slate-700">{pct(i.percentual)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 font-medium tabular-nums">
                <tr>
                  <td className="py-2 pr-3 text-slate-700">Total</td>
                  <td className="px-3 py-2 text-right text-slate-700">{qtd}</td>
                  <td className="px-3 py-2 text-right text-slate-800">{formatMoney(total)}</td>
                  <td className="py-2 pl-3 text-right text-slate-800">100,0%</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={copiar}>
              {copiado ? 'Copiado — cole no Excel' : 'Copiar tabela para o Excel'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PorMes({ meses }: { meses: MesDashboard[] }) {
  const maior = useMemo(
    () => Math.max(1, ...meses.flatMap((m) => [m.receitas_cents, m.despesas_cents])),
    [meses],
  );
  if (!meses.length) return null;
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">Receitas x despesas por mês</p>
        <div className="flex gap-4 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_RECEITA }} />
            Receitas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COR_DESPESA }} />
            Despesas
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex h-48 min-w-fit items-end gap-4 border-b border-slate-200 px-1">
          {meses.map((m) => (
            <div key={m.mes} className="flex min-w-[3.5rem] flex-1 flex-col items-center">
              <div className="flex h-40 w-full items-end justify-center gap-1">
                {(
                  [
                    ['Receitas', m.receitas_cents, COR_RECEITA],
                    ['Despesas', m.despesas_cents, COR_DESPESA],
                  ] as const
                ).map(([nome, v, cor]) => (
                  <span
                    key={nome}
                    className="w-5 rounded-t"
                    style={{ height: `${(v / maior) * 100}%`, minHeight: v ? 2 : 0, background: cor }}
                    title={`${rotuloMes(m.mes)} — ${nome}: ${formatMoney(v)}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-fit gap-4 px-1 pt-1">
          {meses.map((m) => (
            <div key={m.mes} className="min-w-[3.5rem] flex-1 text-center text-xs">
              <p className="text-slate-500">{rotuloMes(m.mes)}</p>
              <p
                className={`tabular-nums ${m.receitas_cents - m.despesas_cents < 0 ? 'text-red-700' : 'text-slate-600'}`}
                title="Resultado do mês (receitas − despesas)"
              >
                {formatMoney(m.receitas_cents - m.despesas_cents)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
