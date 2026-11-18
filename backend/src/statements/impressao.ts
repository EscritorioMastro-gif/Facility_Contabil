/**
 * Trava de extrato duplicado (pedido de 2026-11-11; desde 2026-11-18 vale em
 * TODAS as empresas do escritório, não só na mesma).
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

/** `data|centavos|direção` de cada lançamento — a mesma linha da impressão e da sobreposição (0027). */
export function linhasDoExtrato(transacoes: Lido[]): string[] {
  return transacoes.map((t) => `${t.date}|${Math.round(t.amount_cents)}|${t.direction}`);
}

export function impressaoDoExtrato(transacoes: Lido[]): string {
  const linhas = linhasDoExtrato(transacoes);
  // mesma ordem do `collate "C"` da migration (bytes; as linhas são ASCII)
  linhas.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(linhas.join('\n'), 'utf8').digest('hex');
}

const MODULO: Record<string, string> = { importacao: 'Importação', classificacao: 'Classificação' };

export const dataBr = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

type JaImportado = {
  id: string;
  client_id: string;
  arquivo_nome: string;
  period_start: string | null;
  period_end: string | null;
  origem_modulo: string;
  status: string;
  created_at: string;
  client: { razao_social: string } | null;
};

/**
 * Já existe outro extrato (fora os com erro) com os mesmos lançamentos, em
 * qualquer empresa do escritório? Então 409 com o que foi achado. Essa trava
 * nunca é liberada: o mesmo extrato não entra duas vezes.
 *
 * `visiveis`: empresas que o login enxerga (portal do cliente). Se o original
 * está numa empresa fora dessa lista, a resposta não diz qual é nem o arquivo.
 */
export async function recusarDuplicado(
  supabase: SupabaseClient,
  p: { ownerId: string; clientId: string; impressao: string; excetoId?: string; visiveis?: Set<string> | null },
): Promise<void> {
  let q = supabase
    .from('statements')
    .select('id, client_id, arquivo_nome, period_start, period_end, origem_modulo, status, created_at, client:clients(razao_social)')
    .eq('owner_id', p.ownerId)
    .eq('impressao', p.impressao)
    .neq('status', 'erro');
  if (p.excetoId) q = q.neq('id', p.excetoId);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(10);
  if (error) throw mapPgrstError(error, 'conferir se o extrato já foi importado');
  const achados = (data ?? []) as unknown as JaImportado[];
  if (!achados.length) return;
  // o da própria empresa primeiro: é o caso comum (mandou de novo) e o que dá pra abrir
  const ja = achados.find((s) => s.client_id === p.clientId) ?? achados[0]!;

  const outraEmpresa = ja.client_id !== p.clientId;
  if (outraEmpresa && p.visiveis && !p.visiveis.has(ja.client_id)) {
    throw new HttpError(
      409,
      'Esse extrato já foi enviado em outra empresa do escritório. Confira se escolheu a empresa certa — ' +
        'na dúvida, fale com o escritório.',
      { code: 'extrato_duplicado' },
    );
  }

  const onde = outraEmpresa ? ` na empresa ${ja.client?.razao_social ?? 'outra empresa'}` : '';
  const periodo = ja.period_start && ja.period_end ? `, de ${dataBr(ja.period_start)} a ${dataBr(ja.period_end)}` : '';
  throw new HttpError(
    409,
    `Esse extrato já foi importado${onde}: "${ja.arquivo_nome}"${periodo}, em ${dataBr(ja.created_at)} ` +
      `(módulo ${MODULO[ja.origem_modulo] ?? ja.origem_modulo}), com os mesmos lançamentos. ` +
      (outraEmpresa
        ? 'Confira se escolheu a empresa certa: o mesmo extrato não entra em duas empresas.'
        : 'Para trocar esse extrato, exclua-o (ou use Reimportar nele) antes de importar de novo.'),
    {
      code: 'extrato_duplicado',
      statement_id: ja.id,
      client_id: ja.client_id,
      status: ja.status,
      origem_modulo: ja.origem_modulo,
    },
  );
}
