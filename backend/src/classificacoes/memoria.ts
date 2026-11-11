/**
 * Memória do módulo Classificação (pedido de 2026-11-11): descrição que já foi
 * classificada antes NA MESMA EMPRESA vem classificada no extrato novo —
 * entradas e saídas, cada uma com a sua.
 *
 * - a descrição sempre teve a mesma classificação → preenche (origem 'memoria')
 * - já teve classificações diferentes → preenche com a mais usada (empate: a
 *   mais recente) e marca 'conferir' — é uma sugestão, a tela mostra em amarelo
 *
 * A memória sai direto dos lançamentos já classificados (RPC
 * memoria_classificacao, migration 0023): não tem tabela própria pra ficar
 * desatualizada — trocar uma classificação ou excluir um extrato já muda o que
 * o sistema sugere. Sugestão ainda não conferida não vira memória.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';

export type OrigemClassificacao = 'memoria' | 'conferir';
export type Sugestao = { classificacao_id: string; origem: OrigemClassificacao };

type Uso = { descricao: string; direction: string; classificacao_id: string; usos: number; ultima: string | null };
type Lancamento = { direction: string; descricao: string };

/** Chave do mapa: a descrição EXATA (a RPC já agrupou pelas normalizadas). */
const chave = (direction: string, descricao: string) => `${direction}\u0000${descricao}`;

/** Escolhe a sugestão de cada descrição a partir dos usos devolvidos pela RPC. */
export function escolherSugestoes(usos: Uso[]): Map<string, Sugestao> {
  const porDescricao = new Map<string, Uso[]>();
  for (const u of usos) {
    const k = chave(u.direction, u.descricao);
    porDescricao.set(k, [...(porDescricao.get(k) ?? []), u]);
  }
  const out = new Map<string, Sugestao>();
  for (const [k, lista] of porDescricao) {
    const [melhor] = [...lista].sort(
      (a, b) => Number(b.usos) - Number(a.usos) || String(b.ultima ?? '').localeCompare(String(a.ultima ?? '')),
    );
    if (!melhor) continue;
    out.set(k, { classificacao_id: melhor.classificacao_id, origem: lista.length > 1 ? 'conferir' : 'memoria' });
  }
  return out;
}

/**
 * Sugestões pra uma lista de lançamentos de uma empresa. Falhou a leitura? Segue
 * sem (memória só ajuda a pré-preencher — não pode impedir a importação).
 */
export async function sugerirClassificacoes(
  supabase: SupabaseClient,
  p: { clientId: string; lancamentos: Lancamento[]; excetoExtrato?: string },
): Promise<(lancamento: Lancamento) => Sugestao | null> {
  const descricoes = [...new Set(p.lancamentos.map((l) => l.descricao).filter((d) => d.trim()))];
  if (!descricoes.length) return () => null;
  try {
    const { data, error } = await supabase.rpc('memoria_classificacao', {
      p_client: p.clientId,
      p_descricoes: descricoes,
      p_excluir: p.excetoExtrato ?? null,
    });
    if (error) throw error;
    const sugestoes = escolherSugestoes(Array.isArray(data) ? (data as Uso[]) : []);
    return (l) => sugestoes.get(chave(l.direction, l.descricao)) ?? null;
  } catch (err) {
    logger.warn({ err }, 'falha ao ler a memória da classificação (segue sem pré-preencher)');
    return () => null;
  }
}
