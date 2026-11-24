/**
 * Grava o que o leitor tirou dos relatórios da Shopee (shopee.ts). Reimportar
 * o mesmo período não duplica: pedidos e pagamentos por nº do pedido,
 * movimentos da carteira pela chave (data|tipo|pedido|valor|saldo).
 *
 * TRAVA DE LOJA: o relatório de renda e o da carteira trazem o "nome de
 * usuário do vendedor". A primeira importação liga a empresa à loja; depois,
 * relatório de outra loja é recusado antes de gravar qualquer coisa — e a
 * mesma loja não entra em duas empresas do escritório (índice único).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';
import type { RelatorioShopee } from './shopee.js';

const MARKETPLACE = 'shopee';
const LOTE = 500;

export type Empresa = { id: string; owner_id: string };

export type ResultadoImportacao = {
  arquivo: string;
  tipo: RelatorioShopee['tipo'];
  loja: string | null;
  periodo: { de: string; ate: string } | null;
  linhas: number;
};

const conflito = (msg: string, details?: unknown) => new HttpError(409, msg, details);
const normal = (loja: string) => loja.trim().toLowerCase();

/** A loja já ligada à empresa (ou null). */
export async function lojaDaEmpresa(sb: SupabaseClient, clientId: string): Promise<string | null> {
  const { data, error } = await sb
    .from('marketplace_lojas')
    .select('loja')
    .eq('client_id', clientId)
    .eq('marketplace', MARKETPLACE)
    .maybeSingle();
  if (error) throw mapPgrstError(error, 'ler a loja da empresa');
  return (data as { loja: string } | null)?.loja ?? null;
}

/** Confere (ou faz) a ligação empresa ↔ loja. Recusa relatório de outra loja. */
export async function travarLoja(sb: SupabaseClient, empresa: Empresa, loja: string): Promise<void> {
  const atual = await lojaDaEmpresa(sb, empresa.id);
  if (atual) {
    if (normal(atual) !== normal(loja)) {
      throw conflito(
        `Este relatório é da loja "${loja}", mas esta empresa está ligada à loja "${atual}" na Shopee. Confira se escolheu a empresa certa.`,
        { code: 'loja_diferente', loja, loja_da_empresa: atual },
      );
    }
    return;
  }
  const { error } = await sb
    .from('marketplace_lojas')
    .insert({ owner_id: empresa.owner_id, client_id: empresa.id, marketplace: MARKETPLACE, loja: loja.trim() });
  if (error) {
    if (error.code === '23505') {
      throw conflito(`A loja "${loja}" já está ligada a outra empresa do escritório. Confira se escolheu a empresa certa.`, {
        code: 'loja_em_outra_empresa',
        loja,
      });
    }
    throw mapPgrstError(error, 'ligar a empresa à loja');
  }
}

async function gravar(
  sb: SupabaseClient,
  tabela: string,
  linhas: Record<string, unknown>[],
  onConflict: string,
  contexto: string,
  ignoreDuplicates = false,
) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await sb.from(tabela).upsert(linhas.slice(i, i + LOTE), { onConflict, ignoreDuplicates });
    if (error) throw mapPgrstError(error, contexto);
  }
}

/** Grava um relatório já lido. A trava de loja vem antes (travarLoja). */
export async function importarRelatorio(
  sb: SupabaseClient,
  empresa: Empresa,
  rel: RelatorioShopee,
  arquivo: string,
  email: string,
): Promise<ResultadoImportacao> {
  const agora = new Date().toISOString();
  const base = { owner_id: empresa.owner_id, client_id: empresa.id, marketplace: MARKETPLACE, origem: 'excel', importado_em: agora };
  const chave = 'client_id,marketplace,pedido';
  let linhas = 0;

  if (rel.tipo === 'pedidos') {
    await gravar(
      sb,
      'marketplace_pedidos',
      rel.pedidos.map((p) => ({
        ...base,
        pedido: p.pedido,
        status: p.status,
        status_marketplace: p.status_marketplace,
        status_devolucao: p.status_devolucao,
        motivo_cancelamento: p.motivo_cancelamento,
        criado_em: p.criado_em,
        enviado_em: p.enviado_em,
        concluido_em: p.concluido_em,
        valor_produtos: p.valor_produtos,
        itens: p.itens,
      })),
      chave,
      'gravar os pedidos',
    );
    linhas = rel.pedidos.length;
  } else if (rel.tipo === 'renda') {
    await gravar(
      sb,
      'marketplace_repasses',
      rel.repasses.map((x) => ({ ...base, ...x })),
      chave,
      'gravar os pagamentos',
    );
    // pedido pago que ainda não veio no relatório de pedidos entra com o mínimo
    // (sem sobrescrever o que já existe) — pra poder entrar em chamado
    await gravar(
      sb,
      'marketplace_pedidos',
      rel.repasses.map((x) => ({
        ...base,
        pedido: x.pedido,
        status: 'concluido',
        criado_em: x.criado_dia ? `${x.criado_dia}T12:00:00-03:00` : null,
        valor_produtos: x.preco,
        itens: [],
      })),
      chave,
      'gravar os pedidos',
      true,
    );
    linhas = rel.repasses.length;
  } else {
    await gravar(
      sb,
      'marketplace_carteira',
      rel.movimentos.map((m) => ({ ...base, ...m })),
      'client_id,marketplace,chave',
      'gravar a carteira',
    );
    linhas = rel.movimentos.length;
  }

  const { error } = await sb.from('marketplace_importacoes').insert({
    owner_id: empresa.owner_id,
    client_id: empresa.id,
    marketplace: MARKETPLACE,
    tipo: rel.tipo,
    arquivo: arquivo.slice(0, 200),
    loja: rel.loja,
    periodo_de: rel.periodo?.de ?? null,
    periodo_ate: rel.periodo?.ate ?? null,
    linhas,
    importado_por_email: email || '(sem e-mail)',
  });
  if (error) throw mapPgrstError(error, 'registrar a importação');

  return { arquivo, tipo: rel.tipo, loja: rel.loja, periodo: rel.periodo, linhas };
}
