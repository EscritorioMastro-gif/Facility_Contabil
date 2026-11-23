import { useState, type ReactNode } from 'react';
import { FinanceIllustration } from '@/components/FinanceIllustration';
import { Marca } from '@/components/Sidebar';
import { IconCheckCirculo, IconEscudo, IconFaisca, IconOlho, IconOlhoFechado } from '@/components/icons';

/**
 * Moldura das telas de entrada (login, criar senha): painel da marca à
 * esquerda (só em tela larga) e o formulário num cartão à direita.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* painel da marca */}
      <div className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-brand-800 via-brand-900 to-brand-900 p-10 text-white lg:flex">
        <div className="bg-grid-dark pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_40%,black,transparent_75%)]" />
        <div className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 animate-drift rounded-full bg-brand-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-brand-300/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <Marca tamanho="lg" />
          <span>
            <span className="block font-display text-lg font-semibold leading-tight">Facility Contábil</span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-300/80">extrato → domínio</span>
          </span>
        </div>

        <div className="relative flex flex-1 items-center justify-center py-8">
          <div className="absolute h-72 w-72 rounded-full bg-brand-300/10 blur-2xl" />
          <FinanceIllustration className="relative w-full max-w-lg drop-shadow-[0_30px_50px_rgb(0_0_0/0.35)]" />
        </div>

        <div className="relative space-y-4">
          <p className="max-w-md font-display text-2xl font-semibold leading-snug">
            Do extrato bancário ao arquivo do Domínio, <span className="text-brand-300">num lugar só.</span>
          </p>
          <ul className="grid max-w-lg grid-cols-1 gap-2.5 text-sm text-white/70 xl:grid-cols-3">
            <li className="flex items-center gap-2">
              <IconFaisca className="h-4 w-4 shrink-0 text-brand-300" /> Leitura automática
            </li>
            <li className="flex items-center gap-2">
              <IconCheckCirculo className="h-4 w-4 shrink-0 text-brand-300" /> Memória de contas
            </li>
            <li className="flex items-center gap-2">
              <IconEscudo className="h-4 w-4 shrink-0 text-brand-300" /> Aprovação do cliente
            </li>
          </ul>
        </div>
      </div>

      {/* formulário */}
      <div className="relative flex items-center justify-center px-4 py-12">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-brand-300/20 blur-3xl" />
        <div className="relative w-full max-w-[25rem] animate-fade-up">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Marca />
            <span className="font-display text-base font-semibold text-slate-800">Facility Contábil</span>
          </div>
          <div className="card p-7 sm:p-8">{children}</div>
          <p className="mt-6 text-center text-xs text-slate-400">
            Acesso restrito ao escritório e aos clientes convidados.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Campo com ícone à esquerda. */
export function CampoIcone({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{icone}</span>
      {children}
    </div>
  );
}

/**
 * Campo de senha com "mostrar/ocultar" e aviso de Caps Lock ligado — os dois
 * erros mais comuns ao digitar senha.
 */
export function CampoSenha({
  id,
  value,
  onChange,
  autoComplete,
  icone,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  icone: ReactNode;
}) {
  const [visivel, setVisivel] = useState(false);
  const [caps, setCaps] = useState(false);
  const checarCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.('CapsLock') ?? false);
  return (
    <>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">{icone}</span>
        <input
          id={id}
          type={visivel ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="input h-11 pl-10 pr-11"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checarCaps}
          onKeyUp={checarCaps}
          onBlur={() => setCaps(false)}
          required
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visivel ? <IconOlhoFechado className="h-[18px] w-[18px]" /> : <IconOlho className="h-[18px] w-[18px]" />}
        </button>
      </div>
      {caps && <p className="mt-1.5 text-xs font-semibold text-amber-700">Caps Lock está ligado.</p>}
    </>
  );
}
