import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { clientsRouter, contemTexto } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler } from '../test/fakeSupabase.js';

function appWith(handler: FakeHandler) {
  const { client, ops } = makeFakeSupabase(handler);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'user-1', email: 'a@b.com', token: 't' };
    req.escritorioId = 'esc-1'; // escritório ≠ login: o dono gravado tem que ser o escritório
    req.supabase = client;
    next();
  });
  app.use('/clients', clientsRouter);
  app.use(errorHandler);
  return { app, ops };
}

const sample = {
  id: 'c1',
  razao_social: 'ACME LTDA',
  cnpj: '11222333000181',
  dominio_code: '168',
  ativo: true,
};

describe('clientsRouter', () => {
  it('GET / lista', async () => {
    const { app, ops } = appWith(() => ({ data: [sample], error: null }));
    const res = await request(app).get('/clients');
    expect(res.status).toBe(200);
    expect(res.body.clients).toHaveLength(1);
    expect(ops[0]).toMatchObject({ table: 'clients', verb: 'select', orderBy: 'razao_social' });
  });

  it('GET / com filtro ativo e busca', async () => {
    const { app, ops } = appWith(() => ({ data: [], error: null }));
    await request(app).get('/clients?ativo=true&q=acme');
    expect(ops[0]?.filters).toContainEqual(['ativo', true]);
    expect(ops[0]?.or).toContain('razao_social.ilike."%acme%"');
  });

  it('GET / busca não deixa o texto digitado virar filtro do banco', async () => {
    const { app, ops } = appWith(() => ({ data: [], error: null }));
    // tentativa de fechar o valor e abrir outro filtro (ex.: listar tudo)
    const ataque = 'x%",id.neq.0,razao_social.ilike."%';
    await request(app).get(`/clients?q=${encodeURIComponent(ataque)}`);
    const or = String(ops[0]?.or);
    expect(or).toBe(`razao_social.ilike.${contemTexto(ataque)},cnpj.ilike.${contemTexto('0')}`);
    // só as aspas que delimitam os 2 valores ficam "abertas"; as do ataque vêm escapadas
    let abertas = 0;
    for (let i = 0; i < or.length; i++) {
      if (or[i] !== '"') continue;
      let barras = 0;
      for (let j = i - 1; j >= 0 && or[j] === '\\'; j--) barras++;
      if (barras % 2 === 0) abertas++;
    }
    expect(abertas).toBe(4);
  });

  it('contemTexto: aspas, barra e curingas viram texto', () => {
    expect(contemTexto('acme')).toBe('"%acme%"');
    expect(contemTexto('50%_off')).toBe('"%50\\\\%\\\\_off%"');
    expect(contemTexto('a"b')).toBe('"%a\\"b%"');
    expect(contemTexto('a\\b')).toBe('"%a\\\\\\\\b%"');
  });

  it('GET /:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/clients/xxx');
    expect(res.status).toBe(404);
  });

  it('POST / cria e devolve 201', async () => {
    const { app, ops } = appWith(() => ({ data: sample, error: null }));
    const res = await request(app)
      .post('/clients')
      .send({ razao_social: 'ACME LTDA', cnpj: '11.222.333/0001-81', dominio_code: '168' });
    expect(res.status).toBe(201);
    expect(res.body.client.id).toBe('c1');
    expect(ops[0]).toMatchObject({ verb: 'insert' });
    expect((ops[0]?.payload as { owner_id: string }).owner_id).toBe('esc-1');
    expect((ops[0]?.payload as { cnpj: string }).cnpj).toBe('11222333000181');
  });

  it('POST / 400 em cnpj inválido', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/clients')
      .send({ razao_social: 'X', cnpj: '123', dominio_code: '1' });
    expect(res.status).toBe(400);
  });

  it('POST / 409 em cnpj duplicado', async () => {
    const { app } = appWith(() => ({ data: null, error: { code: '23505', message: 'dup' } }));
    const res = await request(app)
      .post('/clients')
      .send({ razao_social: 'ACME', cnpj: '11.222.333/0001-81', dominio_code: '168' });
    expect(res.status).toBe(409);
  });

  it('PATCH /:id atualiza', async () => {
    const { app, ops } = appWith(() => ({ data: { ...sample, razao_social: 'NOVO' }, error: null }));
    const res = await request(app).patch('/clients/c1').send({ razao_social: 'NOVO' });
    expect(res.status).toBe(200);
    expect(res.body.client.razao_social).toBe('NOVO');
    expect(ops[0]).toMatchObject({ verb: 'update' });
  });

  it('PATCH /:id 400 sem campos', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch('/clients/c1').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /:id 204', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 1 }));
    const res = await request(app).delete('/clients/c1');
    expect(res.status).toBe(204);
  });

  it('DELETE /:id 409 quando tem importações (FK)', async () => {
    const { app } = appWith(() => ({ error: { code: '23503', message: 'fk' } }));
    const res = await request(app).delete('/clients/c1');
    expect(res.status).toBe(409);
  });
});
