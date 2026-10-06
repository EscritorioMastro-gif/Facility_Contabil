import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

vi.mock('../statements/parserClient.js', () => ({ callParser: vi.fn(), callParserExcel: vi.fn(), lerPlanilha: vi.fn() }));
import { callParser } from '../statements/parserClient.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeOp } from '../test/fakeSupabase.js';
import { porPapel } from '../routes/papel.js';
import { portalClientesRouter } from './clientes.js';
import { portalExtratosRouter } from './extratos.js';
import { portalClassificacoesRouter } from './classificacoes.js';

const mockedParser = vi.mocked(callParser);

const LOGIN = 'login-cliente';
const ESCRITORIO = 'escritorio-1';
const EMP_A = '11111111-1111-1111-1111-111111111111'; // liberada
const EMP_B = '22222222-2222-2222-2222-222222222222'; // liberada, mas inativa
const EMP_X = '33333333-3333-3333-3333-333333333333'; // de outro cliente
const ST_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // EMP_A, ainda no módulo Classificação
const ST_PUXADO = 'aaaaaaaa-0000-0000-0000-000000000002'; // EMP_A, já puxado pra Importação
const ST_IMPORTACAO = 'aaaaaaaa-0000-0000-0000-000000000003'; // EMP_A, nasceu na Importação
const ST_X = 'aaaaaaaa-0000-0000-0000-000000000004'; // empresa de outro cliente

const empresa = (id: string, ativo = true) => ({
  id,
  owner_id: ESCRITORIO,
  razao_social: `EMPRESA ${id.slice(0, 1)}`,
  cnpj: '11222333000181',
  hist_code_entrada: '201',
  hist_code_saida: '202',
  saldo_inicial: '150.00',
  ativo,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  // campos que o portal NUNCA pode devolver
  banco_conta_contabil: '10002',
  dominio_code: '168',
});
const EMPRESAS: Record<string, ReturnType<typeof empresa>> = {
  [EMP_A]: empresa(EMP_A),
  [EMP_B]: empresa(EMP_B, false),
  [EMP_X]: empresa(EMP_X),
};
const ACESSOS = [
  { id: 'ac-1', user_id: LOGIN, client_id: EMP_A },
  { id: 'ac-2', user_id: LOGIN, client_id: EMP_B },
];

const extrato = (id: string, client_id: string, status: string, origem_modulo = 'classificacao') => ({
  id,
  client_id,
  arquivo_nome: 'extrato.ofx',
  formato: 'ofx',
  period_start: '2026-09-01',
  period_end: '2026-09-30',
  status,
  origem_modulo,
  totais: { qtd: 1 },
  erro_msg: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  storage_path: `${ESCRITORIO}/${id}/extrato.ofx`,
  banco_conta_contabil: '10002',
  client: { razao_social: 'EMPRESA A', cnpj: '11222333000181' },
});
const EXTRATOS: Record<string, ReturnType<typeof extrato>> = {
  [ST_A]: extrato(ST_A, EMP_A, 'classificacao'),
  [ST_PUXADO]: extrato(ST_PUXADO, EMP_A, 'revisao'),
  [ST_IMPORTACAO]: extrato(ST_IMPORTACAO, EMP_A, 'revisao', 'importacao'),
  [ST_X]: extrato(ST_X, EMP_X, 'classificacao'),
};
const LANCAMENTO = {
  id: 'tx-1',
  ordem: 0,
  data: '2026-09-02',
  descricao_raw: 'PIX ENVIADO',
  valor: '10.00',
  direction: 'saida',
  ignorado: false,
  classificacao_id: null,
  // o banco tem, o portal não devolve
  conta_contabil: '467',
  hist_code: '186',
};
const CLASSIF_A = { id: '0c0c0c0c-0000-4000-8000-00000000000a', client_id: EMP_A, direction: 'saida', nome: 'AGUA', ativo: true };
const CLASSIF_X = { id: '0c0c0c0c-0000-4000-8000-00000000000b', client_id: EMP_X, direction: 'saida', nome: 'LUZ', ativo: true };

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

/** Banco falso com a regra que importa: acessos, empresas ativas, extratos e classificações. */
function banco(op: FakeOp) {
  const ativo = filtro(op, 'ativo');
  switch (op.table) {
    case 'cliente_acessos': {
      const userId = filtro(op, 'user_id');
      const clientId = filtro(op, 'client_id');
      const linhas = ACESSOS.filter((a) => a.user_id === userId && (!clientId || a.client_id === clientId));
      return { data: op.single ? (linhas[0] ?? null) : linhas, error: null };
    }
    case 'clients': {
      const ids = (filtro(op, 'id') as string | string[] | undefined) ?? [];
      const lista = (Array.isArray(ids) ? ids : [ids])
        .map((id) => EMPRESAS[id])
        .filter((e) => e && (ativo === undefined || e.ativo === ativo));
      return { data: op.single ? (lista[0] ?? null) : lista, error: null };
    }
    case 'statements': {
      if (op.verb === 'insert') return { data: { id: 'st-novo' }, error: null };
      if (op.verb === 'update') {
        return { data: { ...extrato('st-novo', EMP_A, 'classificacao'), ...(op.payload as object) }, error: null };
      }
      if (op.verb === 'delete') return { data: null, error: null };
      const id = filtro(op, 'id') as string | undefined;
      if (id) return { data: EXTRATOS[id] ?? null, error: null };
      const ids = filtro(op, 'client_id') as string[];
      return { data: Object.values(EXTRATOS).filter((s) => ids.includes(s.client_id)), error: null };
    }
    case 'transactions':
      if (op.verb === 'insert') return { data: null, error: null };
      if (op.verb === 'select' && op.single === undefined && !op.range) return { data: null, error: null, count: 0 };
      return { data: [LANCAMENTO], error: null };
    case 'classificacoes': {
      const todas = [CLASSIF_A, CLASSIF_X];
      if (op.verb === 'insert') return { data: { id: 'cl-novo', ...(op.payload as object) }, error: null };
      if (op.verb === 'delete') return { data: null, error: null };
      const id = filtro(op, 'id');
      if (Array.isArray(id)) return { data: todas.filter((c) => id.includes(c.id)), error: null };
      if (id) return { data: todas.find((c) => c.id === id) ?? null, error: null };
      return { data: todas.filter((c) => c.client_id === filtro(op, 'client_id')), error: null };
    }
    case 'mapping_rules':
      return { data: [], error: null };
    default:
      return { data: null, error: null };
  }
}

function appCliente() {
  const fake = makeFakeSupabase(banco, () => ({ error: null }), () => ({ data: 1, error: null }));
  const escritorio = Router().use((_req, res) => {
    res.json({ atendido_por: 'escritorio' });
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: LOGIN, email: 'cliente@empresa.com', token: 't', papel: 'cliente' };
    req.supabaseAdmin = fake.client;
    next();
  });
  app.use('/clients', porPapel({ escritorio, cliente: portalClientesRouter }));
  app.use('/statements', porPapel({ escritorio, cliente: portalExtratosRouter }));
  app.use('/classificacoes', porPapel({ escritorio, cliente: portalClassificacoesRouter }));
  app.use(errorHandler);
  return { app, ...fake };
}

beforeEach(() => mockedParser.mockReset());

describe('portal do cliente — empresas', () => {
  it('lista só as empresas liberadas e ativas, sem dados contábeis', async () => {
    const { app } = appCliente();
    const res = await request(app).get('/clients?ativo=true');
    expect(res.status).toBe(200);
    expect(res.body.clients.map((c: { id: string }) => c.id)).toEqual([EMP_A]);
    expect(res.body.clients[0]).toMatchObject({ banco_conta_contabil: null, dominio_code: '', saldo_inicial: '0' });
  });

  it('não cadastra nem edita cliente (403)', async () => {
    const { app } = appCliente();
    expect((await request(app).post('/clients').send({})).status).toBe(403);
    expect((await request(app).patch(`/clients/${EMP_A}`).send({})).status).toBe(403);
  });
});

describe('portal do cliente — extratos', () => {
  it('lista só extratos do módulo Classificação das empresas dele, sem campos contábeis', async () => {
    const { app, ops } = appCliente();
    const res = await request(app).get('/statements?origem_modulo=classificacao');
    expect(res.status).toBe(200);
    const op = ops.find((o) => o.table === 'statements')!;
    expect(op.filters).toContainEqual(['client_id', [EMP_A]]);
    expect(op.filters).toContainEqual(['origem_modulo', 'classificacao']);
    for (const s of res.body.statements) expect(s.banco_conta_contabil).toBeNull();
  });

  it('extrato de empresa de outro cliente: 404', async () => {
    const { app } = appCliente();
    expect((await request(app).get(`/statements/${ST_X}`)).status).toBe(404);
  });

  it('extrato que nasceu na Importação: 404', async () => {
    const { app } = appCliente();
    expect((await request(app).get(`/statements/${ST_IMPORTACAO}`)).status).toBe(404);
  });

  it('abre o extrato da empresa dele sem conta contábil nem histórico', async () => {
    const { app } = appCliente();
    const res = await request(app).get(`/statements/${ST_A}`);
    expect(res.status).toBe(200);
    expect(res.body.statement).toMatchObject({ id: ST_A, banco_conta_contabil: null, storage_path: null });
    expect(res.body.transactions[0]).toMatchObject({ id: 'tx-1', conta_contabil: null, hist_code: null });
  });

  it('classifica: grava pela função do portal e devolve os lançamentos', async () => {
    const { app, rpcOps } = appCliente();
    const updates = [
      { id: '0f0f0f0f-0000-4000-8000-000000000001', classificacao_id: CLASSIF_A.id },
      { id: '0f0f0f0f-0000-4000-8000-000000000002', classificacao_id: null },
    ];
    const res = await request(app).patch(`/statements/${ST_A}/classificacao`).send({ updates });
    expect(res.status).toBe(200);
    expect(rpcOps[0]).toEqual({
      fn: 'update_transactions_classificacao_portal',
      args: { p_statement: ST_A, p_updates: updates },
    });
  });

  it('não classifica extrato já puxado pra Importação', async () => {
    const { app, rpcOps } = appCliente();
    const res = await request(app)
      .patch(`/statements/${ST_PUXADO}/classificacao`)
      .send({ updates: [{ id: '0f0f0f0f-0000-4000-8000-000000000001', classificacao_id: null }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já foi enviado/);
    expect(rpcOps).toHaveLength(0);
  });

  it('não aceita classificação de outra empresa', async () => {
    const { app, rpcOps } = appCliente();
    const res = await request(app)
      .patch(`/statements/${ST_A}/classificacao`)
      .send({ updates: [{ id: '0f0f0f0f-0000-4000-8000-000000000001', classificacao_id: CLASSIF_X.id }] });
    expect(res.status).toBe(400);
    expect(rpcOps).toHaveLength(0);
  });

  it('exclui só enquanto está no módulo Classificação (e apaga o arquivo)', async () => {
    const { app, ops, storageOps } = appCliente();
    expect((await request(app).delete(`/statements/${ST_PUXADO}`)).status).toBe(400);
    expect(ops.some((o) => o.table === 'statements' && o.verb === 'delete')).toBe(false);

    expect((await request(app).delete(`/statements/${ST_A}`)).status).toBe(204);
    expect(storageOps).toContainEqual({ bucket: 'statements', action: 'remove', paths: [`${ESCRITORIO}/${ST_A}/extrato.ofx`] });
    expect(ops.some((o) => o.table === 'statements' && o.verb === 'delete')).toBe(true);
  });

  it('envia extrato: fica do escritório, marcado como enviado pelo cliente, com os históricos do cadastro', async () => {
    mockedParser.mockResolvedValue({
      format: 'ofx',
      bank_id: null,
      account_id: null,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
      warnings: [],
      transactions: [{ date: '2026-09-02', description: 'PIX', amount_cents: 1000, direction: 'saida', raw: {} }],
    });
    const { app, ops, storageOps } = appCliente();
    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', EMP_A)
      .attach('file', Buffer.from('<OFX></OFX>'), 'set.ofx');
    expect(res.status).toBe(201);

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert')!.payload as Record<string, unknown>;
    expect(insert).toMatchObject({
      owner_id: ESCRITORIO,
      client_id: EMP_A,
      enviado_por: LOGIN,
      origem_modulo: 'classificacao',
      hist_code_entrada: '201',
      hist_code_saida: '202',
    });
    expect(storageOps[0]?.path).toBe(`${ESCRITORIO}/st-novo/set.ofx`);
    const txns = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')!.payload as Array<
      Record<string, unknown>
    >;
    expect(txns[0]).toMatchObject({ owner_id: ESCRITORIO, hist_code: '202' });
    expect(res.body.statement).toMatchObject({ status: 'classificacao', banco_conta_contabil: null });
  });

  it('não envia extrato pra empresa que não é dele (nem cria nada)', async () => {
    const { app, ops } = appCliente();
    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', EMP_X)
      .attach('file', Buffer.from('<OFX></OFX>'), 'set.ofx');
    expect(res.status).toBe(404);
    expect(ops.some((o) => o.verb === 'insert')).toBe(false);
    expect(mockedParser).not.toHaveBeenCalled();
  });

  it('importação, revisão e arquivo do Domínio são do escritório (403)', async () => {
    const { app } = appCliente();
    expect((await request(app).post('/statements').send({})).status).toBe(403);
    expect((await request(app).post(`/statements/${ST_A}/export`)).status).toBe(403);
    expect((await request(app).patch(`/statements/${ST_A}/transactions`).send({ updates: [] })).status).toBe(403);
    expect((await request(app).patch(`/statements/${ST_A}`).send({ status: 'revisao' })).status).toBe(403);
  });
});

describe('portal do cliente — classificações', () => {
  it('lista as da empresa dele; de outra empresa, 404', async () => {
    const { app } = appCliente();
    const ok = await request(app).get(`/classificacoes?client_id=${EMP_A}&direction=saida`);
    expect(ok.status).toBe(200);
    expect(ok.body.classificacoes.map((c: { id: string }) => c.id)).toEqual([CLASSIF_A.id]);
    expect((await request(app).get(`/classificacoes?client_id=${EMP_X}`)).status).toBe(404);
  });

  it('cria no catálogo da empresa, em nome do escritório', async () => {
    const { app, ops } = appCliente();
    const res = await request(app).post('/classificacoes').send({ client_id: EMP_A, direction: 'saida', nome: 'Energia' });
    expect(res.status).toBe(201);
    const payload = ops.find((o) => o.table === 'classificacoes' && o.verb === 'insert')!.payload;
    expect(payload).toMatchObject({ client_id: EMP_A, owner_id: ESCRITORIO, nome: 'Energia' });
  });

  it('não cria em empresa que não é dele', async () => {
    const { app, ops } = appCliente();
    const res = await request(app).post('/classificacoes').send({ client_id: EMP_X, direction: 'saida', nome: 'Energia' });
    expect(res.status).toBe(404);
    expect(ops.some((o) => o.verb === 'insert')).toBe(false);
  });
});

describe('login do escritório', () => {
  it('segue nos routers de sempre', async () => {
    const fake = makeFakeSupabase(banco);
    const escritorio = Router().use((_req, res) => {
      res.json({ atendido_por: 'escritorio' });
    });
    const app = express();
    app.use((req, _res, next) => {
      req.auth = { userId: ESCRITORIO, email: 'x@escritorio.com', token: 't' };
      req.supabaseAdmin = fake.client;
      next();
    });
    app.use('/statements', porPapel({ escritorio, cliente: portalExtratosRouter }));
    const res = await request(app).get('/statements');
    expect(res.body).toEqual({ atendido_por: 'escritorio' });
    expect(fake.ops).toHaveLength(0);
  });
});
