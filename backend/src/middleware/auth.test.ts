import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';
import { _limparEstadoDeAuth } from './auth.js';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

const ISS = `${process.env.SUPABASE_URL}/auth/v1`;
const daquiA = (s: number) => Math.floor(Date.now() / 1000) + s;

describe('requireAuth (HS256 local)', () => {
  const app = createApp();
  const secret = process.env.SUPABASE_JWT_SECRET!;
  const valido = (extra: Record<string, unknown> = {}) =>
    signHs256({ sub: 'user-123', email: 'a@b.com', aud: 'authenticated', iss: ISS, exp: daquiA(3600), ...extra }, secret);

  beforeEach(() => _limparEstadoDeAuth());

  it('aceita token HS256 válido', async () => {
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${valido()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-123', email: 'a@b.com' });
  });

  it('rejeita assinatura errada', async () => {
    const token = signHs256({ sub: 'user-123', aud: 'authenticated', iss: ISS, exp: daquiA(3600) }, 'secret-errado');
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejeita token expirado', async () => {
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${valido({ exp: daquiA(-10) })}`);
    expect(res.status).toBe(401);
  });

  it('rejeita token sem validade (exp), de outro público (aud) ou outro emissor (iss)', async () => {
    const semExp = signHs256({ sub: 'user-123', aud: 'authenticated', iss: ISS }, secret);
    for (const token of [semExp, valido({ aud: 'anon' }), valido({ iss: 'https://outro.supabase.co/auth/v1' })]) {
      const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('IP que erra o login demais leva 429 — nem o token é mais conferido', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await request(app).get('/api/me').set('Authorization', 'Bearer a.b.c');
      expect(r.status).toBe(401);
    }
    const bloqueado = await request(app).get('/api/me').set('Authorization', `Bearer ${valido()}`);
    expect(bloqueado.status).toBe(429);
  });
});
