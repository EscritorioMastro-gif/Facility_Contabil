import type { User } from '@supabase/supabase-js';
import { config } from '../config.js';
import { badGateway, HttpError } from './httpError.js';

/**
 * O que os dois convites por e-mail têm em comum — o do cliente (portal,
 * acessos/router.ts) e o da equipe do escritório (equipe/router.ts).
 */

/** Link do e-mail (convite ou nova senha) — sempre a tela publicada. */
export const linkSenha = () => `${config.appUrl}/definir-senha`;

/** Já criou a senha pelo link (a tela /definir-senha marca isso). */
export const senhaDefinida = (u: User | null | undefined) => u?.user_metadata?.senha_definida === true;

/** Erro do Supabase ao mandar e-mail → mensagem que diz o que conferir. */
export function erroDeEmail(acao: string, err: { message?: string; code?: string; status?: number }): HttpError {
  const msg = err.message ?? 'erro desconhecido';
  if (err.status === 429 || /rate limit/i.test(msg)) {
    return new HttpError(429, `O Supabase limitou o envio de e-mails agora — tente de novo em alguns minutos (${msg}).`);
  }
  return badGateway(
    `Não consegui ${acao}: ${msg}. Confira o servidor de e-mail (SMTP) em Supabase → Authentication → Emails.`,
  );
}
