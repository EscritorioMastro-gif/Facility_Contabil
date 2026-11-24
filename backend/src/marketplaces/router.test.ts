import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeOp, type FakeRpcHandler } from '../test/fakeSupabase.js';
import { COMPRADOR, relatorioCarteira, relatorioPedidos, relatorioRenda } from '../test/relatoriosShopee.js';
import { xlsxDeTeste } from '../test/xlsx.js';
import { marketplacesRouter, portalMarketplacesRouter } from './router.js';

const ESC = 'escritorio-1';
const C1 = '11111111-1111-1111-1111-111111111111'; // empresa do login
const C2 = '22222222-2222-2222-2222-222222222222'; // empresa de outro cliente
const LOGIN = 'login-cliente';
const OUTRO_LOGIN = 'login-socio';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const T2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const CH1 = 'cccccccc-0000-0000-0000-000000000001'; // chamado da C1
const CH2 = 'cccccccc-0000-0000-0000-000000000002'; // chamado da C2

const CHAMADO_1 = { id: CH1, numero: 'SHP-1', aberto_em: '2026-11-10', aberto_por_email: 'esc@mastro.com', obs: null, resolvido_em: null };

const PEDIDOS = [
  { pedido: 'P-PAGO', status: 'concluido', criado_em: '2026-10-02T10:00:00-03:00', concluido_em: '2026-10-05T10:00:00-03:00', valor_produtos: '100.00', itens: [{ preco: 50, qtd: 2 }], chamado_id: null, chamado: null },
  { pedido: 'P-COMISSAO', status: 'concluido', criado_em: '2026-10-03T10:00:00-03:00', concluido_em: '2026-10-06T10:00:00-03:00', valor_produtos: '100.00', itens: [{ preco: '50.00', qtd: 2 }], chamado_id: null, chamado: null },
  { pedido: 'P-NAO-PAGO', status: 'concluido', criado_em: '2026-10-04T10:00:00-03:00', concluido_em: '2026-10-07T10:00:00-03:00', valor_produtos: '120.00', itens: [{ preco: 120, qtd: 1 }], chamado_id: null, chamado: null },
  { pedido: 'P-EM-CHAMADO', status: 'concluido', criado_em: '2026-10-05T10:00:00-03:00', concluido_em: '2026-10-08T10:00:00-03:00', valor_produtos: '80.00', itens: [{ preco: 80, qtd: 1 }], chamado_id: CH1, chamado: CHAMADO_1 },
  { pedido: 'P-CANCEL', status: 'cancelado', criado_em: '2026-10-06T10:00:00-03:00', concluido_em: null, valor_produtos: '30.00', itens: [{ preco: 30, qtd: 1 }], chamado_id: null, chamado: null },
];
const repasse = (pedido: string, dia: string, comissao: string, liquido: string) => ({
  pedido,
  criado_dia: dia,
  pago_em: '2026-10-12',
  preco: '100.00',
  reembolso: '0',
  cupom: '0',
  incentivo_cupom: '0',
  voucher_loja: '0',
  frete_comprador: '0',
  frete_desconto: '0',
  frete_transportadora: '0',
  comissao_bruta: comissao,
  comissao_liquida: comissao,
  servico_bruta: '-9.00',
  servico_liquida: '-9.00',
  transacao: '0',
  campanha: '0',
  por_item: '-9.00',
  devolucao_facil: '0',
  outros: '0',
  liquido,
  frete_esperado: null,
  frete_real: null,
});
const REPASSES = [repasse('P-PAGO', '2026-10-02', '-20.00', '71.00'), repasse('P-COMISSAO', '2026-10-03', '-23.00', '68.00')];
/** 20% de comissão + R$ 4,50 por item (o resto zerado) */
const tarifa = (id: string, usuario_id: string, em: string, min: number, max: number | null, porItem = '4.50') => ({
  id,
  usuario_id,
  vigencia_inicio: '2026-01-01',
  vigencia_fim: null,
  preco_min: String(min),
  preco_max: max === null ? null : String(max),
  comissao_pct: '20.000',
  transacao_pct: '0.000',
  campanha_pct: '0.000',
  por_item: porItem,
  por_pedido: '0.00',
  obs: null,
  preenchido_por_email: usuario_id === LOGIN ? 'financeiro@alfa.com' : 'socio@alfa.com',
  preenchido_em: em,
});

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

type Opts = {
  tarifas?: ReturnType<typeof tarifa>[];
  logins?: string[];
  erroUpdate?: unknown;
  pedidos?: typeof PEDIDOS;
  loja?: string | null;
  erroLoja?: unknown;
  carteira?: Record<string, unknown>[];
};

function banco(opts: Opts = {}) {
  const tarifas = opts.tarifas ?? [tarifa(T1, LOGIN, '2026-11-01T10:00:00Z', 0, 199.99)];
  const logins = opts.logins ?? [LOGIN];
  const PEDIDOS_ = opts.pedidos ?? PEDIDOS;
  return (op: FakeOp) => {
    switch (op.table) {
      case 'clients': {
        const id = filtro(op, 'id');
        if (Array.isArray(id)) {
          return { data: id.filter((i) => i === C1).map((i) => ({ id: i, owner_id: ESC, razao_social: 'ALFA', cnpj: '1', ativo: true })), error: null };
        }
        return { data: id === C1 ? { id: C1, owner_id: ESC } : null, error: null };
      }
      case 'cliente_acessos':
        if (filtro(op, 'client_id')) {
          return { data: filtro(op, 'client_id') === C1 ? logins.map((user_id) => ({ user_id })) : [], error: null };
        }
        return { data: [{ client_id: C1, email: 'financeiro@alfa.com' }], error: null };
      case 'marketplace_lojas':
        if (op.verb === 'insert') return { data: null, error: opts.erroLoja ?? null };
        return { data: opts.loja ? { loja: opts.loja } : null, error: null };
      case 'marketplace_importacoes':
        if (op.verb === 'insert') return { data: null, error: null };
        return { data: [{ id: 'imp-1', tipo: 'renda', arquivo: 'Income.xlsx', linhas: 1 }], error: null };
      case 'marketplace_carteira': {
        if (op.verb === 'upsert') return { data: null, error: null };
        const lista = opts.carteira ?? [];
        const nums = filtro(op, 'pedido') as string[] | undefined;
        return { data: nums ? lista.filter((m) => nums.includes(m.pedido as string)) : lista, error: null };
      }
      case 'marketplace_chamados': {
        if (op.verb === 'delete') return { data: null, error: null };
        if (op.verb === 'update') {
          if (opts.erroUpdate) return { data: null, error: opts.erroUpdate };
          return { data: { ...CHAMADO_1, ...(op.payload as object) }, error: null };
        }
        const id = filtro(op, 'id');
        if (id) return { data: id === CH1 ? { id: CH1, client_id: C1 } : id === CH2 ? { id: CH2, client_id: C2 } : null, error: null };
        return { data: filtro(op, 'client_id') === C1 ? [CHAMADO_1] : [], error: null };
      }
      case 'marketplace_pedidos': {
        if (op.verb === 'upsert') return { data: null, error: null };
        if (op.verb === 'update') {
          const p = PEDIDOS_.find((x) => x.pedido === filtro(op, 'pedido') && x.chamado_id === filtro(op, 'chamado_id'));
          return { data: p ? { pedido: p.pedido, ...(op.payload as object) } : null, error: null };
        }
        if (filtro(op, 'client_id') !== C1) return { data: [], error: null };
        const chamado = filtro(op, 'chamado_id');
        const nums = filtro(op, 'pedido') as string[] | undefined;
        const lista = Array.isArray(chamado)
          ? PEDIDOS_.filter((p) => p.chamado_id && chamado.includes(p.chamado_id))
          : chamado
            ? PEDIDOS_.filter((p) => p.chamado_id === chamado)
            : nums
              ? PEDIDOS_.filter((p) => nums.includes(p.pedido))
              : PEDIDOS_;
        const [de, ate] = op.range ?? [0, 999];
        return { data: lista.slice(de, ate + 1), error: null };
      }
      case 'marketplace_repasses': {
        if (op.verb === 'upsert') return { data: null, error: null };
        const nums = (filtro(op, 'pedido') as string[]) ?? [];
        return { data: REPASSES.filter((r) => nums.includes(r.pedido)), error: null };
      }
      case 'marketplace_tarifas': {
        if (op.verb !== 'select') return { data: null, error: null };
        const u = filtro(op, 'usuario_id');
        const us = Array.isArray(u) ? u : [u];
        return { data: tarifas.filter((t) => us.includes(t.usuario_id)), error: null };
      }
      default:
        return { data: null, error: null };
    }
  };
}

const rpcOk: FakeRpcHandler = () => ({ data: { id: 'novo', pedidos: 2 }, error: null });

function appEscritorio(b = banco(), rpc: FakeRpcHandler = rpcOk) {
  const { client, ops, rpcOps } = makeFakeSupabase(b, undefined, rpc);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'u-esc', email: 'esc@mastro.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/marketplaces', marketplacesRouter);
  app.use(errorHandler);
  return { app, ops, rpcOps };
}

function appCliente(b = banco(), rpc: FakeRpcHandler = rpcOk) {
  const { client, ops, rpcOps } = makeFakeSupabase(b, undefined, rpc);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: LOGIN, email: 'financeiro@alfa.com', token: 't', papel: 'cliente' };
    req.supabaseAdmin = client;
    next();
  });
  app.use('/marketplaces', portalMarketplacesRouter);
  app.use(errorHandler);
  return { app, ops, rpcOps };
}

const pedidoDe = (body: { pedidos: Array<{ pedido: string }> }, n: string) => body.pedidos.find((p) => p.pedido === n);

describe('POST /marketplaces/shopee/importar', () => {
  const importar = (app: express.Express, arquivos: Array<[Buffer, string]>, client = C1) => {
    let r = request(app).post('/marketplaces/shopee/importar').field('client_id', client);
    for (const [b, nome] of arquivos) r = r.attach('arquivos', b, nome);
    return r;
  };

  it('lê os três relatórios, liga a empresa à loja e grava sem nada do comprador', async () => {
    const { app, ops } = appEscritorio();
    const res = await importar(app, [
      [relatorioPedidos(), 'Order.all.xlsx'],
      [relatorioRenda(), 'Income.lançado.xlsx'],
      [relatorioCarteira(), 'my_balance.xlsx'],
    ]);
    expect(res.status).toBe(201);
    expect(res.body.loja).toBe('loja_teste');
    expect(res.body.importados.map((i: { tipo: string; linhas: number }) => [i.tipo, i.linhas])).toEqual([
      ['pedidos', 5],
      ['renda', 1],
      ['carteira', 5],
    ]);
    expect(ops.find((o) => o.table === 'marketplace_lojas' && o.verb === 'insert')!.payload).toEqual({
      owner_id: ESC,
      client_id: C1,
      marketplace: 'shopee',
      loja: 'loja_teste',
    });
    const upserts = ops.filter((o) => o.verb === 'upsert');
    expect(upserts.map((o) => [o.table, o.onConflict, !!o.ignoreDuplicates])).toEqual([
      ['marketplace_pedidos', 'client_id,marketplace,pedido', false],
      ['marketplace_repasses', 'client_id,marketplace,pedido', false],
      // pago sem relatório de pedidos entra com o mínimo, sem sobrescrever
      ['marketplace_pedidos', 'client_id,marketplace,pedido', true],
      ['marketplace_carteira', 'client_id,marketplace,chave', false],
    ]);
    expect(JSON.stringify(upserts.map((o) => o.payload))).not.toContain(COMPRADOR);
    expect(ops.filter((o) => o.table === 'marketplace_importacoes' && o.verb === 'insert')).toHaveLength(3);
  });

  it('relatório de outra loja: 409 e nada gravado', async () => {
    const { app, ops } = appEscritorio(banco({ loja: 'outra_loja' }));
    const res = await importar(app, [[relatorioRenda(), 'Income.xlsx']]);
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: 'loja_diferente', loja: 'loja_teste', loja_da_empresa: 'outra_loja' });
    expect(ops.some((o) => o.verb === 'upsert' || o.verb === 'insert')).toBe(false);
  });

  it('a loja já está em outra empresa do escritório: 409', async () => {
    const { app } = appEscritorio(banco({ erroLoja: { code: '23505', message: 'duplicate key marketplace_lojas_loja_idx' } }));
    const res = await importar(app, [[relatorioCarteira(), 'carteira.xlsx']]);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('loja_em_outra_empresa');
  });

  it('arquivo que não é relatório da Shopee: 400 com o nome, antes de gravar', async () => {
    const { app, ops } = appEscritorio();
    const outro = xlsxDeTeste({ Planilha1: [['Data', 'Histórico', 'Valor']] });
    const res = await importar(app, [
      [relatorioRenda(), 'Income.xlsx'],
      [outro, 'extrato.xlsx'],
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/extrato\.xlsx/);
    expect(ops.some((o) => o.verb === 'upsert')).toBe(false);
    expect((await importar(app, [])).status).toBe(400);
  });

  it('empresa que o login não vê: 404', async () => {
    const { app } = appCliente();
    expect((await importar(app, [[relatorioRenda(), 'Income.xlsx']], C2)).status).toBe(404);
  });
});

describe('GET /marketplaces/shopee/conferencia', () => {
  it('mês: pagos, não pagos, cancelados, comissão a maior e o chamado de cada pedido', async () => {
    const { app, ops } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&mes=2026-10`);
    expect(res.status).toBe(200);
    expect(res.body.tabela).toEqual({ preenchida: true, por_email: 'financeiro@alfa.com', em: '2026-11-01T10:00:00Z' });
    expect(res.body.resumo).toMatchObject({
      pedidos: 5,
      por_pagamento: { pago: 2, nao_pago: 2, cancelado: 1, aguardando: 0, em_andamento: 0, devolvido: 0 },
      nao_pago_valor: 200,
      comissao_a_mais: { pedidos: 1, valor: 3 },
      taxas_a_mais: { pedidos: 0, valor: 0 },
    });
    expect(pedidoDe(res.body, 'P-COMISSAO')).toMatchObject({
      tarifa: { comissao: { esperada: 20, cobrada: 23, diferenca: 3, situacao: 'a_mais' }, taxas: { situacao: 'ok' } },
      itens: 2,
    });
    expect(pedidoDe(res.body, 'P-EM-CHAMADO')).toMatchObject({ chamado: 'aberto', chamado_info: { numero: 'SHP-1', aberto_em: '2026-11-10' } });
    expect(pedidoDe(res.body, 'P-NAO-PAGO')).toMatchObject({ chamado: 'nenhum', chamado_info: null });
    const op = ops.find((o) => o.table === 'marketplace_pedidos')!;
    expect(op.rangeFilters).toEqual([
      { op: 'gte', col: 'criado_em', val: '2026-10-01T00:00:00-03:00' },
      { op: 'lte', col: 'criado_em', val: '2026-10-31T23:59:59.999-03:00' },
    ]);
  });

  it('período: pedidos criados entre duas datas (vários meses), em São Paulo', async () => {
    const { app, ops } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&escopo=periodo&de=2026-09-01&ate=2026-11-24`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ escopo: 'periodo', de: '2026-09-01', ate: '2026-11-24' });
    expect(res.body.resumo.pedidos).toBe(5);
    expect(ops.find((o) => o.table === 'marketplace_pedidos')!.rangeFilters).toEqual([
      { op: 'gte', col: 'criado_em', val: '2026-09-01T00:00:00-03:00' },
      { op: 'lte', col: 'criado_em', val: '2026-11-24T23:59:59.999-03:00' },
    ]);
  });

  it('período sem data, ao contrário ou maior que um ano: 400', async () => {
    const { app } = appEscritorio();
    const url = (q: string) => `/marketplaces/shopee/conferencia?client_id=${C1}&escopo=periodo${q}`;
    expect((await request(app).get(url('&de=2026-09-01'))).status).toBe(400);
    expect((await request(app).get(url('&de=2026-11-24&ate=2026-09-01'))).body.error).toMatch(/inicial vem depois/);
    expect((await request(app).get(url('&de=2025-01-01&ate=2026-11-24'))).body.error).toMatch(/366 dias/);
    expect((await request(app).get(url('&de=2026-02-30&ate=2026-13-01'))).status).toBe(400);
  });

  it('a devolução debitada a mais vem da carteira', async () => {
    const carteira = [{ pedido: 'P-PAGO', data: '2026-10-20T10:00:00-03:00', seq: 1, categoria: 'debito_devolucao', valor: '-80.00', saldo_apos: null }];
    const { app } = appEscritorio(banco({ carteira }));
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&mes=2026-10`);
    expect(pedidoDe(res.body, 'P-PAGO')).toMatchObject({ devolucao: { depois: 80, limite: 71, a_mais: 9 } });
  });

  it('pendentes: só o que precisa de chamado e ainda não está em nenhum', async () => {
    const { app } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&escopo=pendentes`);
    expect(res.status).toBe(200);
    expect(res.body.pedidos.map((p: { pedido: string }) => p.pedido)).toEqual(['P-COMISSAO', 'P-NAO-PAGO']);
    expect(res.body.resumo.pedidos).toBe(2);
  });

  it('chamado: os pedidos daquele chamado', async () => {
    const { app, ops } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&escopo=chamado&chamado_id=${CH1}`);
    expect(res.body.pedidos.map((p: { pedido: string }) => p.pedido)).toEqual(['P-EM-CHAMADO']);
    expect(ops.find((o) => o.table === 'marketplace_pedidos')!.filters).toContainEqual(['chamado_id', CH1]);
  });

  it('mês inválido: 400; empresa que o login não vê: 404', async () => {
    const { app } = appEscritorio();
    expect((await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&mes=2026-13`)).status).toBe(400);
    expect((await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}`)).status).toBe(400);
    expect((await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C2}&mes=2026-10`)).status).toBe(404);
    const cliente = appCliente();
    expect((await request(cliente.app).get(`/marketplaces/shopee/conferencia?client_id=${C2}&mes=2026-10`)).status).toBe(404);
  });

  it('sem tabela do cliente: avisa, e os pagos ficam "sem tabela"', async () => {
    const { app } = appEscritorio(banco({ tarifas: [] }));
    const res = await request(app).get(`/marketplaces/shopee/conferencia?client_id=${C1}&mes=2026-10`);
    expect(res.body.tabela.preenchida).toBe(false);
    expect(res.body.resumo.tarifa_sem_tabela).toBe(2);
  });
});

describe('GET /marketplaces/shopee/custos', () => {
  it('custos do mês pela carteira, fechando com ela', async () => {
    const carteira = [
      { pedido: 'P-PAGO', data: '2026-10-12T10:00:00-03:00', seq: 1, categoria: 'renda_pedido', valor: '71.00', saldo_apos: '171.00' },
      { pedido: 'P-COMISSAO', data: '2026-10-13T10:00:00-03:00', seq: 2, categoria: 'renda_pedido', valor: '68.00', saldo_apos: '239.00' },
      { pedido: null, data: '2026-10-14T10:00:00-03:00', seq: 3, categoria: 'penalidade', valor: '-100.00', saldo_apos: '139.00' },
    ];
    const { app, ops } = appEscritorio(banco({ carteira }));
    const res = await request(app).get(`/marketplaces/shopee/custos?client_id=${C1}&de=2026-10&ate=2026-10`);
    expect(res.status).toBe(200);
    expect(res.body.meses).toHaveLength(1);
    expect(res.body.meses[0]).toMatchObject({
      mes: '2026-10',
      pedidos: 2,
      itens: 4,
      vendas: 200,
      total_custos: 161,
      recebido: 39,
      carteira: 39,
      fecha: true,
    });
    expect(res.body.meses[0].custos).toMatchObject({ comissao: 43, por_item: 18, penalidade: 100 });
    const op = ops.find((o) => o.table === 'marketplace_carteira')!;
    expect(op.rangeFilters).toEqual([
      { op: 'gte', col: 'data', val: '2026-10-01T00:00:00-03:00' },
      { op: 'lte', col: 'data', val: '2026-10-31T23:59:59.999-03:00' },
    ]);
  });

  it('período ao contrário ou maior que 12 meses: 400', async () => {
    const { app } = appEscritorio();
    expect((await request(app).get(`/marketplaces/shopee/custos?client_id=${C1}&de=2026-10&ate=2026-09`)).status).toBe(400);
    expect((await request(app).get(`/marketplaces/shopee/custos?client_id=${C1}&de=2025-01&ate=2026-10`)).status).toBe(400);
  });
});

describe('chamados em lote', () => {
  it('abre o chamado com o lote, a data e o nº, pela função do banco', async () => {
    const { app, rpcOps } = appEscritorio();
    const res = await request(app)
      .post('/marketplaces/shopee/chamados')
      .send({ client_id: C1, pedidos: ['P-NAO-PAGO', 'P-COMISSAO', 'P-NAO-PAGO'], numero: 'SHP-99', aberto_em: '2026-11-20', obs: 'lote outubro' });
    expect(res.status).toBe(201);
    expect(rpcOps).toEqual([
      {
        fn: 'abrir_chamado_marketplace',
        args: {
          p_client: C1,
          p_marketplace: 'shopee',
          p_pedidos: ['P-NAO-PAGO', 'P-COMISSAO'],
          p_numero: 'SHP-99',
          p_aberto_em: '2026-11-20',
          p_obs: 'lote outubro',
          p_email: 'esc@mastro.com',
        },
      },
    ]);
  });

  it('pedido que já está em chamado: 409 com a lista (o banco não grava nada)', async () => {
    const { app } = appEscritorio(banco(), () => ({
      data: null,
      error: { code: 'MP409', message: 'Há pedido(s) que já estão em outro chamado.', details: '[{"pedido":"P-EM-CHAMADO","numero":"SHP-1","aberto_em":"2026-11-10"}]' },
    }));
    const res = await request(app)
      .post('/marketplaces/shopee/chamados')
      .send({ client_id: C1, pedidos: ['P-EM-CHAMADO', 'P-NAO-PAGO'], aberto_em: '2026-11-20' });
    expect(res.status).toBe(409);
    expect(res.body.details).toEqual({
      code: 'pedido_em_chamado',
      pedidos: [{ pedido: 'P-EM-CHAMADO', numero: 'SHP-1', aberto_em: '2026-11-10' }],
    });
  });

  it('nº repetido: 409; data no futuro ou lote vazio: 400', async () => {
    const { app } = appEscritorio(banco(), () => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "marketplace_chamados_numero_idx"' },
    }));
    const rep = await request(app).post('/marketplaces/shopee/chamados').send({ client_id: C1, pedidos: ['P-NAO-PAGO'], numero: 'SHP-1', aberto_em: '2026-11-20' });
    expect(rep.status).toBe(409);
    expect(rep.body.error).toMatch(/já existe um chamado com esse número/i);
    expect((await request(app).post('/marketplaces/shopee/chamados').send({ client_id: C1, pedidos: ['P-NAO-PAGO'], aberto_em: '2999-01-01' })).status).toBe(400);
    expect((await request(app).post('/marketplaces/shopee/chamados').send({ client_id: C1, pedidos: [], aberto_em: '2026-11-20' })).status).toBe(400);
  });

  it('lista os chamados com quantos pedidos, o valor e quantos já foram pagos', async () => {
    const { app } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/chamados?client_id=${C1}`);
    expect(res.body.chamados).toEqual([
      expect.objectContaining({ id: CH1, numero: 'SHP-1', pedidos: 1, valor: 80, pagos: 0, resolvidos: 0, situacao: 'aberto' }),
    ]);
  });

  it('pedido pago mas com comissão a mais continua pendente no chamado (o chamado é pela cobrança)', async () => {
    const comComissaoNoChamado = PEDIDOS.map((p) => (p.pedido === 'P-COMISSAO' ? { ...p, chamado_id: CH1, chamado: CHAMADO_1 } : p));
    const { app } = appEscritorio(banco({ pedidos: comComissaoNoChamado }));
    const res = await request(app).get(`/marketplaces/shopee/chamados?client_id=${C1}`);
    expect(res.body.chamados[0]).toMatchObject({ pedidos: 2, pagos: 1, resolvidos: 0, situacao: 'aberto' });
  });

  it('informar o nº depois, resolver o lote, tirar um pedido e excluir', async () => {
    const { app, ops } = appEscritorio();
    expect((await request(app).patch(`/marketplaces/shopee/chamados/${CH1}`).send({ numero: 'SHP-1A' })).status).toBe(200);
    expect(ops.find((o) => o.table === 'marketplace_chamados' && o.verb === 'update')!.payload).toEqual({ numero: 'SHP-1A' });

    await request(app).patch(`/marketplaces/shopee/chamados/${CH1}`).send({ acao: 'resolver' });
    expect(ops.filter((o) => o.table === 'marketplace_chamados' && o.verb === 'update')[1]!.payload).toMatchObject({
      resolvido_por_email: 'esc@mastro.com',
      resolvido_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    expect((await request(app).patch(`/marketplaces/shopee/chamados/${CH1}/pedido`).send({ pedido: 'P-EM-CHAMADO', acao: 'tirar' })).status).toBe(200);
    expect(ops.find((o) => o.table === 'marketplace_pedidos' && o.verb === 'update')!.payload).toEqual({
      chamado_id: null,
      chamado_resolvido_em: null,
      chamado_resolvido_por_email: null,
    });
    expect((await request(app).patch(`/marketplaces/shopee/chamados/${CH1}/pedido`).send({ pedido: 'P-NAO-PAGO', acao: 'tirar' })).status).toBe(404);

    expect((await request(app).delete(`/marketplaces/shopee/chamados/${CH1}`)).status).toBe(204);
  });

  it('nº repetido ao informar depois: 409', async () => {
    const { app } = appEscritorio(banco({ erroUpdate: { code: '23505', message: 'duplicate key ... "marketplace_chamados_numero_idx"' } }));
    expect((await request(app).patch(`/marketplaces/shopee/chamados/${CH1}`).send({ numero: 'SHP-2' })).status).toBe(409);
  });

  it('o cliente também abre e acompanha; chamado de empresa de outro cliente: 404', async () => {
    const { app, rpcOps } = appCliente();
    expect((await request(app).post('/marketplaces/shopee/chamados').send({ client_id: C1, pedidos: ['P-NAO-PAGO'], aberto_em: '2026-11-20' })).status).toBe(201);
    expect(rpcOps[0]!.args).toMatchObject({ p_email: 'financeiro@alfa.com' });
    expect((await request(app).patch(`/marketplaces/shopee/chamados/${CH2}`).send({ numero: 'X' })).status).toBe(404);
    expect((await request(app).delete(`/marketplaces/shopee/chamados/${CH2}`)).status).toBe(404);
  });
});

describe('tabela de tarifas', () => {
  it('o escritório só consulta: vê a tabela que vale pra empresa e quem preencheu; gravar é 403', async () => {
    const { app } = appEscritorio();
    const res = await request(app).get(`/marketplaces/shopee/tarifas?client_id=${C1}`);
    expect(res.body).toMatchObject({ pode_editar: false, preenchido_por_email: 'financeiro@alfa.com' });
    expect(res.body.tarifas).toHaveLength(1);
    const put = await request(app).put('/marketplaces/shopee/tarifas').send({ tarifas: [] });
    expect(put.status).toBe(403);
    expect(put.body.error).toMatch(/preenchida pelo cliente/);
  });

  it('empresa com dois logins que preencheram: vale a tabela salva por último', async () => {
    const { app } = appEscritorio(
      banco({
        logins: [LOGIN, OUTRO_LOGIN],
        tarifas: [tarifa(T1, LOGIN, '2026-11-01T10:00:00Z', 0, null), tarifa(T2, OUTRO_LOGIN, '2026-11-20T10:00:00Z', 0, null, '5.00')],
      }),
    );
    const res = await request(app).get(`/marketplaces/shopee/tarifas?client_id=${C1}`);
    expect(res.body.preenchido_por_email).toBe('socio@alfa.com');
    expect(res.body.tarifas.map((t: { id: string }) => t.id)).toEqual([T2]);
  });

  it('o cliente vê a tabela do próprio login (vale pra todas as empresas dele)', async () => {
    const { app } = appCliente();
    const res = await request(app).get('/marketplaces/shopee/tarifas');
    expect(res.body).toMatchObject({ pode_editar: true, empresas: 1 });
    expect(res.body.tarifas[0]).toMatchObject({ id: T1, comissao_pct: 20, transacao_pct: 0, por_item: 4.5, por_pedido: 0, preco_max: 199.99 });
  });

  it('o cliente grava as cinco partes: atualiza o que mudou, inclui o novo e tira o que saiu, com o e-mail dele', async () => {
    const { app, ops } = appCliente();
    const res = await request(app)
      .put('/marketplaces/shopee/tarifas')
      .send({
        tarifas: [
          { id: T1, vigencia_inicio: '2026-01-01', vigencia_fim: null, preco_min: 0, preco_max: 79.99, comissao_pct: 20, por_item: 4.5 },
          { vigencia_inicio: '2026-01-01', preco_min: 80, preco_max: null, comissao_pct: 14, transacao_pct: 1.4, campanha_pct: 5, por_item: 16, por_pedido: 0.49 },
        ],
      });
    expect(res.status).toBe(200);
    const upd = ops.find((o) => o.table === 'marketplace_tarifas' && o.verb === 'update')!;
    expect(upd.payload).toMatchObject({ preco_max: 79.99, preenchido_por_email: 'financeiro@alfa.com' });
    expect(upd.filters).toContainEqual(['usuario_id', LOGIN]);
    const ins = ops.find((o) => o.table === 'marketplace_tarifas' && o.verb === 'insert')!;
    expect(ins.payload).toEqual([
      expect.objectContaining({
        owner_id: ESC,
        usuario_id: LOGIN,
        marketplace: 'shopee',
        preco_min: 80,
        comissao_pct: 14,
        transacao_pct: 1.4,
        campanha_pct: 5,
        por_item: 16,
        por_pedido: 0.49,
        preenchido_por_email: 'financeiro@alfa.com',
      }),
    ]);
    expect(ops.some((o) => o.table === 'marketplace_tarifas' && o.verb === 'delete')).toBe(false);
  });

  it('linha que sai da tabela é apagada; faixas que se sobrepõem ou ao contrário são recusadas', async () => {
    const { app, ops } = appCliente();
    expect((await request(app).put('/marketplaces/shopee/tarifas').send({ tarifas: [] })).status).toBe(200);
    expect(ops.find((o) => o.table === 'marketplace_tarifas' && o.verb === 'delete')?.filters).toContainEqual(['id', [T1]]);

    const sobre = await request(app)
      .put('/marketplaces/shopee/tarifas')
      .send({
        tarifas: [
          { vigencia_inicio: '2026-01-01', preco_min: 0, preco_max: 100, comissao_pct: 20, por_item: 4 },
          { vigencia_inicio: '2026-06-01', preco_min: 50, preco_max: 150, comissao_pct: 14, por_item: 16 },
        ],
      });
    expect(sobre.status).toBe(400);
    expect(sobre.body.error).toMatch(/linhas 1 e 2/);

    const contrario = await request(app)
      .put('/marketplaces/shopee/tarifas')
      .send({ tarifas: [{ vigencia_inicio: '2026-01-01', preco_min: 100, preco_max: 50, comissao_pct: 20, por_item: 4 }] });
    expect(contrario.status).toBe(400);
    expect(contrario.body.error).toMatch(/Linha 1: o preço máximo é menor/);
  });
});
