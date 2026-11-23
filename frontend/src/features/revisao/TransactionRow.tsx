import { memo } from 'react';
import { formatDate, formatMoney } from '@/lib/format';
import type { ComplementoModo, Transaction } from '@/lib/types';
import { composeComplemento } from './complemento';
import type { RowDraft } from './useRevisaoDraft';

export const TransactionRow = memo(function TransactionRow({
  txn,
  draft,
  onPatch,
  complementoModo,
  classificacaoNome,
}: {
  txn: Transaction;
  draft: RowDraft;
  onPatch: (patch: Partial<RowDraft>) => void;
  complementoModo: ComplementoModo;
  classificacaoNome?: string | null;
}) {
  const ign = draft.ignorado;
  const cents = Math.round(Number(txn.valor) * 100);
  const preview = composeComplemento(
    complementoModo,
    txn.descricao_raw,
    draft.hist_complemento,
    classificacaoNome ?? '',
  );

  return (
    <tr className={ign ? 'bg-slate-50/80 text-slate-400' : ''}>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          title="Inativar este lançamento (não vai pro arquivo)"
          checked={ign}
          onChange={(e) => onPatch({ ignorado: e.target.checked })}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-xs">{formatDate(txn.data)}</td>
      <td className={`min-w-[12rem] px-2 py-1 text-xs ${ign ? 'line-through' : 'text-slate-700'}`}>
        {txn.descricao_raw}
      </td>
      <td className={`whitespace-nowrap px-2 py-1 text-right text-xs font-medium tabular-nums ${!ign && txn.direction === 'entrada' ? 'text-green-700' : ''}`}>
        {formatMoney(cents)}
      </td>
      <td className="px-2 py-1">
        <span
          className={`chip ${txn.direction === 'entrada' ? 'chip-green' : 'chip-red'} ${ign ? 'opacity-40' : ''}`}
        >
          {txn.direction === 'entrada' ? 'ent' : 'saí'}
        </span>
      </td>
      <td className="max-w-[9rem] truncate px-2 py-1 text-[11px] text-slate-500" title={classificacaoNome ?? ''}>
        {classificacaoNome || <span className="text-slate-300">—</span>}
      </td>
      <td className="px-1 py-1">
        <input
          className={`input input-mono h-8 w-24 rounded-lg px-2 py-1 text-xs disabled:bg-slate-100 ${
            !ign && !draft.conta_contabil.trim() ? 'border-amber-300 bg-amber-50/40' : ''
          }`}
          aria-label={`Conta contábil — ${txn.descricao_raw}`}
          value={draft.conta_contabil}
          disabled={ign}
          onChange={(e) => onPatch({ conta_contabil: e.target.value })}
          placeholder="conta"
        />
      </td>
      <td className="px-1 py-1">
        <input
          className={`input input-mono h-8 w-16 rounded-lg px-2 py-1 text-xs disabled:bg-slate-100 ${
            !ign && !draft.hist_code.trim() ? 'border-amber-300 bg-amber-50/40' : ''
          }`}
          aria-label={`Código de histórico — ${txn.descricao_raw}`}
          value={draft.hist_code}
          disabled={ign}
          inputMode="numeric"
          onChange={(e) => onPatch({ hist_code: e.target.value })}
          placeholder="hist"
        />
      </td>
      <td className="px-1 py-1">
        <input
          className="input h-8 w-full min-w-[13rem] rounded-lg px-2 py-1 text-xs disabled:bg-slate-100"
          aria-label={`Complemento — ${txn.descricao_raw}`}
          value={draft.hist_complemento}
          disabled={ign}
          onChange={(e) => onPatch({ hist_complemento: e.target.value })}
          placeholder={
            complementoModo === 'extrato'
              ? '(usando o histórico do extrato)'
              : 'complemento do histórico'
          }
        />
      </td>
      <td className="px-2 py-1">
        <span
          className="block max-w-[18rem] truncate text-[11px] text-slate-500"
          title={preview}
        >
          {preview || <span className="text-slate-300">— vazio —</span>}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-center">
        {txn.origem_preenchimento === 'memoria' && (
          <span
            className="chip chip-green"
            title="Preenchido pela memória (você já classificou essa descrição antes)"
          >
            memória
          </span>
        )}
        {txn.origem_preenchimento === 'conferir' && (
          <span
            className="chip chip-amber"
            title="Essa descrição já foi classificada com contas diferentes — confira"
          >
            conferir
          </span>
        )}
      </td>
    </tr>
  );
});
