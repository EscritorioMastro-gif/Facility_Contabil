import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { esquecerEscritorio, exigirEscritorio, FORA_DA_EQUIPE } from './escritorio.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase } from '../test/fakeSupabase.js';

/** `escritorio` = o que public.escritorio_atual() responde; `membros` = tamanho da equipe (secret key). */
function montar(opts: { escritorio: string | null; membros?: number; comSecretKey?: boolean }) {
  const rpc = vi.fn(() => ({ data: opts.escritorio, error: null }));
  const usuario = makeFakeSupabase(() => ({ data: null, error: null }), undefined, rpc);
  const inclusoes: unknown[] = [];
  const admin = makeFakeSupabase((op) => {
    if (op.verb === 'insert') {
      inclusoes.push(op.payload);
      return { data: null, error: null };
    }
    return { data: null, error: null, count: opts.membros ?? 1 };
  });
  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: 'login-1', email: 'a@b.com', token: 't' };
    req.supabase = usuario.client;
    req.supabaseAdmin = opts.comSecretKey === false ? null : (admin.client as SupabaseClient);
    next();
  });
  app.get('/x', exigirEscritorio, (req, res) => {
    res.json({ escritorio: req.escritorioId });
  });
  app.use(errorHandler);
  return { app, rpc, inclusoes };
}

beforeEach(() => esquecerEscritorio());

describe('exigirEscritorio', () => {
  it('descobre o escritório do login e guarda por um minuto', async () => {
    const { app, rpc } = montar({ escritorio: 'esc-1' });
    expect((await request(app).get('/x')).body).toEqual({ escritorio: 'esc-1' });
    expect((await request(app).get('/x')).body).toEqual({ escritorio: 'esc-1' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toMatchObject({ fn: 'escritorio_atual' });
  });

  it('login fora da equipe: 403 explicando o que fazer, sem mexer na equipe', async () => {
    const { app, inclusoes } = montar({ escritorio: null, membros: 2 });
    const res = await request(app).get('/x');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(FORA_DA_EQUIPE);
    expect(inclusoes).toHaveLength(0);
  });

  it('banco novo (equipe vazia): o 1º login a usar o sistema vira a conta principal', async () => {
    const { app, inclusoes } = montar({ escritorio: null, membros: 0 });
    const res = await request(app).get('/x');
    expect(res.body).toEqual({ escritorio: 'login-1' });
    expect(inclusoes).toEqual([{ user_id: 'login-1', escritorio_id: 'login-1', admin: true }]);
  });

  it('sem a secret key não inaugura nada: 403', async () => {
    const { app, inclusoes } = montar({ escritorio: null, membros: 0, comSecretKey: false });
    expect((await request(app).get('/x')).status).toBe(403);
    expect(inclusoes).toHaveLength(0);
  });
});
