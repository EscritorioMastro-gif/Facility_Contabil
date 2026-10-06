/**
 * Portal do cliente — quem pode ver o quê.
 *
 * O login de cliente não toca o banco direto (as regras "sem_login_de_cliente"
 * da migration 0020 barram): o backend atende com a secret key e TODA leitura
 * ou gravação passa antes por aqui, conferindo se a empresa está liberada pro
 * login em `cliente_acessos`. Empresa inativa no cadastro some do portal.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { mapPgrstError } from '../lib/pgrst.js';
import { notFound } from '../lib/httpError.js';

export type Empresa = {
  id: string;
  owner_id: string;
  razao_social: string;
  cnpj: string;
  hist_code_entrada: string;
  hist_code_saida: string;
  saldo_inicial: string | number | null;
  created_at: string;
  updated_at: string;
};

const EMPRESA_COLS =
  'id, owner_id, razao_social, cnpj, hist_code_entrada, hist_code_saida, saldo_inicial, created_at, updated_at';

const uuid = z.string().uuid();

/** Empresas ativas liberadas pro login do cliente, em ordem alfabética. */
export async function empresasDoLogin(admin: SupabaseClient, userId: string): Promise<Empresa[]> {
  const { data: acessos, error } = await admin.from('cliente_acessos').select('client_id').eq('user_id', userId);
  if (error) throw mapPgrstError(error, 'ler as empresas do login');
  const ids = [...new Set((acessos ?? []).map((a) => a.client_id as string))];
  if (!ids.length) return [];

  const { data, error: cErr } = await admin
    .from('clients')
    .select(EMPRESA_COLS)
    .in('id', ids)
    .eq('ativo', true)
    .order('razao_social');
  if (cErr) throw mapPgrstError(cErr, 'ler as empresas do login');
  return (data ?? []) as Empresa[];
}

/** A empresa, se estiver liberada pro login (e ativa) — senão 404, sem revelar se existe. */
export async function exigirEmpresa(admin: SupabaseClient, userId: string, clientId: string): Promise<Empresa> {
  if (!uuid.safeParse(clientId).success) throw notFound('Empresa não encontrada');

  const { data: acesso, error } = await admin
    .from('cliente_acessos')
    .select('id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw mapPgrstError(error, 'conferir o acesso à empresa');
  if (!acesso) throw notFound('Empresa não encontrada');

  const { data: empresa, error: cErr } = await admin
    .from('clients')
    .select(EMPRESA_COLS)
    .eq('id', clientId)
    .eq('ativo', true)
    .maybeSingle();
  if (cErr) throw mapPgrstError(cErr, 'ler a empresa');
  if (!empresa) throw notFound('Empresa não encontrada');
  return empresa as Empresa;
}
