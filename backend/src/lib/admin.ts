import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../supabase.js';
import { HttpError } from './httpError.js';

/**
 * Cliente com a secret key (ignora RLS) — usado só no portal do cliente e nos
 * convites, sempre depois de o código conferir a permissão. Os testes injetam
 * `req.supabaseAdmin`; sem a chave configurada, 503 dizendo o que falta.
 */
export function adminDe(req: Request): SupabaseClient {
  const admin = req.supabaseAdmin === undefined ? serviceClient : req.supabaseAdmin;
  if (!admin) {
    throw new HttpError(
      503,
      'Acesso de clientes indisponível: falta configurar a SUPABASE_SERVICE_ROLE_KEY (secret key do Supabase) no backend.',
    );
  }
  return admin;
}
