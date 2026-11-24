import { formatMoney } from '@/lib/format';
import type { InfoChamado, PedidoConferido, SituacaoPagamento } from './api';
import { planilhaXlsx, type Coluna } from './xlsx';

export const reais = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatMoney(Math.round(v * 100)));

/** "05/10/2026" no fuso de São Paulo (data pura "AAAA-MM-DD" fica como está) */
export const dataCurta = (iso: string | null | undefined) => {
  if (!iso) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.split('-').reverse().join('/');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};

/** Dia (AAAA-MM-DD) em São Paulo — vira data de verdade na planilha. */
const dia = (iso: string | null | undefined) => {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
};

/** Hoje em São Paulo, "AAAA-MM-DD" — a data que vem preenchida ao abrir o chamado. */
export const hojeEmSaoPaulo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** O mês passado, "AAAA-MM" — o que normalmente se confere. */
export function mesAnterior(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const SITUACAO: Record<SituacaoPagamento, { texto: string; cls: string }> = {
  pago: { texto: 'pago', cls: 'chip-green' },
  aguardando: { texto: 'aguardando', cls: 'chip-sky' },
  nao_pago: { texto: 'não pago', cls: 'chip-red' },
  em_andamento: { texto: 'em andamento', cls: 'chip-slate' },
  devolvido: { texto: 'devolvido', cls: 'chip-slate' },
  cancelado: { texto: 'cancelado', cls: 'chip-slate' },
};

/** A comissão ou as taxas vieram a mais? */
export const tarifaAMais = (p: PedidoConferido) => p.tarifa.comissao?.situacao === 'a_mais' || p.tarifa.taxas?.situacao === 'a_mais';

/** O débito da devolução está errado (a mais, ou sem devolução aprovada)? */
export const devolucaoComProblema = (p: PedidoConferido) => !!p.devolucao && p.devolucao.situacao !== 'ok';

/** Pedido que vale abrir chamado: não pago, cobrado a mais, débito de devolução errado, pacote perdido sem compensação. */
export const precisaDeChamado = (p: PedidoConferido) =>
  p.pagamento === 'nao_pago' || tarifaAMais(p) || devolucaoComProblema(p) || p.perdido?.situacao === 'sem_compensacao';

/** O motivo do chamado, em palavras (vai na planilha do lote). */
export function motivoDoChamado(p: PedidoConferido): string {
  const m: string[] = [];
  if (p.pagamento === 'nao_pago') m.push('Enviado e não pago');
  if (p.tarifa.comissao?.situacao === 'a_mais') m.push('Comissão cobrada a mais');
  if (p.tarifa.taxas?.situacao === 'a_mais') m.push('Taxas cobradas a mais');
  if (p.devolucao?.situacao === 'debitado_a_mais') m.push('Devolução debitada a mais');
  if (p.devolucao?.situacao === 'sem_solicitacao') m.push('Débito de devolução sem solicitação aprovada');
  if (p.perdido?.situacao === 'sem_compensacao') m.push('Pacote perdido sem compensação');
  return m.join('; ') || 'Outro';
}

/** "nº SHP-123 · 10/11/2026" ou "chamado de 10/11/2026" */
export const rotuloChamado = (c: Pick<InfoChamado, 'numero' | 'aberto_em'>) =>
  c.numero ? `nº ${c.numero} · ${dataCurta(c.aberto_em)}` : `chamado de ${dataCurta(c.aberto_em)}`;

const COLUNAS_LOTE: Coluna[] = [
  { titulo: 'Chamado', largura: 16 },
  { titulo: 'Aberto em', tipo: 'data', largura: 12 },
  { titulo: 'Pedido', largura: 20 },
  { titulo: 'Data do pedido', tipo: 'data', largura: 15 },
  { titulo: 'Concluído em', tipo: 'data', largura: 14 },
  { titulo: 'Dias sem pagamento', tipo: 'inteiro', largura: 12 },
  { titulo: 'Valor dos produtos (R$)', tipo: 'dinheiro', largura: 16 },
  { titulo: 'Motivo', largura: 30 },
  { titulo: 'Comissão esperada (R$)', tipo: 'dinheiro', largura: 15 },
  { titulo: 'Comissão cobrada (R$)', tipo: 'dinheiro', largura: 15 },
  { titulo: 'Taxas esperadas (R$)', tipo: 'dinheiro', largura: 14 },
  { titulo: 'Taxas cobradas (R$)', tipo: 'dinheiro', largura: 14 },
  { titulo: 'Tarifa a mais (R$)', tipo: 'dinheiro', largura: 14 },
  { titulo: 'Devolução debitada (R$)', tipo: 'dinheiro', largura: 15 },
  { titulo: 'Debitado a mais (R$)', tipo: 'dinheiro', largura: 15 },
];

/** Planilha Excel (.xlsx) com os pedidos do lote — pra anexar no chamado da Shopee. */
export function planilhaDoLote(pedidos: PedidoConferido[], chamado: { numero?: string | null; aberto_em: string }): Blob {
  const aMais = (p: PedidoConferido) =>
    (p.tarifa.comissao?.situacao === 'a_mais' ? p.tarifa.comissao.diferenca : 0) +
    (p.tarifa.taxas?.situacao === 'a_mais' ? p.tarifa.taxas.diferenca : 0);
  const linhas = pedidos.map((p) => [
    chamado.numero ?? '',
    dia(chamado.aberto_em),
    p.pedido,
    dia(p.criado_em),
    dia(p.concluido_em),
    p.pagamento === 'nao_pago' ? p.dias_desde_conclusao : null,
    p.valor_produtos,
    motivoDoChamado(p),
    p.tarifa.comissao?.esperada ?? null,
    p.tarifa.comissao?.cobrada ?? null,
    p.tarifa.taxas?.esperada ?? null,
    p.tarifa.taxas?.cobrada ?? null,
    aMais(p) > 0 ? Math.round(aMais(p) * 100) / 100 : null,
    p.devolucao?.depois || null,
    p.devolucao?.a_mais || null,
  ]);
  return planilhaXlsx(COLUNAS_LOTE, linhas, chamado.numero ? `Chamado ${chamado.numero}` : 'Chamado');
}

/** "shopee-chamado-SHP-123-2026-11-24-EMPRESA.xlsx" */
export const nomeDoArquivo = (empresa: string, chamado: { numero?: string | null; aberto_em: string }) =>
  `shopee-chamado-${chamado.numero ? `${chamado.numero}-` : ''}${chamado.aberto_em}-${empresa}`.replace(/[^\w.-]+/g, '-') + '.xlsx';

export function baixarArquivo(nome: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
