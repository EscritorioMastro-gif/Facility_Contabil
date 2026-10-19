import { env } from './env';

/** Uma chamada segurada pelo Render enquanto o leitor acorda já basta; não repete antes disso. */
const INTERVALO_MS = 30_000;
let ultima = 0;

/**
 * Acorda o leitor de extratos no plano gratuito do Render. Ele dorme após 15 min
 * sem uso, e o Render só o acorda com chamada de FORA do Render — a da API (que
 * roda lá dentro) recebe 502 na hora, sem acordá-lo. Então quem acorda é o
 * navegador: GET no /health público do leitor (no-cors: a resposta não importa,
 * só a chamada chegar). A API, por sua vez, espera o leitor acordar antes de
 * desistir (backend/src/statements/parserClient.ts).
 *
 * Sem VITE_PARSER_URL (dev), não faz nada: o leitor local não dorme.
 */
export function acordarLeitor(): void {
  if (!env.parserUrl) return;
  const agora = Date.now();
  if (agora - ultima < INTERVALO_MS) return;
  ultima = agora;
  fetch(`${env.parserUrl}/health`, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}
