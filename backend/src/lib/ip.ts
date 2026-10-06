import type { Request } from 'express';

const PARECE_IP = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * IP de quem chamou, para os limites e o bloqueio de login inválido.
 *
 * No Render a requisição passa pela Cloudflare e pelo balanceador do Render:
 * o req.ip (trust proxy 1) sai com o IP da Cloudflare, que muda a cada
 * requisição — o bloqueio por IP nunca juntava as tentativas de um mesmo
 * atacante (visto em produção em 2026-10-06). A Cloudflare entrega o IP real
 * em CF-Connecting-IP; fora dela (dev, testes) vale o req.ip.
 */
export function ipDoCliente(req: Request): string {
  const cf = req.header('cf-connecting-ip')?.trim();
  if (cf && PARECE_IP.test(cf)) return cf;
  return req.ip ?? 'desconhecido';
}
