import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconChevronDireita, IconChevronEsquerda, IconChevronsDireita, IconChevronsEsquerda } from './icons';

/** Itens por página que a pessoa escolhe (pedido do user: 10, 50 e 100). */
export const TAMANHOS_PAGINA = [10, 50, 100] as const;
const PADRAO = 50;

function lerTamanho(chave: string): number {
  try {
    const v = Number(window.localStorage.getItem(`itens-por-pagina:${chave}`));
    return (TAMANHOS_PAGINA as readonly number[]).includes(v) ? v : PADRAO;
  } catch {
    return PADRAO;
  }
}

/**
 * Itens por página lembrado por tabela (`chave`), entre visitas: quem escolhe
 * 100 na Classificação continua com 100 no próximo extrato.
 */
export function useItensPorPagina(chave: string): [number, (n: number) => void] {
  const [porPagina, setPorPagina] = useState(() => lerTamanho(chave));
  const mudar = useCallback(
    (n: number) => {
      setPorPagina(n);
      try {
        window.localStorage.setItem(`itens-por-pagina:${chave}`, String(n));
      } catch {
        /* navegador sem armazenamento: vale só nesta tela */
      }
    },
    [chave],
  );
  return [porPagina, mudar];
}

/**
 * Paginação de uma lista que já está toda na tela (lançamentos do extrato).
 * `reinicio` muda → volta pra página 1 (ex.: trocou o filtro).
 */
export function usePaginacao<T>(itens: T[], chave: string, reinicio?: unknown) {
  const [porPagina, setPorPagina] = useItensPorPagina(chave);
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(itens.length / porPagina));

  useEffect(() => setPagina(1), [reinicio, porPagina]);
  // a lista encolheu (ex.: classificou e saiu do filtro "pendentes"): fica na última página que existe
  useEffect(() => {
    if (pagina > paginas) setPagina(paginas);
  }, [pagina, paginas]);

  const atual = Math.min(pagina, paginas);
  const inicio = (atual - 1) * porPagina;
  const daPagina = useMemo(() => itens.slice(inicio, inicio + porPagina), [itens, inicio, porPagina]);

  return {
    daPagina,
    inicio,
    pagina: atual,
    paginas,
    porPagina,
    setPagina,
    setPorPagina,
    total: itens.length,
  };
}

export function Paginacao({
  pagina,
  paginas,
  porPagina,
  total,
  onPagina,
  onPorPagina,
  rotulo = 'lançamentos',
}: {
  pagina: number;
  paginas: number;
  porPagina: number;
  total: number;
  onPagina: (p: number) => void;
  onPorPagina: (n: number) => void;
  rotulo?: string;
}) {
  if (!total) return null;
  const de = (pagina - 1) * porPagina + 1;
  const ate = Math.min(pagina * porPagina, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
      <span className="text-[13px]">
        <b className="font-semibold tabular-nums text-slate-800">
          {de.toLocaleString('pt-BR')}–{ate.toLocaleString('pt-BR')}
        </b>{' '}
        de <span className="tabular-nums">{total.toLocaleString('pt-BR')}</span> {rotulo}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Por página</span>
          <select
            className="input h-8 w-[4.75rem] rounded-lg py-0 pl-2.5 text-[13px]"
            value={porPagina}
            onChange={(e) => onPorPagina(Number(e.target.value))}
          >
            {TAMANHOS_PAGINA.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {paginas > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Páginas">
            <BotaoPagina onClick={() => onPagina(1)} disabled={pagina <= 1} titulo="Primeira página">
              <IconChevronsEsquerda className="h-4 w-4" />
            </BotaoPagina>
            <BotaoPagina onClick={() => onPagina(pagina - 1)} disabled={pagina <= 1} titulo="Página anterior">
              <IconChevronEsquerda className="h-4 w-4" />
            </BotaoPagina>
            <span className="min-w-[5.5rem] px-1.5 text-center text-xs font-medium text-slate-500">
              Página <b className="font-semibold text-slate-800">{pagina}</b> de {paginas}
            </span>
            <BotaoPagina onClick={() => onPagina(pagina + 1)} disabled={pagina >= paginas} titulo="Próxima página">
              <IconChevronDireita className="h-4 w-4" />
            </BotaoPagina>
            <BotaoPagina onClick={() => onPagina(paginas)} disabled={pagina >= paginas} titulo="Última página">
              <IconChevronsDireita className="h-4 w-4" />
            </BotaoPagina>
          </div>
        )}
      </div>
    </div>
  );
}

function BotaoPagina({
  onClick,
  disabled,
  titulo,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg border border-brand-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
