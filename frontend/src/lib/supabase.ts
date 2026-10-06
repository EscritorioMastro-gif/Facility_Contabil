import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * A página abriu pelo link de um e-mail (convite / nova senha)? Lido ANTES de
 * criar o cliente, que limpa o endereço ao pegar a sessão do link. Sessão que
 * chega assim é nova — não pode cair no logout por inatividade.
 */
export const chegouPorLinkDeEmail =
  typeof window !== 'undefined' &&
  /(access_token|token_hash)=|type=(invite|recovery|magiclink|signup)/.test(
    `${window.location.hash}&${window.location.search}`,
  );

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
