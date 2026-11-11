/**
 * Pedidos de 2026-11-11: trava de extrato duplicado, memória da classificação,
 * extrato de 8.000 lançamentos (gravação em lotes) e histórico paginado.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({ callParser: vi.fn(), callParserExcel: vi.fn(), lerPlanilha: vi.fn() }));
import { callParser, type ParseResult } from './parserClient.js';
import { statementsRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp, type FakeRpcHandler } from '../test/fakeSupabase.js';
import { impressaoDoExtrato } from './impressao.js';
import { escolherSugestoes } from '../classificacoes/memoria.js';

const mockedParser = vi.mocked(callParser);
const CID = '11111111-1111-1111-1111-111111111111';

function appWith(handler: FakeHandler, rpc?: FakeRpcHandler) {
  const fake = makeFakeSupabase(handler, undefined, rpc);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'u1', email: 'a@b.com', token: 't' };
    req.escritorioId = 'esc-1';
    req.supabase = fake.client;
    next();
  });
  app.use('/statements', statementsRouter);
  app.use(errorHandler);
  return { app, ...fake };
}

function handlerFor(map: Record<string, (op: FakeOp) => unknown>): FakeHandler {
  return (op) => {
    const fn = map[`${op.table}.${op.verb}`] ?? map[op.table];
    return { data: fn ? fn(op) : null, error: null };
  };
}

const temFiltro = (op: FakeOp, col: string) => op.filters.some(([c]) => c === col);

function lido(transactions: ParseResult['transactions']): ParseResult {
  return { format: 'ofx', bank_id: null, account_id: null, period_start: '2026-10-01', period_end: '2026-10-31', warnings: [], transactions };
}
const TXNS: ParseResult['transactions'] = [
  { date: '2026-10-02', description: 'ENERGISA CONTA 10/2026', amount_cents: 15_000, direction: 'saida', raw: {} },
  { date: '2026-10-05', description: 'PIX RECEBIDO CLIENTE A', amount_cents: 50_000, direction: 'entrada', raw: {} },
  { date: '2026-10-09', description: 'TARIFA PACOTE', amount_cents: 3_500, direction: 'saida', raw: {} },
];

const JA_IMPORTADO = {
  id: 's-antigo',
  arquivo_nome: 'outubro.pdf',
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  origem_modulo: 'classificacao',
  status: 'classificacao',
  created_at: '2026-11-03T14:00:00Z',
};

/** Banco da importação nova; `repetido` = já existe extrato com os mesmos lançamentos. */
function banco(repetido: boolean) {
  return handlerFor({
    'clients.select': () => ({ id: CID, saldo_inicial: '0' }),
    'statements.select': (op) => (temFiltro(op, 'impressao') ? (repetido ? [JA_IMPORTADO] : []) : null),
    'statements.insert': () => ({ id: 's-novo' }),
    'statements.update': (op) => ({ id: 's-novo', status: 'revisao', totais: {}, ...(op.payload as object) }),
    'transactions.select': () => [],
    mapping_rules: () => [],
  });
}

beforeEach(() => mockedParser.mockReset());

describe('impressão do extrato', () => {
  it('não depende da ordem, da descrição nem do formato — só de data, valor e direção', () => {
    const outroFormato = [...TXNS].reverse().map((t) => ({ ...t, description: `${t.description} (PDF)` }));
    expect(impressaoDoExtrato(outroFormato)).toBe(impressaoDoExtrato(TXNS));
    expect(impressaoDoExtrato([{ ...TXNS[0]!, amount_cents: 15_001 }, TXNS[1]!, TXNS[2]!])).not.toBe(impressaoDoExtrato(TXNS));
    expect(impressaoDoExtrato([{ ...TXNS[1]!, direction: 'saida' }, TXNS[0]!, TXNS[2]!])).not.toBe(impressaoDoExtrato(TXNS));
  });

  it('é o sha256 das linhas data|centavos|direção ordenadas (mesma conta da migration 0023)', () => {
    const esperado = createHash('sha256')
      .update(['2026-10-02|15000|saida', '2026-10-05|50000|entrada', '2026-10-09|3500|saida'].join('\n'))
      .digest('hex');
    expect(impressaoDoExtrato(TXNS)).toBe(esperado);
  });
});

describe('trava de extrato duplicado', () => {
  it('importar de novo o mesmo extrato: 409 dizendo onde está, e o extrato novo some', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, ops, storageOps } = appWith(banco(true));
    const res = await request(app)
      .post('/statements')
      .field('client_id', CID)
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('<OFX></OFX>'), 'outubro.ofx');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'Esse extrato já foi importado: "outubro.pdf", de 01/10/2026 a 31/10/2026, em 03/11/2026 (módulo Classificação), ' +
        'com os mesmos lançamentos. Para trocar esse extrato, exclua-o (ou use Reimportar nele) antes de importar de novo.',
    );
    expect(res.body.details).toEqual({
      code: 'extrato_duplicado',
      statement_id: 's-antigo',
      status: 'classificacao',
      origem_modulo: 'classificacao',
    });
    const busca = ops.find((o) => o.table === 'statements' && temFiltro(o, 'impressao'))!;
    expect(busca.filters).toContainEqual(['client_id', CID]);
    expect(busca.filters).toContainEqual(['impressao', impressaoDoExtrato(TXNS)]);
    expect(busca.notFilters).toContainEqual({ col: 'status', op: 'eq', val: 'erro' });
    expect(busca.notFilters).toContainEqual({ col: 'id', op: 'eq', val: 's-novo' });
    expect(ops.some((o) => o.table === 'transactions' && o.verb === 'insert')).toBe(false);
    expect(ops.find((o) => o.table === 'statements' && o.verb === 'delete')?.filters).toContainEqual(['id', 's-novo']);
    expect(storageOps.filter((s) => s.action === 'remove').flatMap((s) => s.paths)).toEqual(['esc-1/s-novo/outubro.ofx']);
  });

  it('vale pro módulo Classificação também', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app } = appWith(banco(true));
    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', CID)
      .attach('file', Buffer.from('<OFX></OFX>'), 'outubro.ofx');
    expect(res.status).toBe(409);
  });

  it('extrato novo grava a impressão (pra travar o próximo igual)', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, ops } = appWith(banco(false));
    const res = await request(app)
      .post('/statements')
      .field('client_id', CID)
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('<OFX></OFX>'), 'outubro.ofx');
    expect(res.status).toBe(201);
    const fim = ops.filter((o) => o.table === 'statements' && o.verb === 'update').map((o) => o.payload as Record<string, unknown>);
    expect(fim.some((p) => p.impressao === impressaoDoExtrato(TXNS))).toBe(true);
  });

  it('reimportar com o arquivo de OUTRO extrato da empresa: 409 sem mexer em nada', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, ops, storageOps } = appWith(
      handlerFor({
        'statements.select': (op) =>
          temFiltro(op, 'impressao')
            ? [JA_IMPORTADO]
            : { id: 's1', client_id: CID, hist_code_entrada: '1', hist_code_saida: '2', saldo_inicial: '0', status: 'revisao', excel_mapeamento: null },
      }),
    );
    const res = await request(app).post('/statements/s1/reimport').attach('file', Buffer.from('<OFX></OFX>'), 'outro.ofx');
    expect(res.status).toBe(409);
    const busca = ops.find((o) => o.table === 'statements' && temFiltro(o, 'impressao'))!;
    expect(busca.notFilters).toContainEqual({ col: 'id', op: 'eq', val: 's1' }); // o próprio extrato não conta
    expect(ops.some((o) => o.table === 'transactions')).toBe(false);
    expect(ops.some((o) => o.table === 'statements' && o.verb !== 'select')).toBe(false);
    expect(storageOps).toEqual([]);
  });
});

describe('memória da classificação', () => {
  it('uma classificação só → preenche; classificações diferentes → a mais usada, pra conferir', () => {
    const s = escolherSugestoes([
      { descricao: 'ENERGISA', direction: 'saida', classificacao_id: 'energia', usos: 3, ultima: '2026-09-02' },
      { descricao: 'PIX JOAO', direction: 'saida', classificacao_id: 'aluguel', usos: 1, ultima: '2026-08-05' },
      { descricao: 'PIX JOAO', direction: 'saida', classificacao_id: 'salario', usos: 2, ultima: '2026-07-05' },
      { descricao: 'PIX MARIA', direction: 'entrada', classificacao_id: 'vendas', usos: 1, ultima: '2026-07-01' },
      { descricao: 'PIX MARIA', direction: 'entrada', classificacao_id: 'emprestimo', usos: 1, ultima: '2026-09-01' },
    ]);
    expect(s.get('saida\u0000ENERGISA')).toEqual({ classificacao_id: 'energia', origem: 'memoria' });
    expect(s.get('saida\u0000PIX JOAO')).toEqual({ classificacao_id: 'salario', origem: 'conferir' });
    // empate em usos: a mais recente
    expect(s.get('entrada\u0000PIX MARIA')).toEqual({ classificacao_id: 'emprestimo', origem: 'conferir' });
  });

  it('importar no módulo Classificação já vem classificado pela memória da empresa', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, ops, rpcOps } = appWith(banco(false), (op) =>
      op.fn === 'memoria_classificacao'
        ? {
            data: [
              { descricao: 'ENERGISA CONTA 10/2026', direction: 'saida', classificacao_id: 'cl-energia', usos: 4, ultima: '2026-09-02' },
              { descricao: 'PIX RECEBIDO CLIENTE A', direction: 'entrada', classificacao_id: 'cl-vendas', usos: 2, ultima: '2026-09-05' },
              { descricao: 'PIX RECEBIDO CLIENTE A', direction: 'entrada', classificacao_id: 'cl-emprestimo', usos: 1, ultima: '2026-08-05' },
              // mesma descrição, mas de SAÍDA: não vale pra entrada
              { descricao: 'TARIFA PACOTE', direction: 'entrada', classificacao_id: 'cl-estorno', usos: 9, ultima: '2026-09-09' },
            ],
            error: null,
          }
        : { data: 1, error: null },
    );
    const res = await request(app).post('/statements/classificar').field('client_id', CID).attach('file', Buffer.from('<OFX></OFX>'), 'out.ofx');
    expect(res.status).toBe(201);

    expect(rpcOps.find((r) => r.fn === 'memoria_classificacao')?.args).toEqual({
      p_client: CID,
      p_descricoes: TXNS.map((t) => t.description),
      p_excluir: 's-novo',
    });
    const linhas = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')!.payload as Array<Record<string, unknown>>;
    expect(linhas.map((l) => [l.classificacao_id, l.classificacao_origem])).toEqual([
      ['cl-energia', 'memoria'],
      ['cl-vendas', 'conferir'],
      [null, null],
    ]);
  });

  it('a memória falhar não impede a importação', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, ops } = appWith(banco(false), (op) =>
      op.fn === 'memoria_classificacao' ? { data: null, error: { message: 'function does not exist' } } : { data: 1, error: null },
    );
    const res = await request(app).post('/statements/classificar').field('client_id', CID).attach('file', Buffer.from('<OFX></OFX>'), 'out.ofx');
    expect(res.status).toBe(201);
    const linhas = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')!.payload as Array<Record<string, unknown>>;
    expect(linhas.every((l) => l.classificacao_id === null)).toBe(true);
  });

  it('a Importação direta (sem o módulo Classificação) não usa a memória da classificação', async () => {
    mockedParser.mockResolvedValue(lido(TXNS));
    const { app, rpcOps } = appWith(banco(false));
    await request(app).post('/statements').field('client_id', CID).field('banco_conta_contabil', '10002').attach('file', Buffer.from('<OFX></OFX>'), 'o.ofx');
    expect(rpcOps.some((r) => r.fn === 'memoria_classificacao')).toBe(false);
  });

  it('GET /:id/classificacao/sugestoes: só pros lançamentos ainda sem classificação', async () => {
    const { app, rpcOps } = appWith(
      handlerFor({
        'statements.select': () => ({ id: 's1', client_id: CID }),
        'transactions.select': () => [
          { id: 't1', direction: 'saida', descricao_raw: 'ENERGISA', classificacao_id: null, ignorado: false },
          { id: 't2', direction: 'saida', descricao_raw: 'ENERGISA', classificacao_id: 'cl-outra', ignorado: false },
          { id: 't3', direction: 'saida', descricao_raw: 'ENERGISA', classificacao_id: null, ignorado: true },
          { id: 't4', direction: 'saida', descricao_raw: 'SEM HISTORICO', classificacao_id: null, ignorado: false },
        ],
      }),
      () => ({ data: [{ descricao: 'ENERGISA', direction: 'saida', classificacao_id: 'cl-energia', usos: 2, ultima: null }], error: null }),
    );
    const res = await request(app).get('/statements/s1/classificacao/sugestoes');
    expect(res.status).toBe(200);
    expect(res.body.sugestoes).toEqual([{ id: 't1', classificacao_id: 'cl-energia', origem: 'memoria' }]);
    expect(rpcOps[0]?.args).toMatchObject({ p_descricoes: ['ENERGISA', 'SEM HISTORICO'], p_excluir: 's1' });
  });
});

describe('extrato grande', () => {
  it('8.000 lançamentos são gravados em lotes de 1.000', async () => {
    const muitos = Array.from({ length: 8_000 }, (_, i) => ({
      date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      description: `PIX ${i}`,
      amount_cents: 100 + i,
      direction: (i % 2 ? 'entrada' : 'saida') as 'entrada' | 'saida',
      raw: {},
    }));
    mockedParser.mockResolvedValue(lido(muitos));
    const { app, ops } = appWith(banco(false));
    const res = await request(app).post('/statements').field('client_id', CID).field('banco_conta_contabil', '10002').attach('file', Buffer.from('<OFX></OFX>'), 'g.ofx');
    expect(res.status).toBe(201);
    const lotes = ops.filter((o) => o.table === 'transactions' && o.verb === 'insert').map((o) => (o.payload as unknown[]).length);
    expect(lotes).toEqual(Array(8).fill(1_000));
    const ordens = ops
      .filter((o) => o.table === 'transactions' && o.verb === 'insert')
      .flatMap((o) => (o.payload as Array<{ ordem: number }>).map((l) => l.ordem));
    expect(ordens).toEqual(Array.from({ length: 8_000 }, (_, i) => i));
  });
});

describe('histórico paginado', () => {
  it('GET /statements?pagina=3&por_pagina=10 lê só a página e devolve o total', async () => {
    const { app, ops } = appWith((op) => ({ data: [{ id: 's21' }], error: null, count: 137 }));
    const res = await request(app).get(`/statements?pagina=3&por_pagina=10&client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ statements: [{ id: 's21' }], total: 137 });
    expect(ops[0]?.range).toEqual([20, 29]);
    expect(ops[0]?.orderCalls.map((o) => o.col)).toEqual(['created_at', 'id']);
  });

  it('sem página continua com o limite de antes', async () => {
    const { app, ops } = appWith(() => ({ data: [], error: null, count: 0 }));
    await request(app).get('/statements');
    expect(ops[0]?.limit).toBe(50);
    expect(ops[0]?.range).toBeUndefined();
  });
});
