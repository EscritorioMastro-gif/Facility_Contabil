import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import {
  useAcessos,
  useLiberarAcesso,
  useReenviarAcesso,
  useRemoverAcesso,
  type AcessoCliente,
} from './acessos';

const msgErro = (e: unknown) => (e instanceof ApiError ? e.message : 'Falha na operação');

/**
 * Acesso do cliente ao sistema (portal), na edição do cadastro: quem entra
 * por esta empresa, liberar um e-mail novo, reenviar o convite, remover.
 */
export function AcessosCliente({ clientId }: { clientId: string }) {
  const { data: acessos, isLoading, error } = useAcessos(clientId);
  const liberar = useLiberarAcesso();
  const reenviar = useReenviarAcesso();
  const remover = useRemoverAcesso();
  const [email, setEmail] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [removendo, setRemovendo] = useState<AcessoCliente | null>(null);

  function onLiberar(e: React.FormEvent) {
    e.preventDefault();
    const alvo = email.trim();
    if (!alvo) return;
    setAviso(null);
    liberar.mutate(
      { client_id: clientId, email: alvo },
      {
        onSuccess: (r) => {
          setEmail('');
          setAviso({
            ok: true,
            texto: r.convite_enviado
              ? `Convite enviado para ${alvo}. O cliente cria a senha pelo link do e-mail.`
              : `Pronto: ${alvo} já tinha login — agora também acessa esta empresa.`,
          });
        },
        onError: (err) => setAviso({ ok: false, texto: msgErro(err) }),
      },
    );
  }

  function onReenviar(a: AcessoCliente) {
    setAviso(null);
    reenviar.mutate(a.id, {
      onSuccess: (r) =>
        setAviso({
          ok: true,
          texto:
            r.enviado === 'convite'
              ? `Convite reenviado para ${a.email}.`
              : `Enviamos para ${a.email} um link para criar uma nova senha.`,
        }),
      onError: (err) => setAviso({ ok: false, texto: msgErro(err) }),
    });
  }

  const outrasDe = (a: AcessoCliente) => a.empresas.filter((e) => e.id !== clientId);

  return (
    <div className="mt-6 border-t border-brand-200 pt-5">
      <h3 className="text-sm font-semibold text-slate-800">Acesso do cliente ao sistema</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        O cliente entra com o próprio e-mail e uma senha que ele mesmo cria pelo link do convite —
        o escritório não vê a senha. Ele acessa só o módulo Classificação desta empresa (e das outras
        empresas liberadas para o mesmo e-mail).
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600">{msgErro(error)}</p>
      ) : acessos?.length ? (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
          {acessos.map((a) => {
            const outras = outrasDe(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium text-slate-700">{a.email}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    a.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {a.status === 'ativo' ? 'ativo' : 'convite pendente'}
                </span>
                {outras.length > 0 && (
                  <span className="text-xs text-slate-400">
                    também acessa: {outras.map((e) => e.razao_social).join(', ')}
                  </span>
                )}
                <span className="ml-auto flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-brand-600 hover:underline disabled:opacity-50"
                    disabled={reenviar.isPending}
                    onClick={() => onReenviar(a)}
                  >
                    {a.status === 'ativo' ? 'enviar nova senha' : 'reenviar convite'}
                  </button>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => setRemovendo(a)}
                  >
                    remover
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Nenhum acesso liberado para esta empresa.</p>
      )}

      <form onSubmit={onLiberar} className="mt-3 flex flex-wrap gap-2">
        <input
          type="email"
          className="input max-w-xs flex-1"
          placeholder="e-mail do cliente"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="btn-ghost" disabled={!email.trim() || liberar.isPending}>
          {liberar.isPending ? 'Enviando…' : 'Liberar acesso'}
        </button>
      </form>

      {aviso && (
        <p
          className={`mt-3 rounded-md px-3 py-2 text-sm ${
            aviso.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <ConfirmDialog
        open={!!removendo}
        title="Remover acesso"
        message={
          removendo
            ? outrasDe(removendo).length
              ? `Remover o acesso de ${removendo.email} a esta empresa? Ele continua acessando: ${outrasDe(removendo)
                  .map((e) => e.razao_social)
                  .join(', ')}.`
              : `Remover o acesso de ${removendo.email}? Como esta é a única empresa dele, o login também é apagado — para voltar, é só liberar de novo (ele recebe um novo convite).`
            : ''
        }
        confirmLabel="Remover"
        busy={remover.isPending}
        error={remover.isError ? msgErro(remover.error) : null}
        onConfirm={() => removendo && remover.mutate(removendo.id, { onSuccess: () => setRemovendo(null) })}
        onCancel={() => {
          setRemovendo(null);
          remover.reset();
        }}
      />
    </div>
  );
}
