/** Dashboard do módulo Classificação — rotas do escritório e do portal. Dados fictícios. */
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { classificacoesRouter } from './router.js';
import { portalClassificacoesRouter } from '../portal/classificacoes.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeRpcOp } from '../test/fakeSupabase.js';
import { bancoEmMemoria } from '../test/bancoEmMemoria.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333'; // de outro cliente

const RESPOSTA = {
  por_classificacao: [
    { direction: 'entrada', nome: 'RECEBIMENTO SHOPEE', total: '1750.00', qtd: 3 },
    { direction: 'entrada', nome: 'RECEBIMENTO SHEIN', total: '750.00', qtd: 1 },
    { direction: 'saida', nome: 'FORNECEDORES', total: '300.00', qtd: 1 },
  ],
  por_mes: [
    { mes: '2026-09', receitas: '1000.00', despesas: '0' },
    { mes: '2026-10', receitas: '1500.00', despesas: '300.00' },
  ],
  por_mes_classificacao: [
    { mes: '2026-09', direction: 'entrada', nome: 'RECEBIMENTO SHOPEE', total: '1000.00', qtd: 1 },
    { mes: '2026-10', direction: 'entrada', nome: 'RECEBIMENTO SHEIN', total: '750.00', qtd: 1 },
    // outra empresa grafou diferente: sai com o nome do período
    { mes: '2026-10', direction: 'entrada', nome: 'Recebimento Shopee', total: '750.00', qtd: 2 },
    { mes: '2026-10', direction: 'saida', nome: 'FORNECEDORES', total: '300.00', qtd: 1 },
  ],
  pendentes: { qtd: 2, total: '40.50' },
};

function app(papel: 'escritorio' | 'cliente') {
  const tabelas = {
    clients: [
      { id: A, razao_social: 'LOJA ALFA', owner_id: 'esc', ativo: true },
      { id: B, razao_social: 'LOJA BETA', owner_id: 'esc', ativo: true },
      { id: C, razao_social: 'OUTRO CLIENTE', owner_id: 'esc', ativo: true },
    ],
    cliente_acessos: [
      { id: 'ac1', user_id: 'login-1', client_id: A },
      { id: 'ac2', user_id: 'login-1', client_id: B },
    ],
  };
  const rpcs: FakeRpcOp[] = [];
  const { client } = makeFakeSupabase(bancoEmMemoria(tabelas), undefined, (op) => {
    rpcs.push(op);
    return { data: RESPOSTA, error: null };
  });
  const a = express();
  a.use((req, _res, next) => {
    req.auth = { userId: 'login-1', email: 'x@x.test', token: 't', papel: papel === 'cliente' ? 'cliente' : undefined };
    req.escritorioId = 'esc';
    req.supabase = client;
    req.supabaseAdmin = client;
    next();
  });
  a.use('/classificacoes', papel === 'cliente' ? portalClassificacoesRouter : classificacoesRouter);
  a.use(errorHandler);
  return { app: a, rpcs };
}

describe('dashboard do módulo Classificação', () => {
  it('escritório: uma empresa, com totais, % do total e meses em centavos', async () => {
    const { app: a, rpcs } = app('escritorio');
    const res = await request(a).get(`/classificacoes/dashboard?client_id=${A}&de=2026-10-01&ate=2026-10-31`);
    expect(res.status).toBe(200);
    expect(rpcs[0]?.args).toEqual({ p_clients: [A], p_de: '2026-10-01', p_ate: '2026-10-31' });
    expect(res.body.empresas).toEqual([{ id: A, razao_social: 'LOJA ALFA' }]);
    expect(res.body.totais).toEqual({ receitas_cents: 250000, despesas_cents: 30000, resultado_cents: 220000 });
    expect(res.body.receitas).toEqual([
      { nome: 'RECEBIMENTO SHOPEE', total_cents: 175000, qtd: 3, percentual: 70 },
      { nome: 'RECEBIMENTO SHEIN', total_cents: 75000, qtd: 1, percentual: 30 },
    ]);
    expect(res.body.despesas).toEqual([{ nome: 'FORNECEDORES', total_cents: 30000, qtd: 1, percentual: 100 }]);
    expect(res.body.meses).toEqual([
      {
        mes: '2026-09',
        receitas_cents: 100000,
        despesas_cents: 0,
        receitas: [{ nome: 'RECEBIMENTO SHOPEE', total_cents: 100000, qtd: 1, percentual: 100 }],
        despesas: [],
      },
      {
        mes: '2026-10',
        receitas_cents: 150000,
        despesas_cents: 30000,
        // % sobre o total do mês; empate no valor vai por nome
        receitas: [
          { nome: 'RECEBIMENTO SHEIN', total_cents: 75000, qtd: 1, percentual: 50 },
          { nome: 'RECEBIMENTO SHOPEE', total_cents: 75000, qtd: 2, percentual: 50 },
        ],
        despesas: [{ nome: 'FORNECEDORES', total_cents: 30000, qtd: 1, percentual: 100 }],
      },
    ]);
    expect(res.body.pendentes).toEqual({ qtd: 2, total_cents: 4050 });
  });

  it('escritório: grupo=true soma todas as empresas do mesmo login de cliente', async () => {
    const { app: a, rpcs } = app('escritorio');
    const res = await request(a).get(`/classificacoes/dashboard?client_id=${A}&grupo=true`);
    expect(res.status).toBe(200);
    expect(new Set(rpcs[0]?.args.p_clients as string[])).toEqual(new Set([A, B]));
    expect(res.body.empresas.map((e: { razao_social: string }) => e.razao_social)).toEqual(['LOJA ALFA', 'LOJA BETA']);
  });

  it('escritório: sem empresa → 400; empresa que não existe → 404', async () => {
    const { app: a } = app('escritorio');
    expect((await request(a).get('/classificacoes/dashboard')).status).toBe(400);
    expect((await request(a).get('/classificacoes/dashboard?client_id=99999999-9999-9999-9999-999999999999')).status).toBe(404);
    expect((await request(a).get(`/classificacoes/dashboard?client_id=${A}&de=10/2026`)).status).toBe(400);
  });

  it('cliente: sem empresa = todas as dele; empresa de outro cliente → 404', async () => {
    const { app: a, rpcs } = app('cliente');
    const todas = await request(a).get('/classificacoes/dashboard');
    expect(todas.status).toBe(200);
    expect(new Set(rpcs[0]?.args.p_clients as string[])).toEqual(new Set([A, B]));
    const uma = await request(a).get(`/classificacoes/dashboard?client_id=${B}`);
    expect(uma.status).toBe(200);
    expect(rpcs[1]?.args.p_clients).toEqual([B]);
    expect((await request(a).get(`/classificacoes/dashboard?client_id=${C}`)).status).toBe(404);
    expect(rpcs).toHaveLength(2);
  });
});
