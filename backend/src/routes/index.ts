import { Router } from 'express';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';
import { requireAuth } from '../middleware/auth.js';
import { clientsRouter } from '../clients/router.js';
import { statementsRouter } from '../statements/router.js';
import { rulesRouter } from '../rules/router.js';
import { classificacoesRouter } from '../classificacoes/router.js';
import { acessosRouter } from '../acessos/router.js';
import { portalClientesRouter } from '../portal/clientes.js';
import { portalExtratosRouter } from '../portal/extratos.js';
import { portalClassificacoesRouter } from '../portal/classificacoes.js';
import { porPapel, soEscritorio } from './papel.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/me', meRouter);
// login do escritório segue nos routers de sempre; login de cliente (portal) só
// enxerga a Classificação das empresas liberadas pra ele
apiRouter.use('/clients', requireAuth, porPapel({ escritorio: clientsRouter, cliente: portalClientesRouter }));
apiRouter.use('/statements', requireAuth, porPapel({ escritorio: statementsRouter, cliente: portalExtratosRouter }));
apiRouter.use('/rules', requireAuth, soEscritorio, rulesRouter);
apiRouter.use(
  '/classificacoes',
  requireAuth,
  porPapel({ escritorio: classificacoesRouter, cliente: portalClassificacoesRouter }),
);
apiRouter.use('/acessos', requireAuth, soEscritorio, acessosRouter);
