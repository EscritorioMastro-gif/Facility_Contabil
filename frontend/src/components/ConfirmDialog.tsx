import { Modal } from './Modal';
import { IconAlerta, IconInfo, Spinner } from './icons';

export function ConfirmDialog({
  open,
  title = 'Confirmar',
  message,
  confirmLabel = 'Excluir',
  busyLabel = 'Excluindo…',
  danger = true,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  /** texto do botão enquanto a ação roda */
  busyLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      icone={
        <span
          className={`grid h-10 w-10 place-items-center rounded-xl ring-1 ${
            danger ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-brand-50 text-brand-600 ring-brand-200'
          }`}
        >
          {danger ? <IconAlerta className="h-5 w-5" /> : <IconInfo className="h-5 w-5" />}
        </span>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
      {error && <p className="alert alert-error mt-3">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
          {busy && <Spinner />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
