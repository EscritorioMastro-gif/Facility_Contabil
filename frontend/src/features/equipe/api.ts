import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Pessoa da equipe do escritório — todas veem os mesmos clientes e extratos. */
export type MembroEquipe = {
  user_id: string;
  email: string;
  admin: boolean;
  /** a conta principal do escritório (dona dos dados) — não sai da equipe */
  principal: boolean;
  voce: boolean;
  /** 'convite_pendente' = ainda não criou a senha pelo link do e-mail */
  status: 'ativo' | 'convite_pendente';
  criado_em: string;
};

export function useEquipe() {
  return useQuery({
    queryKey: ['equipe'],
    queryFn: () => api<{ membros: MembroEquipe[]; souAdmin: boolean }>('/api/equipe'),
  });
}

export function useConvidarMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      api<{ convite_enviado: boolean }>('/api/equipe', { method: 'POST', body: { email } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipe'] }),
  });
}

export function useReenviarMembro() {
  return useMutation({
    mutationFn: (userId: string) =>
      api<{ enviado: 'convite' | 'redefinir_senha' }>(`/api/equipe/${userId}/reenviar`, { method: 'POST' }),
  });
}

export function useRemoverMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api(`/api/equipe/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipe'] }),
  });
}
