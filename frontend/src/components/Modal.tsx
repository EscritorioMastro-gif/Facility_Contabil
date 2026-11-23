import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconX } from './icons';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** ícone ao lado do título (ex.: alerta na confirmação de exclusão) */
  icone?: ReactNode;
  /** texto curto abaixo do título */
  subtitulo?: ReactNode;
};

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Janela por cima da tela. Esc ou clique fora fecham; o foco fica preso
 * dentro (Tab circula) e volta pro botão que abriu quando ela fecha.
 */
export function Modal({ open, onClose, title, children, wide, icone, subtitulo }: ModalProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const fechar = useRef(onClose);
  fechar.current = onClose;

  useEffect(() => {
    if (!open) return;
    const antes = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fechar.current();
        return;
      }
      if (e.key !== 'Tab' || !caixa.current) return;
      const itens = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)];
      if (!itens.length) return;
      const primeiro = itens[0]!;
      const ultimo = itens[itens.length - 1]!;
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    // foca o primeiro campo (ou o que tiver autoFocus); senão, a própria janela
    const t = window.setTimeout(() => {
      const el = caixa.current;
      if (!el || el.contains(document.activeElement)) return;
      const campo = el.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea');
      (campo ?? el).focus();
    }, 20);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      document.body.style.overflow = overflow;
      antes?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[8vh]" onClick={onClose}>
      <div className="fixed inset-0 animate-fade-in bg-brand-900/45 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} animate-scale-in overflow-hidden rounded-2xl border border-brand-200 bg-white shadow-float focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* filete de brilho no topo */}
        <div className="h-1 w-full bg-gradient-to-r from-brand-700 via-brand-400 to-brand-300" />
        <div className="p-6">
          <div className="mb-4 flex items-start gap-3">
            {icone && <span className="mt-0.5 shrink-0">{icone}</span>}
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-lg font-semibold leading-snug text-slate-800">
                {title}
              </h2>
              {subtitulo && <div className="mt-1 text-sm text-slate-500">{subtitulo}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Fechar"
            >
              <IconX className="h-[18px] w-[18px]" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
