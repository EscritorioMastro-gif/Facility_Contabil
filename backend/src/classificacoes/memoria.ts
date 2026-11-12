/**
 * Memória do módulo Classificação (pedido de 2026-11-11): descrição que já foi
 * classificada antes vem classificada no extrato novo — entradas e saídas,
 * cada uma com a sua.
 *
 * 1. Memória da PRÓPRIA empresa (vale primeiro):
 *    - a descrição sempre teve a mesma classificação → preenche ('memoria')
 *    - já teve classificações diferentes → a mais usada (empate: a mais
 *      recente), marcada 'conferir' — sugestão, a tela mostra em amarelo
 * 2. Memória das OUTRAS empresas do mesmo cliente (pedido de 2026-11-12: "o que
 *    ele gasta em uma ele gasta na outra"): a descrição nunca foi classificada
 *    nesta empresa, mas já foi numa empresa que divide o login de cliente
 *    (mesmo grupo da lista própria — grupo.ts) → vem a classificação de MESMO
 *    NOME desta empresa, sempre como sugestão ('conferir'). Salvou, vira
 *    memória da própria empresa.
 *
 * A memória sai direto dos lançamentos já classificados (RPC
 * memoria_classificacao, migration 0023): não tem tabela própria pra ficar
 * desatualizada — trocar uma classificação ou excluir um extrato já muda o que
 * o sistema sugere. Sugestão ainda não conferida não vira memória.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger.js';
import { lerTodas } from '../lib/pgrst.js';
import { chaveDoItem, empresasDoGrupo } from './grupo.js';

export type OrigemClassificacao = 'memoria' | 'conferir';
export type Sugestao = { classificacao_id: string; origem: OrigemClassificacao };

type Uso = { descricao: string; direction: string; classificacao_id: string; usos: number; ultima: string | null };
type Lancamento = { direction: string; descricao: string };
type ItemDaLista = { id: string; client_id: string; direction: string; nome: string; ativo: boolean };

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

async function usosDa(supabase: SupabaseClient, clientId: string, descricoes: string[], excluir: string | null) {
  const { data, error } = await supabase.rpc('memoria_classificacao', {
    p_client: clientId,
    p_descricoes: descricoes,
    p_excluir: excluir,
  });
  if (error) throw error;
  return Array.isArray(data) ? (data as Uso[]) : [];
}

/**
 * Memória das outras empresas do mesmo cliente, já traduzida pras
 * classificações DESTA empresa (pelo nome — a lista própria é a mesma no
 * grupo). Classificação sem par aqui (ou desativada aqui) não vira sugestão.
 */
async function memoriaDoGrupo(
  supabase: SupabaseClient,
  clientId: string,
  descricoes: string[],
): Promise<Map<string, Sugestao>> {
  const outras = (await empresasDoGrupo(supabase, clientId)).filter((e) => e !== clientId);
  if (!outras.length) return new Map();

  const [lista, ...usosDasOutras] = await Promise.all([
    lerTodas<ItemDaLista>(
      (de, ate) =>
        supabase
          .from('classificacoes')
          .select('id, client_id, direction, nome, ativo')
          .in('client_id', [clientId, ...outras])
          .order('id')
          .range(de, ate),
      'ler as classificações das empresas do cliente',
    ),
    ...outras.map((e) => usosDa(supabase, e, descricoes, null)),
  ]);

  const porId = new Map(lista.map((c) => [c.id, c]));
  const aqui = new Map(lista.filter((c) => c.client_id === clientId && c.ativo).map((c) => [chaveDoItem(c), c.id]));

  // a mesma descrição classificada igual em várias empresas: soma os usos
  const somados = new Map<string, Uso>();
  for (const u of usosDasOutras.flat()) {
    const deLa = porId.get(u.classificacao_id);
    const local = deLa && aqui.get(chaveDoItem(deLa));
    if (!local) continue;
    const k = `${chave(u.direction, u.descricao)}\u0000${local}`;
    const ja = somados.get(k);
    somados.set(
      k,
      ja
        ? { ...ja, usos: Number(ja.usos) + Number(u.usos), ultima: String(ja.ultima ?? '') > String(u.ultima ?? '') ? ja.ultima : u.ultima }
        : { ...u, classificacao_id: local, usos: Number(u.usos) },
    );
  }

  const escolhidas = escolherSugestoes([...somados.values()]);
  for (const [k, s] of escolhidas) escolhidas.set(k, { ...s, origem: 'conferir' }); // de outra empresa: sempre sugestão
  return escolhidas;
}

/**
 * Sugestões pra uma lista de lançamentos de uma empresa: a memória dela e, no
 * que ela não tem, a das outras empresas do mesmo cliente. Falhou a leitura?
 * Segue sem (memória só ajuda a pré-preencher — não pode impedir a importação).
 */
export async function sugerirClassificacoes(
  supabase: SupabaseClient,
  p: { clientId: string; lancamentos: Lancamento[]; excetoExtrato?: string },
): Promise<(lancamento: Lancamento) => Sugestao | null> {
  const descricoes = [...new Set(p.lancamentos.map((l) => l.descricao).filter((d) => d.trim()))];
  if (!descricoes.length) return () => null;

  const [proprias, doGrupo] = await Promise.all([
    usosDa(supabase, p.clientId, descricoes, p.excetoExtrato ?? null)
      .then(escolherSugestoes)
      .catch((err) => {
        logger.warn({ err }, 'falha ao ler a memória da classificação (segue sem pré-preencher)');
        return new Map<string, Sugestao>();
      }),
    memoriaDoGrupo(supabase, p.clientId, descricoes).catch((err) => {
      logger.warn({ err }, 'falha ao ler a memória das outras empresas do cliente (segue só com a da empresa)');
      return new Map<string, Sugestao>();
    }),
  ]);

  return (l) => {
    const k = chave(l.direction, l.descricao);
    return proprias.get(k) ?? doGrupo.get(k) ?? null;
  };
}
