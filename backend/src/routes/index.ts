import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';
import { requireAuth } from '../middleware/auth.js';
import { limiteConvites, limiteUpload } from '../middleware/limite.js';
import { clientsRouter } from '../clients/router.js';
import { statementsRouter } from '../statements/router.js';
import { rulesRouter } from '../rules/router.js';
import { classificacoesRouter } from '../classificacoes/router.js';
import { acessosRouter } from '../acessos/router.js';
import { portalClientesRouter } from '../portal/clientes.js';
import { portalExtratosRouter } from '../portal/extratos.js';
import { portalClassificacoesRouter } from '../portal/classificacoes.js';
import { equipeRouter } from '../equipe/router.js';
import { exigirEscritorio } from '../lib/escritorio.js';
import { porPapel, soEscritorio } from './papel.js';

export const apiRouter = Router();

// O corpo JSON só é lido depois do requireAuth: requisição sem login válido é
// recusada antes de a API gastar memória/CPU com o corpo.
const json = express.json({ limit: '1mb' });
// salvar a revisão de um extrato grande manda até 10.000 lançamentos de uma vez
const jsonRevisao = express.json({ limit: '10mb' });

/** Aplica o limitador só nas rotas que recebem arquivo (cada uma vai pro leitor). */
const UPLOAD = /^\/(excel(\/planilha)?|classificar|[^/]+\/reimport)?\/?$/;
function soEmUpload(limite: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) =>
    req.method === 'POST' && UPLOAD.test(req.path) ? limite(req, res, next) : next();
}
const soEmPost = (limite: RequestHandler): RequestHandler => (req, res, next) =>
  req.method === 'POST' ? limite(req, res, next) : next();
/** Rotas do escritório: antes, descobre o escritório do login (lib/escritorio.ts). */
const doEscritorio = (router: RequestHandler): RequestHandler => Router().use(exigirEscritorio, router);

apiRouter.use('/health', healthRouter);
apiRouter.use('/me', meRouter);
// login do escritório segue nos routers de sempre (todos no MESMO escritório);
// login de cliente (portal) só enxerga a Classificação das empresas liberadas pra ele
apiRouter.use(
  '/clients',
  requireAuth,
  json,
  porPapel({ escritorio: doEscritorio(clientsRouter), cliente: portalClientesRouter }),
);
apiRouter.use(
  '/statements',
  requireAuth,
  soEmUpload(limiteUpload),
  jsonRevisao,
  porPapel({ escritorio: doEscritorio(statementsRouter), cliente: portalExtratosRouter }),
);
apiRouter.use('/rules', requireAuth, soEscritorio, exigirEscritorio, json, rulesRouter);
apiRouter.use(
  '/classificacoes',
  requireAuth,
  json,
  porPapel({ escritorio: doEscritorio(classificacoesRouter), cliente: portalClassificacoesRouter }),
);
apiRouter.use('/acessos', requireAuth, soEscritorio, exigirEscritorio, soEmPost(limiteConvites), json, acessosRouter);
apiRouter.use('/equipe', requireAuth, soEscritorio, exigirEscritorio, soEmPost(limiteConvites), json, equipeRouter);
