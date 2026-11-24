import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Transaction } from '@/lib/types';

/**
 * Limite mensal de retiradas (backend/src/classificacoes/retiradas.ts): pró-labore
 * + distribuição de lucro da empresa no mês, de todos os extratos dela. Passou de
 * R$ 50.000,00 → avisa pra gerar a guia do imposto de 10% (Lei 15.270/2025).
 */
export type TipoRetirada = 'pro_labore' | 'distribuicao';
export type SomaRetiradas = { pro_labore: number; distribuicao: number };
export type MesAcima = SomaRetiradas & { mes: string; total: number };

export type RetiradasDoExtrato = {
  limite: number;
  /** classificações da empresa que contam no limite */
  classificacoes: Array<{ id: string; tipo: TipoRetirada }>;
  /** cada mês do extrato, com o que os OUTROS extratos da empresa já somam nele */
  meses: Array<{ mes: string; outros: SomaRetiradas }>;
};

/** Chaves sob 'statements': salvar a classificação ou aprovar recarrega. */
export function useRetiradasExtrato(statementId: string) {
  return useQuery({
    queryKey: ['statements', 'retiradas', statementId],
    queryFn: () => api<RetiradasDoExtrato>(`/api/retiradas/extrato/${statementId}`),
    enabled: !!statementId,
  });
}

export function useRetiradasHistorico(ids: string[]) {
  const chave = ids.join(',');
  return useQuery({
    queryKey: ['statements', 'retiradas-historico', chave],
    queryFn: () =>
      api<{ limite: number; acima: Record<string, MesAcima[]> }>(`/api/retiradas/historico?ids=${chave}`),
    select: (d) => d.acima,
    enabled: ids.length > 0,
  });
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Meses em que a empresa passou do limite, somando o que os outros extratos já
 * têm com o DESTE extrato como está na tela (o que ainda não foi salvo conta).
 */
export function mesesAcimaDoLimite(
  dados: RetiradasDoExtrato,
  transactions: Transaction[],
  classificacaoDe: (id: string) => string | null,
): MesAcima[] {
  if (!dados.classificacoes.length) return [];
  const tipos = new Map(dados.classificacoes.map((c) => [c.id, c.tipo]));
  const meses = new Map<string, SomaRetiradas>(dados.meses.map((m) => [m.mes, { ...m.outros }]));
  for (const t of transactions) {
    if (t.ignorado || t.direction !== 'saida') continue;
    const classif = classificacaoDe(t.id);
    const tipo = classif ? tipos.get(classif) : undefined;
    if (!tipo) continue;
    const mes = t.data.slice(0, 7);
    const s = meses.get(mes) ?? { pro_labore: 0, distribuicao: 0 };
    s[tipo] = centavos(s[tipo] + Number(t.valor));
    meses.set(mes, s);
  }
  return [...meses]
    .map(([mes, s]) => ({ mes, ...s, total: centavos(s.pro_labore + s.distribuicao) }))
    .filter((m) => m.total > dados.limite)
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-10" → "outubro/2026" */
export function nomeDoMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m}/${a}`;
}

export const reais = (v: number) => formatMoney(Math.round(v * 100));

/** "R$ 52 mil", "R$ 50,4 mil" — pra etiqueta do Histórico */
export const reaisCurto = (v: number) =>
  `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;

/** O aviso da janela "Salvar e aprovar" (uma frase por mês acima do limite). */
export function textoRetiradasAprovacao(meses: MesAcima[]): string | null {
  if (!meses.length) return null;
  const quais = meses.map((m) => `${reais(m.total)} em ${nomeDoMes(m.mes)}`).join(' e ');
  return `Pró-labore e distribuição de lucro somam ${quais}. Avise o escritório para gerar a guia do imposto de 10% sobre o valor retirado da Pessoa Jurídica.`;
}
