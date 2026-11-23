import { useMemo, useState } from 'react';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { TabelaRolavel } from '@/components/TabelaRolavel';
import { Segmented, Vazio } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import type { Planilha } from '@/lib/types';
import {
  definirFuncao,
  funcaoDa,
  incluida,
  letraColuna,
  type Colunas,
  type Funcao,
  type LinhaLida,
} from './planilha';

type Filtro = 'todas' | 'entram' | 'fora';

/**
 * A planilha como está no Excel, com a escolha da função de cada coluna em
 * cima e, em cada linha, como ela vai entrar (ou por que fica de fora).
 */
export function MapeamentoPlanilha({
  planilha,
  colunas,
  onColunas,
  linhas,
  invertidas,
  onInverter,
}: {
  planilha: Planilha;
  colunas: Colunas;
  onColunas: (c: Colunas) => void;
  /** `lerLinhas(planilha, colunas)` — na mesma ordem de `planilha.linhas` */
  linhas: LinhaLida[];
  invertidas: ReadonlySet<number>;
  onInverter: (n: number) => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const cols = useMemo(() => Array.from({ length: planilha.colunas }, (_, i) => i), [planilha.colunas]);
  const celulas = useMemo(() => new Map(planilha.linhas.map((l) => [l.n, l.c])), [planilha.linhas]);
  const dentro = useMemo(
    () => new Set(linhas.filter((l) => incluida(l, invertidas)).map((l) => l.n)),
    [linhas, invertidas],
  );
  const lendo = colunas.data != null && colunas.valor != null;
  const filtradas = useMemo(
    () =>
      filtro === 'todas' || !lendo
        ? linhas
        : linhas.filter((l) => (filtro === 'entram') === dentro.has(l.n)),
    [linhas, filtro, dentro, lendo],
  );
  const pag = usePaginacao(filtradas, 'planilha', filtro);
  const mostradas = pag.daPagina;

  function filtrar(f: Filtro) {
    setFiltro(f);
  }

  if (!planilha.linhas.length) {
    return (
      <div className="card">
        <Vazio titulo="Essa aba está vazia" texto="Escolha outra aba da planilha acima." />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* sem Data e Valor escolhidos, "entram (0)" só confundiria */}
      {lendo && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Segmented
            label="Filtrar linhas da planilha"
            value={filtro}
            onChange={filtrar}
            options={[
              { value: 'todas', label: 'Todas as linhas', count: linhas.length },
              { value: 'entram', label: 'Entram', count: dentro.size },
              { value: 'fora', label: 'Ficam de fora', count: linhas.length - dentro.size },
            ]}
          />
          <span className="text-xs text-slate-500">Desmarque a caixinha pra tirar uma linha da importação.</span>
        </div>
      )}

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
        rotulo="linhas"
      />

      {/* rolagem dentro da tabela: a barra pra passar pro lado fica sempre à vista,
          e a escolha das colunas (no cabeçalho) acompanha a descida */}
      <TabelaRolavel>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-2 py-2 text-right font-medium">Linha</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Vai entrar como</th>
              {cols.map((i) => {
                const f = funcaoDa(colunas, i);
                return (
                  <th key={i} className={`px-2 py-2 align-bottom ${f ? '!bg-brand-100' : ''}`}>
                    <div className="mb-1 font-mono font-semibold text-slate-600">Coluna {letraColuna(i)}</div>
                    <select
                      aria-label={`Função da coluna ${letraColuna(i)}`}
                      className={`input h-8 w-full min-w-[8.5rem] rounded-lg px-2 py-1 text-xs normal-case tracking-normal ${
                        f ? '!border-brand-500 font-semibold text-slate-800 shadow-glow' : 'text-slate-500'
                      }`}
                      value={f ?? ''}
                      onChange={(e) => onColunas(definirFuncao(colunas, i, (e.target.value || null) as Funcao | null))}
                    >
                      <option value="">não usar</option>
                      <option value="data">Data</option>
                      <option value="valor">Valor</option>
                      <option value="historico">Histórico</option>
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mostradas.map((l) => {
              const vai = dentro.has(l.n);
              const c = celulas.get(l.n) ?? [];
              return (
                <tr key={l.n} className={vai || !lendo ? 'text-slate-700' : 'text-slate-400'}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Importar a linha ${l.n}`}
                      checked={vai}
                      disabled={l.situacao !== 'entra'}
                      onChange={() => onInverter(l.n)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-400">{l.n}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {lendo ? <Resultado l={l} vai={vai} /> : <span className="text-slate-300">—</span>}
                  </td>
                  {cols.map((i) => (
                    <td
                      key={i}
                      title={c[i]?.t}
                      className={`max-w-[16rem] truncate px-3 py-1.5 ${funcaoDa(colunas, i) ? 'bg-brand-50' : ''}`}
                    >
                      {c[i]?.t ?? ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TabelaRolavel>

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
        rotulo="linhas"
      />
    </div>
  );
}

function Resultado({ l, vai }: { l: LinhaLida; vai: boolean }) {
  if (l.situacao === 'sem_data') return <span className="text-xs">fora · sem data</span>;
  if (l.situacao === 'sem_valor') return <span className="text-xs">fora · sem valor</span>;
  if (l.situacao === 'valor_zero') return <span className="text-xs">fora · valor zero</span>;
  if (!vai) {
    return l.pareceSaldo ? (
      <span
        className="chip chip-amber"
        title="O histórico começa com saldo/total — se for um lançamento de verdade, marque a caixinha"
      >
        fora · saldo/total?
      </span>
    ) : (
      <span className="text-xs">fora · tirada por você</span>
    );
  }
  const saida = l.valor! < 0;
  return (
    <>
      <span className="tabular-nums text-slate-500">{formatDate(l.data!)}</span>{' '}
      <span className={`chip ${saida ? 'chip-red' : 'chip-green'}`}>
        {saida ? 'saída' : 'entrada'} {formatMoney(Math.abs(l.valor!))}
      </span>
    </>
  );
}
