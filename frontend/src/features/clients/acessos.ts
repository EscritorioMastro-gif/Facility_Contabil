import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Login de cliente com acesso a uma empresa (portal — só o módulo Classificação). */
export type AcessoCliente = {
  id: string;
  client_id: string;
  user_id: string;
  email: string;
  created_at: string;
  /** 'convite_pendente' = ainda não criou a senha pelo link do e-mail */
  status: 'ativo' | 'convite_pendente';
  /** todas as empresas que esse login acessa (inclusive esta) */
  empresas: Array<{ id: string; razao_social: string }>;
};

export function useAcessos(clientId: string | undefined) {
  return useQuery({
    queryKey: ['acessos', clientId],
    queryFn: () => api<{ acessos: AcessoCliente[] }>(`/api/acessos?client_id=${clientId}`),
    select: (d) => d.acessos,
    enabled: !!clientId,
  });
}

export function useLiberarAcesso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { client_id: string; email: string }) =>
      api<{ acesso: AcessoCliente; convite_enviado: boolean }>('/api/acessos', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acessos'] }),
  });
}

export function useReenviarAcesso() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ enviado: 'convite' | 'redefinir_senha' }>(`/api/acessos/${id}/reenviar`, { method: 'POST' }),
  });
}

export function useRemoverAcesso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/acessos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acessos'] }),
  });
}
