import { useState } from 'react';
import type { ComplementoModo } from '@/lib/types';

type Dir = 'entrada' | 'saida';

const MODO_LABEL: Record<ComplementoModo, string> = {
  ambos: 'Histórico do extrato + complemento',
  extrato: 'Somente o histórico do extrato',
  complemento: 'Somente o complemento',
  extrato_classificacao: 'Histórico do extrato + classificação',
  tudo: 'Histórico do extrato + complemento + classificação',
};

export function BulkBar({
  onApplyConta,
  onApplyHist,
  onIgnore,
  complementoModo,
  onComplementoModo,
  savingModo,
}: {
  onApplyConta: (dir: Dir, conta: string) => void;
  onApplyHist: (dir: Dir, hist: string) => void;
  onIgnore: (target: 'entrada' | 'saida' | 'reativar') => void;
  complementoModo: ComplementoModo;
  onComplementoModo: (m: ComplementoModo) => void;
  savingModo: boolean;
}) {
  const [conta, setConta] = useState('');
  const [hist, setHist] = useState('');
  const [dir, setDir] = useState<Dir>('saida');

  return (
    <div className="card space-y-4 p-5">
      <p className="card-title">Ações em massa</p>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="field-label">Aplicar em</span>
          <select className="input h-9 w-40" value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
            <option value="saida">todas as saídas</option>
            <option value="entrada">todas as entradas</option>
          </select>
        </label>

        <label className="flex flex-col">
          <span className="field-label">Conta contábil</span>
          <div className="flex gap-1">
            <input
              className="input input-mono h-9 w-32"
              value={conta}
              onChange={(e) => setConta(e.target.value)}
              placeholder="ex: 10004"
            />
            <button
              className="btn-ghost btn-sm h-9"
              disabled={!conta.trim()}
              onClick={() => onApplyConta(dir, conta.trim())}
            >
              aplicar
            </button>
          </div>
        </label>

        <label className="flex flex-col">
          <span className="field-label">Cód. histórico</span>
          <div className="flex gap-1">
            <input
              className="input input-mono h-9 w-20"
              value={hist}
              inputMode="numeric"
              onChange={(e) => setHist(e.target.value)}
              placeholder="138"
            />
            <button
              className="btn-ghost btn-sm h-9"
              disabled={!hist.trim()}
              onClick={() => onApplyHist(dir, hist.trim())}
            >
              aplicar
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-sm">
        <span className="field-label mb-0">Complemento no arquivo</span>
        <select
          className="input h-9 w-full sm:w-96"
          value={complementoModo}
          disabled={savingModo}
          onChange={(e) => onComplementoModo(e.target.value as ComplementoModo)}
        >
          {(Object.keys(MODO_LABEL) as ComplementoModo[]).map((m) => (
            <option key={m} value={m}>
              {MODO_LABEL[m]}
            </option>
          ))}
        </select>
        {savingModo && <span className="text-xs text-slate-400">salvando…</span>}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-sm">
        <span className="field-label mb-0 self-center">Inativar</span>
        <button
          className="btn-danger-soft btn-sm"
          onClick={() => onIgnore('saida')}
        >
          todas as saídas
        </button>
        <button
          className="btn-danger-soft btn-sm"
          onClick={() => onIgnore('entrada')}
        >
          todas as entradas
        </button>
        <button
          className="btn-ghost btn-sm"
          onClick={() => onIgnore('reativar')}
        >
          reativar todos
        </button>
      </div>
    </div>
  );
}
