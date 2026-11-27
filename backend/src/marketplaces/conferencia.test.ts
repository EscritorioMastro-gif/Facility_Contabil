/**
 * Regras da conferência de marketplaces. A tabela aqui é a que a Shopee
 * aplicou na loja da amostra (conferida centavo a centavo em 2.533 pedidos) —
 * a de verdade o cliente preenche no portal. Pedidos fictícios.
 */
import { describe, expect, it } from 'vitest';
import {
  conferir,
  conferirPedido,
  diaEmSaoPaulo,
  precisaDeChamado,
  situacaoPagamento,
  sobreposicoes,
  tarifaEsperada,
  type Movimento,
  type Pedido,
  type Repasse,
  type Tarifa,
} from './conferencia.js';
import { lerXlsx } from './xlsx.js';
import { lerRelatorioShopee, type RelatorioShopee } from './shopee.js';
import { relatorioRendaLoja2 } from '../test/relatoriosShopee.js';

const AGORA = new Date('2026-11-24T12:00:00-03:00');

const TABELA: Tarifa[] = [
  { vigencia_inicio: '2026-01-01', vigencia_fim: '2026-09-30', preco_min: 0, preco_max: null, comissao_pct: 18, transacao_pct: 2, campanha_pct: 3.5, por_item: 4, por_pedido: 0.49 },
  { vigencia_inicio: '2026-10-01', vigencia_fim: '2026-10-27', preco_min: 0, preco_max: null, comissao_pct: 18.6, transacao_pct: 1.4, campanha_pct: 3.5, por_item: 4.5, por_pedido: 0.49 },
  { vigencia_inicio: '2026-10-28', vigencia_fim: null, preco_min: 0, preco_max: null, comissao_pct: 18.6, transacao_pct: 1.4, campanha_pct: 5, por_item: 4.5, por_pedido: 0.49 },
];

const pedido = (over: Partial<Pedido> = {}): Pedido => ({
  pedido: 'P1',
  status: 'concluido',
  criado_em: '2026-10-01T09:00:00-03:00',
  concluido_em: '2026-10-05T12:00:00-03:00',
  itens: [{ preco: 49.99, qtd: 1 }],
  ...over,
});

const repasse = (over: Partial<Repasse> = {}): Repasse => ({
  pedido: 'P1',
  criado_dia: '2026-10-01',
  pago_em: '2026-10-06',
  preco: 49.99,
  reembolso: 0,
  cupom: 0,
  incentivo_cupom: 0,
  voucher_loja: 0,
  frete_comprador: 0,
  frete_desconto: 8.39,
  frete_transportadora: -8.39,
  comissao_bruta: -9.3,
  comissao_liquida: -9.3,
  servico_bruta: -6.95,
  servico_liquida: -6.95,
  transacao: -0.7,
  campanha: -1.75,
  por_item: -4.5,
  devolucao_facil: -0.49,
  outros: 0,
  liquido: 33.25,
  frete_esperado: null,
  frete_real: null,
  ...over,
});

const mov = (categoria: Movimento['categoria'], valor: number, pedido_ = 'P1'): Movimento => ({
  pedido: pedido_,
  data: '2026-10-12T10:00:00-03:00',
  seq: 1,
  categoria,
  valor,
  saldo_apos: null,
});

describe('situação do pagamento', () => {
  const sit = (p: Partial<Pedido>, rep: Repasse | null = null, credito = false) =>
    situacaoPagamento({ ...pedido(), ...p }, rep, credito, AGORA).situacao;

  it('pago, aguardando (menos de 7 dias), não pago (7 dias ou mais)', () => {
    expect(sit({}, repasse())).toBe('pago');
    expect(sit({}, null, true)).toBe('pago'); // só o crédito da carteira
    expect(sit({ concluido_em: '2026-11-20T10:00:00-03:00' })).toBe('aguardando');
    expect(sit({ concluido_em: '2026-11-17T11:00:00-03:00' })).toBe('nao_pago');
  });

  it('devolvido por inteiro antes do pagamento, cancelado, ainda em andamento', () => {
    expect(sit({}, repasse({ reembolso: -49.99, liquido: -0.49 }))).toBe('devolvido');
    expect(sit({ status: 'cancelado', concluido_em: null })).toBe('cancelado');
    expect(sit({ status: 'enviado', concluido_em: null })).toBe('em_andamento');
  });
});

describe('tarifa esperada (cinco partes)', () => {
  const esp = (p: Partial<Pedido>, rep: Partial<Repasse>, tabela = TABELA) => tarifaEsperada({ ...pedido(), ...p }, repasse(rep), tabela);

  it('pela vigência da data de criação, cada % arredondado no centavo', () => {
    expect(esp({}, {})).toEqual({
      esperado: { comissao: 9.3, transacao: 0.7, campanha: 1.75, por_item: 4.5, por_pedido: 0.49, itens: 1 },
      itens_estimados: false,
    });
    // até 30/09: 18% / 2% / 3,5% / R$ 4,00
    expect(esp({}, { criado_dia: '2026-09-15' })).toMatchObject({
      esperado: { comissao: 9, transacao: 1, campanha: 1.75, por_item: 4 },
    });
    // a partir de 28/10: Campanha de Destaque 5%
    expect(esp({}, { criado_dia: '2026-10-28' })).toMatchObject({ esperado: { campanha: 2.5 } });
  });

  it('o voucher da loja sai da base (R$ 49,99 com voucher de R$ 2,50 paga 18% sobre R$ 47,49)', () => {
    expect(esp({}, { criado_dia: '2026-09-15', voucher_loja: -2.5 })).toMatchObject({
      esperado: { comissao: 8.55, transacao: 0.95, campanha: 1.66, por_item: 4 },
    });
  });

  it('devolução antes do pagamento: % sobre o que ficou e a taxa por item na proporção', () => {
    // kit de R$ 69,99 com R$ 46,66 devolvido: R$ 4,00 × 1/3
    expect(
      esp({ itens: [{ preco: 69.99, qtd: 1, devolvidos: 1 }] }, { criado_dia: '2026-09-13', preco: 69.99, reembolso: -46.66 }),
    ).toMatchObject({ esperado: { comissao: 4.2, transacao: 0.47, campanha: 0.82, por_item: 1.33, por_pedido: 0.49 } });
    // devolução total: só a taxa por pedido
    expect(esp({}, { reembolso: -49.99 })).toMatchObject({
      esperado: { comissao: 0, transacao: 0, campanha: 0, por_item: 0, por_pedido: 0.49 },
    });
  });

  it('faixas por preço do item; sem faixa = sem_tabela; duas faixas = ambígua', () => {
    const faixas: Tarifa[] = [
      { ...TABELA[1]!, preco_max: 79.99 },
      { ...TABELA[1]!, preco_min: 80, comissao_pct: 14, por_item: 16 },
    ];
    const r = esp({ itens: [{ preco: 50, qtd: 1 }, { preco: 100, qtd: 1 }] }, { preco: 150 }, faixas);
    expect(r).toMatchObject({ esperado: { comissao: 23.3, por_item: 20.5, itens: 2 } });
    expect(esp({}, { criado_dia: '2025-01-01' })).toEqual({ erro: 'sem_tabela' });
    expect(esp({}, {}, [TABELA[1]!, { ...TABELA[1]!, comissao_pct: 20 }])).toEqual({ erro: 'tabela_ambigua' });
  });

  it('sem o relatório de pedidos, a quantidade sai da taxa por item cobrada', () => {
    expect(esp({ itens: [] }, { preco: 99.98, servico_bruta: -13.9 })).toMatchObject({
      esperado: { por_item: 9, itens: 2 },
      itens_estimados: true,
    });
  });
});

describe('conferir um pedido', () => {
  it('tudo certo: comissão e taxas batem', () => {
    const x = conferirPedido(pedido(), repasse(), [], TABELA, AGORA);
    expect(x.tarifa).toMatchObject({
      situacao: 'ok',
      comissao: { esperada: 9.3, cobrada: 9.3, situacao: 'ok' },
      taxas: { esperada: 7.44, cobrada: 7.44, situacao: 'ok' },
    });
    expect(precisaDeChamado(x)).toBe(false);
  });

  it('comissão e taxas a mais aparecem separadas', () => {
    const x = conferirPedido(pedido(), repasse({ comissao_bruta: -10.3, servico_bruta: -7.45 }), [], TABELA, AGORA);
    expect(x.tarifa).toMatchObject({
      situacao: 'cobrado_a_mais',
      comissao: { diferenca: 1, situacao: 'a_mais' },
      taxas: { diferenca: 0.5, situacao: 'a_mais' },
      diferenca: 1.5,
    });
    expect(precisaDeChamado(x)).toBe(true);
  });

  it('cupom da Shopee: a bruta segue a tabela e o desconto que voltou fica registrado', () => {
    const x = conferirPedido(pedido(), repasse({ cupom: -4.54, comissao_liquida: -6.62, servico_liquida: -5.09 }), [], TABELA, AGORA);
    expect(x.tarifa.situacao).toBe('ok');
    expect(x.cupom).toEqual({ cupom: 4.54, desconto_taxas: 4.54 });
  });

  it('devolução depois do pagamento: o débito não pode passar do que a loja recebeu', () => {
    const devolvido = pedido({ status_devolucao: 'Solicitação aprovada', itens: [{ preco: 49.99, qtd: 1, devolvidos: 1 }] });
    const ok = conferirPedido(devolvido, repasse(), [mov('debito_devolucao', -33.74)], TABELA, AGORA);
    expect(ok.devolucao).toMatchObject({ depois: 33.74, limite: 33.74, situacao: 'ok' });
    expect(ok.recebido_final).toBe(-0.49);

    const aMais = conferirPedido(devolvido, repasse(), [mov('debito_devolucao', -49.99)], TABELA, AGORA);
    expect(aMais.devolucao).toMatchObject({ situacao: 'debitado_a_mais', a_mais: 16.25 });
    expect(precisaDeChamado(aMais)).toBe(true);

    const semPedido = conferirPedido(pedido(), repasse(), [mov('debito_devolucao', -10)], TABELA, AGORA);
    expect(semPedido.devolucao?.situacao).toBe('sem_solicitacao');
  });

  it('pacote perdido: compensado, aguardando ou sem compensação', () => {
    const perdido = pedido({ status: 'cancelado', concluido_em: null, motivo_cancelamento: 'Motivo : Pacote perdido em trânsito.' });
    expect(conferirPedido(perdido, null, [mov('objeto_perdido', 11.22)], TABELA, AGORA).perdido).toEqual({
      situacao: 'compensado',
      compensado: 11.22,
    });
    expect(conferirPedido(perdido, null, [], TABELA, AGORA).perdido?.situacao).toBe('sem_compensacao');
    expect(conferirPedido({ ...perdido, criado_em: '2026-11-20T10:00:00-03:00' }, null, [], TABELA, AGORA).perdido?.situacao).toBe(
      'aguardando',
    );
  });

  it('extrato pro cliente: com cupom, a bruta de cada parte (a Shopee tirou o desconto da taxa por item)', () => {
    // pedido real da amostra (261027P1RABYT4): o detalhe da taxa de serviço vem líquido
    const x = conferirPedido(
      pedido({ criado_em: '2026-10-26T20:50:00-03:00', itens: [{ preco: 34.9, qtd: 1 }] }),
      repasse({
        criado_dia: '2026-10-26',
        preco: 34.9,
        cupom: -4.54,
        frete_comprador: 9.06,
        frete_desconto: 9.05,
        frete_transportadora: -18.11,
        comissao_bruta: -6.49,
        comissao_liquida: -3.81,
        servico_bruta: -6.21,
        servico_liquida: -4.35,
        transacao: -0.49,
        campanha: -1.22,
        por_item: -2.64,
        liquido: 21.71,
      }),
      [],
      TABELA,
      AGORA,
    );
    expect(x.tarifa.situacao).toBe('ok');
    expect(x.extrato).toMatchObject({
      preco: 34.9,
      base: 34.9,
      comissao: 6.49,
      transacao: 0.49,
      campanha: 1.22,
      por_item: 4.5,
      devolucao_facil: 0.49,
      cupom: 4.54,
      desconto_taxas: 4.54,
      frete: { comprador: 9.06, desconto_shopee: 9.05, transportadora: 18.11, loja_pagou: 0 },
      liquido: 21.71,
    });
  });

  it('frete a mais por peso', () => {
    const x = conferirPedido(pedido(), repasse({ frete_transportadora: -9.62, frete_esperado: 8.39, frete_real: 9.62 }), [], TABELA, AGORA);
    expect(x.frete_a_mais).toEqual({ valor: 1.23, esperado: 8.39, real: 9.62 });
  });
});

describe('conferir a empresa', () => {
  it('resume por situação, cobranças a mais, devoluções e frete', () => {
    const pedidos = [
      pedido(),
      pedido({ pedido: 'P2' }),
      pedido({ pedido: 'P3', concluido_em: '2026-11-01T10:00:00-03:00', itens: [{ preco: 120, qtd: 1 }] }),
    ];
    const reps = [repasse(), repasse({ pedido: 'P2', comissao_bruta: -12.3, frete_transportadora: -9.62 })];
    const { resumo } = conferir(pedidos, reps, [mov('debito_devolucao', -5, 'P1')], TABELA, AGORA);
    expect(resumo).toMatchObject({
      pedidos: 3,
      por_pagamento: { pago: 2, nao_pago: 1 },
      nao_pago_valor: 120,
      comissao_a_mais: { pedidos: 1, valor: 3 },
      taxas_a_mais: { pedidos: 0, valor: 0 },
      tarifa_cobrada_a_mais: { pedidos: 1, valor: 3 },
      devolucoes: { pedidos: 1, depois: 5 },
      frete_a_mais: { pedidos: 1, valor: 1.23 },
    });
  });
});

it('faixas que se sobrepõem', () => {
  expect(sobreposicoes([TABELA[0]!, TABELA[1]!])).toEqual([]);
  expect(sobreposicoes([TABELA[1]!, { ...TABELA[1]!, vigencia_inicio: '2026-10-15' }])).toEqual([[0, 1]]);
});

it('dia em São Paulo', () => {
  expect(diaEmSaoPaulo('2026-10-01T02:00:00Z')).toBe('2026-09-30');
  expect(diaEmSaoPaulo('2026-10-01')).toBe('2026-10-01');
});

describe('loja com faixas de preço, afiliados, Pix e frete de devolução', () => {
  const faixa = (min: number, max: number | null, com: number, item: number): Tarifa => ({
    vigencia_inicio: '2026-10-01',
    vigencia_fim: null,
    preco_min: min,
    preco_max: max,
    comissao_pct: com,
    transacao_pct: 1.4,
    campanha_pct: 0,
    por_item: item,
    por_pedido: 0,
  });
  const TAB2 = [faixa(0, 79.99, 18.6, 4.5), faixa(80, 99.99, 12.6, 16), faixa(100, 199.99, 12.6, 20)];
  const rel = lerRelatorioShopee(lerXlsx(relatorioRendaLoja2())) as Extract<RelatorioShopee, { tipo: 'renda' }>;
  const rep = (id: string) => rel.repasses.find((x) => x.pedido === id)!;
  const ped = (id: string, itens: Pedido['itens']) => pedido({ pedido: id, criado_em: '2026-10-20T10:00:00-03:00', itens });

  it('a taxa do afiliado não é "tarifa a mais" e aparece no extrato', () => {
    const c = conferirPedido(ped('A1', [{ preco: 46.9, qtd: 1 }]), rep('A1'), [mov('renda_pedido', 25, 'A1')], TAB2, AGORA);
    expect(c.tarifa.situacao).toBe('ok');
    expect(c.extrato).toMatchObject({ afiliados: 8.02, por_item: 4.5, transacao: 0.66, outros: 0 });
  });

  it('itens de duas faixas no mesmo pedido e desconto no Pix compensado', () => {
    const a3 = conferirPedido(ped('A3', [{ preco: 89.9, qtd: 1 }, { preco: 69.99, qtd: 1 }]), rep('A3'), [], TAB2, AGORA);
    expect(a3.tarifa).toMatchObject({ situacao: 'ok', esperado: { comissao: 24.35, transacao: 2.24, por_item: 20.5 } });
    expect(a3.extrato?.por_item).toBe(20.5);
    const a2 = conferirPedido(ped('A2', [{ preco: 89.9, qtd: 1 }]), rep('A2'), [], TAB2, AGORA);
    expect(a2.tarifa.situacao).toBe('ok');
    expect(a2.cupom).toEqual({ cupom: 4.49, desconto_taxas: 4.49 });
    expect(a2.extrato).toMatchObject({ pix: 4.49, cupom: 0, desconto_taxas: 4.49, por_item: 16 });
  });

  it('devolvido antes do pagamento com a loja pagando o frete: não é "debitado a mais"', () => {
    const c = conferirPedido(ped('A4', [{ preco: 64.99, qtd: 1 }]), rep('A4'), [mov('renda_pedido', -24.62, 'A4')], TAB2, AGORA);
    expect(c.devolucao).toMatchObject({ situacao: 'ok', a_mais: 0, limite: 0, antes: 64.99 });
    expect(c.extrato).toMatchObject({ envio_reverso: 15, liquido: -24.62 });
    // e um débito depois do pagamento numa venda que já saiu negativa é todo "a mais"
    const d = conferirPedido(ped('A4', [{ preco: 64.99, qtd: 1 }]), rep('A4'), [mov('debito_devolucao', -5, 'A4')], TAB2, AGORA);
    expect(d.devolucao).toMatchObject({ situacao: 'debitado_a_mais', a_mais: 5 });
  });
});
