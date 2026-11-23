/**
 * Peças de interface reaproveitadas pelas telas (repaginação 2026-11):
 * cabeçalho de página, filtro segmentado, números de resumo, barra de
 * progresso, etapas do fluxo e os estados de carregando / vazio / erro.
 */
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { itemAtPath } from '@/lib/modules';
import { IconCheck, IconInfo, Spinner } from './icons';

/* ------------------------------------------------------------------ */
/* Cabeçalho da página                                                 */
/* ------------------------------------------------------------------ */

export function PageHeader({
  titulo,
  descricao,
  acoes,
  eyebrow,
  children,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  /** botões à direita do título */
  acoes?: ReactNode;
  /** rótulo acima do título — por padrão, o nome do módulo */
  eyebrow?: ReactNode;
  children?: ReactNode;
}) {
  const { pathname } = useLocation();
  const rotulo = eyebrow ?? itemAtPath(pathname)?.mod.label;
  return (
    <header className="animate-fade-up space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          {rotulo && (
            <p className="eyebrow flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400 shadow-glow-sm" />
              {rotulo}
            </p>
          )}
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight text-slate-800 sm:text-[1.75rem]">{titulo}</h1>
          {descricao && <div className="mt-1.5 text-sm leading-relaxed text-slate-500">{descricao}</div>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Filtro segmentado                                                   */
/* ------------------------------------------------------------------ */

export type OpcaoSegmento<T extends string> = {
  value: T;
  label: ReactNode;
  /** número no selo ao lado do rótulo */
  count?: number;
  title?: string;
};

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: OpcaoSegmento<T>[];
  /** nome do grupo pra leitores de tela ("Filtrar lançamentos") */
  label: string;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg-btn"
          aria-pressed={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count.toLocaleString('pt-BR')}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Números de resumo                                                   */
/* ------------------------------------------------------------------ */

type Tom = 'green' | 'amber' | 'red' | 'brand' | 'slate';

const COR_TOM: Record<Tom, string> = {
  green: 'text-green-700',
  amber: 'text-amber-700',
  red: 'text-red-700',
  brand: 'text-brand-700',
  slate: 'text-slate-800',
};

const PONTO_TOM: Record<Tom, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  brand: 'bg-brand-400',
  slate: 'bg-slate-300',
};

/** Um número com rótulo (Ativos, Pendentes, Receitas...). */
export function Metrica({
  rotulo,
  valor,
  tom,
  detalhe,
  className = '',
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  tom?: Tom;
  detalhe?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PONTO_TOM[tom ?? 'slate']}`} />
        <span className="truncate">{rotulo}</span>
      </p>
      <p className={`mt-1 font-display text-xl font-semibold tabular-nums leading-tight ${COR_TOM[tom ?? 'slate']}`}>
        {valor}
      </p>
      {detalhe && <div className="mt-0.5 text-xs text-slate-500">{detalhe}</div>}
    </div>
  );
}

/** Barra fina de progresso (quanto já foi feito do total). */
export function BarraProgresso({
  feito,
  total,
  rotulo,
  className = '',
}: {
  feito: number;
  total: number;
  /** texto pra leitores de tela */
  rotulo: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((feito / total) * 100)) : 0;
  const completo = total > 0 && feito >= total;
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={feito}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${
          completo ? 'bg-green-500' : 'bg-gradient-to-r from-brand-600 via-brand-500 to-brand-300'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Etapas do fluxo                                                     */
/* ------------------------------------------------------------------ */

/**
 * Onde a pessoa está no fluxo (ex.: Importação → etapa 3 de 4). `atual` é o
 * índice da etapa em andamento; `concluidas` marca as anteriores como feitas.
 */
export function Etapas({ etapas, atual, className = '' }: { etapas: string[]; atual: number; className?: string }) {
  return (
    <nav aria-label="Etapas" className={className}>
      {/* celular: só a etapa atual */}
      <p className="text-xs font-semibold text-slate-500 sm:hidden">
        Etapa {Math.min(atual + 1, etapas.length)} de {etapas.length} ·{' '}
        <span className="text-brand-700">{etapas[Math.min(atual, etapas.length - 1)]}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
        {etapas.map((nome, i) => {
          const feita = i < atual;
          const agora = i === atual;
          return (
            <li key={nome} className="flex min-w-0 items-center gap-2" aria-current={agora ? 'step' : undefined}>
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-all ${
                  feita
                    ? 'bg-brand-600 text-white'
                    : agora
                      ? 'bg-white text-brand-700 ring-2 ring-brand-400 shadow-glow-sm'
                      : 'bg-white text-slate-400 ring-1 ring-brand-200'
                }`}
              >
                {feita ? <IconCheck className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
              </span>
              <span
                className={`truncate text-xs font-semibold ${
                  agora ? 'text-slate-800' : feita ? 'text-brand-700' : 'text-slate-400'
                }`}
              >
                {nome}
              </span>
              {i < etapas.length - 1 && (
                <span
                  className={`mx-1 h-px w-6 shrink-0 lg:w-10 ${feita ? 'bg-brand-400' : 'bg-brand-200'}`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Título numerado de um bloco do formulário ("1 · Cliente", "2 · Extrato"). */
export function Secao({
  numero,
  titulo,
  descricao,
  children,
  className = '',
}: {
  numero?: number;
  titulo: ReactNode;
  descricao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`space-y-4 ${className}`}>
      <div className="flex items-start gap-3">
        {numero !== undefined && (
          <span className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-50 font-mono text-[11px] font-bold text-brand-700 ring-1 ring-brand-200">
            {numero}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="card-title leading-6">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{descricao}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Caixa lateral de ajuda ("Como funciona") ao lado dos formulários. */
export function Ajuda({ titulo = 'Como funciona', children }: { titulo?: ReactNode; children: ReactNode }) {
  return (
    <aside className="relative overflow-hidden rounded-2xl border border-brand-200/80 bg-gradient-to-br from-white/80 to-brand-50/60 p-5 text-sm leading-relaxed text-slate-600 backdrop-blur xl:sticky xl:top-20">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-brand-300/20 blur-2xl" />
      <p className="eyebrow relative flex items-center gap-2">
        <IconInfo className="h-3.5 w-3.5" />
        {titulo}
      </p>
      <div className="relative mt-3 space-y-3">{children}</div>
    </aside>
  );
}

/** Item numerado dentro da caixa de ajuda. */
export function PassoAjuda({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-700 font-mono text-[10px] font-bold text-white">
        {n}
      </span>
      <p className="min-w-0 text-[13px]">{children}</p>
    </div>
  );
}

/**
 * Barra de ações presa no rodapé da tela (Revisão, Classificação): o estado
 * do trabalho e os botões de salvar/gerar ficam sempre à vista, mesmo no meio
 * de uma tabela de 200 lançamentos.
 */
export function BarraAcoes({ status, children }: { status: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-2 z-20 pt-1 sm:bottom-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-brand-200/80 bg-white/85 px-3 py-2.5 shadow-float backdrop-blur-xl sm:px-4 sm:py-3">
        <div className="min-w-0 basis-full text-xs text-slate-600 sm:flex-1 sm:basis-auto sm:text-sm">{status}</div>
        {/* no celular os botões dividem a linha; em tela larga ficam do tamanho do texto */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estados: carregando, vazio, erro                                    */
/* ------------------------------------------------------------------ */

export function Carregando({ texto = 'Carregando…', className = '' }: { texto?: string; className?: string }) {
  return (
    <p className={`flex items-center gap-2 text-sm text-slate-500 ${className}`} role="status">
      <Spinner className="h-4 w-4 text-brand-500" />
      {texto}
    </p>
  );
}

/** Esqueleto de tabela/lista enquanto os dados chegam. */
export function CarregandoLinhas({ linhas = 5, className = '' }: { linhas?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 p-5 ${className}`} role="status" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-3.5 w-24" />
          <div className="skeleton h-3.5 flex-1" style={{ maxWidth: `${70 - ((i * 13) % 30)}%` }} />
          <div className="skeleton ml-auto h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function Vazio({
  titulo,
  texto,
  acao,
  icone,
  className = '',
}: {
  titulo: ReactNode;
  texto?: ReactNode;
  acao?: ReactNode;
  icone?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-200">
        {icone ?? <IconInfo className="h-6 w-6" />}
      </span>
      <p className="mt-3 font-display text-[15px] font-semibold text-slate-700">{titulo}</p>
      {texto && <div className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{texto}</div>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function ErroCarregar({ erro, padrao = 'Falha ao carregar', className = '' }: { erro: unknown; padrao?: string; className?: string }) {
  return (
    <p className={`alert alert-error ${className}`} role="alert">
      {erro instanceof Error ? erro.message : padrao}
    </p>
  );
}

/** Atalho de teclado desenhado como tecla. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
