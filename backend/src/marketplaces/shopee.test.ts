import { describe, expect, it } from 'vitest';
import { lerXlsx, XlsxInvalido } from './xlsx.js';
import { dataHora, lerRelatorioShopee, numero, RelatorioDesconhecido, type RelatorioShopee } from './shopee.js';
import { xlsxDeTeste } from '../test/xlsx.js';
import { COMPRADOR, CPF, relatorioCarteira, relatorioPedidos, relatorioRenda } from '../test/relatoriosShopee.js';

const ler = (buf: Buffer) => lerRelatorioShopee(lerXlsx(buf));

describe('lerXlsx', () => {
  it('lê texto compartilhado e inline, número, booleano e célula vazia, comprimido ou não', () => {
    const abas = { Dados: [['a & b', 1.5, null, true], [], ['<x>', -2]] };
    for (const opts of [{}, { comprimir: false }, { inline: true }]) {
      const lido = lerXlsx(xlsxDeTeste(abas, opts));
      expect(lido.get('Dados')).toEqual([['a & b', 1.5, null, true], [], ['<x>', -2]]);
    }
  });

  it('arquivo que não é xlsx é recusado', () => {
    expect(() => lerXlsx(Buffer.from('não sou planilha'))).toThrow(XlsxInvalido);
    expect(() => lerXlsx(Buffer.alloc(0))).toThrow(XlsxInvalido);
  });
});

describe('números e datas do relatório', () => {
  it('aceita número do Excel e texto em real', () => {
    expect(numero(12.5)).toBe(12.5);
    expect(numero('1.234,56')).toBe(1234.56);
    expect(numero('R$ 10,00')).toBe(10);
    expect(numero('-')).toBe(0);
    expect(numero(null)).toBe(0);
  });
  it('data e hora de São Paulo viram ISO com -03:00', () => {
    expect(dataHora('2026-09-01 07:20')).toBe('2026-09-01T07:20:00-03:00');
    expect(dataHora('2026-09-01')).toBe('2026-09-01T00:00:00-03:00');
    expect(dataHora('01/09/2026 07:20:05')).toBe('2026-09-01T07:20:05-03:00');
    expect(dataHora('')).toBeNull();
  });
});

describe('relatório de pedidos', () => {
  const rel = ler(relatorioPedidos()) as Extract<RelatorioShopee, { tipo: 'pedidos' }>;

  it('junta os itens por pedido e normaliza a situação', () => {
    expect(rel.tipo).toBe('pedidos');
    expect(rel.periodo).toEqual({ de: '2026-10-01', ate: '2026-10-01' });
    const p = (id: string) => rel.pedidos.find((x) => x.pedido === id)!;
    expect(rel.pedidos).toHaveLength(5);
    expect(p('P2')).toMatchObject({ status: 'concluido', valor_produtos: 99.8 });
    expect(p('P2').itens).toEqual([
      { sku: 'SKU-B', descricao: 'Kit — P', preco: 39.9, qtd: 2, devolvidos: 0 },
      { sku: 'SKU-C', descricao: 'Boné — P', preco: 20, qtd: 1, devolvidos: 0 },
    ]);
    expect(p('P1')).toMatchObject({ criado_em: '2026-10-01T09:00:00-03:00', concluido_em: '2026-10-05T12:00:00-03:00' });
    expect(p('P3')).toMatchObject({ status: 'cancelado', motivo_cancelamento: expect.stringMatching(/Pacote perdido/) });
    expect(p('P4')).toMatchObject({ status: 'devolvido', status_devolucao: 'Solicitação aprovada' });
    expect(p('P5').status).toBe('enviado');
  });

  it('LGPD: nada do comprador sai do leitor', () => {
    const tudo = JSON.stringify(rel);
    expect(tudo).not.toContain(COMPRADOR);
    expect(tudo).not.toContain(CPF);
    expect(tudo).not.toContain('11999990000');
  });

  it('o mesmo relatório sem compressão dá o mesmo resultado', () => {
    expect(ler(relatorioPedidos({ comprimir: false }))).toEqual(rel);
  });
});

describe('relatório Minha renda', () => {
  const rel = ler(relatorioRenda()) as Extract<RelatorioShopee, { tipo: 'renda' }>;

  it('loja, período e o pagamento de cada pedido (só a linha "Order")', () => {
    expect(rel).toMatchObject({ tipo: 'renda', loja: 'loja_teste', periodo: { de: '2026-10-01', ate: '2026-10-31' } });
    expect(rel.repasses).toEqual([
      {
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
        frete_transportadora: -9.62,
        comissao_bruta: -9.3,
        comissao_liquida: -9.3,
        servico_bruta: -6.95,
        servico_liquida: -6.95,
        // as duas colunas "Taxa de transação" somadas
        transacao: -0.7,
        campanha: -1.75,
        por_item: -4.5,
        devolucao_facil: -0.49,
        outros: 0,
        liquido: 32.02,
        frete_esperado: 8.39,
        frete_real: 9.62,
      },
    ]);
  });

  it('LGPD: o usuário do comprador não sai do leitor', () => {
    expect(JSON.stringify(rel)).not.toContain(COMPRADOR);
  });
});

describe('relatório da carteira', () => {
  const rel = ler(relatorioCarteira()) as Extract<RelatorioShopee, { tipo: 'carteira' }>;

  it('cada movimento com sinal, categoria, pedido e a ordem do mais antigo pro mais novo', () => {
    expect(rel).toMatchObject({ tipo: 'carteira', loja: 'loja_teste', periodo: { de: '2026-10-01', ate: '2026-10-31' } });
    const porSeq = [...rel.movimentos].sort((a, b) => a.seq - b.seq);
    expect(porSeq.map((m) => [m.categoria, m.valor, m.pedido, m.saldo_apos])).toEqual([
      ['renda_pedido', 32.02, 'P1', 132.02],
      ['difal', -3, '260727RRTM8572', 129.02],
      ['saque', -100, null, 29.02],
      ['anuncios', -20, null, 9.02],
      // "Saída" com valor positivo no arquivo vira negativo
      ['penalidade', -5, null, 4.02],
    ]);
    expect(new Set(rel.movimentos.map((m) => m.chave)).size).toBe(5);
    expect(porSeq[0]!.data).toBe('2026-10-06T09:00:00-03:00');
  });
});

it('arquivo de outro tipo: RelatorioDesconhecido', () => {
  expect(() => ler(xlsxDeTeste({ Planilha1: [['Data', 'Histórico', 'Valor'], ['2026-10-01', 'PIX', 10]] }))).toThrow(
    RelatorioDesconhecido,
  );
});
