import type { Statement } from '@/lib/types';

/**
 * Aprovação das classificações pelo cliente (migration 0026). O cliente aprova
 * pelo portal; se alguém mexer numa classificação depois, a aprovação deixa de
 * valer até ele aprovar de novo.
 */
export type SituacaoAprovacao = 'aprovado' | 'alterado' | 'aguardando';

export function situacaoAprovacao(
  s: Pick<Statement, 'aprovado_em' | 'classificacao_alterada_em'>,
): SituacaoAprovacao {
  if (!s.aprovado_em) return 'aguardando';
  if (s.classificacao_alterada_em && Date.parse(s.classificacao_alterada_em) > Date.parse(s.aprovado_em)) {
    return 'alterado';
  }
  return 'aprovado';
}

/** "12/11/2026 às 14:32" */
export function dataHora(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}
