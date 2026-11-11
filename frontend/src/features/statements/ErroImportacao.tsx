import { Link } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/auth/useAuth';

type Duplicado = { code: 'extrato_duplicado'; statement_id: string; status?: string; origem_modulo?: string };

export function duplicado(err: unknown): Duplicado | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const d = err.details as Partial<Duplicado> | undefined;
  return d?.code === 'extrato_duplicado' && d.statement_id ? (d as Duplicado) : null;
}

/** Texto do erro da importação, sem o detalhe técnico do extrato duplicado. */
export function textoDoErro(err: unknown): string | null {
  if (!err) return null;
  if (!(err instanceof ApiError)) return String(err);
  if (duplicado(err)) return err.message;
  return err.message + (err.details ? ` (${JSON.stringify(err.details)})` : '');
}

/**
 * Caixa de erro da importação. Extrato repetido (trava de duplicado) ganha o
 * atalho pra abrir o que já foi importado.
 */
export function ErroImportacao({ err, children }: { err: unknown; children?: React.ReactNode }) {
  const { ehCliente } = useAuth();
  const msg = textoDoErro(err);
  if (!msg) return null;
  const dup = duplicado(err);
  // o cliente só abre extrato do módulo Classificação (o resto é do escritório)
  const destino = !dup
    ? null
    : ehCliente
      ? dup.origem_modulo === 'classificacao'
        ? `/classificacao/revisao/${dup.statement_id}`
        : null
      : dup.status === 'classificacao'
        ? `/classificacao/revisao/${dup.statement_id}`
        : `/revisao/${dup.statement_id}`;
  return (
    <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      <p>{msg}</p>
      {destino && (
        <Link to={destino} className="mt-1 inline-block font-medium underline">
          Abrir o extrato que já foi importado →
        </Link>
      )}
      {children}
    </div>
  );
}
