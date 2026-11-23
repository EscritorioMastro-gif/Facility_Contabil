import { useMemo, useState } from 'react';
import { formatMoney, parseMoneyToCents } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import { computeSaldo } from './saldo';

/**
 * Painel de conferência do saldo bancário.
 * saldoInicial: número (reais). Se não bater com o extrato, o operador ajusta.
 */
export function SaldoReconciliacao({
  transactions,
  saldoInicial,
  onSaldoInicial,
}: {
  transactions: Transaction[];
  saldoInicial: number;
  onSaldoInicial?: (v: number) => void;
}) {
  const info = useMemo(() => computeSaldo(transactions, saldoInicial), [transactions, saldoInicial]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(saldoInicial).replace('.', ','));
  const nEntradas = info.cronologica.filter((t) => t.direction === 'entrada').length;
  const nSaidas = info.cronologica.filter((t) => t.direction === 'saida').length;

  function salvar() {
    if (!onSaldoInicial) return;
    // mesma regra do "só ponto" da importação: "1500.50" é decimal, "1.500" é milhar
    onSaldoInicial(parseMoneyToCents(draft) / 100);
    setEditing(false);
  }

  return (
    <div className="card p-5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="card-title">Conferência do saldo bancário</p>
        {onSaldoInicial && !editing && (
          <button
            className="link text-xs"
            onClick={() => {
              setDraft(String(saldoInicial).replace('.', ','));
              setEditing(true);
            }}
          >
            ajustar saldo inicial
          </button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {editing && onSaldoInicial ? (
          <form
            className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50/60 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              salvar();
            }}
          >
            <span className="pl-1 text-slate-600">Saldo inicial R$</span>
            <input
              className="input h-9 w-36 tabular-nums"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
            />
            <button type="submit" className="btn-primary btn-sm">
              Salvar
            </button>
            <button type="button" className="btn-quiet btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </form>
        ) : (
          <Linha sinal="" label="Saldo inicial" cents={info.inicialCents} />
        )}
        <Linha sinal="+" label={`Entradas (${nEntradas})`} cents={info.entradasCents} tone="green" />
        <Linha sinal="−" label={`Saídas (${nSaidas})`} cents={-info.saidasCents} tone="red" />
        <div className="!mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-brand-800 to-brand-700 px-4 py-3 text-white shadow-glow">
          <span className="font-semibold text-white/80">= Saldo final calculado</span>
          <span className="font-display text-lg font-semibold tabular-nums">{formatMoney(info.finalCents)}</span>
        </div>
      </div>
      <p className="hint mt-3">
        Compare o saldo final calculado com o saldo do extrato no fim do período. Se não bater, confira o saldo inicial
        ou algum lançamento faltando.
      </p>
    </div>
  );
}

function Linha({ sinal, label, cents, tone }: { sinal: string; label: string; cents: number; tone?: 'green' | 'red' }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className="flex items-center gap-2 text-slate-500">
        <span
          className={`grid h-5 w-5 place-items-center rounded-md font-mono text-xs font-bold ${
            tone === 'green' ? 'bg-green-50 text-green-700' : tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-400'
          }`}
        >
          {sinal || '·'}
        </span>
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-slate-700'}`}
      >
        {formatMoney(cents)}
      </span>
    </div>
  );
}
