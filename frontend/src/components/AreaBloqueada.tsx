import { Link } from 'react-router-dom';
import { IconCadeado, IconSetaDireita } from './icons';

/** O que o login de cliente vê ao abrir uma tela do escritório (Cadastros, Importação). */
export function AreaBloqueada() {
  return (
    <section className="mx-auto mt-16 max-w-md animate-fade-up text-center">
      <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white text-brand-700 shadow-card ring-1 ring-brand-200">
        <span className="absolute inset-0 rounded-2xl bg-brand-300/20 blur-xl" />
        <IconCadeado className="relative h-7 w-7" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold text-slate-800">Área bloqueada</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Essa parte do sistema é de uso do escritório. Seu acesso é ao módulo Classificação.
      </p>
      <Link to="/classificacao" className="btn-primary mt-6">
        Ir para a Classificação
        <IconSetaDireita className="h-4 w-4" />
      </Link>
    </section>
  );
}
