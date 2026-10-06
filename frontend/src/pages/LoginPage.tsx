import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { supabase } from '@/lib/supabase';
import { FinanceIllustration } from '@/components/FinanceIllustration';

/** As mensagens mais comuns do Supabase Auth, em português. */
function traduzir(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(msg)) {
    return 'Esse login ainda não foi ativado — use o link do convite que chegou no seu e-mail.';
  }
  if (/rate limit|security purposes/i.test(msg)) return 'Muitas tentativas seguidas — espere um minuto e tente de novo.';
  return msg;
}

export function LoginPage() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [esqueci, setEsqueci] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (session) {
    const to = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
    return <Navigate to={to} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? traduzir(err.message) : 'Falha ao entrar');
    } finally {
      setBusy(false);
    }
  }

  /** "Esqueci minha senha": o Supabase manda o link pra criar uma nova (vale pro escritório e pro cliente). */
  async function onEsqueci(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/definir-senha`,
    });
    setBusy(false);
    if (err) {
      setError(traduzir(err.message));
      return;
    }
    // não diz se o e-mail existe ou não
    setAviso('Se esse e-mail tiver acesso ao sistema, enviamos um link para criar uma nova senha. Confira a caixa de entrada (e o spam).');
  }

  return (
    <div className="grid min-h-screen bg-cream lg:grid-cols-2">
      {/* painel da marca */}
      <div className="relative hidden flex-col overflow-hidden bg-brand-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-300 text-sm font-bold text-brand-900">
            FC
          </span>
          <span className="text-base font-semibold">Facility Contábil</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <FinanceIllustration className="w-full max-w-lg" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-white/55">
          Do extrato bancário ao arquivo do Domínio — importação, classificação e conferência
          num lugar só.
        </p>
      </div>

      {/* formulário */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-800 text-sm font-bold text-cream">
              FC
            </span>
            <span className="text-base font-semibold text-slate-800">Facility Contábil</span>
          </div>

          {esqueci ? (
            <>
              <h1 className="text-xl font-semibold text-slate-800">Esqueci minha senha</h1>
              <p className="mt-1 text-sm text-slate-500">
                Informe seu e-mail de acesso: enviamos um link para você criar uma nova senha.
              </p>
              <form onSubmit={onEsqueci} className="mt-6 space-y-4">
                <div>
                  <label className="label" htmlFor="email-esqueci">
                    E-mail
                  </label>
                  <input
                    id="email-esqueci"
                    type="email"
                    autoComplete="username"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                {aviso && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{aviso}</p>}
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Enviando…' : 'Enviar link'}
                </button>
                <button
                  type="button"
                  className="w-full text-center text-sm text-brand-600 hover:underline"
                  onClick={() => {
                    setEsqueci(false);
                    setError(null);
                    setAviso(null);
                  }}
                >
                  Voltar para a entrada
                </button>
              </form>
            </>
          ) : (
            <>
          <h1 className="text-xl font-semibold text-slate-800">Entrar</h1>
          <p className="mt-1 text-sm text-slate-500">Entre com o seu e-mail e senha.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
            <button
              type="button"
              className="w-full text-center text-sm text-brand-600 hover:underline"
              onClick={() => {
                setEsqueci(true);
                setError(null);
              }}
            >
              Esqueci minha senha
            </button>
          </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
