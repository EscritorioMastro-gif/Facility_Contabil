import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Classificacao, ClassificacaoGeral, Direction, Transaction } from '@/lib/types';
import type { StatementDetail } from '@/features/statements/api';
import { anexarRespostas, type RespostasTravas } from '@/features/statements/travas';
import type { Aprovacao } from './aprovacao';

export type ClassificarResult = StatementDetail & { warnings: string[] };

export function useClassificacoes(clientId: string | undefined, direction?: Direction) {
  const params = new URLSearchParams();
  if (clientId) params.set('client_id', clientId);
  if (direction) params.set('direction', direction);
  return useQuery({
    queryKey: ['classificacoes', clientId, direction],
    queryFn: () => api<{ classificacoes: Classificacao[] }>(`/api/classificacoes?${params}`),
    select: (d) => d.classificacoes,
    enabled: !!clientId,
  });
}

export type ClassificacaoInput = { client_id: string; direction: Direction; nome: string };

export function useCreateClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClassificacaoInput) =>
      api<{ classificacao: Classificacao }>('/api/classificacoes', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

export function useUpdateClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Pick<Classificacao, 'nome' | 'ativo'>> }) =>
      api<{ classificacao: Classificacao }>(`/api/classificacoes/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

/** Tirar da lista: onde não está em uso é excluída; onde algum lançamento usa, só desativa. */
export function useDeleteClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ excluidas: number; desativadas: number }>(`/api/classificacoes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

// --------------------------------------------------------------------------- #
// Lista geral do escritório
// --------------------------------------------------------------------------- #
export function useClassificacoesGerais(direction?: Direction) {
  const params = new URLSearchParams();
  if (direction) params.set('direction', direction);
  return useQuery({
    queryKey: ['classificacoes', 'gerais', direction],
    queryFn: () =>
      api<{ gerais: ClassificacaoGeral[]; pode_editar: boolean }>(`/api/classificacoes/gerais?${params}`),
  });
}

export function useCreateGeral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { direction: Direction; nome: string }) =>
      api<{ geral: ClassificacaoGeral }>('/api/classificacoes/gerais', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes', 'gerais'] }),
  });
}

export function useDeleteGeral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/classificacoes/gerais/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes', 'gerais'] }),
  });
}

/** Itens da lista geral entram na lista própria (de todas as empresas do mesmo login de cliente). */
export function useAdicionarDaListaGeral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { client_id: string; geral_ids: string[] }) =>
      api<{ incluidas: number; reativadas: number; classificacoes: Classificacao[] }>(
        '/api/classificacoes/da-lista-geral',
        { method: 'POST', body: input },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

// --------------------------------------------------------------------------- #
// Dashboard
// --------------------------------------------------------------------------- #
export type ItemDashboard = { nome: string; total_cents: number; qtd: number; percentual: number };
export type Dashboard = {
  empresas: Array<{ id: string; razao_social: string }>;
  totais: { receitas_cents: number; despesas_cents: number; resultado_cents: number };
  receitas: ItemDashboard[];
  despesas: ItemDashboard[];
  /** receitas/despesas de cada mês: % sobre o total daquele mês */
  meses: MesDashboard[];
  pendentes: { qtd: number; total_cents: number };
};
export type MesDashboard = {
  mes: string;
  receitas_cents: number;
  despesas_cents: number;
  receitas: ItemDashboard[];
  despesas: ItemDashboard[];
};
export type FiltroDashboard = { client_id?: string; grupo?: boolean; de: string; ate: string };

/** Escritório: client_id obrigatório (grupo = todas as do mesmo cliente). Cliente: sem client_id = todas as dele. */
export function useDashboard(f: FiltroDashboard, opts: { enabled?: boolean } = {}) {
  const params = new URLSearchParams({ de: f.de, ate: f.ate });
  if (f.client_id) params.set('client_id', f.client_id);
  if (f.grupo) params.set('grupo', 'true');
  return useQuery({
    queryKey: ['classificacoes', 'dashboard', f],
    queryFn: () => api<Dashboard>(`/api/classificacoes/dashboard?${params}`),
    enabled: opts.enabled ?? true,
  });
}

export type SugestaoMemoria ={ id: string; classificacao_id: string; origem: 'memoria' | 'conferir' };

/** O que a memória sugere pros lançamentos ainda sem classificação (não grava). */
export function buscarSugestoes(statementId: string) {
  return api<{ sugestoes: SugestaoMemoria[] }>(`/api/statements/${statementId}/classificacao/sugestoes`);
}

export type CreateClassificarInput = {
  client_id: string;
  pdf_password?: string;
  file: File;
  /** respostas às travas de entrada, no reenvio (statements/travas.ts) */
  respostas?: RespostasTravas;
};

export function useCreateStatementClassificar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClassificarInput) => {
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('client_id', input.client_id);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      anexarRespostas(fd, input.respostas);
      return api<ClassificarResult>('/api/statements/classificar', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  });
}

/** Histórico das aprovações do cliente no extrato (cada parte aprovada). Chave sob 'statements': aprovar recarrega. */
export function useAprovacoes(statementId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['statements', 'aprovacoes', statementId],
    queryFn: () => api<{ aprovacoes: Aprovacao[] }>(`/api/statements/${statementId}/aprovacoes`),
    select: (d) => d.aprovacoes,
    enabled,
  });
}

/**
 * Login de cliente: "Salvar e aprovar" — declara que conferiu as classificações
 * já feitas e aprova (pode ser parte do mês). Fica registrado quem, quando e o IP.
 */
export function useAprovarClassificacao(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{ statement: StatementDetail['statement'] }>(`/api/statements/${statementId}/aprovacao`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(['statements', 'one', statementId], (cur: StatementDetail | undefined) =>
        cur ? { ...cur, statement: { ...cur.statement, ...data.statement } } : cur,
      );
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}

export function useSaveClassificacoes(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: string; classificacao_id: string | null }[]) =>
      api<{ transactions: Transaction[]; updated: number }>(
        `/api/statements/${statementId}/classificacao`,
        { method: 'PATCH', body: { updates } },
      ),
    onSuccess: (data) => {
      qc.setQueryData(['statements', 'one', statementId], (cur: StatementDetail | undefined) =>
        cur ? { ...cur, transactions: data.transactions } : cur,
      );
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}
