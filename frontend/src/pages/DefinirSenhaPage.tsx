import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { supabase } from '@/lib/supabase';

const MINIMO = 8;

/** As mensagens mais comuns do Supabase Auth, em português. */
function traduzir(msg: string): string {
  if (/should be different/i.test(msg)) return 'A nova senha precisa ser diferente da anterior.';
  if (/at least/i.test(msg)) return `A senha precisa ter pelo menos ${MINIMO} caracteres.`;
  if (/weak|pwned|leaked/i.test(msg)) return 'Essa senha é fraca ou já apareceu em vazamentos — escolha outra.';
  return msg;
}

/**
 * Destino do link do e-mail (convite do escritório ou "esqueci minha senha"):
 * o Supabase já entrega a sessão no próprio link; aqui a pessoa só cria a
 * senha. A senha vai direto pro Supabase Auth (guardada como hash) — nem o
 * escritório nem o nosso backend a recebem.
 */
export function DefinirSenhaPage() {
  const { session, loading, precisaDefinirSenha } = useAuth();
  const navigate = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pronto, setPronto] = useState(false);

  // salvou e o login já não está mais pendente: entra no sistema
  useEffect(() => {
    if (pronto && !precisaDefinirSenha) navigate('/', { replace: true });
  }, [pronto, precisaDefinirSenha, navigate]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < MINIMO) {
      setErro(`A senha precisa ter pelo menos ${MINIMO} caracteres.`);
      return;
    }
    if (senha !== confirma) {
      setErro('As duas senhas não são iguais.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: senha, data: { senha_definida: true } });
    setBusy(false);
    if (error) {
      setErro(traduzir(error.message));
      return;
    }
    setPronto(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-800 text-sm font-bold text-cream">
            FC
          </span>
          <span className="text-base font-semibold text-slate-800">Facility Contábil</span>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Carregando…</p>
        ) : !session ? (
          <>
            <h1 className="text-xl font-semibold text-slate-800">Link expirado ou inválido</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              O link do e-mail vale por pouco tempo e só pode ser usado uma vez. Na tela de entrada,
              use <b>Esqueci minha senha</b> para receber um novo — ou peça ao escritório para reenviar
              o convite.
            </p>
            <Link to="/login" className="btn-primary mt-6 w-full">
              Ir para a entrada
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-800">Crie sua senha</h1>
            <p className="mt-1 text-sm text-slate-500">
              Para entrar como <span className="font-medium text-slate-700">{session.user.email}</span>.
              Só você vai saber essa senha — o escritório não tem acesso a ela.
            </p>

            <form onSubmit={salvar} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="senha">
                  Nova senha
                </label>
                <input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-slate-400">Pelo menos {MINIMO} caracteres.</p>
              </div>
              <div>
                <label className="label" htmlFor="confirma">
                  Repita a senha
                </label>
                <input
                  id="confirma"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  value={confirma}
                  onChange={(e) => setConfirma(e.target.value)}
                  required
                />
              </div>

              {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

              <button type="submit" className="btn-primary w-full" disabled={busy || pronto}>
                {busy || pronto ? 'Salvando…' : 'Salvar senha e entrar'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
