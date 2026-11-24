/**
 * Lista própria de classificações compartilhada (pedido de 2026-11-11): "se o
 * cliente tiver 4 empresas, essa mesma lista própria deve aparecer para as 4".
 *
 * No banco a lista continua por empresa (`classificacoes.client_id` — cada
 * lançamento aponta pra uma classificação da própria empresa). O GRUPO de uma
 * empresa = ela + as outras empresas liberadas pros mesmos logins de cliente
 * (`cliente_acessos`). Toda mudança na lista (incluir, remover, renomear,
 * ativar) vale pro grupo inteiro, e ao abrir a lista o que falta numa empresa
 * do grupo é copiado das outras (empresa liberada depois pro mesmo login, por
 * exemplo). Empresa sem login de cliente = grupo de uma empresa só.
 *
 * As funções recebem o cliente do Supabase de quem chama: o do login (RLS do
 * escritório) nas rotas do escritório, o da secret key no portal — sempre
 * depois de a rota conferir a permissão.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { badRequest, forbidden } from '../lib/httpError.js';
import { lerTodas, mapPgrstError } from '../lib/pgrst.js';

export const COLS_CLASSIFICACAO = 'id, client_id, direction, nome, ativo, geral_id, created_at, updated_at';

export type Classificacao = {
  id: string;
  client_id: string;
  direction: 'entrada' | 'saida';
  nome: string;
  ativo: boolean;
  geral_id: string | null;
};

export type ItemDaLista = { direction: 'entrada' | 'saida'; nome: string; geral_id?: string | null };

export const DUPLICADA = 'Já existe uma classificação com esse nome para essa direção.';

/** Mesmo item da lista = mesma direção e mesmo nome (sem diferença de maiúsculas/espaços). */
export const chaveDoItem = (c: { direction: string; nome: string }) =>
  `${c.direction}\u0000${c.nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')}`;

/** A empresa e as outras liberadas pros mesmos logins de cliente. */
export async function empresasDoGrupo(db: SupabaseClient, clientId: string): Promise<string[]> {
  const { data: logins, error } = await db.from('cliente_acessos').select('user_id').eq('client_id', clientId);
  if (error) throw mapPgrstError(error, 'ler os logins da empresa');
  const users = [...new Set((logins ?? []).map((l) => l.user_id as string))];
  if (!users.length) return [clientId];
  const { data: acessos, error: aErr } = await db.from('cliente_acessos').select('client_id').in('user_id', users);
  if (aErr) throw mapPgrstError(aErr, 'ler as empresas do login');
  return [...new Set([clientId, ...(acessos ?? []).map((a) => a.client_id as string)])];
}

async function listaDoGrupo(db: SupabaseClient, empresas: string[]): Promise<Classificacao[]> {
  return lerTodas<Classificacao>(
    (de, ate) => db.from('classificacoes').select(COLS_CLASSIFICACAO).in('client_id', empresas).order('id').range(de, ate),
    'ler as classificações',
  );
}

/** Lista de UMA empresa (ativas e desativadas), em ordem alfabética. */
export async function listaDaEmpresa(
  db: SupabaseClient,
  clientId: string,
  direction?: 'entrada' | 'saida',
): Promise<Classificacao[]> {
  let q = db.from('classificacoes').select(COLS_CLASSIFICACAO).eq('client_id', clientId);
  if (direction) q = q.eq('direction', direction);
  const { data, error } = await q.order('nome', { ascending: true });
  if (error) throw mapPgrstError(error, 'listar as classificações');
  return (data ?? []) as Classificacao[];
}

/** Insere sem quebrar se outra requisição incluiu o mesmo item no meio-tempo. */
async function inserir(db: SupabaseClient, linhas: Array<Record<string, unknown>>): Promise<void> {
  if (!linhas.length) return;
  const { error } = await db
    .from('classificacoes')
    .upsert(linhas, { onConflict: 'client_id,direction,nome', ignoreDuplicates: true });
  if (error) throw mapPgrstError(error, 'incluir as classificações');
}

/**
 * Inclui os itens na lista do grupo da empresa. Item que já existe desativado
 * volta a valer; item que já está ativo fica como está.
 */
export async function adicionarAoGrupo(
  db: SupabaseClient,
  p: { ownerId: string; clientId: string; itens: ItemDaLista[] },
): Promise<{ incluidas: number; reativadas: number }> {
  const empresas = await empresasDoGrupo(db, p.clientId);
  const atuais = await listaDoGrupo(db, empresas);
  const porChave = new Map(atuais.map((c) => [`${c.client_id}\u0000${chaveDoItem(c)}`, c]));

  const novas: Array<Record<string, unknown>> = [];
  const reativar: string[] = [];
  const ligarAoGeral = new Map<string, string[]>(); // geral_id -> ids sem origem
  for (const item of p.itens) {
    const nome = item.nome.trim().replace(/\s+/g, ' ');
    for (const empresa of empresas) {
      const ja = porChave.get(`${empresa}\u0000${chaveDoItem(item)}`);
      if (!ja) {
        novas.push({ owner_id: p.ownerId, client_id: empresa, direction: item.direction, nome, geral_id: item.geral_id ?? null });
        continue;
      }
      if (!ja.ativo) reativar.push(ja.id);
      if (item.geral_id && !ja.geral_id) ligarAoGeral.set(item.geral_id, [...(ligarAoGeral.get(item.geral_id) ?? []), ja.id]);
    }
  }

  await inserir(db, novas);
  if (reativar.length) {
    const { error } = await db.from('classificacoes').update({ ativo: true }).in('id', reativar);
    if (error) throw mapPgrstError(error, 'reativar as classificações');
  }
  for (const [geral, ids] of ligarAoGeral) {
    const { error } = await db.from('classificacoes').update({ geral_id: geral }).in('id', ids);
    if (error) throw mapPgrstError(error, 'ligar as classificações à lista geral');
  }
  return { incluidas: novas.length, reativadas: reativar.length };
}

/**
 * Copia pra cada empresa do grupo o que está ativo nas outras e falta nela.
 * Não mexe no que já existe (desativado continua desativado).
 */
export async function sincronizarGrupo(db: SupabaseClient, p: { ownerId: string; clientId: string }): Promise<number> {
  const empresas = await empresasDoGrupo(db, p.clientId);
  if (empresas.length < 2) return 0;
  const atuais = await listaDoGrupo(db, empresas);

  const ativos = new Map<string, Classificacao>();
  for (const c of atuais) if (c.ativo && !ativos.has(chaveDoItem(c))) ativos.set(chaveDoItem(c), c);
  const existe = new Set(atuais.map((c) => `${c.client_id}\u0000${chaveDoItem(c)}`));

  const novas: Array<Record<string, unknown>> = [];
  for (const [k, c] of ativos) {
    for (const empresa of empresas) {
      if (existe.has(`${empresa}\u0000${k}`)) continue;
      novas.push({ owner_id: p.ownerId, client_id: empresa, direction: c.direction, nome: c.nome, geral_id: c.geral_id });
    }
  }
  await inserir(db, novas);
  return novas.length;
}

/** O mesmo item nas empresas do grupo (a própria classificação inclusa). */
async function mesmoItemNoGrupo(db: SupabaseClient, item: Classificacao): Promise<Classificacao[]> {
  const empresas = await empresasDoGrupo(db, item.client_id);
  const atuais = await listaDoGrupo(db, empresas);
  const k = chaveDoItem(item);
  return atuais.filter((c) => c.id === item.id || chaveDoItem(c) === k);
}

/** Quantos lançamentos apontam pra essas classificações na coluna dada. */
async function usos(
  db: SupabaseClient,
  coluna: 'classificacao_id' | 'aprovado_classificacao_id',
  ids: string[],
): Promise<number> {
  const { count, error } = await db.from('transactions').select('id', { count: 'exact', head: true }).in(coluna, ids);
  if (error) throw mapPgrstError(error, 'verificar o uso da classificação');
  return count ?? 0;
}

export const NOME_APROVADO =
  'Essa classificação já está em lançamentos aprovados pelo cliente — o nome não pode mais mudar. ' +
  'Se precisar de outro nome, crie uma classificação nova e desative esta.';

/**
 * Tira o item da lista do grupo: onde não está em uso, exclui; onde algum
 * lançamento usa (ou o cliente aprovou um lançamento com ela), desativa — some
 * da lista de escolha, os lançamentos antigos continuam com ela.
 */
export async function removerDoGrupo(
  db: SupabaseClient,
  item: Classificacao,
): Promise<{ excluidas: number; desativadas: number }> {
  const linhas = await mesmoItemNoGrupo(db, item);
  const excluir: string[] = [];
  const desativar: string[] = [];
  for (const c of linhas) {
    // em uso = algum lançamento está com ela, ou o cliente aprovou um lançamento com ela
    const emUso = (await usos(db, 'classificacao_id', [c.id])) > 0 || (await usos(db, 'aprovado_classificacao_id', [c.id])) > 0;
    (emUso ? desativar : excluir).push(c.id);
  }
  if (excluir.length) {
    const { error } = await db.from('classificacoes').delete().in('id', excluir);
    if (error) throw mapPgrstError(error, 'excluir a classificação');
  }
  if (desativar.length) {
    const { error } = await db.from('classificacoes').update({ ativo: false }).in('id', desativar);
    if (error) throw mapPgrstError(error, 'desativar a classificação');
  }
  return { excluidas: excluir.length, desativadas: desativar.length };
}

/** Renomeia / ativa / desativa o item em todas as empresas do grupo. */
export async function alterarNoGrupo(
  db: SupabaseClient,
  item: Classificacao,
  patch: { nome?: string; ativo?: boolean },
): Promise<void> {
  const linhas = await mesmoItemNoGrupo(db, item);
  const dados: Record<string, unknown> = {};
  if (patch.ativo !== undefined) dados.ativo = patch.ativo;
  if (patch.nome !== undefined) {
    const nome = patch.nome.trim().replace(/\s+/g, ' ');
    // outro item do grupo já tem esse nome (mudar só maiúscula/minúscula do próprio pode)
    const empresas = [...new Set(linhas.map((c) => c.client_id))];
    const atuais = await listaDoGrupo(db, empresas);
    const ids = new Set(linhas.map((c) => c.id));
    if (atuais.some((c) => !ids.has(c.id) && chaveDoItem(c) === chaveDoItem({ direction: item.direction, nome }))) {
      throw badRequest(DUPLICADA);
    }
    // renomear mudaria o que o cliente aprovou sem tocar no lançamento (migration 0031)
    if (linhas.some((c) => c.nome !== nome) && (await usos(db, 'aprovado_classificacao_id', [...ids])) > 0) {
      throw forbidden(NOME_APROVADO);
    }
    dados.nome = nome;
  }
  if (!Object.keys(dados).length) return;
  const { error } = await db.from('classificacoes').update(dados).in('id', linhas.map((c) => c.id));
  if (error) {
    if (error.code === '23505') throw badRequest(DUPLICADA);
    throw mapPgrstError(error, 'atualizar a classificação');
  }
}
