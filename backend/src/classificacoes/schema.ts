import { z } from 'zod';

const direction = z.enum(['entrada', 'saida']);
const nome = z.string().trim().min(2, 'nome muito curto').max(120);

export const classificacaoCreateSchema = z.object({
  client_id: z.string().uuid(),
  direction,
  nome,
  ativo: z.boolean().default(true),
});

export const classificacaoUpdateSchema = classificacaoCreateSchema.partial().omit({ client_id: true });

export const classificacaoListQuerySchema = z.object({
  client_id: z.string().uuid(),
  direction: direction.optional(),
});

/** Lista geral do escritório (só administrador inclui/exclui). */
export const geralCreateSchema = z.object({ direction, nome });
export const geralListQuerySchema = z.object({ direction: direction.optional() });

/** Itens da lista geral que entram na lista própria (do grupo de empresas). */
export const daListaGeralSchema = z.object({
  client_id: z.string().uuid(),
  geral_ids: z.array(z.string().uuid()).min(1).max(500),
});

export type ClassificacaoCreate = z.infer<typeof classificacaoCreateSchema>;
export type ClassificacaoUpdate = z.infer<typeof classificacaoUpdateSchema>;
