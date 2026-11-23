import { createContext, useContext } from 'react';

/**
 * Avisos rápidos no canto da tela ("Salvo", "Copiado", "Arquivo gerado"):
 * confirmam que a ação deu certo sem a pessoa precisar procurar a mensagem.
 * Erros que pedem ação continuam na própria tela, perto do que falhou.
 */
export type ToastTipo = 'sucesso' | 'erro' | 'info';

export type ToastInput = {
  tipo?: ToastTipo;
  texto: string;
  /** detalhe em letra menor */
  detalhe?: string;
  /** botão opcional (ex.: "desfazer") */
  acao?: { label: string; onClick: () => void };
  /** ms na tela (padrão 4,5 s) */
  duracao?: number;
};

export const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

export function useToast(): (t: ToastInput) => void {
  return useContext(ToastCtx);
}
