import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { AreaBloqueada } from '@/components/AreaBloqueada';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, precisaDefinirSenha } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">Carregando…</div>
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
