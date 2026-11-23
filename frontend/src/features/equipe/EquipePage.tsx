import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconEmail, Spinner } from '@/components/icons';
import { CarregandoLinhas, PageHeader } from '@/components/ui';
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
    <section className="space-y-5">
      <PageHeader
        titulo="Equipe do escritório"
        descricao="Todo mundo da equipe vê os mesmos clientes, extratos e classificações — cada pessoa com o próprio login e a própria senha (criada pelo link do convite; o escritório não vê a senha). O sistema guarda quem cadastrou cada cliente e cada extrato."
      />

      {isLoading ? (
        <div className="card">
          <CarregandoLinhas linhas={3} />
        </div>
      ) : error ? (
        <p className="alert alert-error">{msgErro(error)}</p>
      ) : (
        <div className="card divide-y divide-slate-100">
          {data?.membros.map((m) => (
            <div key={m.user_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 py-3.5 text-sm">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-display text-sm font-semibold text-white">
                {m.email[0]?.toUpperCase()}
              </span>
              <span className="font-semibold text-slate-700">{m.email}</span>
              {m.voce && <span className="chip chip-slate">você</span>}
              {m.principal && (
                <span className="chip chip-brand">
                  conta principal
                </span>
              )}
              {m.admin && !m.principal && (
                <span className="chip chip-slate">
                  administra
                </span>
              )}
              <span className={`chip chip-dot ${m.status === 'ativo' ? 'chip-green' : 'chip-amber'}`}>
                {m.status === 'ativo' ? 'ativo' : 'convite pendente'}
              </span>
              {souAdmin && (
                <span className="ml-auto flex gap-3 text-xs">
                  <button
                    type="button"
                    className="link"
                    disabled={reenviar.isPending}
                    onClick={() => onReenviar(m)}
                  >
                    {m.status === 'ativo' ? 'enviar nova senha' : 'reenviar convite'}
                  </button>
                  {!m.voce && !m.principal && (
                    <button type="button" className="link-danger" onClick={() => setRemovendo(m)}>
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
        <form onSubmit={onConvidar} className="card flex flex-wrap items-end gap-3 p-5">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="convite-email">
              Convidar alguém
            </label>
            <input
              id="convite-email"
              type="email"
              className="input"
              placeholder="e-mail da pessoa"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={!email.trim() || convidar.isPending}>
            {convidar.isPending ? <Spinner /> : <IconEmail className="h-4 w-4" />}
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
          className={`alert ${aviso.ok ? 'alert-success' : 'alert-error'}`}
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
