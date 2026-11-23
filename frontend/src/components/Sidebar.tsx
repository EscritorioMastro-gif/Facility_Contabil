import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduleAtPath, moduloBloqueado, navDoPapel } from '@/lib/modules';
import { IconBusca, IconCadeado, IconChevronDireita, IconHome, IconLogout } from './icons';
import { ModuloIcone, NavIcone } from './NavIcone';

/** Marca: o quadradinho "FC" com brilho, usado na barra lateral, no topo do celular e no login. */
export function Marca({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' | 'lg' }) {
  const cls = { sm: 'h-7 w-7 rounded-lg text-[11px]', md: 'h-9 w-9 rounded-xl text-[13px]', lg: 'h-11 w-11 rounded-2xl text-base' }[tamanho];
  return (
    <span
      className={`relative grid shrink-0 place-items-center bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 font-display font-bold text-brand-900 shadow-glow ring-1 ring-white/30 ${cls}`}
    >
      FC
    </span>
  );
}

/** Conteúdo da barra lateral — reaproveitado no fixo (desktop) e na gaveta (mobile). */
export function SidebarNav({ onNavigate, onBuscar }: { onNavigate?: () => void; onBuscar: () => void }) {
  const { user, signOut, papel } = useAuth();
  const location = useLocation();
  const activeMod = moduleAtPath(location.pathname);
  // módulo ativo sempre aberto; os outros abrem pela setinha (sem sair da tela)
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set(activeMod ? [activeMod.id] : []));
  useEffect(() => {
    if (activeMod) setAbertos((s) => (s.has(activeMod.id) ? s : new Set(s).add(activeMod.id)));
  }, [activeMod]);

  const alternar = (id: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const email = user?.email ?? '';
  const inicial = (email[0] ?? '?').toUpperCase();
  const naInicio = location.pathname === '/';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-brand-800 to-brand-900 text-white">
      {/* textura e brilho de fundo */}
      <div className="bg-grid-dark pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_55%)]" />
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />

      <Link to="/" onClick={onNavigate} className="relative flex items-center gap-3 px-5 pb-4 pt-5">
        <Marca />
        <span className="min-w-0">
          <span className="block font-display text-[15px] font-semibold leading-tight text-white">Facility Contábil</span>
          <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-brand-300/80">extrato → domínio</span>
        </span>
      </Link>

      <div className="relative px-3 pb-2">
        <button
          type="button"
          onClick={onBuscar}
          className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-left text-sm text-white/60 transition-colors hover:border-brand-300/40 hover:bg-white/[0.1] hover:text-white"
        >
          <IconBusca className="h-4 w-4 shrink-0" />
          <span className="flex-1">Ir para…</span>
          <kbd className="rounded-md border border-white/15 bg-white/5 px-1.5 font-mono text-[10px] text-white/60">Ctrl K</kbd>
        </button>
      </div>

      <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 pb-3 pt-2" aria-label="Módulos">
        <Link
          to="/"
          onClick={onNavigate}
          aria-current={naInicio ? 'page' : undefined}
          className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold transition-colors ${
            naInicio ? 'bg-white/[0.09] text-white ring-1 ring-white/10' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'
          }`}
        >
          {naInicio && <Indicador />}
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
              naInicio ? 'bg-brand-300 text-brand-900 shadow-glow-sm' : 'bg-white/[0.06] text-white/70 group-hover:text-white'
            }`}
          >
            <IconHome className="h-[18px] w-[18px]" />
          </span>
          Início
        </Link>

        <p className="px-3 pb-1 pt-4 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/35">Módulos</p>

        {MODULES.map((m) => {
          const isActive = activeMod?.id === m.id;

          // login de cliente: o módulo aparece, mas trancado
          if (moduloBloqueado(m, papel)) {
            return (
              <div
                key={m.id}
                aria-disabled="true"
                title="Bloqueado — área do escritório"
                className="flex cursor-not-allowed items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold text-white/30"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.03]">
                  <ModuloIcone id={m.id} className="h-[18px] w-[18px]" />
                </span>
                {m.label}
                <IconCadeado className="ml-auto h-4 w-4 shrink-0" aria-label="bloqueado" />
              </div>
            );
          }

          const itens = navDoPapel(m, papel);
          const aberto = abertos.has(m.id) && itens.length > 1;

          return (
            <div key={m.id}>
              <div
                className={`group relative flex items-center rounded-xl transition-colors ${
                  isActive ? 'bg-white/[0.09] ring-1 ring-white/10' : 'hover:bg-white/[0.06]'
                }`}
              >
                {isActive && <Indicador />}
                <Link
                  to={m.home}
                  onClick={() => {
                    setAbertos((s) => new Set(s).add(m.id));
                    onNavigate?.();
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-semibold ${
                    isActive ? 'text-white' : 'text-white/75 group-hover:text-white'
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors ${
                      isActive ? 'bg-brand-300 text-brand-900 shadow-glow-sm' : 'bg-white/[0.06] text-white/70 group-hover:text-white'
                    }`}
                  >
                    <ModuloIcone id={m.id} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="truncate">{m.label}</span>
                </Link>
                {itens.length > 1 && (
                  <button
                    type="button"
                    onClick={() => alternar(m.id)}
                    aria-expanded={aberto}
                    aria-label={`${aberto ? 'Recolher' : 'Mostrar'} as telas de ${m.label}`}
                    className="mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <IconChevronDireita className={`h-4 w-4 transition-transform duration-200 ${aberto ? 'rotate-90' : ''}`} />
                  </button>
                )}
              </div>

              {aberto && (
                <div className="mb-1.5 ml-[1.6rem] mt-1 animate-fade-in space-y-0.5 border-l border-white/10 pl-2.5">
                  {itens.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end
                      onClick={onNavigate}
                      className={({ isActive: subActive }) =>
                        `group/sub flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
                          subActive
                            ? 'bg-white/[0.08] font-semibold text-white'
                            : 'font-medium text-white/55 hover:bg-white/[0.04] hover:text-white/90'
                        }`
                      }
                    >
                      {({ isActive: subActive }) => (
                        <>
                          <NavIcone
                            nome={n.icone}
                            className={`h-4 w-4 shrink-0 ${subActive ? 'text-brand-300' : 'text-white/40 group-hover/sub:text-white/70'}`}
                          />
                          <span className="truncate">{n.label}</span>
                          {subActive && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300 shadow-glow-sm" />}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="relative border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] p-2.5 ring-1 ring-white/[0.08]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-display text-sm font-semibold text-white ring-2 ring-brand-300/30">
            {inicial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white/90" title={email}>
              {email}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-300/80">
              {papel === 'cliente' ? 'Cliente' : 'Escritório'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sair do sistema"
            aria-label="Sair do sistema"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconLogout className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Barrinha brilhante à esquerda do item ativo. */
function Indicador() {
  return (
    <span
      aria-hidden="true"
      className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-300 shadow-[0_0_14px_rgb(127_209_214/0.9)]"
    />
  );
}
