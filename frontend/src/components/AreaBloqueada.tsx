import { Link } from 'react-router-dom';
import { IconCadeado } from './icons';

/** O que o login de cliente vê ao abrir uma tela do escritório (Cadastros, Importação). */
export function AreaBloqueada() {
  return (
    <section className="mx-auto mt-16 max-w-md text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-100 text-brand-700">
        <IconCadeado className="h-7 w-7" />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-slate-800">Área bloqueada</h1>
      <p className="mt-2 text-sm text-slate-500">
        Essa parte do sistema é de uso do escritório. Seu acesso é ao módulo Classificação.
      </p>
      <Link to="/classificacao" className="btn-primary mt-6">
        Ir para a Classificação
      </Link>
    </section>
  );
}
