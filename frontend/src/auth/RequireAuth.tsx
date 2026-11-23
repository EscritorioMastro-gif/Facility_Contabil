import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { AreaBloqueada } from '@/components/AreaBloqueada';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, precisaDefinirSenha } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-sm text-slate-500" role="status">
        <span className="grid h-11 w-11 animate-pulse-ring place-items-center rounded-2xl bg-gradient-to-br from-brand-300 via-brand-400 to-brand-600 font-display text-base font-bold text-brand-900 shadow-glow">
          FC
        </span>
        Carregando…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // cliente que entrou pelo link do convite: primeiro cria a senha
  if (precisaDefinirSenha) {
    return <Navigate to="/definir-senha" replace />;
  }

  return <>{children}</>;
}

/** Telas só do escritório (Cadastros e Importação): login de cliente vê o cadeado. */
export function SoEscritorio({ children }: { children: ReactNode }) {
  const { ehCliente } = useAuth();
  return ehCliente ? <AreaBloqueada /> : <>{children}</>;
}
