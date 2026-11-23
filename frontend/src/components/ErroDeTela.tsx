import { Component, type ErrorInfo, type ReactNode } from 'react';

type Estado = { erro: Error | null };

/**
 * Rede de segurança da tela: um erro inesperado ao desenhar uma página deixava
 * o sistema todo em branco, sem explicação. Aqui vira uma mensagem com um
 * botão para recarregar — o resto (sessão, dados salvos) continua intacto.
 */
export class ErroDeTela extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo): void {
    // só no console do navegador: nada sai pra terceiros
    console.error('Erro na tela', erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card max-w-md animate-scale-in p-7 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-xl font-bold text-red-600 ring-1 ring-red-200">
            !
          </span>
          <h1 className="text-lg font-semibold text-slate-800">Algo deu errado nesta tela</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            O que já estava salvo não foi perdido. Recarregue a página para continuar — se o erro
            voltar, avise o escritório dizendo o que estava fazendo.
          </p>
          <button className="btn-primary mt-5" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
