import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/icons';
import { ApiError } from '@/lib/api';
import type { Classificacao, Direction } from '@/lib/types';
import { useCreateClassificacao } from './api';

export function NovaClassificacaoModal({
  open,
  clientId,
  direction,
  onClose,
  onCreated,
}: {
  open: boolean;
  clientId: string;
  direction: Direction;
  onClose: () => void;
  onCreated: (c: Classificacao) => void;
}) {
  const [nome, setNome] = useState('');
  const createMut = useCreateClassificacao();

  function close() {
    setNome('');
    createMut.reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    createMut.mutate(
      { client_id: clientId, direction, nome: nome.trim() },
      {
        onSuccess: (r) => {
          onCreated(r.classificacao);
          setNome('');
          createMut.reset();
          onClose();
        },
      },
    );
  }

  const err =
    createMut.error instanceof ApiError
      ? createMut.error.message
      : createMut.error
        ? 'Falha ao criar'
        : null;

  return (
    <Modal open={open} onClose={close} title="Nova classificação">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">
            Nome ({direction === 'entrada' ? 'entrada' : 'saída'})
          </label>
          <input
            className="input"
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="ex: ÁGUA E ESGOTO"
          />
        </div>
        {err && <p className="alert alert-error">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={close}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={!nome.trim() || createMut.isPending}>
            {createMut.isPending && <Spinner />}
            {createMut.isPending ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
