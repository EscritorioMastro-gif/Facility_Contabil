import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoney, formatPct as pct } from '@/lib/format';
import type { ItemDashboard } from './api';

/**
 * Gráficos do Dashboard da Classificação, desenhados aqui mesmo (sem
 * biblioteca): a rosca e o mapa de árvore do período. Valor e % sempre
 * juntos; o nome completo fica na legenda (rosca) ou ao passar o mouse (mapa).
 */

/** Paleta categórica em ordem fixa (a maior classificação sempre na 1ª cor). */
const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
const COR_DEMAIS = '#b4b2a9';
/** fatias com cor própria na rosca; o resto vira "Demais" (todas continuam na legenda) */
const FATIAS = 6;

/** Rampas de um tom só (do escuro pro claro) do mapa de árvore. */
const RAMPAS = {
  receitas: ['#04342C', '#0F6E56', '#1D9E75', '#9FE1CB'],
  despesas: ['#4A1B0C', '#993C1D', '#D85A30', '#F5C4B3'],
};
/** sem centavos — pro centro da rosca e os blocos do mapa, onde o espaço é curto */
const reais = (c: number) =>
  (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// --------------------------------------------------------------------------- #
// Rosca
// --------------------------------------------------------------------------- #
type Fatia = { chave: string; nome: string; total_cents: number; percentual: number; cor: string };

/** Fatia de anel (ângulos em radianos, 0 = topo, sentido horário) num quadro de 160×160. */
function caminho(a0: number, a1: number, r0 = 58, r1 = 79, c = 80): string {
  const p = (a: number, r: number) => `${(c + r * Math.sin(a)).toFixed(2)} ${(c - r * Math.cos(a)).toFixed(2)}`;
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(a0, r1)} A${r1} ${r1} 0 ${grande} 1 ${p(a1, r1)} L${p(a1, r0)} A${r0} ${r0} 0 ${grande} 0 ${p(a0, r0)}Z`;
}

export function Rosca({
  titulo,
  itens,
  total,
  vazio,
}: {
  titulo: string;
  /** classificações (maior primeiro), % sobre o total */
  itens: ItemDashboard[];
  total: number;
  vazio: string;
}) {
  const [ativo, setAtivo] = useState<string | null>(null);

  const { fatias, resto } = useMemo(() => {
    const top = itens.slice(0, FATIAS);
    const resto = itens.slice(FATIAS);
    const fatias: Fatia[] = top.map((i, k) => ({ ...i, chave: i.nome, cor: CORES[k]! }));
    const demais = resto.reduce((a, i) => a + i.total_cents, 0);
    if (resto.length)
      fatias.push({
        chave: '__demais',
        nome: `Demais (${resto.length})`,
        total_cents: demais,
        percentual: total ? Math.round((demais / total) * 1000) / 10 : 0,
        cor: COR_DEMAIS,
      });
    return { fatias, resto };
  }, [itens, total]);

  const arcos = useMemo(() => {
    let acc = 0;
    return fatias.map((f) => {
      const a0 = (acc / total) * 2 * Math.PI;
      acc += f.total_cents;
      // fatia única: o anel quase fechado (um arco de 360° não se desenha)
      const a1 = Math.min((acc / total) * 2 * Math.PI, a0 + 2 * Math.PI - 1e-4);
      return { ...f, d: caminho(a0, a1) };
    });
  }, [fatias, total]);

  const foco = fatias.find((f) => f.chave === ativo);
  const marcar = (chave: string | null) => () => setAtivo(chave);

  return (
    <div className="card p-5">
      <p className="card-title mb-4">{titulo}</p>
      {!itens.length || total <= 0 ? (
        <p className="text-sm text-slate-400">{vazio}</p>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="relative h-40 w-40 flex-none">
            <svg viewBox="0 0 160 160" className="h-full w-full" role="img" aria-label={`${titulo}: ${formatMoney(total)}`}>
              {arcos.map((a) => (
                <path
                  key={a.chave}
                  d={a.d}
                  fill={a.cor}
                  stroke="#fff"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  opacity={ativo && ativo !== a.chave ? 0.35 : 1}
                  onMouseEnter={marcar(a.chave)}
                  onMouseLeave={marcar(null)}
                  onClick={marcar(a.chave)}
                >
                  <title>{`${a.nome}: ${formatMoney(a.total_cents)} · ${pct(a.percentual)}`}</title>
                </path>
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-display text-sm font-semibold tabular-nums text-slate-800">
                {reais(foco ? foco.total_cents : total)}
              </span>
              <span className="max-w-[6.5rem] text-[11px] leading-tight text-slate-500">
                {foco ? `${pct(foco.percentual)} do total` : 'total'}
              </span>
            </div>
          </div>

          <ul className="w-full min-w-0 flex-1 space-y-0.5 text-xs" aria-label={`Legenda — ${titulo}`}>
            {fatias.map((f) => (
              <li
                key={f.chave}
                className={`grid grid-cols-[0.625rem_minmax(0,1fr)_auto_3rem] items-start gap-x-2 rounded px-1 py-0.5 ${
                  ativo === f.chave ? 'bg-slate-100' : ''
                }`}
                onMouseEnter={marcar(f.chave)}
                onMouseLeave={marcar(null)}
              >
                <span className="mt-[3px] h-2.5 w-2.5 rounded-sm" style={{ background: f.cor }} />
                {/* nome completo, quebrando a linha se precisar */}
                <span className="break-words text-slate-700">{f.nome}</span>
                <span className="whitespace-nowrap text-right tabular-nums text-slate-700">{formatMoney(f.total_cents)}</span>
                <span className="text-right font-medium tabular-nums text-slate-700">{pct(f.percentual)}</span>
              </li>
            ))}
            {resto.map((i) => (
              <li
                key={`r-${i.nome}`}
                className={`grid grid-cols-[0.625rem_minmax(0,1fr)_auto_3rem] items-start gap-x-2 rounded px-1 py-0.5 text-slate-500 ${
                  ativo === '__demais' ? 'bg-slate-50' : ''
                }`}
                onMouseEnter={marcar('__demais')}
                onMouseLeave={marcar(null)}
              >
                <span />
                <span className="break-words pl-2">{i.nome}</span>
                <span className="whitespace-nowrap text-right tabular-nums">{formatMoney(i.total_cents)}</span>
                <span className="text-right tabular-nums">{pct(i.percentual)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- #
// Mapa de árvore
// --------------------------------------------------------------------------- #
type Bloco = { x: number; y: number; w: number; h: number };

/**
 * Mapa de árvore "squarified" (Bruls, Huizing e van Wijk): a área de cada bloco
 * é proporcional ao valor e os blocos saem o mais quadrados possível, na ordem
 * dada (maior primeiro). Valores têm que ser > 0.
 */
function squarify(valores: number[], largura: number, altura: number): Bloco[] {
  const soma = valores.reduce((a, v) => a + v, 0);
  if (!soma || largura <= 0 || altura <= 0) return valores.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const areas = valores.map((v) => (v / soma) * largura * altura);
  const pior = (linha: number[], lado: number) => {
    const s = linha.reduce((a, v) => a + v, 0);
    return Math.max((lado * lado * Math.max(...linha)) / (s * s), (s * s) / (lado * lado * Math.min(...linha)));
  };

  const out: Bloco[] = [];
  let x = 0;
  let y = 0;
  let w = largura;
  let h = altura;
  let i = 0;
  while (i < areas.length) {
    const lado = Math.min(w, h);
    const linha = [areas[i]!];
    let j = i + 1;
    while (j < areas.length && pior([...linha, areas[j]!], lado) <= pior(linha, lado)) linha.push(areas[j++]!);
    const espessura = linha.reduce((a, v) => a + v, 0) / lado;
    if (w >= h) {
      // coluna encostada à esquerda
      let cy = y;
      for (const a of linha) {
        out.push({ x, y: cy, w: espessura, h: a / espessura });
        cy += a / espessura;
      }
      x += espessura;
      w -= espessura;
    } else {
      // faixa encostada em cima
      let cx = x;
      for (const a of linha) {
        out.push({ x: cx, y, w: a / espessura, h: espessura });
        cx += a / espessura;
      }
      y += espessura;
      h -= espessura;
    }
    i = j;
  }
  return out;
}

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setLargura(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setLargura(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, largura] as const;
}

export function MapaArvore({
  titulo,
  itens,
  total,
  tom,
}: {
  titulo: string;
  itens: ItemDashboard[];
  total: number;
  tom: keyof typeof RAMPAS;
}) {
  const positivos = useMemo(() => itens.filter((i) => i.total_cents > 0), [itens]);
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="card-title">{titulo}</p>
        <p className="text-sm tabular-nums text-slate-500">Total {formatMoney(total)}</p>
      </div>
      {positivos.length ? (
        <Blocos titulo={titulo} itens={positivos} rampa={RAMPAS[tom]} />
      ) : (
        <p className="text-sm text-slate-400">Nenhum lançamento classificado nesse período.</p>
      )}
    </div>
  );
}

const ALTURA_MAPA = 240;

function Blocos({ titulo, itens, rampa }: { titulo: string; itens: ItemDashboard[]; rampa: string[] }) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [foco, setFoco] = useState<ItemDashboard | null>(null);
  const blocos = useMemo(
    () => squarify(itens.map((i) => i.total_cents), largura, ALTURA_MAPA),
    [itens, largura],
  );

  return (
    <>
      <div ref={ref} className="relative w-full" style={{ height: ALTURA_MAPA }} role="img" aria-label={`Mapa de árvore — ${titulo}`}>
        {largura > 0 &&
          itens.map((i, k) => {
            const b = blocos[k]!;
            // tom pela posição: as maiores mais escuras
            const tom = k < 2 ? 0 : k < 4 ? 1 : k < 7 ? 2 : 3;
            return (
              <div
                key={i.nome}
                className="absolute overflow-hidden rounded-lg border-2 border-white px-1.5 py-1 text-[11.5px] leading-snug transition-[filter] hover:brightness-110"
                style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: rampa[tom], color: tom === 3 ? rampa[0] : '#fff' }}
                title={`${i.nome}: ${formatMoney(i.total_cents)} · ${pct(i.percentual)}`}
                onMouseEnter={() => setFoco(i)}
                onMouseLeave={() => setFoco(null)}
                onClick={() => setFoco(i)}
              >
                {b.w > 84 && b.h > 48 ? (
                  <>
                    <b className="block truncate font-medium">{i.nome}</b>
                    <span className="block whitespace-nowrap tabular-nums">{reais(i.total_cents)}</span>
                    <span className="block font-medium tabular-nums">{pct(i.percentual)}</span>
                  </>
                ) : b.w > 40 && b.h > 20 ? (
                  <span className="font-medium tabular-nums">{pct(i.percentual)}</span>
                ) : null}
              </div>
            );
          })}
      </div>
      <p className="mt-2 min-h-[1rem] text-xs text-slate-500">
        {foco
          ? `${foco.nome}: ${formatMoney(foco.total_cents)} · ${pct(foco.percentual)} · ${foco.qtd} lançamento(s)`
          : 'Passe o mouse (ou toque) num bloco para ver o nome, o valor e o %.'}
      </p>
    </>
  );
}
