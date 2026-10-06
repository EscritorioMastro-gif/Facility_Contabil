import { Router } from 'express';
import { adminDe } from '../lib/admin.js';
import { forbidden } from '../lib/httpError.js';
import { empresasDoLogin } from './acesso.js';
import { paraCliente } from './formato.js';

/** /api/clients pro login de cliente: só lista as empresas liberadas pra ele. */
export const portalClientesRouter = Router();

portalClientesRouter.get('/', async (req, res, next) => {
  try {
    const empresas = await empresasDoLogin(adminDe(req), req.auth!.userId);
    res.json({ clients: empresas.map(paraCliente) });
  } catch (err) {
    next(err);
  }
});

// cadastro de clientes é do escritório
portalClientesRouter.use((_req, _res, next) => next(forbidden('Acesso restrito ao escritório.')));
