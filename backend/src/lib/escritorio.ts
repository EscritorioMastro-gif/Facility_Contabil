import type { NextFunction, Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { forbidden } from './httpError.js';
import { logger } from './logger.js';
import { mapPgrstError } from './pgrst.js';

/**
 * Escritório de quem está logado — o dono dos dados (migration 0022).
 *
 * Todos os logins da equipe veem e gravam no MESMO escritório: o owner_id dos
 * cadastros e a 1ª pasta dos arquivos no Storage são o id do escritório (a
 * conta principal), não o do login. A RLS do banco usa a mesma regra
 * (public.escritorio_atual()); aqui é só pra API saber qual dono gravar.
 */
const cache = new Map<string, { escritorio: string; exp: number }>();
const TTL_MS = 60_000;

export const FORA_DA_EQUIPE =
  'Seu login ainda não faz parte da equipe do escritório — peça a quem administra o sistema para incluir você em Cadastros → Equipe.';

/** Esquece o escritório guardado de um login (ex.: saiu da equipe). */
export function esquecerEscritorio(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** O escritório da requisição (posto pelo exigirEscritorio). */
export function escritorioDe(req: Request): string {
  if (!req.escritorioId) throw new Error('escritório ausente (falta o middleware exigirEscritorio)');
  return req.escritorioId;
}

/**
 * Banco novo (equipe vazia): quem usar o sistema primeiro vira a conta
 * principal — sem isso ninguém conseguiria nem abrir a tela de Equipe.
 * Precisa da secret key; sem ela, fica como "fora da equipe".
 */
async function inaugurarEscritorio(req: Request): Promise<string | null> {
  const admin = req.supabaseAdmin === undefined ? serviceClient : req.supabaseAdmin;
  if (!admin) return null;
  const { count, error } = await admin.from('escritorio_membros').select('user_id', { count: 'exact', head: true });
  if (error || count !== 0) return null;
  const userId = req.auth!.userId;
  const { error: iErr } = await admin
    .from('escritorio_membros')
    .insert({ user_id: userId, escritorio_id: userId, admin: true });
  if (iErr) return null;
  logger.info('equipe vazia: o 1º login a usar o sistema virou a conta principal do escritório');
  return userId;
}

/** Rotas do escritório: descobre o escritório do login ou responde 403. */
export async function exigirEscritorio(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.auth!.userId;
    const agora = Date.now();
    const guardado = cache.get(userId);
    if (guardado && guardado.exp > agora) {
      req.escritorioId = guardado.escritorio;
      next();
      return;
    }
    const { data, error } = await req.supabase!.rpc('escritorio_atual');
    if (error) throw mapPgrstError(error, 'identificar o escritório do login');
    const escritorio = (typeof data === 'string' && data) || (await inaugurarEscritorio(req));
    if (!escritorio) throw forbidden(FORA_DA_EQUIPE);
    if (cache.size > 5000) cache.clear();
    cache.set(userId, { escritorio, exp: agora + TTL_MS });
    req.escritorioId = escritorio;
    next();
  } catch (err) {
    next(err);
  }
}
