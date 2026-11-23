import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ToastCtx, type ToastInput } from '@/lib/toast';
import { IconAlerta, IconCheckCirculo, IconInfo, IconX } from './icons';

type Item = ToastInput & { id: number };

const ICONE = {
  sucesso: <IconCheckCirculo className="h-5 w-5 text-green-500" />,
  erro: <IconAlerta className="h-5 w-5 text-red-500" />,
  info: <IconInfo className="h-5 w-5 text-brand-300" />,
};

export function Toaster({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<Item[]>([]);
  const seq = useRef(0);

  const fechar = useCallback((id: number) => setItens((l) => l.filter((t) => t.id !== id)), []);

  const mostrar = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      // no máximo 3 na tela: o mais antigo sai
      setItens((l) => [...l.slice(-2), { ...t, id }]);
      window.setTimeout(() => fechar(id), t.duracao ?? 4500);
    },
    [fechar],
  );

  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:items-end"
      >
        {itens.map((t) => (
          <div
            key={t.id}
            role={t.tipo === 'erro' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-2xl border border-white/10 bg-brand-900/95 px-4 py-3 text-sm text-white shadow-float backdrop-blur-xl"
          >
            <span className="mt-px shrink-0">{ICONE[t.tipo ?? 'sucesso']}</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-5">{t.texto}</p>
              {t.detalhe && <p className="mt-0.5 text-xs leading-relaxed text-white/65">{t.detalhe}</p>}
              {t.acao && (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-bold text-brand-300 underline-offset-4 hover:underline"
                  onClick={() => {
                    t.acao!.onClick();
                    fechar(t.id);
                  }}
                >
                  {t.acao.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Fechar aviso"
              className="-mr-1 shrink-0 rounded-lg p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => fechar(t.id)}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
