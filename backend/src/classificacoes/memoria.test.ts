/**
 * Memória compartilhada entre as empresas do mesmo cliente (pedido de
 * 2026-11-12): o que foi classificado numa empresa vira sugestão nas outras do
 * mesmo login — com a classificação de mesmo nome da empresa do extrato.
 */
import { describe, expect, it } from 'vitest';
import { makeFakeSupabase, type FakeRpcOp } from '../test/fakeSupabase.js';
import { bancoEmMemoria, type Tabelas } from '../test/bancoEmMemoria.js';
import { sugerirClassificacoes } from './memoria.js';

const A = 'empresa-a'; // a do extrato
const B = 'empresa-b'; // mesmo login de cliente
const C = 'empresa-c'; // mesmo login de cliente
const SOZINHA = 'empresa-sozinha'; // sem login de cliente

type Uso = { descricao: string; direction: string; classificacao_id: string; usos: number; ultima: string | null };

function montar(memoria: Record<string, Uso[]>, extra: Partial<Tabelas> = {}) {
  const tabelas: Tabelas = {
    cliente_acessos: [
      { user_id: 'L1', client_id: A },
      { user_id: 'L1', client_id: B },
      { user_id: 'L1', client_id: C },
    ],
    classificacoes: [
      { id: 'a-energia', client_id: A, direction: 'saida', nome: 'ENERGIA ELÉTRICA', ativo: true },
      { id: 'a-limpeza', client_id: A, direction: 'saida', nome: 'LIMPEZA E HIGIENE', ativo: true },
      { id: 'a-velha', client_id: A, direction: 'saida', nome: 'TELEFONE', ativo: false },
      { id: 'b-energia', client_id: B, direction: 'saida', nome: 'Energia Elétrica', ativo: true },
      { id: 'b-limpeza', client_id: B, direction: 'saida', nome: 'LIMPEZA E HIGIENE', ativo: true },
      { id: 'b-telefone', client_id: B, direction: 'saida', nome: 'TELEFONE', ativo: true },
      { id: 'b-so-dela', client_id: B, direction: 'saida', nome: 'SÓ NA EMPRESA B', ativo: true },
      { id: 'c-limpeza', client_id: C, direction: 'saida', nome: 'LIMPEZA E HIGIENE', ativo: true },
      { id: 'c-energia', client_id: C, direction: 'saida', nome: 'ENERGIA ELÉTRICA', ativo: true },
    ],
    ...extra,
  };
  const chamadas: FakeRpcOp[] = [];
  const { client } = makeFakeSupabase(bancoEmMemoria(tabelas), undefined, (op) => {
    chamadas.push(op);
    return { data: memoria[op.args.p_client as string] ?? [], error: null };
  });
  return { client, chamadas };
}

const uso = (descricao: string, classificacao_id: string, usos = 1, ultima = '2026-10-01'): Uso => ({
  descricao,
  direction: 'saida',
  classificacao_id,
  usos,
  ultima,
});

const saida = (descricao: string) => ({ direction: 'saida', descricao });

describe('memória compartilhada entre as empresas do mesmo cliente', () => {
  it('descrição classificada em outra empresa vira sugestão com a classificação de mesmo nome desta', async () => {
    const { client } = montar({ [B]: [uso('ENERGISA CONTA', 'b-energia')] });
    const sugere = await sugerirClassificacoes(client, { clientId: A, lancamentos: [saida('ENERGISA CONTA')] });
    expect(sugere(saida('ENERGISA CONTA'))).toEqual({ classificacao_id: 'a-energia', origem: 'conferir' });
  });

  it('a memória da própria empresa vale primeiro', async () => {
    const { client } = montar({
      [A]: [uso('ENERGISA CONTA', 'a-limpeza')],
      [B]: [uso('ENERGISA CONTA', 'b-energia', 9)],
    });
    const sugere = await sugerirClassificacoes(client, { clientId: A, lancamentos: [saida('ENERGISA CONTA')] });
    expect(sugere(saida('ENERGISA CONTA'))).toEqual({ classificacao_id: 'a-limpeza', origem: 'memoria' });
  });

  it('várias empresas: soma os usos e fica com a mais usada', async () => {
    const { client } = montar({
      [B]: [uso('MERCADO BOM PRECO', 'b-energia', 2), uso('MERCADO BOM PRECO', 'b-limpeza', 1)],
      [C]: [uso('MERCADO BOM PRECO', 'c-limpeza', 3)],
    });
    const sugere = await sugerirClassificacoes(client, { clientId: A, lancamentos: [saida('MERCADO BOM PRECO')] });
    expect(sugere(saida('MERCADO BOM PRECO'))).toEqual({ classificacao_id: 'a-limpeza', origem: 'conferir' });
  });

  it('classificação que esta empresa não tem (ou desativou) não vira sugestão', async () => {
    const { client } = montar({ [B]: [uso('PIX FULANO', 'b-so-dela'), uso('VIVO FIXO', 'b-telefone')] });
    const sugere = await sugerirClassificacoes(client, {
      clientId: A,
      lancamentos: [saida('PIX FULANO'), saida('VIVO FIXO')],
    });
    expect(sugere(saida('PIX FULANO'))).toBeNull();
    expect(sugere(saida('VIVO FIXO'))).toBeNull();
  });

  it('empresa sem login de cliente: só a própria memória, sem buscar outras', async () => {
    const { client, chamadas } = montar({});
    await sugerirClassificacoes(client, { clientId: SOZINHA, lancamentos: [saida('ENERGISA CONTA')] });
    expect(chamadas.map((c) => c.args.p_client)).toEqual([SOZINHA]);
  });

  it('busca a memória de cada empresa do cliente; o extrato atual só sai da conta da própria empresa', async () => {
    const { client, chamadas } = montar({});
    await sugerirClassificacoes(client, { clientId: A, lancamentos: [saida('X')], excetoExtrato: 'extrato-novo' });
    expect(chamadas.map((c) => [c.args.p_client, c.args.p_excluir]).sort()).toEqual(
      [
        [A, 'extrato-novo'],
        [B, null],
        [C, null],
      ].sort(),
    );
  });
});
