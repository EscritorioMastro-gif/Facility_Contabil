/**
 * Trava de extrato duplicado (pedido de 2026-11-11).
 *
 * Impressão do extrato = sha256 das linhas `data|centavos|direção` de TODOS os
 * lançamentos lidos, ordenadas. Não usa a descrição nem o nome do arquivo: o
 * mesmo extrato baixado de novo, ou em outro formato (PDF x OFX), tem textos
 * diferentes mas as mesmas datas e valores. A migration 0023 calcula igual
 * para os extratos que já estavam no banco — mudar aqui exige mudar lá.
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';

type Lido = { date: string; amount_cents: number; direction: 'entrada' | 'saida' };

export function impressaoDoExtrato(transacoes: Lido[]): string {
  const linhas = transacoes.map((t) => `${t.date}|${Math.round(t.amount_cents)}|${t.direction}`);
  // mesma ordem do `collate "C"` da migration (bytes; as linhas são ASCII)
  linhas.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(linhas.join('\n'), 'utf8').digest('hex');
}

const MODULO: Record<string, string> = { importacao: 'Importação', classificacao: 'Classificação' };

const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Já existe outro extrato (fora os com erro) da mesma empresa com os mesmos
 * lançamentos? Então 409 com o que foi achado — o operador sabe onde está.
 */
export async function recusarDuplicado(
  supabase: SupabaseClient,
  p: { clientId: string; impressao: string; excetoId?: string },
): Promise<void> {
  let q = supabase
    .from('statements')
    .select('id, arquivo_nome, period_start, period_end, origem_modulo, status, created_at')
    .eq('client_id', p.clientId)
    .eq('impressao', p.impressao)
    .neq('status', 'erro');
  if (p.excetoId) q = q.neq('id', p.excetoId);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(1);
  if (error) throw mapPgrstError(error, 'conferir se o extrato já foi importado');
  const ja = (data ?? [])[0] as
    | {
        id: string;
        arquivo_nome: string;
        period_start: string | null;
        period_end: string | null;
        origem_modulo: string;
        status: string;
        created_at: string;
      }
    | undefined;
  if (!ja) return;

  const periodo = ja.period_start && ja.period_end ? `, de ${dataBr(ja.period_start)} a ${dataBr(ja.period_end)}` : '';
  throw new HttpError(
    409,
    `Esse extrato já foi importado: "${ja.arquivo_nome}"${periodo}, em ${dataBr(ja.created_at)} ` +
      `(módulo ${MODULO[ja.origem_modulo] ?? ja.origem_modulo}), com os mesmos lançamentos. ` +
      'Para trocar esse extrato, exclua-o (ou use Reimportar nele) antes de importar de novo.',
    { code: 'extrato_duplicado', statement_id: ja.id, status: ja.status, origem_modulo: ja.origem_modulo },
  );
}
