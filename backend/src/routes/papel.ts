import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden } from '../lib/httpError.js';

/**
 * Mesmo endereço, dois atendimentos: login do escritório segue no router de
 * sempre (intocado); login de cliente (portal) cai no router do portal, que só
 * conhece a Classificação das empresas liberadas pra ele.
 */
export function porPapel(routers: { escritorio: RequestHandler; cliente: RequestHandler }): RequestHandler {
  return (req, res, next) => (req.auth?.papel === 'cliente' ? routers.cliente : routers.escritorio)(req, res, next);
}

/** Rota só do escritório: login de cliente recebe 403. */
export function soEscritorio(req: Request, _res: Response, next: NextFunction): void {
  next(req.auth?.papel === 'cliente' ? forbidden('Acesso restrito ao escritório.') : undefined);
}
