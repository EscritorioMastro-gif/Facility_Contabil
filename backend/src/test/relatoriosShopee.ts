/**
 * Relatórios da Shopee de mentira, no mesmo formato dos de verdade (nomes de
 * coluna, linhas de cabeçalho, colunas repetidas), com colunas de comprador
 * preenchidas — pra provar que o leitor não as lê. Tudo fictício.
 */
import { xlsxDeTeste } from './xlsx.js';

export const COMPRADOR = 'FULANO DE TAL';
export const CPF = '12345678900';

export function relatorioPedidos(opts: { comprimir?: boolean } = {}) {
  const cab = [
    'ID do pedido',
    'Status do pedido',
    'Cancelar Motivo',
    'Status da Devolução / Reembolso',
    'Tempo de Envio',
    'Data de criação do pedido',
    'Hora completa do pedido',
    'Número de referência SKU',
    'Nome do Produto',
    'Nome da variação',
    'Preço acordado',
    'Quantidade',
    'Returned quantity',
    'Nome do destinatário',
    'Telefone',
    'CPF do Comprador',
  ];
  const linha = (id: string, status: string, motivo: string, dev: string, sku: string, nome: string, preco: number, qtd: number, devolvidos = 0) => [
    id,
    status,
    motivo,
    dev,
    '2026-10-02 10:00',
    '2026-10-01 09:00',
    status === 'Concluído' ? '2026-10-05 12:00' : '',
    sku,
    nome,
    'P',
    preco,
    qtd,
    devolvidos,
    COMPRADOR,
    '11999990000',
    CPF,
  ];
  return xlsxDeTeste(
    {
      orders: [
        cab,
        linha('P1', 'Concluído', '', '', 'SKU-A', 'Camiseta', 49.99, 1),
        linha('P2', 'Concluído', '', '', 'SKU-B', 'Kit', 39.9, 2),
        linha('P2', 'Concluído', '', '', 'SKU-C', 'Boné', 20, 1),
        linha('P3', 'Cancelado', 'Cancelado automaticamente pelo sistema da Shopee. Motivo : Pacote perdido em trânsito.', '', 'SKU-A', 'Camiseta', 19.9, 1),
        linha('P4', 'Concluído', '', 'Solicitação aprovada', 'SKU-A', 'Camiseta', 34.9, 1, 1),
        linha('P5', 'Entregue', '', '', 'SKU-A', 'Camiseta', 34.9, 1),
      ],
    },
    opts,
  );
}

/** P1: R$ 49,99 a 18,6% / 1,4% / 3,5% / R$ 4,50 / R$ 0,49, frete a mais de R$ 1,23. */
export function relatorioRenda() {
  const cab = [
    'Número da sequência',
    'Ver',
    'ID do pedido',
    'Data de criação do pedido',
    'Data de conclusão do pagamento',
    'Quantia total lançada (R$)',
    'Preço do produto',
    'Valor do Reembolso',
    'Cupom',
    'Incentivo de cupom',
    'Voucher subsidiado pelo Seller',
    'Taxa de frete paga pelo comprador',
    'Desconto de frete pela Shopee',
    'Frete cobrado pelo parceiro logístico',
    'Taxa de comissão bruta',
    'Taxa de comissão líquida',
    'Taxa de serviço bruta',
    'Taxa de serviço líquida',
    'Taxa de Devolução Fácil Shopee',
    'Nome de usuário (Comprador)',
  ];
  return xlsxDeTeste({
    Summary: [
      ['Relatório de rendimento'],
      [],
      ['Nome de usuário (Vendedor)', 'loja_teste'],
      ['Titular da conta bancária', 'empresa teste ltda'],
      ['De', '2026-10-01'],
      ['Para', '2026-10-31'],
    ],
    'Service Fee Details': [
      [null, null, 'Taxa de serviço líquida'],
      ['Número da sequência', 'ID do pedido', 'Taxa de Transação', 'Taxa de serviço adicional', 'Taxa de transação', 'Taxa por item vendido'],
      [1, 'P1', -0.7, -1.75, 0, -4.5],
    ],
    Adjustment: [['Nota'], ['Nome de usuário (Vendedor)', 'loja_teste'], ['De', '2026-10-01', 'Para', '2026-10-31']],
    'Shipping Fee Discrepancy': [
      ['Nota'],
      ['ID do pedido', 'Taxa de frete esperada:', 'Taxa de frete real cobrada pelo parceiro logístico:', 'Motivo da discrepância'],
      ['P1', 8.39, 9.62, 'Possível razão: o peso real do produto é maior'],
    ],
    Renda: [
      ['Informações do pedido', null, null, 'Detalhes do valor liberado'],
      ['Renda do pedido', 'Subtotal de mercadoria'],
      cab,
      [1, 'Order', 'P1', '2026-10-01', '2026-10-06', 32.02, 49.99, 0, 0, 0, 0, 0, 8.39, -9.62, -9.3, -9.3, -6.95, -6.95, -0.49, COMPRADOR],
      [2, 'Sku', 'P1', '2026-10-01', '2026-10-06', 32.02, 49.99, 0, 0, 0, 0, 0, 8.39, -9.62, -9.3, -9.3, -6.95, -6.95, -0.49, COMPRADOR],
    ],
  });
}

/** Saldo 100,00 → renda P1 +32,02 → DIFAL −3 → saque −100 → anúncios −20 → penalidade −5 (do mais novo pro mais antigo, como a Shopee exporta). */
export function relatorioCarteira() {
  return xlsxDeTeste({
    'Transaction Report': [
      ['Relatório'],
      ['Informações da conta'],
      ['Nome de usuário (vendedor)', 'loja_teste'],
      ['De', '2026-10-01'],
      ['Para', '2026-10-31'],
      [],
      ['Data', 'Tipo de transação', 'Descrição', 'ID do pedido', 'Direção do dinheiro', 'Valor', 'Status', 'Balança após as transações', 'Valor a Ser Ajustado'],
      ['2026-10-20 10:00:00', 'Ajuste', 'Cobrança de taxa referente ao atingimento de Faixa 1 de Penalização', '-', 'Saída', 5, 'Transação completa', 4.02, 0],
      ['2026-10-12 12:00:00', 'Saldo da Carteira - Pagamento', 'Recarga por compra de ADS', '-', 'Saída', -20, 'Transação completa', 9.02, 0],
      ['2026-10-10 11:00:00', 'Saques', 'Saque', '-', 'Saída', -100, 'Transação completa', 29.02, 0],
      [
        '2026-10-08 10:00:00',
        'Ajuste',
        'Débito por diferencial de alíquota do ICMS (DIFAL) cobrada pelo fisco governamental durante fiscalização referente ao pedido 260727RRTM8572',
        '-',
        'Saída',
        -3,
        'Transação completa',
        129.02,
        0,
      ],
      ['2026-10-06 09:00:00', 'Renda do pedido', 'Renda do pedido  #P1', 'P1', 'Entrada', 32.02, 'Transação completa', 132.02, 0],
    ],
  });
}
