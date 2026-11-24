/** Custos do mês a mês pela carteira — dados fictícios, no formato da Shopee. */
import { describe, expect, it } from 'vitest';
import type { Movimento, Repasse } from './conferencia.js';
import { custosDoRepasse, custosPorMes, taxasAtuais, taxasObservadas } from './custos.js';

const zero = {
  reembolso: 0,
  cupom: 0,
  incentivo_cupom: 0,
  voucher_loja: 0,
  frete_comprador: 0,
  frete_desconto: 0,
  frete_transportadora: 0,
  outros: 0,
  frete_esperado: null,
  frete_real: null,
};

/** Setembro: R$ 49,99 a 18% / 2% / 3,5% / R$ 4,00 / R$ 0,49. */
const A: Repasse = {
  ...zero,
  pedido: 'A',
  criado_dia: '2026-09-20',
  pago_em: '2026-09-30',
  preco: 49.99,
  comissao_bruta: -9,
  comissao_liquida: -9,
  servico_bruta: -6.75,
  servico_liquida: -6.75,
  transacao: -1,
  campanha: -1.75,
  por_item: -4,
  devolucao_facil: -0.49,
  liquido: 33.75,
};

/** Outubro, com cupom da Shopee: a loja paga R$ 4,54 e a Shopee devolve R$ 4,54 nas taxas. */
const B: Repasse = {
  ...zero,
  pedido: 'B',
  criado_dia: '2026-10-05',
  pago_em: '2026-10-10',
  preco: 34.9,
  cupom: -4.54,
  comissao_bruta: -6.49,
  comissao_liquida: -3.81,
  servico_bruta: -6.21,
  servico_liquida: -4.35,
  transacao: -0.34,
  campanha: -0.86,
  por_item: -3.15,
  devolucao_facil: -0.49,
  liquido: 21.71,
};

let seq = 0;
const mov = (data: string, categoria: Movimento['categoria'], valor: number, saldo: number, pedido: string | null = null): Movimento => ({
  data,
  categoria,
  valor,
  saldo_apos: saldo,
  pedido,
  seq: ++seq,
});

const MOVIMENTOS: Movimento[] = [
  // 30/09 23:30 em São Paulo (01/10 em UTC) — é setembro
  mov('2026-10-01T02:30:00+00:00', 'renda_pedido', 33.75, 133.75, 'A'),
  mov('2026-10-10T10:00:00-03:00', 'renda_pedido', 21.71, 155.46, 'B'),
  // A devolvido depois do pagamento: a Shopee debita o que pagou + R$ 0,49
  mov('2026-10-12T10:00:00-03:00', 'debito_devolucao', -34.24, 121.22, 'A'),
  mov('2026-10-13T10:00:00-03:00', 'objeto_perdido', 11.22, 132.44, 'X'),
  mov('2026-10-14T10:00:00-03:00', 'saque', -100, 32.44),
  mov('2026-10-15T10:00:00-03:00', 'anuncios', -20, 12.44),
  mov('2026-10-16T10:00:00-03:00', 'penalidade', -5, 7.44),
  mov('2026-10-17T10:00:00-03:00', 'difal', -3, 4.44),
  // pedido sem o relatório de renda; e o saldo anda R$ 0,49 a menos que a transação
  mov('2026-10-18T10:00:00-03:00', 'renda_pedido', 10, 13.95, 'P9'),
];

describe('custos do pagamento', () => {
  it('a soma dos custos é preço − líquido; com cupom, a bruta é rateada e o cupom líquido é zero', () => {
    const cs = custosDoRepasse(B);
    expect(Object.values(cs).reduce((a, b) => a + b, 0)).toBe(Math.round((B.preco - B.liquido) * 100));
    expect(cs.comissao).toBe(649);
    expect(cs.transacao + cs.campanha + cs.por_item).toBe(621);
    expect(cs.cupom_shopee).toBe(0);
  });
});

describe('custos por mês', () => {
  const { meses, total } = custosPorMes(MOVIMENTOS, [A, B], new Map([['A', 1]]));
  const [set, out] = meses;

  it('o mês é o da carteira em São Paulo, e a conta fecha com ela', () => {
    expect(meses.map((m) => m.mes)).toEqual(['2026-09', '2026-10']);
    expect(set).toMatchObject({
      pedidos: 1,
      itens: 1,
      vendas: 49.99,
      devolvido: 0,
      total_custos: 16.24,
      recebido: 33.75,
      carteira: 33.75,
      fecha: true,
    });
    expect(set!.custos).toMatchObject({ comissao: 9, transacao: 1, campanha: 1.75, por_item: 4, devolucao_facil: 0.49 });
    expect(set!.aplicadas).toEqual({
      comissao: { '18%': 1 },
      transacao: { '2%': 1 },
      campanha: { '3,5%': 1 },
      por_item: { 'R$ 4,00': 1 },
      por_pedido: { 'R$ 0,49': 1 },
    });
  });

  it('devolução depois do pagamento: sai das vendas e as taxas voltam; anúncios, penalidade e DIFAL são custo; saque não', () => {
    expect(out).toMatchObject({
      pedidos: 1,
      vendas: 34.9,
      devolvido: 49.99,
      compensacao: 11.22,
      saques: -100,
      sem_detalhe: { pedidos: 1, valor: 10 },
      recebido: -19.31,
      carteira: -19.31,
      fecha: true,
      saldo: { quebras: 1, valor: -0.49 },
    });
    expect(out!.custos).toMatchObject({
      comissao: -2.51, // 6,49 do B − 9,00 devolvidos do A
      cupom_shopee: 0,
      anuncios: 20,
      penalidade: 5,
      difal: 3,
    });
    expect(out!.total_custos).toBe(25.44);
  });

  it('o total soma os meses', () => {
    expect(total).toMatchObject({ mes: 'total', pedidos: 2, vendas: 84.89, recebido: 14.44, carteira: 14.44, fecha: true });
  });
});

describe('taxas observadas', () => {
  it('a % mais comum do dia e as taxas atuais (desde quando valem)', () => {
    const dia = (d: string, pedido: string): Repasse => ({ ...A, criado_dia: d, pedido });
    const out = {
      ...A,
      criado_dia: '2026-10-02',
      pedido: 'O',
      comissao_bruta: -9.3,
      comissao_liquida: -9.3,
      servico_bruta: -6.95,
      servico_liquida: -6.95,
      transacao: -0.7,
      por_item: -4.5,
    };
    // dia só com pedido de cupom: vale a taxa do dia limpo mais perto
    const soCupom = { ...B, criado_dia: '2026-10-03', pedido: 'C' };
    const obs = taxasObservadas([dia('2026-09-20', 'A1'), dia('2026-09-21', 'A2'), out, soCupom], new Map());
    expect(obs.get('2026-09-20')).toEqual({ comissao: 18, transacao: 2, campanha: 3.5, por_item: 4, por_pedido: 0.49 });
    expect(obs.get('2026-10-02')).toMatchObject({ comissao: 18.6, transacao: 1.4, por_item: 4.5 });
    expect(obs.get('2026-10-03')).toEqual(obs.get('2026-10-02'));
    expect(taxasAtuais(obs)).toMatchObject({ comissao: 18.6, desde: '2026-10-02' });
    expect(taxasAtuais(new Map())).toBeNull();
  });
});
