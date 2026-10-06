/** Barreiras gerais da API: cabeçalhos, CORS, log sem token, corpo só depois do login, limites. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createApp, serializadoresDeLog } from './app.js';
import { limitador } from './middleware/limite.js';
import { errorHandler } from './middleware/error.js';
import { _limparEstadoDeAuth } from './middleware/auth.js';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tokenValido(): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({
      sub: 'user-seg',
      aud: 'authenticated',
      iss: `${process.env.SUPABASE_URL}/auth/v1`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const sig = createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

describe('cabeçalhos e CORS', () => {
  const app = createApp();

  it('não anuncia o Express, não deixa emoldurar nem guardar em cache', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('CORS: só a tela do sistema, e ela consegue ler o nome do arquivo do Domínio', async () => {
    const tela = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(tela.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(tela.headers['access-control-expose-headers']).toContain('Content-Disposition');
    expect(tela.headers['access-control-allow-credentials']).toBeUndefined();

    const estranho = await request(app).get('/api/health').set('Origin', 'https://site-malicioso.example');
    expect(estranho.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('log', () => {
  it('não grava o token de login nem a query string', () => {
    const r = serializadoresDeLog.req({
      id: 1,
      method: 'GET',
      url: '/api/clients?q=EMPRESA%20X',
      headers: { authorization: 'Bearer segredo' },
    } as never);
    expect(JSON.stringify(r)).not.toContain('segredo');
    expect(JSON.stringify(r)).not.toContain('EMPRESA');
    expect(r).toEqual({ id: 1, method: 'GET', url: '/api/clients' });
  });
});

describe('corpo da requisição', () => {
  afterEach(() => _limparEstadoDeAuth());

  it('sem login, o corpo nem é lido (JSON quebrado dá 401, não 400)', async () => {
    const app = createApp();
    // se o corpo fosse lido antes do login, o JSON inválido daria 400
    const res = await request(app)
      .post('/api/clients')
      .set('Content-Type', 'application/json')
      .send('{"quebrado": ');
    expect(res.status).toBe(401);
  });

  it('com login, corpo acima de 1 MB é recusado (413) nas rotas comuns', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${tokenValido()}`)
      .send({ razao_social: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('limitador', () => {
  function appCom(lim: ReturnType<typeof limitador>) {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/x', lim, (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    return app;
  }

  it('estoura a cota com 429 + Retry-After e libera na janela seguinte', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const lim = limitador({ janelaMs: 60_000, maximo: 2, chave: () => 'k', mensagem: 'devagar' });
      const app = appCom(lim);
      expect((await request(app).get('/x')).status).toBe(200);
      expect((await request(app).get('/x')).status).toBe(200);
      const barrado = await request(app).get('/x');
      expect(barrado.status).toBe(429);
      expect(barrado.body.error).toBe('devagar');
      expect(Number(barrado.headers['retry-after'])).toBeGreaterThan(0);

      vi.setSystemTime(Date.now() + 61_000);
      expect((await request(app).get('/x')).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cada chave tem a própria cota', async () => {
    const lim = limitador({
      janelaMs: 60_000,
      maximo: 1,
      chave: (req) => String(req.query.u),
      mensagem: 'devagar',
    });
    const app = appCom(lim);
    expect((await request(app).get('/x?u=a')).status).toBe(200);
    expect((await request(app).get('/x?u=a')).status).toBe(429);
    expect((await request(app).get('/x?u=b')).status).toBe(200);
  });
});
