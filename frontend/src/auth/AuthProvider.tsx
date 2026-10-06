import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { chegouPorLinkDeEmail, supabase } from '@/lib/supabase';
import { AuthCtx, type AuthState, type Papel } from './authContext';
import {
  inativoHaMuito,
  limparAvisoDeInatividade,
  marcarSaidaPorInatividade,
  registrarAtividade,
  vigiarInatividade,
} from './inatividade';

/** Sai só neste navegador (os outros aparelhos do mesmo login seguem). */
async function sairPorInatividade(): Promise<void> {
  marcarSaidaPorInatividade();
  await supabase.auth.signOut({ scope: 'local' });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      let s = data.session;
      if (s && chegouPorLinkDeEmail) {
        registrarAtividade();
      } else if (s && inativoHaMuito()) {
        // navegador reaberto depois do limite: a sessão guardada não vale mais
        await sairPorInatividade();
        s = null;
      }
      setSession(s);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const logado = !!session;
  useEffect(() => {
    if (!logado) return;
    return vigiarInatividade(() => void sairPorInatividade());
  }, [logado]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user ?? null;
    // app_metadata só o backend grava (com a secret key) — o login não consegue se promover
    const papel: Papel = user?.app_metadata?.papel === 'cliente' ? 'cliente' : 'escritorio';
    return {
      session,
      user,
      loading,
      papel,
      ehCliente: papel === 'cliente',
      precisaDefinirSenha: papel === 'cliente' && user?.user_metadata?.senha_definida !== true,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        registrarAtividade();
        limparAvisoDeInatividade();
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    };
  }, [session, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
