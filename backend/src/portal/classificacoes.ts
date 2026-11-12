/**
 * /api/classificacoes pro login de cliente — a lista própria de classificações
 * das empresas liberadas pra ele. Desde 2026-11-11 o cliente só ESCOLHE da
 * lista geral do escritório (não cria avulsa — isso é do escritório), e a
 * lista é a mesma em todas as empresas do login (classificacoes/grupo.ts).
 */
import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { badRequest, forbidden, notFound } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';
import { logger } from '../lib/logger.js';
import {
  classificacaoListQuerySchema,
  classificacaoUpdateSchema,
  daListaGeralSchema,
  geralListQuerySchema,
} from '../classificacoes/schema.js';
import { COLS_GERAL } from '../classificacoes/router.js';
import { dashboardQuerySchema, montarDashboard } from '../classificacoes/dashboard.js';
import {
  adicionarAoGrupo,
  alterarNoGrupo,
  COLS_CLASSIFICACAO,
  listaDaEmpresa,
  removerDoGrupo,
  sincronizarGrupo,
  type Classificacao,
} from '../classificacoes/grupo.js';
import { empresasDoLogin, exigirEmpresa } from './acesso.js';

const TABLE = 'classificacoes';
const SO_DA_LISTA_GERAL =
  'Para incluir uma classificação, escolha da lista geral (botões "Adicionar classificações de entradas/saídas"). ' +
  'Se faltar alguma, peça ao escritório.';
const uuid = z.string().uuid();

export const portalClassificacoesRouter = Router();

/** A classificação, se for de uma empresa liberada pro login — senão 404. */
async function classificacaoDoLogin(admin: SupabaseClient, userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Classificação não encontrada');
  const { data, error } = await admin.from(TABLE).select(COLS_CLASSIFICACAO).eq('id', id).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar a classificação');
  if (!data) throw notFound('Classificação não encontrada');
  const empresa = await exigirEmpresa(admin, userId, data.client_id as string);
  return { classificacao: data as Classificacao, empresa };
}

// GET /gerais  — a lista geral do escritório das empresas do login (só leitura)
portalClassificacoesRouter.get('/gerais', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { direction } = geralListQuerySchema.parse(req.query);
    const escritorios = [...new Set((await empresasDoLogin(admin, req.auth!.userId)).map((e) => e.owner_id))];
    if (!escritorios.length) {
      res.json({ gerais: [], pode_editar: false });
      return;
    }
    let q = admin.from('classificacoes_gerais').select(COLS_GERAL).in('owner_id', escritorios);
    if (direction) q = q.eq('direction', direction);
    const { data, error } = await q.order('nome', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar a lista geral');
    res.json({ gerais: data ?? [], pode_editar: false });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard  — uma empresa do login, ou todas (sem client_id)
portalClassificacoesRouter.get('/dashboard', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { client_id, de, ate } = dashboardQuerySchema.parse(req.query);
    const empresas = client_id
      ? [await exigirEmpresa(admin, req.auth!.userId, client_id)]
      : await empresasDoLogin(admin, req.auth!.userId);
    res.json(
      await montarDashboard(admin, {
        empresas: empresas.map((e) => ({ id: e.id, razao_social: e.razao_social })),
        de,
        ate,
      }),
    );
  } catch (err) {
    next(err);
  }
});

// POST /da-lista-geral  — o cliente escolhe itens da lista geral
portalClassificacoesRouter.post('/da-lista-geral', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const dto = daListaGeralSchema.parse(req.body);
    const empresa = await exigirEmpresa(admin, req.auth!.userId, dto.client_id);
    const { data: gerais, error } = await admin
      .from('classificacoes_gerais')
      .select(COLS_GERAL)
      .in('id', dto.geral_ids)
      .eq('owner_id', empresa.owner_id);
    if (error) throw mapPgrstError(error, 'ler a lista geral');
    if ((gerais ?? []).length !== new Set(dto.geral_ids).size) throw badRequest('Item da lista geral não encontrado.');

    const r = await adicionarAoGrupo(admin, {
      ownerId: empresa.owner_id,
      clientId: empresa.id,
      itens: (gerais ?? []).map((g) => ({ direction: g.direction, nome: g.nome, geral_id: g.id })),
    });
    res.status(201).json({ ...r, classificacoes: await listaDaEmpresa(admin, empresa.id) });
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.get('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { client_id, direction } = classificacaoListQuerySchema.parse(req.query);
    const empresa = await exigirEmpresa(admin, req.auth!.userId, client_id);
    try {
      await sincronizarGrupo(admin, { ownerId: empresa.owner_id, clientId: empresa.id });
    } catch (err) {
      logger.warn({ err }, 'falha ao sincronizar a lista das empresas do login (segue com a da empresa)');
    }
    res.json({ classificacoes: await listaDaEmpresa(admin, client_id, direction) });
  } catch (err) {
    next(err);
  }
});

// criar classificação avulsa é do escritório
portalClassificacoesRouter.post('/', (_req, _res, next) => next(forbidden(SO_DA_LISTA_GERAL)));

// só reativar/desativar — renomear é do escritório (o nome vem da lista geral)
portalClassificacoesRouter.patch('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const dto = classificacaoUpdateSchema.parse(req.body);
    if (dto.nome !== undefined) throw forbidden('O nome vem da lista geral — só o escritório pode mudar.');
    if (dto.ativo === undefined) throw badRequest('Nada para atualizar');
    const { classificacao } = await classificacaoDoLogin(admin, req.auth!.userId, req.params.id);
    await alterarNoGrupo(admin, classificacao, { ativo: dto.ativo });
    const { data, error } = await admin.from(TABLE).select(COLS_CLASSIFICACAO).eq('id', req.params.id).maybeSingle();
    if (error) throw mapPgrstError(error, 'reler a classificação');
    res.json({ classificacao: data });
  } catch (err) {
    next(err);
  }
});

// tira da lista própria (de todas as empresas do login): exclui onde não está
// em uso, desativa onde algum lançamento usa
portalClassificacoesRouter.delete('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { classificacao } = await classificacaoDoLogin(admin, req.auth!.userId, req.params.id);
    res.json(await removerDoGrupo(admin, classificacao));
  } catch (err) {
    next(err);
  }
});

portalClassificacoesRouter.use((_req, _res, next) => next(forbidden('Acesso restrito ao escritório.')));
