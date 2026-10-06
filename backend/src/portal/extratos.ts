/**
 * /api/statements pro login de cliente — só o que o módulo Classificação usa:
 * listar, abrir, enviar extrato, classificar e excluir. Tudo restrito às
 * empresas liberadas pro login e a extratos do módulo Classificação. Depois que
 * o escritório puxa o extrato pra Importação (status sai de 'classificacao'),
 * o cliente só consegue ver.
 */
import { Router } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { badRequest, forbidden, notFound } from '../lib/httpError.js';
import { emLotes, lerTodas, mapPgrstError } from '../lib/pgrst.js';
import { logger } from '../lib/logger.js';
import {
  bulkUpdateClassificacaoSchema,
  classificarStatementSchema,
  listStatementsQuerySchema,
} from '../statements/schema.js';
import { callParser, type ParseResult } from '../statements/parserClient.js';
import { detectFormat, gravarLancamentos, motivoRecusa, sanitizeName, tipoPorNome } from '../statements/router.js';
import { empresasDoLogin, exigirEmpresa } from './acesso.js';
import { paraExtrato, paraLancamento, STMT_COLS_PORTAL, TXN_COLS_PORTAL } from './formato.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const BUCKET = 'statements';
const uuid = z.string().uuid();

const JA_ENVIADO =
  'Esse extrato já foi enviado para a contabilidade — as classificações não podem mais ser alteradas.';

export const portalExtratosRouter = Router();

/** O extrato, se for do módulo Classificação e de uma empresa liberada pro login — senão 404. */
async function extratoDoLogin(admin: SupabaseClient, userId: string, id: string) {
  if (!uuid.safeParse(id).success) throw notFound('Extrato não encontrado');
  const { data, error } = await admin
    .from('statements')
    .select(`${STMT_COLS_PORTAL}, client:clients(razao_social, cnpj)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar o extrato');
  if (!data || data.origem_modulo !== 'classificacao') throw notFound('Extrato não encontrado');
  await exigirEmpresa(admin, userId, data.client_id as string);
  return data as Record<string, unknown>;
}

function lerLancamentos(admin: SupabaseClient, statementId: string, contexto: string) {
  return lerTodas(
    (de, ate) =>
      admin.from('transactions').select(TXN_COLS_PORTAL).eq('statement_id', statementId).order('ordem').range(de, ate),
    contexto,
  );
}

// --------------------------------------------------------------------------- #
// GET /  — extratos do módulo Classificação das empresas do login
// --------------------------------------------------------------------------- #
portalExtratosRouter.get('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const { client_id, status, limit } = listStatementsQuerySchema.parse(req.query);
    let ids = (await empresasDoLogin(admin, req.auth!.userId)).map((e) => e.id);
    if (client_id) ids = ids.filter((id) => id === client_id);
    if (!ids.length) {
      res.json({ statements: [] });
      return;
    }

    let q = admin
      .from('statements')
      .select(`${STMT_COLS_PORTAL}, client:clients(razao_social, cnpj)`)
      .in('client_id', ids)
      .eq('origem_modulo', 'classificacao')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw mapPgrstError(error, 'listar os extratos');
    res.json({ statements: (data ?? []).map((s) => paraExtrato(s)) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /classificar  — o cliente envia o extrato de uma empresa dele
// --------------------------------------------------------------------------- #
portalExtratosRouter.post('/classificar', upload.single('file'), async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const userId = req.auth!.userId;
    if (!req.file) throw badRequest('Arquivo do extrato é obrigatório (campo "file")');
    const dto = classificarStatementSchema.parse(req.body);

    const formato = detectFormat(req.file.originalname);
    if (!formato) throw badRequest('Formato não reconhecido — use PDF, OFX, CSV, XLS ou XLSX');

    const empresa = await exigirEmpresa(admin, userId, dto.client_id);
    const saldoInicial = Number(empresa.saldo_inicial ?? 0);

    // o extrato é do escritório (owner_id) — é ele que puxa pra Importação depois
    const { data: stmt, error: sErr } = await admin
      .from('statements')
      .insert({
        owner_id: empresa.owner_id,
        client_id: empresa.id,
        arquivo_nome: req.file.originalname,
        formato,
        hist_code_entrada: empresa.hist_code_entrada,
        hist_code_saida: empresa.hist_code_saida,
        saldo_inicial: saldoInicial,
        status: 'parsing',
        origem_modulo: 'classificacao',
        enviado_por: userId,
      })
      .select('id')
      .single();
    if (sErr) throw mapPgrstError(sErr, 'criar o extrato');
    const statementId = stmt.id as string;

    const path = `${empresa.owner_id}/${statementId}/${sanitizeName(req.file.originalname)}`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, req.file.buffer, { contentType: tipoPorNome(req.file.originalname), upsert: true });
    if (upErr) {
      logger.warn({ upErr }, 'falha ao subir arquivo no storage (segue mesmo assim)');
    } else {
      await admin.from('statements').update({ storage_path: path }).eq('id', statementId);
    }

    let parsed: ParseResult | null = null;
    let parseErr: unknown = null;
    try {
      parsed = await callParser(
        { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
        { pdfPassword: dto.pdf_password },
      );
    } catch (e) {
      parseErr = e;
    }

    const recusa = motivoRecusa(parseErr, parsed);
    if (recusa || !parsed) {
      const msg = recusa ?? 'falha ao ler o extrato';
      await admin.from('statements').update({ status: 'erro', erro_msg: msg }).eq('id', statementId);
      throw parseErr ?? badRequest(msg, { warnings: parsed?.warnings ?? [] });
    }

    const { statement, transactions } = await gravarLancamentos(admin, {
      ownerId: empresa.owner_id,
      statementId,
      clientId: empresa.id,
      histEntrada: empresa.hist_code_entrada,
      histSaida: empresa.hist_code_saida,
      saldoInicial,
      parsed,
      arquivoNome: req.file.originalname,
      formato,
      storagePath: upErr ? null : path,
      statusFinal: 'classificacao',
    });

    res.status(201).json({
      statement: paraExtrato(statement as Record<string, unknown>, empresa),
      transactions: (transactions as Record<string, unknown>[]).map(paraLancamento),
      warnings: parsed.warnings,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /:id  — extrato + lançamentos (sem nada do fluxo contábil)
// --------------------------------------------------------------------------- #
portalExtratosRouter.get('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const extrato = await extratoDoLogin(admin, req.auth!.userId, req.params.id);
    const txns = await lerLancamentos(admin, req.params.id, 'buscar os lançamentos');
    res.json({ statement: paraExtrato(extrato), transactions: txns.map(paraLancamento) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /:id/classificacao  — grava a classificação (só enquanto está no módulo)
// --------------------------------------------------------------------------- #
portalExtratosRouter.patch('/:id/classificacao', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const statementId = req.params.id;
    const { updates } = bulkUpdateClassificacaoSchema.parse(req.body);
    const extrato = await extratoDoLogin(admin, req.auth!.userId, statementId);
    if (extrato.status !== 'classificacao') throw badRequest(JA_ENVIADO);

    // só classificação da própria empresa do extrato
    const idsClassif = [...new Set(updates.map((u) => u.classificacao_id).filter((v): v is string => !!v))];
    const validas = new Set<string>();
    for (const lote of emLotes(idsClassif)) {
      const { data, error } = await admin.from('classificacoes').select('id, client_id').in('id', lote);
      if (error) throw mapPgrstError(error, 'conferir as classificações');
      for (const c of data ?? []) if (c.client_id === extrato.client_id) validas.add(c.id as string);
    }
    if (idsClassif.some((id) => !validas.has(id))) throw badRequest('Classificação inválida para essa empresa.');

    const { data: affected, error } = await admin.rpc('update_transactions_classificacao_portal', {
      p_statement: statementId,
      p_updates: updates,
    });
    if (error) throw mapPgrstError(error, 'salvar as classificações');
    if (!affected) throw notFound('Nenhum lançamento atualizado');

    const txns = await lerLancamentos(admin, statementId, 'recarregar os lançamentos');
    res.json({ transactions: txns.map(paraLancamento), updated: affected });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /:id  — só enquanto o extrato ainda está no módulo Classificação
// --------------------------------------------------------------------------- #
portalExtratosRouter.delete('/:id', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const extrato = await extratoDoLogin(admin, req.auth!.userId, req.params.id);
    if (!['classificacao', 'erro'].includes(extrato.status as string)) {
      throw badRequest('Esse extrato já foi enviado para a contabilidade — só o escritório pode excluí-lo.');
    }

    const { data: arquivo } = await admin.from('statements').select('storage_path').eq('id', req.params.id).maybeSingle();
    if (arquivo?.storage_path) await admin.storage.from(BUCKET).remove([arquivo.storage_path as string]);
    const { error } = await admin.from('statements').delete().eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir o extrato');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// importar/revisar/gerar arquivo do Domínio é do escritório
portalExtratosRouter.use((_req, _res, next) => next(forbidden('Acesso restrito ao escritório.')));
