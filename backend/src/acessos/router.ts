/**
 * /api/acessos — o escritório libera o portal (módulo Classificação) pro
 * cliente, pelo e-mail dele.
 *
 * E-mail novo: cria o login já marcado como cliente (app_metadata.papel) e o
 * Supabase manda o convite — o cliente clica e define a própria senha (fica só
 * o hash no Supabase Auth; o escritório nunca vê). E-mail que já é login de
 * cliente: só ganha mais uma empresa, sem novo convite. Remover o último
 * acesso de um login apaga o login.
 */
import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { erroDeEmail, linkSenha, senhaDefinida } from '../lib/convite.js';
import { badGateway, badRequest, HttpError, notFound } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';
import { escritorioDe } from '../lib/escritorio.js';
import { logger } from '../lib/logger.js';

const TABLE = 'cliente_acessos';
const COLS = 'id, client_id, user_id, email, created_at';

const listarSchema = z.object({ client_id: z.string().uuid() });
const criarSchema = z.object({
  client_id: z.string().uuid(),
  email: z.string().trim().toLowerCase().email('e-mail inválido').max(254),
});

export const acessosRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

/** O cliente é do escritório (RLS) — senão 404. */
async function exigirCliente(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase.from('clients').select('id').eq('id', clientId).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar o cliente');
  if (!data) throw notFound('Cliente não encontrado');
}

// --------------------------------------------------------------------------- #
// GET /?client_id=  — logins com acesso a esse cliente (e as outras empresas deles)
// --------------------------------------------------------------------------- #
acessosRouter.get('/', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { client_id } = listarSchema.parse(req.query);
    await exigirCliente(supabase, client_id);

    const { data: acessos, error } = await supabase
      .from(TABLE)
      .select(COLS)
      .eq('client_id', client_id)
      .order('created_at', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar os acessos');
    if (!acessos?.length) {
      res.json({ acessos: [] });
      return;
    }

    const userIds = [...new Set(acessos.map((a) => a.user_id as string))];
    const { data: todas, error: tErr } = await supabase
      .from(TABLE)
      .select('user_id, client_id, client:clients(razao_social)')
      .in('user_id', userIds);
    if (tErr) throw mapPgrstError(tErr, 'listar as empresas dos logins');
    const empresasPorLogin = new Map<string, Array<{ id: string; razao_social: string }>>();
    for (const t of todas ?? []) {
      const c = (Array.isArray(t.client) ? t.client[0] : t.client) as { razao_social?: string } | null;
      const lista = empresasPorLogin.get(t.user_id as string) ?? [];
      lista.push({ id: t.client_id as string, razao_social: c?.razao_social ?? '' });
      empresasPorLogin.set(t.user_id as string, lista);
    }

    const admin = adminDe(req);
    const saida = [];
    for (const a of acessos) {
      const { data: u } = await admin.auth.admin.getUserById(a.user_id as string);
      saida.push({
        ...a,
        status: senhaDefinida(u?.user) ? 'ativo' : 'convite_pendente',
        empresas: empresasPorLogin.get(a.user_id as string) ?? [],
      });
    }
    res.json({ acessos: saida });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /  { client_id, email }  — libera o portal pro e-mail
// --------------------------------------------------------------------------- #
acessosRouter.post('/', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { client_id, email } = criarSchema.parse(req.body);
    await exigirCliente(supabase, client_id);
    const admin = adminDe(req);

    // já é login de cliente (de qualquer empresa)? então só ganha mais uma empresa
    const { data: existente, error: eErr } = await admin
      .from(TABLE)
      .select('user_id')
      .eq('email', email)
      .limit(1)
      .maybeSingle();
    if (eErr) throw mapPgrstError(eErr, 'procurar o login');

    let userId: string;
    let criado = false;
    if (existente) {
      userId = existente.user_id as string;
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
      if (uErr || u?.user?.app_metadata?.papel !== 'cliente') {
        throw badRequest('Esse e-mail não é um login de cliente — use outro e-mail.');
      }
    } else {
      // login novo, já marcado como cliente ANTES do convite sair
      const { data: novo, error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        app_metadata: { papel: 'cliente' },
      });
      if (cErr || !novo?.user) {
        if (cErr?.code === 'email_exists' || /already (been )?registered/i.test(cErr?.message ?? '')) {
          throw badRequest('Esse e-mail já é usado por um login do escritório — use outro e-mail para o cliente.');
        }
        throw badGateway(`Não consegui criar o login: ${cErr?.message ?? 'resposta vazia'}`);
      }
      userId = novo.user.id;
      criado = true;

      const { error: iErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: linkSenha() });
      if (iErr) {
        await admin.auth.admin.deleteUser(userId);
        throw erroDeEmail('enviar o convite', iErr);
      }
    }

    const { data: acesso, error: aErr } = await supabase
      .from(TABLE)
      .insert({ owner_id: escritorioDe(req), client_id, user_id: userId, email })
      .select(COLS)
      .single();
    if (aErr) {
      if (criado) await admin.auth.admin.deleteUser(userId);
      if (aErr.code === '23505') throw new HttpError(409, 'Esse login já tem acesso a essa empresa.');
      throw mapPgrstError(aErr, 'liberar o acesso');
    }

    res.status(201).json({ acesso, convite_enviado: criado });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /:id/reenviar  — convite de novo (ou redefinição, se já tem senha)
// --------------------------------------------------------------------------- #
acessosRouter.post('/:id/reenviar', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { data: acesso, error } = await supabase.from(TABLE).select(COLS).eq('id', req.params.id).maybeSingle();
    if (error) throw mapPgrstError(error, 'buscar o acesso');
    if (!acesso) throw notFound('Acesso não encontrado');
    const admin = adminDe(req);

    const { data: u } = await admin.auth.admin.getUserById(acesso.user_id as string);
    // já aceitou o convite (e-mail confirmado), mesmo sem ter criado a senha:
    // o Supabase recusa convite de novo — vai o e-mail de nova senha
    if (senhaDefinida(u?.user) || u?.user?.email_confirmed_at) {
      const { error: rErr } = await admin.auth.resetPasswordForEmail(acesso.email as string, { redirectTo: linkSenha() });
      if (rErr) throw erroDeEmail('enviar o e-mail de nova senha', rErr);
      res.json({ enviado: 'redefinir_senha' });
      return;
    }
    const { error: iErr } = await admin.auth.admin.inviteUserByEmail(acesso.email as string, { redirectTo: linkSenha() });
    if (iErr) throw erroDeEmail('reenviar o convite', iErr);
    res.json({ enviado: 'convite' });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /:id  — tira a empresa do login (último acesso → apaga o login)
// --------------------------------------------------------------------------- #
acessosRouter.delete('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { data: acesso, error } = await supabase.from(TABLE).select(COLS).eq('id', req.params.id).maybeSingle();
    if (error) throw mapPgrstError(error, 'buscar o acesso');
    if (!acesso) throw notFound('Acesso não encontrado');

    const { error: dErr } = await supabase.from(TABLE).delete().eq('id', req.params.id);
    if (dErr) throw mapPgrstError(dErr, 'remover o acesso');

    const admin = adminDe(req);
    const { count, error: cErr } = await admin
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', acesso.user_id as string);
    if (cErr) throw mapPgrstError(cErr, 'conferir os outros acessos do login');
    if (!count) {
      const { error: uErr } = await admin.auth.admin.deleteUser(acesso.user_id as string);
      if (uErr) logger.warn({ err: uErr }, 'acesso removido, mas não consegui apagar o login sem empresas');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
