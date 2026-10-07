import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';

// o banco responde qual é o escritório do login (public.escritorio_atual)
const banco = vi.hoisted(() => ({ escritorio: 'esc-1' as string | null }));
vi.mock('../supabase.js', () => ({
  userClient: () => ({ rpc: async () => ({ data: banco.escritorio, error: null }) }),
  anonClient: { auth: { getUser: async () => ({ data: { user: null }, error: { message: 'não' } }) } },
  serviceClient: null,
}));

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      aud: 'authenticated',
      iss: `${process.env.SUPABASE_URL}/auth/v1`,
      ...payload,
    }),
  );
  const sig = createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(`${header}.${body}`).digest();
  return `Bearer ${header}.${body}.${b64url(sig)}`;
}

const cliente = token({ sub: 'login-cliente', email: 'c@empresa.com', app_metadata: { papel: 'cliente' } });
const escritorio = token({ sub: 'escritorio-1', email: 'x@escritorio.com', app_metadata: { provider: 'email' } });

describe('login de cliente (app_metadata.papel = cliente) na API', () => {
  const app = createApp();

  it('memória, acessos e cadastro de clientes: 403', async () => {
    expect((await request(app).get('/api/rules?client_id=11111111-1111-1111-1111-111111111111').set('Authorization', cliente)).status).toBe(403);
    expect((await request(app).get('/api/acessos?client_id=11111111-1111-1111-1111-111111111111').set('Authorization', cliente)).status).toBe(403);
    expect((await request(app).post('/api/clients').set('Authorization', cliente).send({})).status).toBe(403);
    expect((await request(app).post('/api/statements/x/export').set('Authorization', cliente)).status).toBe(403);
  });

  it('login do escritório continua chegando nos routers de sempre', async () => {
    // sem client_id o router de memória responde 400 (validação dele) — prova que passou
    expect((await request(app).get('/api/rules').set('Authorization', escritorio)).status).toBe(400);
    expect((await request(app).get('/api/acessos').set('Authorization', escritorio)).status).toBe(400);
  });

  it('login do escritório que ainda não está na equipe: 403 dizendo o que fazer', async () => {
    const foraDaEquipe = token({ sub: 'fora-1', email: 'novo@escritorio.com', app_metadata: { provider: 'email' } });
    banco.escritorio = null;
    try {
      for (const rota of ['/api/clients', '/api/rules?client_id=11111111-1111-1111-1111-111111111111', '/api/equipe']) {
        const res = await request(app).get(rota).set('Authorization', foraDaEquipe);
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/equipe do escritório/);
      }
    } finally {
      banco.escritorio = 'esc-1';
    }
  });
});
