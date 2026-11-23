import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { acordarLeitor } from '@/lib/acordarLeitor';
import { itemAtPath } from '@/lib/modules';
import { StatusServicos } from './BackendStatus';
import { CommandPalette } from './CommandPalette';
import { IconBusca, IconChevronDireita, IconMenu, IconX } from './icons';
import { Marca, SidebarNav } from './Sidebar';

/** A pessoa está digitando num campo? (aí "/" é letra, não atalho) */
function digitando(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function AppLayout() {
  const location = useLocation();
  const onde = itemAtPath(location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paleta, setPaleta] = useState(false);

  // fecha a gaveta e a paleta ao trocar de rota
  useEffect(() => {
    setMenuOpen(false);
    setPaleta(false);
  }, [location.pathname]);
  // entrou no sistema: o leitor já vai acordando enquanto a pessoa navega
  useEffect(acordarLeitor, []);

  // Ctrl+K (ou ⌘K) de qualquer lugar; "/" quando não está num campo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaleta((p) => !p);
      } else if (e.key === '/' && !digitando(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setPaleta(true);
      } else if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const migalhas = [
    onde?.mod && { label: onde.mod.label, to: onde.mod.home },
    onde?.item && { label: onde.item.label, to: onde.item.to },
    onde?.detalhe && { label: onde.detalhe },
  ].filter(Boolean) as { label: string; to?: string }[];

  return (
    <div className="min-h-screen">
      <a
        href="#conteudo"
        className="sr-only z-[80] rounded-lg bg-brand-800 px-3 py-2 text-sm text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Pular para o conteúdo
      </a>

      {/* sidebar fixa — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] md:block">
        <SidebarNav onBuscar={() => setPaleta(true)} />
      </aside>

      {/* topbar — mobile */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-brand-200/70 bg-cream/80 px-4 py-2.5 backdrop-blur-xl md:hidden">
        <Link to="/" className="flex min-w-0 items-center gap-2.5 font-display font-semibold text-slate-800">
          <Marca tamanho="sm" />
          <span className="truncate">{onde?.mod.label ?? 'Facility Contábil'}</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPaleta(true)} className="btn-ghost btn-icon" aria-label="Ir para uma tela">
            <IconBusca className="h-[18px] w-[18px]" />
          </button>
          <button onClick={() => setMenuOpen(true)} className="btn-ghost btn-icon" aria-label="Abrir menu">
            <IconMenu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* gaveta — mobile */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-brand-900/50 backdrop-blur-sm" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[17rem] animate-slide-in-left shadow-float">
            <SidebarNav onNavigate={() => setMenuOpen(false)} onBuscar={() => setPaleta(true)} />
            <button
              onClick={() => setMenuOpen(false)}
              className="absolute -right-12 top-3 grid h-9 w-9 place-items-center rounded-xl bg-white/90 text-slate-700 shadow-card"
              aria-label="Fechar menu"
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <div className="md:pl-[17rem]">
        {/* topbar — desktop: onde estou + busca + status */}
        <header className="sticky top-0 z-20 hidden border-b border-brand-200/60 bg-cream/75 backdrop-blur-xl md:block">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-8">
            <nav aria-label="Você está em" className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                <li className="shrink-0">
                  <Link to="/" className="font-medium text-slate-400 transition-colors hover:text-brand-700">
                    Início
                  </Link>
                </li>
                {migalhas.map((m, i) => {
                  const ultimo = i === migalhas.length - 1;
                  return (
                    <li key={`${m.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                      <IconChevronDireita className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                      {ultimo || !m.to ? (
                        <span className={`truncate ${ultimo ? 'font-semibold text-slate-700' : 'font-medium text-slate-400'}`} aria-current={ultimo ? 'page' : undefined}>
                          {m.label}
                        </span>
                      ) : (
                        <Link to={m.to} className="truncate font-medium text-slate-400 transition-colors hover:text-brand-700">
                          {m.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>

            <button
              type="button"
              onClick={() => setPaleta(true)}
              className="group hidden w-64 items-center gap-2.5 rounded-xl border border-brand-200/80 bg-white/70 px-3 py-1.5 text-left text-sm text-slate-400 shadow-sm transition-all hover:border-brand-300 hover:bg-white hover:text-slate-600 lg:flex"
            >
              <IconBusca className="h-4 w-4 shrink-0 text-brand-500" />
              <span className="flex-1">Buscar ou ir para…</span>
              <kbd className="kbd">Ctrl K</kbd>
            </button>
            <StatusServicos />
          </div>
        </header>

        <main id="conteudo" className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paleta} onClose={() => setPaleta(false)} />
    </div>
  );
}
