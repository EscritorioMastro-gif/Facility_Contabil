import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { supabase } from '@/lib/supabase';
import { destinoSeguro } from '@/lib/destino';
import { avisoDeInatividadePendente } from '@/auth/inatividade';
import { IconChave, IconEmail, IconSetaDireita, IconSetaEsquerda, Spinner } from '@/components/icons';
import { AuthShell, CampoIcone, CampoSenha } from './AuthShell';

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
  const [saiuPorInatividade] = useState(avisoDeInatividadePendente);

  if (session) {
    const to = destinoSeguro((location.state as { from?: { pathname?: unknown } } | null)?.from?.pathname);
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
    <AuthShell>
      {esqueci ? (
        <>
          <p className="eyebrow">Recuperar acesso</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-800">Esqueci minha senha</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Informe seu e-mail de acesso: enviamos um link para você criar uma nova senha.
          </p>
          <form onSubmit={onEsqueci} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email-esqueci">
                E-mail
              </label>
              <CampoIcone icone={<IconEmail className="h-[18px] w-[18px]" />}>
                <input
                  id="email-esqueci"
                  type="email"
                  autoComplete="username"
                  className="input h-11 pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  required
                />
              </CampoIcone>
            </div>
            {error && <p className="alert alert-error" role="alert">{error}</p>}
            {aviso && <p className="alert alert-success" role="status">{aviso}</p>}
            <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Enviando…' : 'Enviar link'}
            </button>
            <button
              type="button"
              className="link w-full justify-center text-sm"
              onClick={() => {
                setEsqueci(false);
                setError(null);
                setAviso(null);
              }}
            >
              <IconSetaEsquerda className="h-4 w-4" />
              Voltar para a entrada
            </button>
          </form>
        </>
      ) : (
        <>
          <p className="eyebrow">Acesso seguro</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-800">Entrar</h1>
          <p className="mt-1.5 text-sm text-slate-500">Entre com o seu e-mail e senha.</p>
          {saiuPorInatividade && (
            <p className="alert alert-warn mt-4">
              Por segurança, a sessão foi encerrada depois de 1 hora sem uso. Entre de novo.
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <CampoIcone icone={<IconEmail className="h-[18px] w-[18px]" />}>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className="input h-11 pl-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  autoFocus
                  required
                />
              </CampoIcone>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <label className="label" htmlFor="password">
                  Senha
                </label>
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => {
                    setEsqueci(true);
                    setError(null);
                  }}
                >
                  Esqueci minha senha
                </button>
              </div>
              <CampoSenha
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                icone={<IconChave className="h-[18px] w-[18px]" />}
              />
            </div>

            {error && (
              <p className="alert alert-error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary h-11 w-full" disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Entrando…' : 'Entrar'}
              {!busy && <IconSetaDireita className="h-4 w-4" />}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
