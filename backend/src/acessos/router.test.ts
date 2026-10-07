import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { acessosRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeOp } from '../test/fakeSupabase.js';

const ESCRITORIO = 'escritorio-1';
const CID = '11111111-1111-1111-1111-111111111111';
const LINK = 'http://localhost:5173/definir-senha'; // APP_URL cai no FRONTEND_ORIGIN dos testes

type Usuario = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  email_confirmed_at: string | null;
};

/** Auth admin falso do Supabase: guarda os logins e registra cada chamada. */
function authFalso(inicial: Usuario[] = [], falhas: { convite?: string; criar?: string; codigoCriar?: string } = {}) {
  const usuarios = new Map(inicial.map((u) => [u.id, u]));
  const chamadas: Array<[string, unknown]> = [];
  let seq = 0;
  const admin = {
    createUser: vi.fn(async (p: { email: string; app_metadata: Record<string, unknown> }) => {
      chamadas.push(['createUser', p]);
      if (falhas.criar) return { data: { user: null }, error: { message: falhas.criar, code: falhas.codigoCriar } };
      const u: Usuario = { id: `novo-${++seq}`, email: p.email, app_metadata: p.app_metadata, user_metadata: {}, email_confirmed_at: null };
      usuarios.set(u.id, u);
      return { data: { user: u }, error: null };
    }),
    inviteUserByEmail: vi.fn(async (email: string, opts: unknown) => {
      chamadas.push(['inviteUserByEmail', { email, opts }]);
      return falhas.convite ? { data: { user: null }, error: { message: falhas.convite, status: 500 } } : { data: {}, error: null };
    }),
    getUserById: vi.fn(async (id: string) => ({ data: { user: usuarios.get(id) ?? null }, error: null })),
    deleteUser: vi.fn(async (id: string) => {
      chamadas.push(['deleteUser', id]);
      usuarios.delete(id);
      return { data: {}, error: null };
    }),
  };
  const resetPasswordForEmail = vi.fn(async (email: string, opts: unknown) => {
    chamadas.push(['resetPasswordForEmail', { email, opts }]);
    return { data: {}, error: null };
  });
  return { admin, resetPasswordForEmail, chamadas, usuarios };
}

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

/**
 * `escritorio` = banco visto pelo escritório (RLS: só o que é dele);
 * `todos` = cliente_acessos de todos os escritórios (o que a secret key enxerga).
 */
function montar(opts: {
  clienteDoEscritorio?: boolean;
  acessos?: Array<Record<string, unknown>>;
  usuarios?: Usuario[];
  falhas?: Parameters<typeof authFalso>[1];
  erroInsert?: string;
}) {
  const acessos = opts.acessos ?? [];
  const auth = authFalso(opts.usuarios, opts.falhas);

  const escritorio = makeFakeSupabase((op) => {
    if (op.table === 'clients') return { data: opts.clienteDoEscritorio === false ? null : { id: CID }, error: null };
    if (op.table === 'cliente_acessos') {
      if (op.verb === 'insert') {
        if (opts.erroInsert) return { data: null, error: { code: opts.erroInsert, message: 'x' } };
        return { data: { id: 'ac-novo', ...(op.payload as object) }, error: null };
      }
      if (op.verb === 'delete') return { data: null, error: null };
      const id = filtro(op, 'id');
      if (id) return { data: acessos.find((a) => a.id === id) ?? null, error: null };
      const userIds = filtro(op, 'user_id') as string[] | undefined;
      if (userIds) {
        return { data: acessos.filter((a) => userIds.includes(a.user_id as string)).map((a) => ({ ...a, client: { razao_social: `EMPRESA ${a.client_id}` } })), error: null };
      }
      return { data: acessos.filter((a) => a.client_id === filtro(op, 'client_id')), error: null };
    }
    return { data: null, error: null };
  });

  const todos = makeFakeSupabase((op) => {
    if (op.table === 'cliente_acessos') {
      const email = filtro(op, 'email');
      if (email) return { data: acessos.find((a) => a.email === email) ?? null, error: null };
      const userId = filtro(op, 'user_id');
      // contagem dos acessos que sobraram do login (o removido já saiu)
      return { data: null, error: null, count: acessos.filter((a) => a.user_id === userId && a.id !== 'ac-removido').length };
    }
    return { data: null, error: null };
  });
  const admin = Object.assign(todos.client, { auth: { admin: auth.admin, resetPasswordForEmail: auth.resetPasswordForEmail } });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: ESCRITORIO, email: 'x@escritorio.com', token: 't' };
    req.escritorioId = ESCRITORIO;
    req.supabase = escritorio.client;
    req.supabaseAdmin = admin as unknown as SupabaseClient;
    next();
  });
  app.use('/acessos', acessosRouter);
  app.use(errorHandler);
  return { app, ops: escritorio.ops, auth };
}

const usuario = (id: string, email: string, extra: Partial<Usuario> = {}): Usuario => ({
  id,
  email,
  app_metadata: { papel: 'cliente' },
  user_metadata: {},
  email_confirmed_at: null,
  ...extra,
});

describe('POST /acessos — liberar o portal', () => {
  it('e-mail novo: cria o login JÁ como cliente, manda o convite e libera a empresa', async () => {
    const { app, ops, auth } = montar({});
    const res = await request(app).post('/acessos').send({ client_id: CID, email: '  Cliente@Empresa.com ' });
    expect(res.status).toBe(201);
    expect(res.body.convite_enviado).toBe(true);

    expect(auth.chamadas.map(([nome]) => nome)).toEqual(['createUser', 'inviteUserByEmail']);
    expect(auth.admin.createUser).toHaveBeenCalledWith({
      email: 'cliente@empresa.com',
      email_confirm: false,
      app_metadata: { papel: 'cliente' },
    });
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledWith('cliente@empresa.com', { redirectTo: LINK });
    const insert = ops.find((o) => o.table === 'cliente_acessos' && o.verb === 'insert')!.payload;
    expect(insert).toEqual({ owner_id: ESCRITORIO, client_id: CID, user_id: 'novo-1', email: 'cliente@empresa.com' });
  });

  it('e-mail que já é login de cliente: só ganha mais uma empresa, sem novo convite', async () => {
    const { app, ops, auth } = montar({
      acessos: [{ id: 'ac-1', client_id: 'outra-empresa', user_id: 'u-1', email: 'cliente@empresa.com' }],
      usuarios: [usuario('u-1', 'cliente@empresa.com')],
    });
    const res = await request(app).post('/acessos').send({ client_id: CID, email: 'cliente@empresa.com' });
    expect(res.status).toBe(201);
    expect(res.body.convite_enviado).toBe(false);
    expect(auth.admin.createUser).not.toHaveBeenCalled();
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(ops.find((o) => o.verb === 'insert')!.payload).toMatchObject({ user_id: 'u-1', client_id: CID });
  });

  it('e-mail de um login do escritório: recusa sem convidar', async () => {
    const { app, auth } = montar({
      falhas: { criar: 'A user with this email address has already been registered', codigoCriar: 'email_exists' },
    });
    const res = await request(app).post('/acessos').send({ client_id: CID, email: 'socio@escritorio.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/login do escritório/);
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('convite não saiu (SMTP): apaga o login criado e explica', async () => {
    const { app, ops, auth } = montar({ falhas: { convite: 'Email address not authorized' } });
    const res = await request(app).post('/acessos').send({ client_id: CID, email: 'cliente@empresa.com' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/SMTP/);
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('novo-1');
    expect(ops.some((o) => o.verb === 'insert')).toBe(false);
  });

  it('login já tinha essa empresa: 409 (e não apaga o login de ninguém)', async () => {
    const { app, auth } = montar({
      acessos: [{ id: 'ac-1', client_id: CID, user_id: 'u-1', email: 'cliente@empresa.com' }],
      usuarios: [usuario('u-1', 'cliente@empresa.com')],
      erroInsert: '23505',
    });
    const res = await request(app).post('/acessos').send({ client_id: CID, email: 'cliente@empresa.com' });
    expect(res.status).toBe(409);
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('cliente que não é do escritório: 404, sem criar login', async () => {
    const { app, auth } = montar({ clienteDoEscritorio: false });
    const res = await request(app).post('/acessos').send({ client_id: CID, email: 'cliente@empresa.com' });
    expect(res.status).toBe(404);
    expect(auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('e-mail inválido: 400', async () => {
    const { app } = montar({});
    expect((await request(app).post('/acessos').send({ client_id: CID, email: 'nao-e-email' })).status).toBe(400);
  });
});

describe('GET /acessos', () => {
  it('lista com a situação do convite e todas as empresas do login', async () => {
    const { app } = montar({
      acessos: [
        { id: 'ac-1', client_id: CID, user_id: 'u-1', email: 'a@x.com', created_at: '2026-10-01' },
        { id: 'ac-2', client_id: 'outra', user_id: 'u-1', email: 'a@x.com', created_at: '2026-10-02' },
        { id: 'ac-3', client_id: CID, user_id: 'u-2', email: 'b@x.com', created_at: '2026-10-03' },
      ],
      usuarios: [usuario('u-1', 'a@x.com', { user_metadata: { senha_definida: true } }), usuario('u-2', 'b@x.com')],
    });
    const res = await request(app).get(`/acessos?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.acessos).toHaveLength(2);
    expect(res.body.acessos[0]).toMatchObject({ email: 'a@x.com', status: 'ativo' });
    expect(res.body.acessos[0].empresas.map((e: { id: string }) => e.id)).toEqual([CID, 'outra']);
    expect(res.body.acessos[1]).toMatchObject({ email: 'b@x.com', status: 'convite_pendente' });
  });
});

describe('POST /acessos/:id/reenviar', () => {
  it('convite ainda não aceito: reenvia o convite', async () => {
    const { app, auth } = montar({
      acessos: [{ id: 'ac-1', client_id: CID, user_id: 'u-1', email: 'a@x.com' }],
      usuarios: [usuario('u-1', 'a@x.com')],
    });
    const res = await request(app).post('/acessos/ac-1/reenviar');
    expect(res.body).toEqual({ enviado: 'convite' });
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalledWith('a@x.com', { redirectTo: LINK });
  });

  it('já aceitou o convite: manda o e-mail de nova senha', async () => {
    const { app, auth } = montar({
      acessos: [{ id: 'ac-1', client_id: CID, user_id: 'u-1', email: 'a@x.com' }],
      usuarios: [usuario('u-1', 'a@x.com', { email_confirmed_at: '2026-10-05T10:00:00Z' })],
    });
    const res = await request(app).post('/acessos/ac-1/reenviar');
    expect(res.body).toEqual({ enviado: 'redefinir_senha' });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@x.com', { redirectTo: LINK });
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe('DELETE /acessos/:id', () => {
  it('última empresa do login: remove o acesso e apaga o login', async () => {
    const { app, auth } = montar({
      acessos: [{ id: 'ac-removido', client_id: CID, user_id: 'u-1', email: 'a@x.com' }],
      usuarios: [usuario('u-1', 'a@x.com')],
    });
    expect((await request(app).delete('/acessos/ac-removido')).status).toBe(204);
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('u-1');
  });

  it('login ainda tem outras empresas: só remove essa', async () => {
    const { app, auth } = montar({
      acessos: [
        { id: 'ac-removido', client_id: CID, user_id: 'u-1', email: 'a@x.com' },
        { id: 'ac-2', client_id: 'outra', user_id: 'u-1', email: 'a@x.com' },
      ],
      usuarios: [usuario('u-1', 'a@x.com')],
    });
    expect((await request(app).delete('/acessos/ac-removido')).status).toBe(204);
    expect(auth.admin.deleteUser).not.toHaveBeenCalled();
  });
});
