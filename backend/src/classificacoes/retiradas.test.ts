import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeOp } from '../test/fakeSupabase.js';
import {
  LIMITE_RETIRADAS,
  mesesEntre,
  portalRetiradasRouter,
  retiradasRouter,
  somarRetiradas,
  tipoRetirada,
  type ClassifRetirada,
} from './retiradas.js';

const C1 = '11111111-1111-1111-1111-111111111111';
const C2 = '22222222-2222-2222-2222-222222222222';
const S1 = 'aaaaaaaa-0000-0000-0000-000000000001'; // C1, outubro, banco A
const S2 = 'aaaaaaaa-0000-0000-0000-000000000002'; // C1, outubro, banco B
const S3 = 'aaaaaaaa-0000-0000-0000-000000000003'; // C2, outubro
const S_IMP = 'aaaaaaaa-0000-0000-0000-000000000004'; // C1, nasceu na Importação

const extrato = (id: string, client_id: string, origem_modulo = 'classificacao', de = '2026-10-01', ate = '2026-10-31') => ({
  id,
  client_id,
  period_start: de,
  period_end: ate,
  origem_modulo,
});
const EXTRATOS: Record<string, ReturnType<typeof extrato>> = {
  [S1]: extrato(S1, C1),
  [S2]: extrato(S2, C1),
  [S3]: extrato(S3, C2),
  [S_IMP]: extrato(S_IMP, C1, 'importacao'),
};

const CLASSIFICACOES = [
  { id: 'k-pro', client_id: C1, nome: 'PRO-LABORE', geral: { nome: 'PRO-LABORE' } },
  { id: 'k-dist', client_id: C1, nome: 'DISTRIBUIÇÃO DE LUCRO', geral: [{ nome: 'DISTRIBUIÇÃO DE LUCRO' }] },
  { id: 'k-forn', client_id: C1, nome: 'FORNECEDORES', geral: null },
  { id: 'k-pro-c2', client_id: C2, nome: 'Pró-labore', geral: null },
];

/** Retiradas gravadas: C1 tira 12 mil de pró-labore (S1) + 40 mil de lucro (S2) em outubro. */
const RETIRADAS = [
  { statement_id: S1, data: '2026-10-05', valor: '12000.00', classificacao_id: 'k-pro' },
  { statement_id: S2, data: '2026-10-20', valor: '25000.00', classificacao_id: 'k-dist' },
  { statement_id: S2, data: '2026-10-28', valor: '15000.00', classificacao_id: 'k-dist' },
  { statement_id: S1, data: '2026-09-30', valor: '5000.00', classificacao_id: 'k-pro' },
  { statement_id: S3, data: '2026-10-10', valor: '1000.00', classificacao_id: 'k-pro-c2' },
];

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

function banco(op: FakeOp) {
  switch (op.table) {
    case 'statements': {
      const id = filtro(op, 'id');
      if (Array.isArray(id)) return { data: id.map((i) => EXTRATOS[i]).filter(Boolean), error: null };
      return { data: (id && EXTRATOS[id as string]) ?? null, error: null };
    }
    case 'classificacoes': {
      const clientes = (filtro(op, 'client_id') as string[] | undefined) ?? [];
      return { data: CLASSIFICACOES.filter((c) => clientes.includes(c.client_id)), error: null };
    }
    case 'transactions': {
      // datas do extrato: primeira e última
      if (filtro(op, 'statement_id') && !filtro(op, 'classificacao_id')) {
        const asc = op.orderCalls[0]?.ascending !== false;
        return { data: [{ data: asc ? '2026-10-01' : '2026-10-31' }], error: null };
      }
      const classifs = (filtro(op, 'classificacao_id') as string[]) ?? [];
      const de = op.rangeFilters.find((r) => r.op === 'gte')?.val as string;
      const ate = op.rangeFilters.find((r) => r.op === 'lte')?.val as string;
      const exceto = op.notFilters.find((n) => n.col === 'statement_id')?.val;
      const so = filtro(op, 'statement_id') as string[] | undefined;
      const linhas = RETIRADAS.filter(
        (r) =>
          classifs.includes(r.classificacao_id) &&
          r.data >= de &&
          r.data <= ate &&
          r.statement_id !== exceto &&
          (!so || so.includes(r.statement_id)),
      );
      const [ini, fim] = op.range ?? [0, linhas.length - 1];
      return { data: linhas.slice(ini, fim + 1), error: null };
    }
    case 'cliente_acessos':
      return { data: [{ client_id: C1 }], error: null };
    case 'clients': {
      const ids = (filtro(op, 'id') as string[]) ?? [];
      return { data: ids.filter((i) => i === C1).map((id) => ({ id, owner_id: 'esc', razao_social: 'ALFA', cnpj: '1', ativo: true })), error: null };
    }
    default:
      return { data: null, error: null };
  }
}

function appEscritorio() {
  const { client, ops } = makeFakeSupabase(banco);
  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: 'u1', email: 'esc@x.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/retiradas', retiradasRouter);
  app.use(errorHandler);
  return { app, ops };
}

function appCliente() {
  const { client } = makeFakeSupabase(banco);
  const app = express();
  app.use((req, _res, next) => {
    req.auth = { userId: 'login-cliente', email: 'c@x.com', token: 't', papel: 'cliente' };
    req.supabaseAdmin = client;
    next();
  });
  app.use('/retiradas', portalRetiradasRouter);
  app.use(errorHandler);
  return { app };
}

describe('quais classificações contam', () => {
  it('pró-labore e distribuição de lucro, do jeito que vierem escritos', () => {
    for (const n of ['PRO-LABORE', 'Pró-labore', 'PRO LABORE SÓCIOS', 'PROLABORE', 'pro_labore']) {
      expect(tipoRetirada(n)).toBe('pro_labore');
    }
    for (const n of ['DISTRIBUIÇÃO DE LUCRO', 'Distribuição de lucros', 'DISTRIBUICAO DE LUCRO - JOAO']) {
      expect(tipoRetirada(n)).toBe('distribuicao');
    }
    for (const n of ['FORNECEDORES', 'LUCRO NA VENDA', 'DISTRIBUIDORA DE LUCROS LTDA', '', null]) {
      expect(tipoRetirada(n)).toBeNull();
    }
  });

  it('meses entre duas datas, virando o ano', () => {
    expect(mesesEntre('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(mesesEntre('2026-10', '2026-10')).toEqual(['2026-10']);
  });

  it('soma por mês separando pró-labore e distribuição', () => {
    const tipos = new Map<string, ClassifRetirada>([
      ['k-pro', { tipo: 'pro_labore', client_id: C1 }],
      ['k-dist', { tipo: 'distribuicao', client_id: C1 }],
    ]);
    const s = somarRetiradas(RETIRADAS, tipos);
    expect(s.get('2026-10')).toEqual({ pro_labore: 12000, distribuicao: 40000 });
    expect(s.get('2026-09')).toEqual({ pro_labore: 5000, distribuicao: 0 });
  });
});

describe('GET /retiradas/extrato/:id (escritório)', () => {
  it('devolve o que os OUTROS extratos da empresa já somam no mês e as classificações que contam', async () => {
    const { app, ops } = appEscritorio();
    const res = await request(app).get(`/retiradas/extrato/${S1}`);
    expect(res.status).toBe(200);
    expect(res.body.limite).toBe(LIMITE_RETIRADAS);
    expect(res.body.classificacoes).toEqual([
      { id: 'k-pro', tipo: 'pro_labore' },
      { id: 'k-dist', tipo: 'distribuicao' },
    ]);
    // S1 fica de fora (a tela soma ele com o rascunho): sobra o lucro do S2
    expect(res.body.meses).toEqual([{ mes: '2026-10', outros: { pro_labore: 0, distribuicao: 40000 } }]);
    const op = ops.find((o) => o.table === 'transactions' && filtro(o, 'classificacao_id'))!;
    expect(op.notFilters).toContainEqual({ col: 'statement_id', op: 'eq', val: S1 });
    expect(op.notFilters).toContainEqual({ col: 'statement.status', op: 'eq', val: 'erro' });
    expect(op.filters).toContainEqual(['direction', 'saida']);
    expect(op.filters).toContainEqual(['ignorado', false]);
    expect(op.rangeFilters).toEqual([
      { op: 'gte', col: 'data', val: '2026-10-01' },
      { op: 'lte', col: 'data', val: '2026-10-31' },
    ]);
  });

  it('classificação avulsa com o mesmo nome (fora da lista geral) também conta', async () => {
    const { app } = appEscritorio();
    const res = await request(app).get(`/retiradas/extrato/${S3}`);
    expect(res.body.classificacoes).toEqual([{ id: 'k-pro-c2', tipo: 'pro_labore' }]);
  });

  it('extrato que não existe: 404', async () => {
    const { app } = appEscritorio();
    expect((await request(app).get('/retiradas/extrato/aaaaaaaa-0000-0000-0000-0000000000ff')).status).toBe(404);
    expect((await request(app).get('/retiradas/extrato/x')).status).toBe(404);
  });
});

describe('GET /retiradas/historico (escritório)', () => {
  it('marca os extratos do mês em que a empresa passou de R$ 50 mil (todos os bancos)', async () => {
    const { app } = appEscritorio();
    const res = await request(app).get(`/retiradas/historico?ids=${S1},${S2},${S3}`);
    expect(res.status).toBe(200);
    const outubro = { mes: '2026-10', pro_labore: 12000, distribuicao: 40000, total: 52000 };
    expect(res.body.acima).toEqual({ [S1]: [outubro], [S2]: [outubro] });
  });

  it('lista vazia ou inválida', async () => {
    const { app } = appEscritorio();
    expect((await request(app).get('/retiradas/historico')).body).toEqual({ limite: LIMITE_RETIRADAS, acima: {} });
    expect((await request(app).get('/retiradas/historico?ids=nao-e-id')).status).toBe(400);
  });
});

describe('portal do cliente', () => {
  it('extrato de empresa que o login não vê, ou que nasceu na Importação: 404', async () => {
    const { app } = appCliente();
    expect((await request(app).get(`/retiradas/extrato/${S3}`)).status).toBe(404);
    expect((await request(app).get(`/retiradas/extrato/${S_IMP}`)).status).toBe(404);
    expect((await request(app).get(`/retiradas/extrato/${S1}`)).status).toBe(200);
  });

  it('o histórico só considera as empresas do login', async () => {
    const { app } = appCliente();
    const res = await request(app).get(`/retiradas/historico?ids=${S1},${S3}`);
    expect(Object.keys(res.body.acima)).toEqual([S1]);
  });
});
