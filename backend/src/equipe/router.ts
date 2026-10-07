/**
 * Equipe do escritório (Cadastros → Equipe) — quem do escritório entra no
 * sistema. Cada pessoa tem o próprio login e a própria senha (criada pelo link
 * do convite) e vê os MESMOS dados do escritório (migration 0022).
 *
 * Só quem administra convida e remove. Remover tira da equipe na hora (a RLS
 * do banco deixa de mostrar qualquer dado) e bloqueia o login — sem apagar,
 * pra o "criado por" dos cadastros continuar dizendo quem fez.
 */
import { Router, type Request } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { erroDeEmail, linkSenha, senhaDefinida } from '../lib/convite.js';
import { escritorioDe, esquecerEscritorio } from '../lib/escritorio.js';
import { badGateway, badRequest, forbidden, HttpError, notFound } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';
import { mapPgrstError } from '../lib/pgrst.js';

const MEMBROS = 'escritorio_membros';
/** ~100 anos: login removido da equipe não entra mais (desbloqueia se for convidado de novo). */
const BLOQUEIO = '876000h';

const conviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('e-mail inválido').max(254),
});
const uuid = z.string().uuid();

type Membro = { user_id: string; escritorio_id: string; admin: boolean; criado_em: string };

export const equipeRouter = Router();

async function membrosDoEscritorio(admin: SupabaseClient, escritorioId: string): Promise<Membro[]> {
  const { data, error } = await admin
    .from(MEMBROS)
    .select('user_id, escritorio_id, admin, criado_em')
    .eq('escritorio_id', escritorioId)
    .order('criado_em');
  if (error) throw mapPgrstError(error, 'listar a equipe');
  return (data ?? []) as Membro[];
}

/** A equipe, se quem chama administra o escritório — senão 403. */
async function exigirAdmin(admin: SupabaseClient, req: Request): Promise<Membro[]> {
  const membros = await membrosDoEscritorio(admin, escritorioDe(req));
  const eu = membros.find((m) => m.user_id === req.auth!.userId);
  if (!eu?.admin) throw forbidden('Só quem administra o escritório pode mexer na equipe.');
  return membros;
}

const status = (u: User | null | undefined) =>
  senhaDefinida(u) || u?.last_sign_in_at ? ('ativo' as const) : ('convite_pendente' as const);

/** Login existente pelo e-mail (a API de Auth não busca por e-mail: percorre as páginas). */
async function loginPorEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const POR_PAGINA = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: POR_PAGINA });
    if (error) throw badGateway(`Não consegui procurar o login: ${error.message}`);
    const achado = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (achado) return achado;
    if (data.users.length < POR_PAGINA) return null;
  }
  return null;
}

async function incluir(admin: SupabaseClient, userId: string, escritorioId: string): Promise<void> {
  const { error } = await admin.from(MEMBROS).insert({ user_id: userId, escritorio_id: escritorioId, admin: false });
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Essa pessoa já faz parte de uma equipe.');
    throw mapPgrstError(error, 'incluir na equipe');
  }
}

// --------------------------------------------------------------------------- #
// GET /  — a equipe do escritório
// --------------------------------------------------------------------------- #
equipeRouter.get('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const escritorioId = escritorioDe(req);
    const membros = await membrosDoEscritorio(admin, escritorioId);
    const saida = [];
    for (const m of membros) {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      saida.push({
        user_id: m.user_id,
        email: data?.user?.email ?? '(login apagado)',
        admin: m.admin,
        principal: m.user_id === escritorioId,
        voce: m.user_id === req.auth!.userId,
        status: status(data?.user),
        criado_em: m.criado_em,
      });
    }
    res.json({ membros: saida, souAdmin: !!membros.find((m) => m.user_id === req.auth!.userId)?.admin });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /  { email }  — convida alguém pra equipe
// --------------------------------------------------------------------------- #
equipeRouter.post('/', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const escritorioId = escritorioDe(req);
    await exigirAdmin(admin, req);
    const { email } = conviteSchema.parse(req.body);

    // login novo (sem papel = login do escritório)
    const { data: novo, error: cErr } = await admin.auth.admin.createUser({ email, email_confirm: false });
    if (cErr || !novo?.user) {
      if (cErr?.code !== 'email_exists' && !/already (been )?registered/i.test(cErr?.message ?? '')) {
        throw badGateway(`Não consegui criar o login: ${cErr?.message ?? 'resposta vazia'}`);
      }
      // o e-mail já tem login: entra na equipe se for login de escritório sem equipe
      const existente = await loginPorEmail(admin, email);
      if (!existente) throw badGateway('O e-mail já tem login, mas não consegui encontrá-lo.');
      if (existente.app_metadata?.papel === 'cliente') {
        throw badRequest('Esse e-mail é de um login de cliente (portal) — use outro e-mail para a equipe.');
      }
      await incluir(admin, existente.id, escritorioId);
      // removido antes? volta a entrar
      const { error: dErr } = await admin.auth.admin.updateUserById(existente.id, { ban_duration: 'none' });
      if (dErr) logger.warn({ err: dErr }, 'incluído na equipe, mas não consegui desbloquear o login');
      esquecerEscritorio(existente.id);
      res.status(201).json({ convite_enviado: false });
      return;
    }

    const userId = novo.user.id;
    try {
      await incluir(admin, userId, escritorioId);
    } catch (e) {
      await admin.auth.admin.deleteUser(userId);
      throw e;
    }
    const { error: iErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: linkSenha() });
    if (iErr) {
      await admin.from(MEMBROS).delete().eq('user_id', userId);
      await admin.auth.admin.deleteUser(userId);
      throw erroDeEmail('enviar o convite', iErr);
    }
    res.status(201).json({ convite_enviado: true });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /:userId/reenviar  — convite de novo (ou link de nova senha)
// --------------------------------------------------------------------------- #
equipeRouter.post('/:userId/reenviar', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const membros = await exigirAdmin(admin, req);
    const alvoId = req.params.userId;
    if (!uuid.safeParse(alvoId).success || !membros.some((m) => m.user_id === alvoId)) {
      throw notFound('Pessoa não encontrada na equipe');
    }
    const { data } = await admin.auth.admin.getUserById(alvoId);
    const u = data?.user;
    if (!u?.email) throw notFound('Login não encontrado');
    if (senhaDefinida(u) || u.email_confirmed_at) {
      const { error } = await admin.auth.resetPasswordForEmail(u.email, { redirectTo: linkSenha() });
      if (error) throw erroDeEmail('enviar o e-mail de nova senha', error);
      res.json({ enviado: 'redefinir_senha' });
      return;
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(u.email, { redirectTo: linkSenha() });
    if (error) throw erroDeEmail('reenviar o convite', error);
    res.json({ enviado: 'convite' });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /:userId  — tira da equipe e bloqueia o login
// --------------------------------------------------------------------------- #
equipeRouter.delete('/:userId', async (req, res, next) => {
  try {
    const admin = adminDe(req);
    const escritorioId = escritorioDe(req);
    const membros = await exigirAdmin(admin, req);
    const alvoId = req.params.userId;
    if (!uuid.safeParse(alvoId).success || !membros.some((m) => m.user_id === alvoId)) {
      throw notFound('Pessoa não encontrada na equipe');
    }
    if (alvoId === req.auth!.userId) {
      throw badRequest('Você não pode tirar a si mesmo da equipe — peça a outra pessoa que administra.');
    }
    if (alvoId === escritorioId) {
      throw badRequest('A conta principal do escritório não pode sair da equipe (os dados são dela).');
    }

    const { error } = await admin.from(MEMBROS).delete().eq('user_id', alvoId).eq('escritorio_id', escritorioId);
    if (error) throw mapPgrstError(error, 'tirar da equipe');
    const { error: bErr } = await admin.auth.admin.updateUserById(alvoId, { ban_duration: BLOQUEIO });
    if (bErr) logger.warn({ err: bErr }, 'tirado da equipe, mas não consegui bloquear o login');
    esquecerEscritorio(alvoId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
