import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Cabeçalhos de segurança de toda resposta da API. A API só devolve JSON e o
 * arquivo do Domínio: nada pode ser renderizado, emoldurado (iframe) nem
 * guardado em cache — resposta com dado financeiro não fica no disco de um
 * computador compartilhado do escritório nem em proxy no caminho.
 */
export function cabecalhosDeSeguranca(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}
