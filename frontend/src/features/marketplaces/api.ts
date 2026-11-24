import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Conferência de pedidos da Shopee (backend/src/marketplaces). */

export type SituacaoPagamento = 'pago' | 'aguardando' | 'nao_pago' | 'em_andamento' | 'devolvido' | 'cancelado';
export type SituacaoTarifa = 'ok' | 'cobrado_a_mais' | 'cobrado_a_menos' | 'sem_tabela' | 'tabela_ambigua' | 'sem_repasse';
export type ParteTarifa = { esperada: number; cobrada: number; diferenca: number; situacao: 'ok' | 'a_mais' | 'a_menos' };
export type TaxasEsperadas = { comissao: number; transacao: number; campanha: number; por_item: number; por_pedido: number; itens: number };

/** O chamado em que o pedido entrou (cada pedido entra em um só). */
export type InfoChamado = {
  id: string;
  numero: string | null;
  aberto_em: string;
  aberto_por_email: string;
  obs: string | null;
  resolvido_em: string | null;
};

export type Devolucao = {
  antes: number;
  depois: number;
  limite: number | null;
  compensado: number;
  situacao: 'ok' | 'debitado_a_mais' | 'sem_solicitacao';
  a_mais: number;
};

/** O pagamento desmontado pra mostrar ao cliente (custos em valor positivo, pela tarifa bruta). */
export type Extrato = {
  preco: number;
  devolvido_antes: number;
  voucher_loja: number;
  base: number;
  comissao: number;
  transacao: number;
  campanha: number;
  por_item: number;
  devolucao_facil: number;
  cupom: number;
  desconto_taxas: number;
  frete: { comprador: number; desconto_shopee: number; transportadora: number; loja_pagou: number };
  outros: number;
  liquido: number;
  debito_devolucao: number;
  compensacao: number;
};

export type PedidoConferido = {
  pedido: string;
  status: string;
  status_marketplace: string | null;
  motivo_cancelamento: string | null;
  pagamento: SituacaoPagamento;
  dias_desde_conclusao: number | null;
  recebido: number;
  recebido_final: number;
  pago_em: string | null;
  tarifa: {
    situacao: SituacaoTarifa;
    comissao: ParteTarifa | null;
    taxas: ParteTarifa | null;
    esperado: TaxasEsperadas | null;
    itens_estimados: boolean;
    diferenca: number | null;
  };
  devolucao: Devolucao | null;
  frete_a_mais: { valor: number; esperado: number | null; real: number | null } | null;
  perdido: { situacao: 'compensado' | 'aguardando' | 'sem_compensacao'; compensado: number } | null;
  cupom: { cupom: number; desconto_taxas: number } | null;
  extrato: Extrato | null;
  chamado: 'nenhum' | 'aberto' | 'resolvido';
  criado_em: string | null;
  concluido_em: string | null;
  valor_produtos: number | null;
  itens: number;
  chamado_info: InfoChamado | null;
  chamado_resolvido_em: string | null;
  chamado_resolvido_por_email: string | null;
};

type Contagem = { pedidos: number; valor: number };
export type ResumoConferencia = {
  pedidos: number;
  por_pagamento: Record<SituacaoPagamento, number>;
  nao_pago_valor: number;
  recebido: number;
  tarifa_cobrada_a_mais: Contagem;
  comissao_a_mais: Contagem;
  taxas_a_mais: Contagem;
  tarifa_sem_tabela: number;
  devolucoes: { pedidos: number; antes: number; depois: number; debitado_a_mais: Contagem; sem_solicitacao: number };
  frete_a_mais: Contagem;
  perdidos: { pedidos: number; sem_compensacao: number };
};

export type Conferencia = {
  escopo: Escopo['escopo'];
  mes: string | null;
  de: string | null;
  ate: string | null;
  tabela: { preenchida: boolean; por_email: string | null; em: string | null };
  resumo: ResumoConferencia;
  pedidos: PedidoConferido[];
};

/** Quais pedidos: os do mês, os criados num período (datas), os pendentes sem chamado (180 dias) ou os de um chamado. */
export type Escopo =
  | { escopo: 'mes'; mes: string }
  | { escopo: 'periodo'; de: string; ate: string }
  | { escopo: 'pendentes' }
  | { escopo: 'chamado'; chamado_id: string };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** O escopo dá pra consultar? (mês e datas no formato, início antes do fim) */
export const escopoValido = (e: Escopo) =>
  e.escopo === 'mes' ? /^\d{4}-\d{2}$/.test(e.mes) : e.escopo === 'periodo' ? DATA.test(e.de) && DATA.test(e.ate) && e.de <= e.ate : true;

export type Chamado = InfoChamado & {
  resolvido_por_email: string | null;
  created_at: string;
  pedidos: number;
  valor: number;
  pagos: number;
  resolvidos: number;
  /** resolvido = o lote marcado; concluido = todos os pedidos pagos/resolvidos */
  situacao: 'aberto' | 'resolvido' | 'concluido';
};

export type LinhaTarifa = {
  id: string;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  preco_min: number;
  preco_max: number | null;
  comissao_pct: number;
  transacao_pct: number;
  campanha_pct: number;
  por_item: number;
  por_pedido: number;
  obs: string | null;
  preenchido_por_email: string;
  preenchido_em: string;
};

export type Tarifas = {
  tarifas: LinhaTarifa[];
  pode_editar: boolean;
  /** cliente: em quantas empresas a tabela vale */
  empresas?: number;
  /** escritório: quem preencheu a tabela que vale pra empresa */
  preenchido_por_email?: string | null;
  preenchido_em?: string | null;
  sem_login?: boolean;
};

export type NovaTarifa = Omit<LinhaTarifa, 'id' | 'preenchido_por_email' | 'preenchido_em'> & { id?: string };

export type TipoRelatorio = 'pedidos' | 'renda' | 'carteira';
export type Importado = { arquivo: string; tipo: TipoRelatorio; loja: string | null; periodo: { de: string; ate: string } | null; linhas: number };
export type Importacao = {
  id: string;
  tipo: TipoRelatorio;
  arquivo: string;
  loja: string | null;
  periodo_de: string | null;
  periodo_ate: string | null;
  linhas: number;
  importado_por_email: string;
  importado_em: string;
};

export const CATEGORIAS_CUSTO = [
  'comissao',
  'transacao',
  'campanha',
  'por_item',
  'devolucao_facil',
  'voucher_loja',
  'cupom_shopee',
  'frete_a_mais',
  'anuncios',
  'penalidade',
  'difal',
  'outros',
] as const;
export type CategoriaCusto = (typeof CATEGORIAS_CUSTO)[number];

export type CustosMes = {
  mes: string;
  pedidos: number;
  itens: number;
  itens_sem_dado: number;
  vendas: number;
  devolvido: number;
  vendas_liquidas: number;
  compensacao: number;
  custos: Record<CategoriaCusto, number>;
  total_custos: number;
  recebido: number;
  carteira: number;
  saques: number;
  sem_detalhe: { pedidos: number; valor: number };
  fecha: boolean;
  diferenca: number;
  saldo: { quebras: number; valor: number };
  aplicadas: Record<'comissao' | 'transacao' | 'campanha' | 'por_item' | 'por_pedido', Record<string, number>>;
};
export type TaxasAtuais = { comissao: number; transacao: number; campanha: number; por_item: number; por_pedido: number; desde: string };
export type Custos = { de: string; ate: string; meses: CustosMes[]; total: CustosMes; taxas_atuais: TaxasAtuais | null; sem_carteira: boolean };

const BASE = '/api/marketplaces/shopee';
const CHAVE = ['marketplaces', 'shopee'] as const;

export function conferenciaUrl(clientId: string, e: Escopo) {
  const p = new URLSearchParams({ client_id: clientId, escopo: e.escopo });
  if (e.escopo === 'mes') p.set('mes', e.mes);
  if (e.escopo === 'periodo') {
    p.set('de', e.de);
    p.set('ate', e.ate);
  }
  if (e.escopo === 'chamado') p.set('chamado_id', e.chamado_id);
  return `${BASE}/conferencia?${p}`;
}

export function useConferenciaShopee(clientId: string, e: Escopo, enabled = true) {
  return useQuery({
    queryKey: [...CHAVE, 'conferencia', clientId, e],
    queryFn: () => api<Conferencia>(conferenciaUrl(clientId, e)),
    enabled: enabled && !!clientId && escopoValido(e),
  });
}

/** Os pedidos de um chamado (pra baixar a planilha do lote de novo). */
export const buscarPedidosDoChamado = (clientId: string, chamadoId: string) =>
  api<Conferencia>(conferenciaUrl(clientId, { escopo: 'chamado', chamado_id: chamadoId }));

export function useCustosShopee(clientId: string, de: string, ate: string) {
  return useQuery({
    queryKey: [...CHAVE, 'custos', clientId, de, ate],
    queryFn: () => api<Custos>(`${BASE}/custos?${new URLSearchParams({ client_id: clientId, de, ate })}`),
    enabled: !!clientId && /^\d{4}-\d{2}$/.test(de) && /^\d{4}-\d{2}$/.test(ate) && de <= ate,
  });
}

export function useImportacoesShopee(clientId: string) {
  return useQuery({
    queryKey: [...CHAVE, 'importacoes', clientId],
    queryFn: () => api<{ loja: string | null; importacoes: Importacao[] }>(`${BASE}/importacoes?${new URLSearchParams({ client_id: clientId })}`),
    enabled: !!clientId,
  });
}

export function useImportarShopee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, arquivos }: { clientId: string; arquivos: File[] }) => {
      const fd = new FormData();
      fd.set('client_id', clientId);
      for (const f of arquivos) fd.append('arquivos', f);
      return api<{ importados: Importado[]; loja: string | null }>(`${BASE}/importar`, { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useChamadosShopee(clientId: string) {
  return useQuery({
    queryKey: [...CHAVE, 'chamados', clientId],
    queryFn: () => api<{ chamados: Chamado[] }>(`${BASE}/chamados?${new URLSearchParams({ client_id: clientId })}`),
    select: (d) => d.chamados,
    enabled: !!clientId,
  });
}

export type NovoChamado = { client_id: string; pedidos: string[]; numero?: string | null; aberto_em: string; obs?: string | null };

export function useAbrirChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NovoChamado) =>
      api<{ chamado: { id: string; pedidos: number } }>(`${BASE}/chamados`, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useAlterarChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; numero?: string | null; obs?: string | null; acao?: 'resolver' | 'reabrir' }) =>
      api(`${BASE}/chamados/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function usePedidoDoChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; pedido: string; acao: 'resolver' | 'reabrir' | 'tirar' }) =>
      api(`${BASE}/chamados/${id}/pedido`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

export function useExcluirChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`${BASE}/chamados/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}

/** Cliente: a tabela do próprio login (sem empresa). Escritório: a que vale pra empresa escolhida. */
export function useTarifasShopee(clientId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...CHAVE, 'tarifas', clientId ?? 'minha'],
    queryFn: () => api<Tarifas>(`${BASE}/tarifas${clientId ? `?${new URLSearchParams({ client_id: clientId })}` : ''}`),
    enabled,
  });
}

export function useSalvarTarifas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tarifas: NovaTarifa[]) => api<Tarifas>(`${BASE}/tarifas`, { method: 'PUT', body: { tarifas } }),
    onSuccess: (data) => {
      qc.setQueryData([...CHAVE, 'tarifas', 'minha'], data);
      qc.invalidateQueries({ queryKey: CHAVE });
    },
  });
}
