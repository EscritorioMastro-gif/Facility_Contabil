import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduloBloqueado, navDoPapel, type IconeNav } from '@/lib/modules';
import { IconBusca, IconHome, IconLogout } from './icons';
import { NavIcone } from './NavIcone';

type Comando = {
  id: string;
  grupo: string;
  label: string;
  descricao?: string;
  icone: IconeNav | 'inicio' | 'sair';
  acao: () => void;
};

/** "Importação" ≈ "importacao": busca sem acento e sem maiúsculas. */
const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Paleta de comandos (Ctrl+K ou /): digita o nome da tela e vai direto,
 * sem passar pelo menu. Setas sobem e descem, Enter abre, Esc fecha.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { papel, signOut } = useAuth();
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  const comandos = useMemo<Comando[]>(() => {
    const ir = (to: string) => () => navigate(to);
    const lista: Comando[] = [
      { id: 'inicio', grupo: 'Geral', label: 'Início', descricao: 'Tela inicial com os módulos', icone: 'inicio', acao: ir('/') },
    ];
    for (const m of MODULES) {
      if (moduloBloqueado(m, papel)) continue;
      for (const n of navDoPapel(m, papel)) {
        lista.push({ id: n.to, grupo: m.label, label: n.label, descricao: n.descricao, icone: n.icone, acao: ir(n.to) });
      }
    }
    lista.push({ id: 'sair', grupo: 'Conta', label: 'Sair do sistema', icone: 'sair', acao: () => void signOut() });
    return lista;
  }, [navigate, papel, signOut]);

  const filtrados = useMemo(() => {
    const q = normal(busca.trim());
    if (!q) return comandos;
    return comandos.filter((c) => normal(`${c.label} ${c.grupo} ${c.descricao ?? ''}`).includes(q));
  }, [comandos, busca]);

  useEffect(() => {
    if (!open) return;
    setBusca('');
    setAtivo(0);
  }, [open]);

  useEffect(() => setAtivo(0), [busca]);

  // mantém o item ativo à vista ao andar com as setas
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [ativo]);

  if (!open) return null;

  function executar(c: Comando | undefined) {
    if (!c) return;
    onClose();
    c.acao();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => (filtrados.length ? (a + 1) % filtrados.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => (filtrados.length ? (a - 1 + filtrados.length) % filtrados.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executar(filtrados[ativo]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  let grupoAnterior = '';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 animate-fade-in bg-brand-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ir para uma tela"
        className="relative w-full max-w-xl animate-scale-in overflow-hidden rounded-2xl border border-brand-200 bg-white/95 shadow-float backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <IconBusca className="h-5 w-5 shrink-0 text-brand-500" />
          <input
            ref={inputRef}
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Ir para… (ex.: histórico, memória, clientes)"
            className="h-14 w-full bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="paleta-lista"
            aria-activedescendant={filtrados[ativo] ? `paleta-${filtrados[ativo].id}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <ul ref={listaRef} id="paleta-lista" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {filtrados.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-slate-400">Nenhuma tela com esse nome.</li>
          )}
          {filtrados.map((c, i) => {
            const cabecalho = c.grupo !== grupoAnterior;
            grupoAnterior = c.grupo;
            return (
              <li key={c.id} role="presentation">
                {cabecalho && (
                  <p className="px-3 pb-1 pt-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                    {c.grupo}
                  </p>
                )}
                <button
                  type="button"
                  id={`paleta-${c.id}`}
                  role="option"
                  aria-selected={i === ativo}
                  data-i={i}
                  onMouseMove={() => setAtivo(i)}
                  onClick={() => executar(c)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                    i === ativo ? 'bg-brand-50 text-brand-900' : 'text-slate-700'
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 transition-colors ${
                      i === ativo ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-brand-600 ring-brand-200'
                    }`}
                  >
                    {c.icone === 'inicio' ? (
                      <IconHome className="h-4 w-4" />
                    ) : c.icone === 'sair' ? (
                      <IconLogout className="h-4 w-4" />
                    ) : (
                      <NavIcone nome={c.icone} className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{c.label}</span>
                    {c.descricao && <span className="block truncate text-xs text-slate-500">{c.descricao}</span>}
                  </span>
                  {i === ativo && <kbd className="kbd">Enter</kbd>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/80 px-4 py-2 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> navegar
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">Enter</kbd> abrir
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="kbd">Ctrl</kbd>
            <kbd className="kbd">K</kbd> abre de qualquer tela
          </span>
        </div>
      </div>
    </div>
  );
}
