import { IconArquivo } from '@/components/icons';
import { formatDate, formatMoney } from '@/lib/format';
import type { Statement, StatementTotais } from '@/lib/types';

function hasTotais(t: Statement['totais']): t is StatementTotais {
  return typeof (t as StatementTotais)?.qtd === 'number';
}

export function StatementSummary({
  statement,
  resumido = false,
}: {
  statement: Statement;
  /** sem conta do banco e lote do Domínio (portal do cliente) */
  resumido?: boolean;
}) {
  const t = statement.totais;
  const periodo =
    statement.period_start && statement.period_end
      ? `${formatDate(statement.period_start)} a ${formatDate(statement.period_end)}`
      : '—';

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-transparent px-5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-200">
          <IconArquivo className="h-[18px] w-[18px]" />
        </span>
        {/* min-w-0 + overflow-wrap: nome de arquivo sem espaço ("financeiro_20260902.xlsx") quebra em vez de invadir */}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800 [overflow-wrap:anywhere]">{statement.arquivo_nome}</p>
          <p className="text-xs text-slate-500">Período {periodo}</p>
        </div>
        <span className="chip chip-brand font-mono">{statement.formato.toUpperCase()}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {!resumido && (
          <>
            <Info label="Conta do banco" value={statement.banco_conta_contabil ?? '—'} mono />
            <Info label="Lote Domínio" value={String(statement.lote_numero)} mono />
          </>
        )}
        {hasTotais(t) && (
          <>
            <Info label="Lançamentos" value={String(t.qtd)} />
            <Info label={`Entradas · ${t.entradas.n}`} value={formatMoney(t.entradas.valor_cents)} tone="green" />
            <Info label={`Saídas · ${t.saidas.n}`} value={formatMoney(t.saidas.valor_cents)} tone="red" />
            <Info
              label="Resultado"
              value={formatMoney(t.entradas.valor_cents - t.saidas.valor_cents)}
              tone={t.entradas.valor_cents - t.saidas.valor_cents < 0 ? 'red' : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red';
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={`mt-0.5 font-semibold tabular-nums [overflow-wrap:anywhere] ${mono ? 'font-mono text-[13px]' : 'font-display'} ${
          tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
