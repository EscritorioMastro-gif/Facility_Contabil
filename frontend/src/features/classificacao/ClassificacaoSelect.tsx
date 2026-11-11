import { forwardRef, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import type { Classificacao, Direction } from '@/lib/types';
import { NovaClassificacaoModal } from './NovaClassificacaoModal';

const NOVA = '__nova__';

type Props = {
  clientId: string;
  direction: Direction;
  options: Classificacao[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  className?: string;
  /** Enter / Shift+Enter na tabela da Classificação: desce / sobe uma linha */
  onKeyDown?: React.KeyboardEventHandler<HTMLSelectElement>;
  'aria-label'?: string;
};

/**
 * Escolha da classificação de um lançamento. Só aparecem as ativas (a
 * desativada continua visível onde já estava escolhida). "+ nova
 * classificação" (avulsa, fora da lista geral) é só do escritório.
 */
export const ClassificacaoSelect = forwardRef<HTMLSelectElement, Props>(function ClassificacaoSelect(
  { clientId, direction, options, value, disabled, onChange, className, onKeyDown, 'aria-label': ariaLabel },
  ref,
) {
  const [creating, setCreating] = useState(false);
  const { ehCliente } = useAuth();
  const visiveis = options.filter((c) => c.ativo || c.id === value);

  return (
    <>
      <select
        ref={ref}
        aria-label={ariaLabel}
        className={className ?? 'input h-8 px-2 py-1 text-xs disabled:bg-slate-100'}
        value={value ?? ''}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          if (e.target.value === NOVA) {
            setCreating(true);
            return;
          }
          onChange(e.target.value || null);
        }}
      >
        <option value="">— sem classificação —</option>
        {visiveis.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.ativo ? '' : ' (desativada)'}
          </option>
        ))}
        {!ehCliente && <option value={NOVA}>+ nova classificação…</option>}
      </select>

      {!ehCliente && (
        <NovaClassificacaoModal
          open={creating}
          clientId={clientId}
          direction={direction}
          onClose={() => setCreating(false)}
          onCreated={(c) => onChange(c.id)}
        />
      )}
    </>
  );
});
