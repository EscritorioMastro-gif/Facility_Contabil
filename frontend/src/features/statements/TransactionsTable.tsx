import { useMemo, useState } from 'react';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { TabelaRolavel } from '@/components/TabelaRolavel';
import { Segmented } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import type { Direction, Transaction } from '@/lib/types';
import { computeSaldo } from './saldo';

type Filter = 'todas' | 'entrada' | 'saida';

export function TransactionsTable({
  transactions,
  readOnly = false,
  saldoInicial,
}: {
  transactions: Transaction[];
  readOnly?: boolean;
  /** Se informado, mostra a coluna "Saldo" (acumulado) em reais. */
  saldoInicial?: number;
}) {
  const [filter, setFilter] = useState<Filter>('todas');
  const showSaldo = saldoInicial !== undefined;

  const saldo = useMemo(
    () => (showSaldo ? computeSaldo(transactions, saldoInicial) : null),
    [transactions, saldoInicial, showSaldo],
  );

  // ordena cronologicamente quando mostra saldo (senão fica sem sentido)
  const ordered = useMemo(
    () => (saldo ? saldo.cronologica : transactions),
    [saldo, transactions],
  );

  const shown = useMemo(
    () => ordered.filter((t) => filter === 'todas' || t.direction === filter),
    [ordered, filter],
  );

  const pag = usePaginacao(shown, 'resultado-importacao', filter);

  const counts = useMemo(() => {
    const e = transactions.filter((t) => t.direction === 'entrada');
    const s = transactions.filter((t) => t.direction === 'saida');
    return {
      entrada: e.length,
      saida: s.length,
      somaE: e.reduce((a, t) => a + Math.round(Number(t.valor) * 100), 0),
      somaS: s.reduce((a, t) => a + Math.round(Number(t.valor) * 100), 0),
    };
  }, [transactions]);

  return (
    <div className="space-y-3">
      <Segmented
        label="Filtrar lançamentos"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'todas', label: 'Todas', count: transactions.length },
          {
            value: 'entrada',
            label: (
              <>
                Entradas <span className="font-normal opacity-80">· {formatMoney(counts.somaE)}</span>
              </>
            ),
            count: counts.entrada,
          },
          {
            value: 'saida',
            label: (
              <>
                Saídas <span className="font-normal opacity-80">· {formatMoney(counts.somaS)}</span>
              </>
            ),
            count: counts.saida,
          },
        ]}
      />

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
      />

      <TabelaRolavel>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Histórico do extrato</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Tipo</th>
              {showSaldo && <th className="px-3 py-2 text-right">Saldo</th>}
              {!readOnly && <th className="px-3 py-2">Conta contábil</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pag.daPagina.map((t) => {
              const s = saldo?.aposPorId.get(t.id);
              return (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">
                    {formatDate(t.data)}
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">{t.descricao_raw}</td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums ${t.direction === 'entrada' ? 'text-green-700' : 'text-slate-700'}`}>
                    {formatMoney(Math.round(Number(t.valor) * 100))}
                  </td>
                  <td className="px-3 py-1.5">
                    <DirBadge dir={t.direction} />
                  </td>
                  {showSaldo && (
                    <td
                      className={`whitespace-nowrap px-3 py-1.5 text-right tabular-nums ${
                        s !== undefined && s < 0 ? 'text-red-600' : 'text-slate-500'
                      }`}
                    >
                      {s !== undefined ? formatMoney(s) : '—'}
                    </td>
                  )}
                  {!readOnly && (
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{t.conta_contabil ?? '—'}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {showSaldo && saldo && filter === 'todas' && pag.pagina === pag.paginas && (
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-medium text-slate-600">
                  Saldo final calculado
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                  {formatMoney(saldo.finalCents)}
                </td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </TabelaRolavel>
    </div>
  );
}

function DirBadge({ dir }: { dir: Direction }) {
  return dir === 'entrada' ? (
    <span className="chip chip-green">entrada</span>
  ) : (
    <span className="chip chip-red">saída</span>
  );
}
