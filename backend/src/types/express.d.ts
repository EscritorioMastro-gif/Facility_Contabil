import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string | null;
        token: string;
        /** 'cliente' = login do portal (só a Classificação das empresas liberadas);
         *  ausente/'escritorio' = login do escritório, como sempre foi. */
        papel?: 'escritorio' | 'cliente';
      };
      /** Cliente Supabase já no contexto do usuário autenticado (RLS aplicada). */
      supabase?: SupabaseClient;
      /** Escritório (dono dos dados) do login da equipe — lib/escritorio.ts. */
      escritorioId?: string;
      /** Cliente com a secret key (ignora RLS) — portal do cliente e convites.
       *  Os testes injetam um fake; em produção vem de `serviceClient`. */
      supabaseAdmin?: SupabaseClient | null;
    }
  }
}

export {};
