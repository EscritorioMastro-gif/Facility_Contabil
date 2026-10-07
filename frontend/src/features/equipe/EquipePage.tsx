import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import {
  useConvidarMembro,
  useEquipe,
  useReenviarMembro,
  useRemoverMembro,
  type MembroEquipe,
} from './api';

const msgErro = (e: unknown) => (e instanceof ApiError ? e.message : 'Falha na operação');

/**
 * Equipe do escritório (Cadastros → Equipe): quem do escritório entra no
 * sistema. Cada pessoa tem login e senha próprios e vê os mesmos clientes e
 * extratos. Quem administra convida, reenvia o convite e tira da equipe.
 */
export function EquipePage() {
  const { data, isLoading, error } = useEquipe();
  const convidar = useConvidarMembro();
  const reenviar = useReenviarMembro();
  const remover = useRemoverMembro();
  const [email, setEmail] = useState('');
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [removendo, setRemovendo] = useState<MembroEquipe | null>(null);
  const souAdmin = !!data?.souAdmin;

  function onConvidar(e: React.FormEvent) {
    e.preventDefault();
    const alvo = email.trim();
    if (!alvo) return;
    setAviso(null);
    convidar.mutate(alvo, {
      onSuccess: (r) => {
        setEmail('');
        setAviso({
          ok: true,
          texto: r.convite_enviado
            ? `Convite enviado para ${alvo}. A pessoa cria a própria senha pelo link do e-mail.`
            : `${alvo} já tinha login — agora faz parte da equipe e já pode entrar.`,
        });
      },
      onError: (err) => setAviso({ ok: false, texto: msgErro(err) }),
    });
  }

  function onReenviar(m: MembroEquipe) {
    setAviso(null);
    reenviar.mutate(m.user_id, {
      onSuccess: (r) =>
        setAviso({
          ok: true,
          texto:
            r.enviado === 'convite'
              ? `Convite reenviado para ${m.email}.`
              : `Enviamos para ${m.email} um link para criar uma nova senha.`,
        }),
      onError: (err) => setAviso({ ok: false, texto: msgErro(err) }),
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Equipe do escritório</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          Todo mundo da equipe vê os mesmos clientes, extratos e classificações — cada pessoa com o
          próprio login e a própria senha (criada pelo link do convite; o escritório não vê a senha).
          O sistema guarda quem cadastrou cada cliente e cada extrato.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{msgErro(error)}</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {data?.membros.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium text-slate-700">{m.email}</span>
              {m.voce && <span className="text-xs text-slate-400">(você)</span>}
              {m.principal && (
                <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">
                  conta principal
                </span>
              )}
              {m.admin && !m.principal && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  administra
                </span>
              )}
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  m.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {m.status === 'ativo' ? 'ativo' : 'convite pendente'}
              </span>
              {souAdmin && (
                <span className="ml-auto flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-brand-600 hover:underline disabled:opacity-50"
                    disabled={reenviar.isPending}
                    onClick={() => onReenviar(m)}
                  >
                    {m.status === 'ativo' ? 'enviar nova senha' : 'reenviar convite'}
                  </button>
                  {!m.voce && !m.principal && (
                    <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setRemovendo(m)}>
                      tirar da equipe
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {souAdmin ? (
        <form onSubmit={onConvidar} className="flex flex-wrap gap-2">
          <input
            type="email"
            className="input max-w-xs flex-1"
            placeholder="e-mail da pessoa"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!email.trim() || convidar.isPending}>
            {convidar.isPending ? 'Enviando…' : 'Convidar para a equipe'}
          </button>
        </form>
      ) : (
        !isLoading &&
        !error && (
          <p className="text-xs text-slate-400">Só quem administra o escritório convida ou tira pessoas da equipe.</p>
        )
      )}

      {aviso && (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            aviso.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <ConfirmDialog
        open={!!removendo}
        title="Tirar da equipe"
        message={
          removendo
            ? `Tirar ${removendo.email} da equipe? O acesso acaba na hora e o login fica bloqueado. ` +
              'O que essa pessoa cadastrou continua no sistema. Para voltar, é só convidar de novo.'
            : ''
        }
        confirmLabel="Tirar da equipe"
        busy={remover.isPending}
        error={remover.isError ? msgErro(remover.error) : null}
        onConfirm={() => removendo && remover.mutate(removendo.user_id, { onSuccess: () => setRemovendo(null) })}
        onCancel={() => {
          setRemovendo(null);
          remover.reset();
        }}
      />
    </section>
  );
}
