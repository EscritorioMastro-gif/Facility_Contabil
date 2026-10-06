/**
 * Caminho de produção: token ES256 conferido pela JWKS do Supabase. A JWKS
 * remota vira uma local (chave gerada no teste) e a consulta remota ao
 * Supabase é espionada: token inválido NUNCA pode virar chamada de rede.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const chaves = vi.hoisted(() => ({ privada: null as unknown, outra: null as unknown }));
const getUser = vi.hoisted(() => vi.fn(async () => ({ data: { user: null }, error: { message: 'não' } })));

vi.mock('jose', async (importOriginal) => {
  const jose = await importOriginal<typeof import('jose')>();
  const par = await jose.generateKeyPair('ES256');
  const outro = await jose.generateKeyPair('ES256');
  chaves.privada = par.privateKey;
  chaves.outra = outro.privateKey;
  const jwk = { ...(await jose.exportJWK(par.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  return { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [jwk] }) };
});

vi.mock('../supabase.js', () => ({
  anonClient: { auth: { getUser } },
  userClient: () => ({}),
  serviceClient: null,
}));

const { SignJWT } = await import('jose');
const { createApp } = await import('../app.js');
const { _limparEstadoDeAuth } = await import('./auth.js');

const ISS = `${process.env.SUPABASE_URL}/auth/v1`;

async function token(chave: unknown, claims: Record<string, unknown> = {}, expira = '1h') {
  return new SignJWT({ email: 'a@b.com', app_metadata: {}, ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject('user-es256')
    .setIssuer(ISS)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expira)
    .sign(chave as CryptoKey);
}

describe('requireAuth (ES256 via JWKS)', () => {
  const app = createApp();
  beforeEach(() => {
    _limparEstadoDeAuth();
    getUser.mockClear();
  });

  it('aceita token assinado pela chave do projeto', async () => {
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${await token(chaves.privada)}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-es256');
    expect(getUser).not.toHaveBeenCalled();
  });

  it('token que a JWKS não confirma vai pro Supabase decidir — forjado continua recusado', async () => {
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${await token(chaves.outra)}`);
    expect(res.status).toBe(401);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('JWKS recusa mas o Supabase aceita (visto em produção): o login entra', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-remoto', email: 'r@b.com', app_metadata: {} } },
      error: null,
    } as never);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${await token(chaves.outra)}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-remoto');
  });

  it('token vencido é recusado SEM consultar o Supabase', async () => {
    const vencido = await token(chaves.privada, {}, Math.floor(Date.now() / 1000) - 60);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${vencido}`);
    expect(res.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('papel cliente vem do app_metadata', async () => {
    const t = await token(chaves.privada, { app_metadata: { papel: 'cliente' } });
    // login de cliente não acessa a área do escritório
    const res = await request(app).get('/api/rules?client_id=00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
  });
});
