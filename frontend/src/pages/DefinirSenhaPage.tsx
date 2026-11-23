import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { supabase } from '@/lib/supabase';
import { IconCheck, IconChave, Spinner } from '@/components/icons';
import { Carregando } from '@/components/ui';
import { AuthShell, CampoSenha } from './AuthShell';

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

  const forca = forcaDaSenha(senha);
  const iguais = confirma.length > 0 && senha === confirma;

  return (
    <AuthShell>
      {loading ? (
        <Carregando />
      ) : !session ? (
        <>
          <p className="eyebrow">Link do e-mail</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-800">Link expirado ou inválido</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            O link do e-mail vale por pouco tempo e só pode ser usado uma vez. Na tela de entrada,
            use <b>Esqueci minha senha</b> para receber um novo — ou peça ao escritório para reenviar
            o convite.
          </p>
          <Link to="/login" className="btn-primary mt-6 h-11 w-full">
            Ir para a entrada
          </Link>
        </>
      ) : (
        <>
          <p className="eyebrow">Primeiro acesso</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-800">Crie sua senha</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
            Para entrar como <span className="font-semibold text-slate-700">{session.user.email}</span>.
            Só você vai saber essa senha — o escritório não tem acesso a ela.
          </p>

          <form onSubmit={salvar} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="senha">
                Nova senha
              </label>
              <CampoSenha
                id="senha"
                value={senha}
                onChange={setSenha}
                autoComplete="new-password"
                icone={<IconChave className="h-[18px] w-[18px]" />}
              />
              <div className="mt-2 flex items-center gap-2" aria-live="polite">
                <div className="flex flex-1 gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                        i < forca.nivel ? forca.cor : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <span className="w-24 text-right text-xs font-semibold text-slate-500">
                  {senha ? forca.texto : `mín. ${MINIMO} caracteres`}
                </span>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="confirma">
                Repita a senha
              </label>
              <CampoSenha
                id="confirma"
                value={confirma}
                onChange={setConfirma}
                autoComplete="new-password"
                icone={<IconChave className="h-[18px] w-[18px]" />}
              />
              {confirma && (
                <p className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${iguais ? 'text-green-700' : 'text-slate-500'}`}>
                  {iguais ? (
                    <>
                      <IconCheck className="h-3.5 w-3.5" /> As senhas são iguais
                    </>
                  ) : (
                    'As senhas ainda não são iguais'
                  )}
                </p>
              )}
            </div>

            {erro && (
              <p className="alert alert-error" role="alert">
                {erro}
              </p>
            )}

            <button type="submit" className="btn-primary h-11 w-full" disabled={busy || pronto}>
              {(busy || pronto) && <Spinner />}
              {busy || pronto ? 'Salvando…' : 'Salvar senha e entrar'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

/** Indicação simples da força (tamanho + variedade); quem decide de verdade é o Supabase. */
function forcaDaSenha(s: string): { nivel: number; texto: string; cor: string } {
  if (!s) return { nivel: 0, texto: '', cor: 'bg-slate-200' };
  if (s.length < MINIMO) return { nivel: 1, texto: 'curta demais', cor: 'bg-red-500' };
  const tipos = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
  const pontos = tipos + (s.length >= 12 ? 1 : 0);
  if (pontos <= 2) return { nivel: 2, texto: 'razoável', cor: 'bg-amber-500' };
  if (pontos === 3) return { nivel: 3, texto: 'boa', cor: 'bg-brand-500' };
  return { nivel: 4, texto: 'forte', cor: 'bg-green-500' };
}
