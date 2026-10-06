import type { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, decodeJwt, errors as joseErrors } from 'jose';
import { config } from '../config.js';
import { anonClient, userClient } from '../supabase.js';
import { HttpError, unauthorized } from '../lib/httpError.js';
import { ipDoCliente } from '../lib/ip.js';
import { logger } from '../lib/logger.js';

type Papel = 'escritorio' | 'cliente';
type Identity = { userId: string; email: string | null; papel: Papel };
/** Identidade + quando o token expira (ms) — o cache nunca passa disso. */
type Verificado = Identity & { expiraEm: number };
type CacheEntry = Identity & { exp: number };

const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5000;

// 10 s: a API do plano free acorda devagar e o 1º download do JWKS pode demorar
const jwks = createRemoteJWKSet(new URL(config.supabase.jwksUrl), { timeoutDuration: 10_000 });
const expectedIssuer = `${config.supabase.url}/auth/v1`;
const AUDIENCE = 'authenticated';

/** Login de cliente (portal) = app_metadata.papel 'cliente' — só o backend, com a
 *  secret key, consegue gravar app_metadata. Qualquer outro login é do escritório. */
function papelDe(appMetadata: unknown): Papel {
  const papel = (appMetadata as { papel?: unknown } | null | undefined)?.papel;
  return papel === 'cliente' ? 'cliente' : 'escritorio';
}

function decodeSegment(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
}

/** A JWKS não confirmou o token (chaves fora do ar, ou recusa) — quem decide é o Supabase. */
class JwksNaoConfirmou extends Error {}

/**
 * Verificação assimétrica (ES256/RS256) via JWKS — o caminho rápido, sem rede.
 * Só token VENCIDO é recusado direto. Qualquer outra recusa vai pro Supabase
 * conferir (é a palavra final): em produção (2026-10-06) a JWKS chegou a
 * recusar tokens verdadeiros e o login de todo mundo caiu. Inundação de token
 * inventado pra cima do Supabase é barrada pelo bloqueio por IP (requireAuth).
 */
async function verifyJwks(token: string): Promise<Verificado | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: expectedIssuer,
      audience: AUDIENCE,
      algorithms: ['ES256', 'RS256', 'EdDSA'],
    });
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.exp !== 'number') return null;
    return {
      userId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      papel: papelDe(payload.app_metadata),
      expiraEm: payload.exp * 1000,
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return null; // vencido é definitivo
    let motivo = err instanceof joseErrors.JOSEError ? err.code : (err as Error).message;
    // qual dado não bateu (iss/aud/nbf) — nunca o valor do token
    if (err instanceof joseErrors.JWTClaimValidationFailed) motivo += ` (${err.claim}: ${err.reason})`;
    throw new JwksNaoConfirmou(motivo);
  }
}

/** Avisa no log (uma vez por processo) que a JWKS recusou um token que o Supabase aceitou. */
let avisouJwks = false;
function avisarJwksDivergente(motivo: string): void {
  if (avisouJwks) return;
  avisouJwks = true;
  logger.warn(
    { motivo, emissorEsperado: JSON.stringify(expectedIssuer) },
    'JWKS recusou um token que o Supabase aceitou — conferir chaves/emissor do projeto',
  );
}

/** Verificação simétrica HS256 (projetos legados, só com SUPABASE_JWT_SECRET). */
function verifyHs256(token: string): Verificado | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', config.supabase.jwtSecret)
    .update(`${header}.${payload}`)
    .digest();
  const got = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  let claims: Record<string, unknown>;
  try {
    claims = decodeSegment(payload);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  // sem exp = token que nunca venceria; aud/iss evitam aceitar token de outro uso
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;
  if (claims.aud !== AUDIENCE || claims.iss !== expectedIssuer) return null;
  if (typeof claims.sub !== 'string' || claims.sub === '') return null;
  return {
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    papel: papelDe(claims.app_metadata),
    expiraEm: claims.exp * 1000,
  };
}

/** Pergunta pra API de Auth do Supabase (a anon key basta). Só como reserva. */
async function verifyRemote(token: string): Promise<Verificado | null> {
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;
  let expiraEm = Date.now() + CACHE_TTL_MS;
  try {
    const exp = decodeJwt(token).exp; // o Supabase acabou de validar o token
    if (typeof exp === 'number') expiraEm = exp * 1000;
  } catch {
    /* fica o TTL padrão */
  }
  return { userId: data.user.id, email: data.user.email ?? null, papel: papelDe(data.user.app_metadata), expiraEm };
}

async function resolveIdentity(token: string): Promise<Verificado | null> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return null; // nem parece um JWT
  }

  if (alg === 'HS256') {
    if (config.supabase.jwtSecret) return verifyHs256(token);
    // projeto legado sem o secret configurado: só o Supabase sabe conferir
    return verifyRemote(token);
  }

  // ES256 / RS256 / EdDSA -> JWKS; se ela não confirmar, o Supabase decide
  try {
    return await verifyJwks(token);
  } catch (err) {
    if (!(err instanceof JwksNaoConfirmou)) throw err;
    const remoto = await verifyRemote(token);
    if (remoto) avisarJwksDivergente(err.message);
    return remoto;
  }
}

// --------------------------------------------------------------------------- #
// Tentativas com token inválido, por IP: quem erra demais leva 429 sem que o
// token nem seja conferido (barra força bruta e inundação da API de Auth).
// --------------------------------------------------------------------------- #
const FALHAS_JANELA_MS = 5 * 60_000;
const FALHAS_MAX = 30;
const falhasPorIp = new Map<string, { inicio: number; n: number }>();

function bloqueado(ip: string, agora: number): boolean {
  const f = falhasPorIp.get(ip);
  return !!f && agora - f.inicio < FALHAS_JANELA_MS && f.n >= FALHAS_MAX;
}

function registrarFalha(ip: string, agora: number): void {
  if (falhasPorIp.size > 20_000) falhasPorIp.clear();
  const f = falhasPorIp.get(ip);
  if (!f || agora - f.inicio >= FALHAS_JANELA_MS) falhasPorIp.set(ip, { inicio: agora, n: 1 });
  else f.n += 1;
}

/** Só pros testes: zera o contador de falhas e o cache. */
export function _limparEstadoDeAuth(): void {
  falhasPorIp.clear();
  tokenCache.clear();
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const ip = ipDoCliente(req);
  const agora = Date.now();
  try {
    if (bloqueado(ip, agora)) {
      throw new HttpError(429, 'Muitas tentativas com login inválido — espere alguns minutos.');
    }
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) throw unauthorized('Token ausente (header Authorization: Bearer ...)');
    const token = match[1]!.trim();

    const cached = tokenCache.get(token);
    let identity: Identity | null =
      cached && cached.exp > agora ? { userId: cached.userId, email: cached.email, papel: cached.papel } : null;

    if (!identity) {
      const verificado = await resolveIdentity(token);
      if (!verificado) {
        registrarFalha(ip, agora);
        throw unauthorized('Token inválido ou expirado');
      }
      const { expiraEm, ...id } = verificado;
      identity = id;
      if (tokenCache.size > CACHE_MAX) tokenCache.clear();
      // nunca guarda além do vencimento do próprio token
      tokenCache.set(token, { ...id, exp: Math.min(agora + CACHE_TTL_MS, expiraEm) });
    }

    req.auth = { ...identity, token };
    req.supabase = userClient(token);
    next();
  } catch (err) {
    next(err);
  }
}
