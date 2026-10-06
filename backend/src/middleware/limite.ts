import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/httpError.js';
import { ipDoCliente } from '../lib/ip.js';

type Janela = { inicio: number; usados: number };

/**
 * Limite de requisições em janela fixa, em memória (a API roda numa instância
 * só). `chave` decide quem divide a cota: o login (quando já autenticado) ou o
 * IP. Estourou: 429 com Retry-After.
 */
export function limitador(opts: {
  janelaMs: number;
  maximo: number;
  chave: (req: Request) => string;
  mensagem: string;
}): ((req: Request, res: Response, next: NextFunction) => void) & { limpar: () => void } {
  const contas = new Map<string, Janela>();
  let ultimaFaxina = Date.now();

  const mw = (req: Request, res: Response, next: NextFunction): void => {
    const agora = Date.now();
    if (agora - ultimaFaxina > opts.janelaMs || contas.size > 50_000) {
      for (const [k, j] of contas) if (agora - j.inicio >= opts.janelaMs) contas.delete(k);
      if (contas.size > 50_000) contas.clear();
      ultimaFaxina = agora;
    }
    const k = opts.chave(req);
    let j = contas.get(k);
    if (!j || agora - j.inicio >= opts.janelaMs) {
      j = { inicio: agora, usados: 0 };
      contas.set(k, j);
    }
    j.usados += 1;
    if (j.usados > opts.maximo) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((j.inicio + opts.janelaMs - agora) / 1000))));
      next(new HttpError(429, opts.mensagem));
      return;
    }
    next();
  };
  return Object.assign(mw, { limpar: () => contas.clear() });
}

const porIp = (req: Request) => `ip:${ipDoCliente(req)}`;
/** Depois do requireAuth: a cota é do login (o escritório inteiro sai pelo mesmo IP). */
const porLogin = (req: Request) => (req.auth ? `u:${req.auth.userId}` : porIp(req));

/** Teto geral por IP — só pra segurar inundação; o uso normal fica muito abaixo. */
export const limiteGeral = limitador({
  janelaMs: 5 * 60_000,
  maximo: 1500,
  chave: porIp,
  mensagem: 'Muitas requisições seguidas — espere um pouco e tente de novo.',
});

/** Envio de arquivo (cada um vai pro leitor de extratos, que é o recurso mais caro). */
export const limiteUpload = limitador({
  janelaMs: 10 * 60_000,
  maximo: 60,
  chave: porLogin,
  mensagem: 'Muitos arquivos enviados em pouco tempo — espere alguns minutos.',
});

/** Convites e links de senha por e-mail (cada um sai pelo SMTP do escritório). */
export const limiteConvites = limitador({
  janelaMs: 60 * 60_000,
  maximo: 30,
  chave: porLogin,
  mensagem: 'Muitos convites/e-mails de acesso nesta hora — tente mais tarde.',
});
