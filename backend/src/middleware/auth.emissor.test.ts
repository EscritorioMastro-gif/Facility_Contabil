/**
 * Incidente de 2026-10-06: a SUPABASE_URL do Render com um caractere invisível
 * no fim fazia o emissor dos tokens não bater — a JWKS recusava todo login
 * verdadeiro. Com o endereço limpo na config, o token é aceito localmente.
 */
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

// endereço "sujo" como chegou do painel: barra + espaço + quebra de linha no fim
process.env.SUPABASE_URL = 'https://example.supabase.co/ \n';

const chaves = vi.hoisted(() => ({ privada: null as unknown }));
const getUser = vi.hoisted(() => vi.fn(async () => ({ data: { user: null }, error: { message: 'não' } })));

vi.mock('jose', async (importOriginal) => {
  const jose = await importOriginal<typeof import('jose')>();
  const par = await jose.generateKeyPair('ES256');
  chaves.privada = par.privateKey;
  const jwk = { ...(await jose.exportJWK(par.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  return { ...jose, createRemoteJWKSet: () => jose.createLocalJWKSet({ keys: [jwk] }) };
});

vi.mock('../supabase.js', () => ({
  anonClient: { auth: { getUser } },
  userClient: () => ({}),
  serviceClient: null,
}));

const { SignJWT } = await import('jose');
const { config } = await import('../config.js');
const { createApp } = await import('../app.js');

describe('SUPABASE_URL com sujeira no fim', () => {
  it('a config limpa o endereço', () => {
    expect(config.supabase.url).toBe('https://example.supabase.co');
    expect(config.supabase.jwksUrl).toBe('https://example.supabase.co/auth/v1/.well-known/jwks.json');
  });

  it('token verdadeiro é aceito pela JWKS, sem perguntar pro Supabase', async () => {
    const token = await new SignJWT({ email: 'a@b.com', app_metadata: {} })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject('user-limpo')
      .setIssuer('https://example.supabase.co/auth/v1') // como o Supabase emite
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(chaves.privada as CryptoKey);
    const res = await request(createApp()).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-limpo');
    expect(getUser).not.toHaveBeenCalled();
  });
});
