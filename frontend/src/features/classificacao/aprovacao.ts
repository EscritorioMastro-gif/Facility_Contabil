import type { Statement } from '@/lib/types';

/**
 * Aprovação das classificações pelo cliente (migrations 0026 e 0028). O cliente
 * aprova pelo portal ("Salvar e aprovar") o que já classificou — pode ser em
 * partes ao longo do mês. Se alguém mexer num lançamento que ele já aprovou,
 * a aprovação deixa de valer até ele aprovar de novo.
 */
export type SituacaoAprovacao = 'aprovado' | 'parcial' | 'alterado' | 'aguardando';

export function situacaoAprovacao(
  s: Pick<Statement, 'aprovado_em' | 'aprovado_pendentes' | 'classificacao_alterada_em'>,
): SituacaoAprovacao {
  if (!s.aprovado_em) return 'aguardando';
  if (s.classificacao_alterada_em && Date.parse(s.classificacao_alterada_em) > Date.parse(s.aprovado_em)) {
    return 'alterado';
  }
  if ((s.aprovado_pendentes ?? 0) > 0) return 'parcial';
  return 'aprovado';
}

/** "40 de 91" — quantos o cliente aprovou na última vez, do total que o extrato tinha. */
export function parteAprovada(s: Pick<Statement, 'aprovado_qtd' | 'aprovado_pendentes'>): string {
  const qtd = s.aprovado_qtd ?? 0;
  return `${qtd} de ${qtd + (s.aprovado_pendentes ?? 0)}`;
}

/** Uma aprovação do histórico (GET /api/statements/:id/aprovacoes). O IP só vem pro escritório. */
export type Aprovacao = {
  id: string;
  email: string;
  aprovado_em: string;
  /** classificados aprovados nesta vez */
  qtd: number;
  /** ainda sem classificação nesta vez (> 0 = parcial) */
  pendentes: number;
  /** entraram ou mudaram desde a aprovação anterior (null nas de antes da 0028) */
  novos: number | null;
  entradas: string;
  saidas: string;
  ip?: string | null;
};

/** "12/11/2026 às 14:32" */
export function dataHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`);
