/**
 * /api/classificacoes pro login de cliente — o catálogo de categorias das
 * empresas liberadas pra ele (mesmas regras do escritório: nome único por
 * direção, categoria em uso não pode ser excluída, só desativada).
 */
import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { badRequest, forbidden, notFound } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';
import {
  classificacaoCreateSchema,
  classificacaoListQuerySchema,
  classificacaoUpdateSchema,
} from '../classificacoes/schema.js';
import { exigirEmpresa } from './acesso.js';

const TABLE = 'classificacoes';
const COLUMNS = 'id, client_id, direction, nome, ativo, created_at, updated_at';
const DUPLICADA = 'Já existe uma classificação com esse nome para essa direção.';
const uuid = z.string().uuid();

export const portalClassificacoesRouter = Router();

/** A classificação, se for de uma empresa liberada pro login — senão 404. */
async function classificacaoDoLogin(admin: SupabaseClient, userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Classificação não encontrada');
  const { data, error } = await admin.from(TABLE).select(COLUMNS).eq('id', id).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar a classificação');
  if (!data) throw notFound('Classificação não encontrada');
  await exigirEmpresa(admin, userId, data.client_id as string);
  return data;
}

portalClassificacoesRouter.get('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { client_id, direction } = classificacaoListQuerySchema.parse(req.query);
    await exigirEmpresa(admin, req.auth!.userId, client_id);
    let q = admin.from(TABLE).select(COLUMNS).eq('client_id', client_id).order('nome', { ascending: true });
    if (direction) q = q.eq('direction', direction);
    const { data, error } = await q;
    if (error) throw mapPgrstError(error, 'listar as classificações');
    res.json({ classificacoes: data ?? [] });
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.post('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const dto = classificacaoCreateSchema.parse(req.body);
    const empresa = await exigirEmpresa(admin, req.auth!.userId, dto.client_id);
    const { data, error } = await admin
      .from(TABLE)
      .insert({ ...dto, owner_id: empresa.owner_id })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw badRequest(DUPLICADA);
      throw mapPgrstError(error, 'criar a classificação');
    }
    res.status(201).json({ classificacao: data });
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.patch('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const dto = classificacaoUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) throw badRequest('Nada para atualizar');
    await classificacaoDoLogin(admin, req.auth!.userId, req.params.id);
    const { data, error } = await admin.from(TABLE).update(dto).eq('id', req.params.id).select(COLUMNS).maybeSingle();
    if (error) {
      if (error.code === '23505') throw badRequest(DUPLICADA);
      throw mapPgrstError(error, 'atualizar a classificação');
    }
    if (!data) throw notFound('Classificação não encontrada');
    res.json({ classificacao: data });
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.delete('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    await classificacaoDoLogin(admin, req.auth!.userId, req.params.id);

    const { count: emUso, error: uErr } = await admin
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('classificacao_id', req.params.id);
    if (uErr) throw mapPgrstError(uErr, 'verificar o uso da classificação');
    if (emUso) {
      throw badRequest(
        `Essa classificação está em uso em ${emUso} lançamento(s) e não pode ser excluída. Desative em vez de excluir.`,
      );
    }

    const { error } = await admin.from(TABLE).delete().eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir a classificação');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.use((_req, _res, next) => next(forbidden('Acesso restrito ao escritório.')));
