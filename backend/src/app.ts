import express, { type Express } from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { cabecalhosDeSeguranca } from './middleware/seguranca.js';
import { limiteGeral } from './middleware/limite.js';

/**
 * O que cada requisição grava no log. SEM os cabeçalhos: o padrão do pino-http
 * grava o Authorization (token de login) em toda linha. Sem query string: a
 * busca de cliente leva nome/CNPJ na URL.
 */
export const serializadoresDeLog = {
  req: (req: { id?: unknown; method?: string; url?: string }) => ({
    id: req.id,
    method: req.method,
    url: String(req.url ?? '').split('?')[0],
  }),
  res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
};

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by'); // não anuncia o servidor
  app.set('etag', false); // dado financeiro não é revalidado de cache (ver cabecalhosDeSeguranca)
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: serializadoresDeLog,
    }),
  );
  app.use(cabecalhosDeSeguranca);
  app.use(
    cors({
      origin: config.frontendOrigin.split(',').map((s) => s.trim()),
      // autenticação é por header Authorization, não por cookie
      credentials: false,
      // a tela lê o nome do arquivo do Domínio e a conferência do download
      exposedHeaders: ['Content-Disposition', 'X-Export-Sha256', 'X-Export-Linhas'],
    }),
  );
  // o corpo JSON só é lido DEPOIS do login conferido (ver routes/index.ts)
  app.use('/api', limiteGeral, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
