import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { mapPgrstError } from '../lib/pgrst.js';
import { escritorioDe } from '../lib/escritorio.js';
import { logger } from '../lib/logger.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/httpError.js';
import {
  classificacaoCreateSchema,
  classificacaoListQuerySchema,
  classificacaoUpdateSchema,
  daListaGeralSchema,
  geralCreateSchema,
  geralListQuerySchema,
} from './schema.js';
import {
  adicionarAoGrupo,
  alterarNoGrupo,
  COLS_CLASSIFICACAO,
  DUPLICADA,
  listaDaEmpresa,
  removerDoGrupo,
  sincronizarGrupo,
  type Classificacao,
} from './grupo.js';

const TABLE = 'classificacoes';
const GERAIS = 'classificacoes_gerais';
export const COLS_GERAL = 'id, direction, nome, created_at';
const GERAL_DUPLICADA = 'Esse nome já está na lista geral para essa direção.';
const SO_ADMIN = 'Só quem administra o escritório (Cadastros → Equipe) mexe na lista geral de classificações.';
const uuid = z.string().uuid();

export const classificacoesRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

async function souAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('sou_admin_do_escritorio');
  if (error) throw mapPgrstError(error, 'conferir se o login administra o escritório');
  return data === true;
}

async function classificacaoPorId(supabase: SupabaseClient, id: string): Promise<Classificacao> {
  if (!uuid.safeParse(id).success) throw notFound('Classificação não encontrada');
  const { data, error } = await supabase.from(TABLE).select(COLS_CLASSIFICACAO).eq('id', id).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar a classificação');
  if (!data) throw notFound('Classificação não encontrada');
  return data as Classificacao;
}

// --------------------------------------------------------------------------- #
// Lista geral do escritório
// --------------------------------------------------------------------------- #

// GET /api/classificacoes/gerais?direction=  — a equipe toda vê
classificacoesRouter.get('/gerais', async (req, res, next) => {
  try {
    const { direction } = geralListQuerySchema.parse(req.query);
    const supabase = db(req);
    let q = supabase.from(GERAIS).select(COLS_GERAL);
    if (direction) q = q.eq('direction', direction);
    const { data, error } = await q.order('nome', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar a lista geral');
    res.json({ gerais: data ?? [], pode_editar: await souAdmin(supabase) });
  } catch (err) {
    next(err);
  }
});

// POST /api/classificacoes/gerais  — só administrador
classificacoesRouter.post('/gerais', async (req, res, next) => {
  try {
    const dto = geralCreateSchema.parse(req.body);
    const supabase = db(req);
    if (!(await souAdmin(supabase))) throw forbidden(SO_ADMIN);
    const { data, error } = await supabase
      .from(GERAIS)
      .insert({ owner_id: escritorioDe(req), direction: dto.direction, nome: dto.nome.replace(/\s+/g, ' ') })
      .select(COLS_GERAL)
      .single();
    if (error) {
      if (error.code === '23505') throw badRequest(GERAL_DUPLICADA);
      if (error.code === '42501') throw forbidden(SO_ADMIN);
      throw mapPgrstError(error, 'incluir na lista geral');
    }
    res.status(201).json({ geral: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/classificacoes/gerais/:id  — só administrador. Quem já escolheu
// o item continua com ele na lista própria.
classificacoesRouter.delete('/gerais/:id', async (req, res, next) => {
  try {
    if (!uuid.safeParse(req.params.id).success) throw notFound('Item não encontrado');
    const supabase = db(req);
    if (!(await souAdmin(supabase))) throw forbidden(SO_ADMIN);
    const { error, count } = await supabase.from(GERAIS).delete({ count: 'exact' }).eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir da lista geral');
    if (!count) throw notFound('Item não encontrado');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/classificacoes/da-lista-geral  — itens da lista geral entram na
// lista própria da empresa (e das outras empresas do mesmo login de cliente)
classificacoesRouter.post('/da-lista-geral', async (req, res, next) => {
  try {
    const dto = daListaGeralSchema.parse(req.body);
    const supabase = db(req);
    const { data: empresa, error: eErr } = await supabase.from('clients').select('id').eq('id', dto.client_id).maybeSingle();
    if (eErr) throw mapPgrstError(eErr, 'buscar o cliente');
    if (!empresa) throw notFound('Cliente não encontrado');

    const { data: gerais, error } = await supabase.from(GERAIS).select(COLS_GERAL).in('id', dto.geral_ids);
    if (error) throw mapPgrstError(error, 'ler a lista geral');
    if ((gerais ?? []).length !== new Set(dto.geral_ids).size) throw badRequest('Item da lista geral não encontrado.');

    const r = await adicionarAoGrupo(supabase, {
      ownerId: escritorioDe(req),
      clientId: dto.client_id,
      itens: (gerais ?? []).map((g) => ({ direction: g.direction, nome: g.nome, geral_id: g.id })),
    });
    res.status(201).json({ ...r, classificacoes: await listaDaEmpresa(supabase, dto.client_id) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// Lista própria (por empresa, igual em todas as empresas do mesmo login)
// --------------------------------------------------------------------------- #

// GET /api/classificacoes?client_id=...&direction=entrada|saida
classificacoesRouter.get('/', async (req, res, next) => {
  try {
    const { client_id, direction } = classificacaoListQuerySchema.parse(req.query);
    const supabase = db(req);
    // empresa liberada depois pro mesmo login ainda sem a lista: copia agora
    try {
      await sincronizarGrupo(supabase, { ownerId: escritorioDe(req), clientId: client_id });
    } catch (err) {
      logger.warn({ err }, 'falha ao sincronizar a lista das empresas do mesmo login (segue com a da empresa)');
    }
    res.json({ classificacoes: await listaDaEmpresa(supabase, client_id, direction) });
  } catch (err) {
    next(err);
  }
});

// POST /api/classificacoes  — classificação avulsa (fora da lista geral): só o escritório
classificacoesRouter.post('/', async (req, res, next) => {
  try {
    const dto = classificacaoCreateSchema.parse(req.body);
    const supabase = db(req);
    const nome = dto.nome.replace(/\s+/g, ' ');
    const daEmpresa = await listaDaEmpresa(supabase, dto.client_id, dto.direction);
    const igual = (c: Classificacao) => c.nome.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR');
    if (daEmpresa.some((c) => c.ativo && igual(c))) throw badRequest(DUPLICADA);

    await adicionarAoGrupo(supabase, {
      ownerId: escritorioDe(req),
      clientId: dto.client_id,
      itens: [{ direction: dto.direction, nome }],
    });
    const criada = (await listaDaEmpresa(supabase, dto.client_id, dto.direction)).find(igual);
    if (!criada) throw new HttpError(500, 'Falha ao criar a classificação');
    res.status(201).json({ classificacao: criada });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/classificacoes/:id  — renomear / desativar / reativar (no grupo todo)
classificacoesRouter.patch('/:id', async (req, res, next) => {
  try {
    const dto = classificacaoUpdateSchema.parse(req.body);
    const patch = { nome: dto.nome, ativo: dto.ativo };
    if (patch.nome === undefined && patch.ativo === undefined) throw badRequest('Nada para atualizar');
    const supabase = db(req);
    const atual = await classificacaoPorId(supabase, req.params.id);
    await alterarNoGrupo(supabase, atual, patch);
    res.json({ classificacao: await classificacaoPorId(supabase, req.params.id) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/classificacoes/:id  — tira da lista (no grupo todo): exclui onde
// não está em uso, desativa onde algum lançamento usa
classificacoesRouter.delete('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const atual = await classificacaoPorId(supabase, req.params.id);
    res.json(await removerDoGrupo(supabase, atual));
  } catch (err) {
    next(err);
  }
});
