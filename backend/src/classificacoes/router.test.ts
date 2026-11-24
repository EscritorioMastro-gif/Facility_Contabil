import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { classificacoesRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler } from '../test/fakeSupabase.js';
import { bancoEmMemoria, type Tabelas } from '../test/bancoEmMemoria.js';

const ESC = 'esc-1';
const CID = '11111111-1111-1111-1111-111111111111'; // empresa A do login de cliente L1
const CID_B = '22222222-2222-2222-2222-222222222222'; // empresa B do mesmo login
const CID_SO = '33333333-3333-3333-3333-333333333333'; // empresa sem login de cliente
const G_ENERGIA = 'aaaaaaaa-0000-0000-0000-000000000001';
const G_LIMPEZA = 'aaaaaaaa-0000-0000-0000-000000000002';
const CL_1 = 'bbbbbbbb-0000-0000-0000-000000000001';

function appWith(handler: FakeHandler, opts: { admin?: boolean } = {}) {
  const { client, ops, rpcOps } = makeFakeSupabase(handler, undefined, (op) =>
    op.fn === 'sou_admin_do_escritorio' ? { data: opts.admin ?? true, error: null } : { data: null, error: null },
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'user-1', email: 'a@b.com', token: 't' };
    req.escritorioId = ESC; // escritório ≠ login: o dono gravado tem que ser o escritório
    req.supabase = client;
    next();
  });
  app.use('/classificacoes', classificacoesRouter);
  app.use(errorHandler);
  return { app, ops, rpcOps };
}

const UNICOS = {
  classificacoes: [['client_id', 'direction', 'nome']],
  classificacoes_gerais: [['owner_id', 'direction', 'nome']],
};

function banco(extra: Partial<Tabelas> = {}): Tabelas {
  return {
    clients: [{ id: CID }, { id: CID_B }, { id: CID_SO }],
    cliente_acessos: [
      { user_id: 'L1', client_id: CID },
      { user_id: 'L1', client_id: CID_B },
    ],
    classificacoes_gerais: [
      { id: G_ENERGIA, owner_id: ESC, direction: 'saida', nome: 'ENERGIA ELÉTRICA' },
      { id: G_LIMPEZA, owner_id: ESC, direction: 'saida', nome: 'LIMPEZA E HIGIENE' },
    ],
    classificacoes: [],
    transactions: [],
    ...extra,
  } as Tabelas;
}

const appBanco = (t: Tabelas, opts: { admin?: boolean } = {}) =>
  appWith(bancoEmMemoria(t, { unicos: UNICOS, padroes: { classificacoes: { ativo: true, geral_id: null } } }), opts);

const nomes = (t: Tabelas, cid: string) =>
  t.classificacoes!.filter((c) => c.client_id === cid && c.ativo).map((c) => c.nome).sort();

describe('classificacoesRouter — lista própria', () => {
  it('GET / exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    expect((await request(app).get('/classificacoes')).status).toBe(400);
  });

  it('GET /?client_id lista ordenado por nome, filtra por direção', async () => {
    const t = banco({
      classificacoes: [
        { id: 'c2', client_id: CID_SO, direction: 'saida', nome: 'TELEFONE', ativo: true },
        { id: 'c1', client_id: CID_SO, direction: 'saida', nome: 'AGUA E ESGOTO', ativo: true },
        { id: 'c3', client_id: CID_SO, direction: 'entrada', nome: 'VENDAS', ativo: true },
      ],
    });
    const { app } = appBanco(t);
    const res = await request(app).get(`/classificacoes?client_id=${CID_SO}&direction=saida`);
    expect(res.status).toBe(200);
    expect(res.body.classificacoes.map((c: { nome: string }) => c.nome)).toEqual(['AGUA E ESGOTO', 'TELEFONE']);
  });

  it('POST / (avulsa, do escritório) cria com o escritório como dono, em todas as empresas do mesmo login', async () => {
    const t = banco();
    const { app } = appBanco(t);
    const res = await request(app)
      .post('/classificacoes')
      .send({ client_id: CID, direction: 'saida', nome: '  Agua   e Esgoto  ' });
    expect(res.status).toBe(201);
    expect(res.body.classificacao).toMatchObject({ client_id: CID, nome: 'Agua e Esgoto', geral_id: null });
    expect(nomes(t, CID)).toEqual(['Agua e Esgoto']);
    expect(nomes(t, CID_B)).toEqual(['Agua e Esgoto']); // a outra empresa do login
    expect(nomes(t, CID_SO)).toEqual([]);
    expect(t.classificacoes!.every((c) => c.owner_id === ESC)).toBe(true);
  });

  it('POST / 400 quando o nome é muito curto', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/classificacoes').send({ client_id: CID, direction: 'saida', nome: 'A' });
    expect(res.status).toBe(400);
  });

  it('POST / 400 em nome duplicado (mesma direção/cliente, sem diferença de maiúsculas)', async () => {
    const t = banco({ classificacoes: [{ id: CL_1, client_id: CID_SO, direction: 'saida', nome: 'AGUA E ESGOTO', ativo: true }] });
    const { app } = appBanco(t);
    const res = await request(app).post('/classificacoes').send({ client_id: CID_SO, direction: 'saida', nome: 'agua e esgoto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('POST / com o nome de uma desativada reativa em vez de duplicar', async () => {
    const t = banco({ classificacoes: [{ id: CL_1, client_id: CID_SO, direction: 'saida', nome: 'AGUA', ativo: false }] });
    const { app } = appBanco(t);
    const res = await request(app).post('/classificacoes').send({ client_id: CID_SO, direction: 'saida', nome: 'AGUA' });
    expect(res.status).toBe(201);
    expect(t.classificacoes).toHaveLength(1);
    expect(t.classificacoes![0]!.ativo).toBe(true);
  });

  it('PATCH /:id renomeia e desativa no grupo todo', async () => {
    const t = banco({
      classificacoes: [
        { id: CL_1, client_id: CID, direction: 'saida', nome: 'AGUA', ativo: true },
        { id: 'c-b', client_id: CID_B, direction: 'saida', nome: 'AGUA', ativo: true },
      ],
    });
    const { app } = appBanco(t);
    const ren = await request(app).patch(`/classificacoes/${CL_1}`).send({ nome: 'ÁGUA E ESGOTO' });
    expect(ren.status).toBe(200);
    expect(ren.body.classificacao.nome).toBe('ÁGUA E ESGOTO');
    expect(nomes(t, CID_B)).toEqual(['ÁGUA E ESGOTO']);
    const des = await request(app).patch(`/classificacoes/${CL_1}`).send({ ativo: false });
    expect(des.status).toBe(200);
    expect(t.classificacoes!.every((c) => c.ativo === false)).toBe(true);
  });

  // migration 0031: renomear mudaria o que o cliente aprovou sem tocar no lançamento
  it('PATCH /:id não renomeia classificação que está em lançamento aprovado pelo cliente (no grupo todo)', async () => {
    const t = banco({
      classificacoes: [
        { id: CL_1, client_id: CID, direction: 'saida', nome: 'PRO-LABORE', ativo: true },
        { id: 'c-b', client_id: CID_B, direction: 'saida', nome: 'PRO-LABORE', ativo: true },
      ],
      // o cliente aprovou um lançamento da OUTRA empresa do login com ela
      transactions: [{ id: 't1', classificacao_id: 'c-b', aprovado_classificacao_id: 'c-b' }],
    });
    const { app } = appBanco(t);
    const ren = await request(app).patch(`/classificacoes/${CL_1}`).send({ nome: 'DISTRIBUIÇÃO DE LUCROS' });
    expect(ren.status).toBe(403);
    expect(ren.body.error).toMatch(/aprovados pelo cliente/);
    expect(nomes(t, CID)).toEqual(['PRO-LABORE']);
    expect(nomes(t, CID_B)).toEqual(['PRO-LABORE']);

    // desativar continua podendo
    expect((await request(app).patch(`/classificacoes/${CL_1}`).send({ ativo: false })).status).toBe(200);
    expect(t.classificacoes!.every((c) => c.ativo === false)).toBe(true);
  });

  it('PATCH /:id renomeia a que está em lançamento ainda não aprovado', async () => {
    const t = banco({
      classificacoes: [{ id: CL_1, client_id: CID_SO, direction: 'saida', nome: 'AGUA', ativo: true }],
      transactions: [{ id: 't1', classificacao_id: CL_1, aprovado_classificacao_id: null }],
    });
    const { app } = appBanco(t);
    expect((await request(app).patch(`/classificacoes/${CL_1}`).send({ nome: 'ÁGUA E ESGOTO' })).status).toBe(200);
    expect(nomes(t, CID_SO)).toEqual(['ÁGUA E ESGOTO']);
  });

  it('PATCH /:id 400 sem campos; 404 quando não existe', async () => {
    const { app } = appBanco(banco());
    expect((await request(app).patch(`/classificacoes/${CL_1}`).send({})).status).toBe(400);
    expect((await request(app).patch(`/classificacoes/${CL_1}`).send({ nome: 'X e Y' })).status).toBe(404);
  });

  it('DELETE /:id exclui onde não está em uso e desativa onde está (no grupo todo)', async () => {
    const t = banco({
      classificacoes: [
        { id: CL_1, client_id: CID, direction: 'saida', nome: 'AGUA', ativo: true },
        { id: 'c-b', client_id: CID_B, direction: 'saida', nome: 'AGUA', ativo: true },
      ],
      transactions: [{ id: 't1', classificacao_id: 'c-b' }],
    });
    const { app } = appBanco(t);
    const res = await request(app).delete(`/classificacoes/${CL_1}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ excluidas: 1, desativadas: 1 });
    expect(t.classificacoes).toEqual([expect.objectContaining({ id: 'c-b', ativo: false })]);
  });

  it('DELETE /:id só desativa a que o cliente aprovou num lançamento, mesmo sem lançamento com ela agora', async () => {
    const t = banco({
      classificacoes: [{ id: CL_1, client_id: CID_SO, direction: 'saida', nome: 'AGUA', ativo: true }],
      transactions: [{ id: 't1', classificacao_id: null, aprovado_classificacao_id: CL_1 }],
    });
    const { app } = appBanco(t);
    const res = await request(app).delete(`/classificacoes/${CL_1}`);
    expect(res.body).toEqual({ excluidas: 0, desativadas: 1 });
    expect(t.classificacoes).toEqual([expect.objectContaining({ id: CL_1, ativo: false })]);
  });

  it('DELETE /:id 404 quando não existe', async () => {
    const { app } = appBanco(banco());
    expect((await request(app).delete(`/classificacoes/${CL_1}`)).status).toBe(404);
  });

  it('GET / copia pra empresa do login o que as outras empresas dele já têm', async () => {
    const t = banco({ classificacoes: [{ id: CL_1, client_id: CID, direction: 'saida', nome: 'AGUA', ativo: true, geral_id: null }] });
    const { app } = appBanco(t);
    const res = await request(app).get(`/classificacoes?client_id=${CID_B}`);
    expect(res.status).toBe(200);
    expect(res.body.classificacoes.map((c: { nome: string }) => c.nome)).toEqual(['AGUA']);
  });
});

describe('classificacoesRouter — lista geral', () => {
  it('GET /gerais lista e diz se o login pode editar', async () => {
    const { app } = appBanco(banco(), { admin: false });
    const res = await request(app).get('/classificacoes/gerais?direction=saida');
    expect(res.status).toBe(200);
    expect(res.body.gerais.map((g: { nome: string }) => g.nome)).toEqual(['ENERGIA ELÉTRICA', 'LIMPEZA E HIGIENE']);
    expect(res.body.pode_editar).toBe(false);
  });

  it('só administrador inclui e exclui na lista geral', async () => {
    const t = banco();
    const naoAdmin = appBanco(t, { admin: false }).app;
    expect((await request(naoAdmin).post('/classificacoes/gerais').send({ direction: 'entrada', nome: 'VENDAS' })).status).toBe(403);
    expect((await request(naoAdmin).delete(`/classificacoes/gerais/${G_ENERGIA}`)).status).toBe(403);
    expect(t.classificacoes_gerais).toHaveLength(2);

    const admin = appBanco(t).app;
    const criou = await request(admin).post('/classificacoes/gerais').send({ direction: 'entrada', nome: ' VENDAS  À VISTA ' });
    expect(criou.status).toBe(201);
    expect(criou.body.geral).toMatchObject({ direction: 'entrada', nome: 'VENDAS À VISTA' });
    expect(t.classificacoes_gerais!.find((g) => g.nome === 'VENDAS À VISTA')?.owner_id).toBe(ESC);
    expect((await request(admin).delete(`/classificacoes/gerais/${G_ENERGIA}`)).status).toBe(204);
    expect(t.classificacoes_gerais!.map((g) => g.id)).not.toContain(G_ENERGIA);
  });

  it('nome repetido na lista geral → 400', async () => {
    const t = banco();
    const { app } = appWith(
      bancoEmMemoria(t, { unicos: { classificacoes_gerais: [['owner_id', 'direction', 'nome']] } }),
    );
    const res = await request(app).post('/classificacoes/gerais').send({ direction: 'saida', nome: 'ENERGIA ELÉTRICA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já está na lista geral/i);
  });

  it('POST /da-lista-geral põe os itens na lista própria de todas as empresas do login', async () => {
    const t = banco();
    const { app } = appBanco(t);
    const res = await request(app)
      .post('/classificacoes/da-lista-geral')
      .send({ client_id: CID, geral_ids: [G_ENERGIA, G_LIMPEZA] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ incluidas: 4, reativadas: 0 });
    expect(nomes(t, CID)).toEqual(['ENERGIA ELÉTRICA', 'LIMPEZA E HIGIENE']);
    expect(nomes(t, CID_B)).toEqual(['ENERGIA ELÉTRICA', 'LIMPEZA E HIGIENE']);
    expect(t.classificacoes!.every((c) => c.geral_id === G_ENERGIA || c.geral_id === G_LIMPEZA)).toBe(true);

    // de novo: nada duplica
    const again = await request(app).post('/classificacoes/da-lista-geral').send({ client_id: CID, geral_ids: [G_ENERGIA] });
    expect(again.body).toMatchObject({ incluidas: 0, reativadas: 0 });
    expect(t.classificacoes).toHaveLength(4);
  });

  it('POST /da-lista-geral reativa a que estava desativada e liga ao item da lista geral', async () => {
    const t = banco({
      classificacoes: [{ id: CL_1, client_id: CID_SO, direction: 'saida', nome: 'Energia Elétrica', ativo: false, geral_id: null }],
    });
    const { app } = appBanco(t);
    const res = await request(app).post('/classificacoes/da-lista-geral').send({ client_id: CID_SO, geral_ids: [G_ENERGIA] });
    expect(res.body).toMatchObject({ incluidas: 0, reativadas: 1 });
    expect(t.classificacoes![0]).toMatchObject({ ativo: true, geral_id: G_ENERGIA, nome: 'Energia Elétrica' });
  });

  it('POST /da-lista-geral com item que não existe → 400', async () => {
    const { app } = appBanco(banco());
    const res = await request(app)
      .post('/classificacoes/da-lista-geral')
      .send({ client_id: CID, geral_ids: ['aaaaaaaa-0000-0000-0000-00000000dead'] });
    expect(res.status).toBe(400);
  });
});
