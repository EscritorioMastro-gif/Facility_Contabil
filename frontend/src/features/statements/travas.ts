/**
 * Travas na entrada do extrato (backend/src/statements/travas.ts): a API
 * devolve 409 `conferir_extrato` com o que falta resolver; a tela mostra
 * (ConferenciaExtrato) e reenvia o mesmo arquivo com as respostas.
 */
import { ApiError } from '@/lib/api';

export type Liberavel = 'outra_empresa' | 'titular_desconhecido' | 'sobreposto';

export type ExtratoSobreposto = {
  id: string;
  arquivo_nome: string;
  period_start: string | null;
  period_end: string | null;
  origem_modulo: string;
  status: string;
  iguais: number;
};

export type Trava =
  | {
      tipo: 'outra_empresa';
      mensagem: string;
      por: 'titular' | 'conta';
      empresa: { id: string; razao_social: string } | null;
      pode_liberar: boolean;
    }
  | { tipo: 'titular_desconhecido'; mensagem: string; documento: string; pode_liberar: boolean }
  | { tipo: 'confirmar_empresa'; mensagem: string; empresa: { id: string; razao_social: string } }
  | {
      tipo: 'sobreposto';
      mensagem: string;
      iguais: number;
      total: number;
      extratos: ExtratoSobreposto[];
      pode_liberar: boolean;
    };

/** O que o usuário respondeu às travas — vai junto no reenvio. */
export type RespostasTravas = { confirmo_empresa?: boolean; liberar?: Liberavel[] };

/** As travas pendentes, se o erro for o 409 `conferir_extrato`. */
export function travasDoErro(err: unknown): Trava[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const d = err.details as { code?: string; travas?: Trava[] } | undefined;
  return d?.code === 'conferir_extrato' && Array.isArray(d.travas) ? d.travas : null;
}

export function anexarRespostas(fd: FormData, r?: RespostasTravas) {
  if (r?.confirmo_empresa) fd.append('confirmo_empresa', 'true');
  if (r?.liberar?.length) fd.append('liberar', r.liberar.join(','));
}
