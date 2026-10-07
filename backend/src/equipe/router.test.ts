import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { equipeRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeOp } from '../test/fakeSupabase.js';

const ESC = 'aaaaaaaa-0000-0000-0000-000000000001'; // conta principal (documentos@)
const GAB = 'aaaaaaaa-0000-0000-0000-000000000002'; // administra
const ANA = 'aaaaaaaa-0000-0000-0000-000000000003'; // membro comum, convite pendente
const FORA = 'aaaaaaaa-0000-0000-0000-000000000009'; // login de escritório sem equipe
const LINK = 'http://localhost:5173/definir-senha';

type Membro = { user_id: string; escritorio_id: string; admin: boolean; criado_em?: string };
type Usuario = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
};

const usuario = (id: string, email: string, extra: Partial<Usuario> = {}): Usuario => ({
  id,
  email,
  app_metadata: { provider: 'email' },
  user_metadata: {},
  email_confirmed_at: '2026-10-06T10:00:00Z',
  last_sign_in_at: '2026-10-06T10:00:00Z',
  ...extra,
});

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

function montar(opts: { eu?: string; usuarios?: Usuario[]; falhaConvite?: string } = {}) {
  const membros: Membro[] = [
    { user_id: ESC, escritorio_id: ESC, admin: true },
    { user_id: GAB, escritorio_id: ESC, admin: true },
    { user_id: ANA, escritorio_id: ESC, admin: false },
  ];
  const usuarios = new Map(
    [
      usuario(ESC, 'documentos@escritorio.com'),
      usuario(GAB, 'gabriel@escritorio.com'),
      usuario(ANA, 'ana@escritorio.com', { email_confirmed_at: null, last_sign_in_at: null }),
      ...(opts.usuarios ?? []),
    ].map((u) => [u.id, u]),
  );
  const chamadas: Array<[string, unknown]> = [];
  let seq = 0;

  const banco = makeFakeSupabase((op) => {
    if (op.table !== 'escritorio_membros') return { data: null, error: null };
    if (op.verb === 'select') return { data: membros.filter((m) => m.escritorio_id === filtro(op, 'escritorio_id')), error: null };
    if (op.verb === 'insert') {
      const p = op.payload as Membro;
      if (membros.some((m) => m.user_id === p.user_id)) return { data: null, error: { code: '23505', message: 'duplicado' } };
      membros.push({ ...p });
      chamadas.push(['incluir', p]);
      return { data: null, error: null };
    }
    if (op.verb === 'delete') {
      const alvo = filtro(op, 'user_id');
      const i = membros.findIndex((m) => m.user_id === alvo);
      if (i >= 0) membros.splice(i, 1);
      chamadas.push(['tirar', alvo]);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });

  const authAdmin = {
    createUser: vi.fn(async (p: { email: string }) => {
      chamadas.push(['createUser', p]);
      if ([...usuarios.values()].some((u) => u.email === p.email)) {
        return { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
      }
      const u = usuario(`aaaaaaaa-0000-0000-0000-00000000010${++seq}`, p.email, { email_confirmed_at: null, last_sign_in_at: null });
      usuarios.set(u.id, u);
      return { data: { user: u }, error: null };
    }),
    inviteUserByEmail: vi.fn(async (email: string, o: unknown) => {
      chamadas.push(['inviteUserByEmail', { email, o }]);
      return opts.falhaConvite ? { data: {}, error: { message: opts.falhaConvite, status: 500 } } : { data: {}, error: null };
    }),
    getUserById: vi.fn(async (id: string) => ({ data: { user: usuarios.get(id) ?? null }, error: null })),
    deleteUser: vi.fn(async (id: string) => {
      chamadas.push(['deleteUser', id]);
      usuarios.delete(id);
      return { data: {}, error: null };
    }),
    listUsers: vi.fn(async () => ({ data: { users: [...usuarios.values()] }, error: null })),
    updateUserById: vi.fn(async (id: string, attrs: unknown) => {
      chamadas.push(['updateUserById', { id, attrs }]);
      return { data: {}, error: null };
    }),
  };
  const resetPasswordForEmail = vi.fn(async (email: string, o: unknown) => {
    chamadas.push(['resetPasswordForEmail', { email, o }]);
    return { data: {}, error: null };
  });
  const admin = Object.assign(banco.client, { auth: { admin: authAdmin, resetPasswordForEmail } });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: opts.eu ?? GAB, email: 'eu@escritorio.com', token: 't' };
    req.escritorioId = ESC;
    req.supabaseAdmin = admin as unknown as SupabaseClient;
    next();
  });
  app.use('/equipe', equipeRouter);
  app.use(errorHandler);
  return { app, chamadas, membros, authAdmin };
}

describe('GET /equipe', () => {
  it('lista a equipe com quem é a conta principal, quem é você e quem ainda não aceitou o convite', async () => {
    const { app } = montar();
    const res = await request(app).get('/equipe');
    expect(res.status).toBe(200);
    expect(res.body.souAdmin).toBe(true);
    const por = (id: string) => res.body.membros.find((m: { user_id: string }) => m.user_id === id);
    expect(por(ESC)).toMatchObject({ email: 'documentos@escritorio.com', principal: true, voce: false, status: 'ativo' });
    expect(por(GAB)).toMatchObject({ principal: false, voce: true, admin: true });
    expect(por(ANA)).toMatchObject({ admin: false, status: 'convite_pendente' });
  });
});

describe('POST /equipe — convidar', () => {
  it('e-mail novo: cria login DE ESCRITÓRIO (nunca de cliente), põe na equipe e manda o convite', async () => {
    const { app, chamadas, authAdmin } = montar();
    const res = await request(app).post('/equipe').send({ email: '  Nova@Escritorio.com ' });
    expect(res.status).toBe(201);
    expect(res.body.convite_enviado).toBe(true);
    expect(authAdmin.createUser).toHaveBeenCalledWith({ email: 'nova@escritorio.com', email_confirm: false });
    expect(chamadas.map(([n]) => n)).toEqual(['createUser', 'incluir', 'inviteUserByEmail']);
    expect(chamadas[1]![1]).toMatchObject({ escritorio_id: ESC, admin: false });
    expect(chamadas[2]![1]).toEqual({ email: 'nova@escritorio.com', o: { redirectTo: LINK } });
  });

  it('quem não administra não convida', async () => {
    const { app, authAdmin } = montar({ eu: ANA });
    const res = await request(app).post('/equipe').send({ email: 'nova@escritorio.com' });
    expect(res.status).toBe(403);
    expect(authAdmin.createUser).not.toHaveBeenCalled();
  });

  it('convite que não sai: desfaz tudo (sem login nem membro sobrando)', async () => {
    const { app, chamadas, membros } = montar({ falhaConvite: 'SMTP fora do ar' });
    const res = await request(app).post('/equipe').send({ email: 'nova@escritorio.com' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/SMTP/);
    expect(chamadas.map(([n]) => n)).toEqual(['createUser', 'incluir', 'inviteUserByEmail', 'tirar', 'deleteUser']);
    expect(membros).toHaveLength(3);
  });

  it('e-mail de login de CLIENTE não entra na equipe', async () => {
    const cliente = usuario('aaaaaaaa-0000-0000-0000-000000000077', 'cliente@empresa.com', { app_metadata: { papel: 'cliente' } });
    const { app, chamadas } = montar({ usuarios: [cliente] });
    const res = await request(app).post('/equipe').send({ email: 'cliente@empresa.com' });
    expect(res.status).toBe(400);
    expect(chamadas.some(([n]) => n === 'incluir')).toBe(false);
  });

  it('login de escritório que já existia (sem equipe) entra e é desbloqueado, sem novo convite', async () => {
    const { app, chamadas } = montar({ usuarios: [usuario(FORA, 'antigo@escritorio.com')] });
    const res = await request(app).post('/equipe').send({ email: 'antigo@escritorio.com' });
    expect(res.status).toBe(201);
    expect(res.body.convite_enviado).toBe(false);
    expect(chamadas.find(([n]) => n === 'incluir')?.[1]).toMatchObject({ user_id: FORA, escritorio_id: ESC });
    expect(chamadas.find(([n]) => n === 'updateUserById')?.[1]).toEqual({ id: FORA, attrs: { ban_duration: 'none' } });
    expect(chamadas.some(([n]) => n === 'inviteUserByEmail')).toBe(false);
  });

  it('quem já é da equipe: 409', async () => {
    const { app } = montar();
    expect((await request(app).post('/equipe').send({ email: 'ana@escritorio.com' })).status).toBe(409);
  });
});

describe('DELETE /equipe/:userId — tirar da equipe', () => {
  it('tira da equipe e bloqueia o login (sem apagar)', async () => {
    const { app, chamadas, membros } = montar();
    const res = await request(app).delete(`/equipe/${ANA}`);
    expect(res.status).toBe(204);
    expect(membros.some((m) => m.user_id === ANA)).toBe(false);
    expect(chamadas.find(([n]) => n === 'updateUserById')?.[1]).toEqual({ id: ANA, attrs: { ban_duration: '876000h' } });
    expect(chamadas.some(([n]) => n === 'deleteUser')).toBe(false);
  });

  it('não tira a si mesmo, nem a conta principal, nem quem não é da equipe; e só quem administra', async () => {
    const { app } = montar();
    expect((await request(app).delete(`/equipe/${GAB}`)).status).toBe(400);
    expect((await request(app).delete(`/equipe/${ESC}`)).status).toBe(400);
    expect((await request(app).delete(`/equipe/${FORA}`)).status).toBe(404);
    expect((await request(montar({ eu: ANA }).app).delete(`/equipe/${GAB}`)).status).toBe(403);
  });
});

describe('POST /equipe/:userId/reenviar', () => {
  it('convite pendente → convite de novo; quem já entrou → link de nova senha', async () => {
    const { app, chamadas } = montar();
    expect((await request(app).post(`/equipe/${ANA}/reenviar`)).body).toEqual({ enviado: 'convite' });
    expect((await request(app).post(`/equipe/${ESC}/reenviar`)).body).toEqual({ enviado: 'redefinir_senha' });
    expect(chamadas.map(([n]) => n)).toEqual(['inviteUserByEmail', 'resetPasswordForEmail']);
  });
});
