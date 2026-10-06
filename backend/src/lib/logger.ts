import { pino } from 'pino';
import { config } from '../config.js';

const level =
  process.env.LOG_LEVEL ??
  (config.env === 'test' ? 'silent' : config.isProd ? 'info' : 'debug');

export const logger = pino({
  level,
  // segunda barreira: se algum objeto logado trouxer cabeçalhos, o token de
  // login e senhas de PDF nunca vão pro log
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      '*.headers.authorization',
      'pdf_password',
      '*.pdf_password',
    ],
    censor: '[oculto]',
  },
  transport:
    config.isProd || config.env === 'test'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
