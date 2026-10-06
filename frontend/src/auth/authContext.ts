import { createContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

/** 'cliente' = login do portal (só o módulo Classificação das empresas liberadas). */
export type Papel = 'escritorio' | 'cliente';

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  papel: Papel;
  ehCliente: boolean;
  /** login de cliente que entrou pelo convite e ainda não criou a senha */
  precisaDefinirSenha: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export const AuthCtx = createContext<AuthState | undefined>(undefined);
