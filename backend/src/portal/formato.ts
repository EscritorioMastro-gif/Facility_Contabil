/**
 * O que o portal devolve. Mesmo formato que a tela já usa (Statement,
 * Transaction, Client), mas com os campos do fluxo contábil vazios: o cliente
 * nunca vê conta contábil, código de histórico, memória, saldo ou lote.
 */
import type { Empresa } from './acesso.js';

export const STMT_COLS_PORTAL =
  'id, client_id, arquivo_nome, formato, period_start, period_end, status, origem_modulo, totais, erro_msg, created_at, updated_at';

export const TXN_COLS_PORTAL = 'id, ordem, data, descricao_raw, valor, direction, ignorado, classificacao_id';

type Linha = Record<string, unknown>;
type ClienteEmbed = { razao_social?: unknown; cnpj?: unknown } | null | undefined;

/** Embed do PostgREST às vezes vem como array-de-um. */
function desembrulhar(v: unknown): ClienteEmbed {
  return (Array.isArray(v) ? v[0] : v) as ClienteEmbed;
}

export function paraExtrato(s: Linha, cliente?: ClienteEmbed) {
  const c = cliente ?? desembrulhar(s.client);
  return {
    id: s.id,
    client_id: s.client_id,
    arquivo_nome: s.arquivo_nome,
    formato: s.formato,
    period_start: s.period_start ?? null,
    period_end: s.period_end ?? null,
    status: s.status,
    origem_modulo: s.origem_modulo,
    totais: s.totais ?? {},
    erro_msg: s.erro_msg ?? null,
    created_at: s.created_at,
    updated_at: s.updated_at,
    // fluxo contábil — fora do portal
    storage_path: null,
    banco_id: null,
    conta_ofx: null,
    banco_conta_contabil: null,
    hist_code_entrada: '',
    hist_code_saida: '',
    lote_numero: 0,
    saldo_inicial: null,
    saldo_final: null,
    complemento_modo: 'extrato',
    excel_mapeamento: null,
    client: c ? { id: s.client_id, razao_social: c.razao_social, cnpj: c.cnpj, dominio_code: '' } : undefined,
  };
}

export function paraLancamento(t: Linha) {
  return {
    id: t.id,
    ordem: t.ordem,
    data: t.data,
    descricao_raw: t.descricao_raw,
    valor: t.valor,
    direction: t.direction,
    ignorado: t.ignorado,
    classificacao_id: t.classificacao_id ?? null,
    // fluxo contábil — fora do portal
    conta_contabil: null,
    hist_code: null,
    hist_complemento: null,
    cod_complemento_hist: '0',
    regra_id: null,
    origem_preenchimento: 'vazio',
  };
}

export function paraCliente(e: Empresa) {
  return {
    id: e.id,
    razao_social: e.razao_social,
    cnpj: e.cnpj,
    dominio_code: '',
    banco_conta_contabil: null,
    hist_code_entrada: '',
    hist_code_saida: '',
    conta_width: 7,
    saldo_inicial: '0',
    ativo: true,
    observacoes: null,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}
