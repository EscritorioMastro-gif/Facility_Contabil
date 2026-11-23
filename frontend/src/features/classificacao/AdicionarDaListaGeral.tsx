import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { IconMais, Spinner } from '@/components/icons';
import { Carregando } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import type { Classificacao, Direction } from '@/lib/types';
import { useAdicionarDaListaGeral, useClassificacoesGerais } from './api';

const ROTULO: Record<Direction, string> = { entrada: 'entradas', saida: 'saídas' };

const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * Botão "Adicionar classificações de entradas/saídas" + a janela com a lista
 * geral do escritório: marca o que entra na lista própria (que vale pra todas
 * as empresas do mesmo login de cliente).
 */
export function AdicionarDaListaGeral({
  clientId,
  direction,
  naLista,
  className = 'btn-ghost btn-sm h-9',
}: {
  clientId: string;
  direction: Direction;
  /** a lista própria da empresa hoje (pra não oferecer o que já está nela) */
  naLista: Classificacao[];
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setAberto(true)} disabled={!clientId}>
        <IconMais className="h-4 w-4" />
        Adicionar classificações de {ROTULO[direction]}
      </button>
      {aberto && (
        <JanelaListaGeral clientId={clientId} direction={direction} naLista={naLista} onClose={() => setAberto(false)} />
      )}
    </>
  );
}

function JanelaListaGeral({
  clientId,
  direction,
  naLista,
  onClose,
}: {
  clientId: string;
  direction: Direction;
  naLista: Classificacao[];
  onClose: () => void;
}) {
  const { ehCliente } = useAuth();
  const { data, isLoading, error } = useClassificacoesGerais(direction);
  const adicionar = useAdicionarDaListaGeral();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');

  const ativos = useMemo(
    () => new Set(naLista.filter((c) => c.direction === direction && c.ativo).map((c) => normal(c.nome))),
    [naLista, direction],
  );
  const gerais = data?.gerais ?? [];
  const mostrados = gerais.filter((g) => !busca.trim() || normal(g.nome).includes(normal(busca)));
  const disponiveis = mostrados.filter((g) => !ativos.has(normal(g.nome)));

  function alternar(id: string) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function confirmar() {
    if (!marcados.size) return;
    adicionar.mutate({ client_id: clientId, geral_ids: [...marcados] }, { onSuccess: onClose });
  }

  const erro =
    adicionar.error instanceof ApiError ? adicionar.error.message : adicionar.error ? 'Falha ao adicionar' : null;
  const daLista = ehCliente ? 'sua lista' : 'lista do cliente';

  return (
    <Modal open onClose={onClose} title={`Adicionar classificações de ${ROTULO[direction]}`}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-500">
          Marque o que entra na {daLista}, a partir da lista geral do escritório. A {daLista} vale para todas as
          empresas do mesmo login.
        </p>

        {isLoading ? (
          <Carregando texto="Carregando a lista geral…" />
        ) : error ? (
          <p className="text-red-600">{error instanceof Error ? error.message : 'Falha ao carregar'}</p>
        ) : !gerais.length ? (
          <p className="alert alert-warn">
            A lista geral de {ROTULO[direction]} ainda está vazia.{' '}
            {ehCliente ? (
              'Peça ao escritório para incluir as classificações.'
            ) : (
              <>
                Inclua os itens em{' '}
                <Link to="/classificacao/lista-geral" className="font-medium underline">
                  Classificação → Lista geral
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                className="input h-9"
                type="search"
                placeholder="Procurar na lista geral…"
                value={busca}
                autoFocus
                onChange={(e) => setBusca(e.target.value)}
              />
              <button
                type="button"
                className="btn-ghost h-9 whitespace-nowrap px-3"
                disabled={!disponiveis.length}
                onClick={() => setMarcados(new Set(disponiveis.map((g) => g.id)))}
              >
                Marcar todas
              </button>
            </div>
            <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-brand-200">
              {mostrados.map((g) => {
                const ja = ativos.has(normal(g.nome));
                return (
                  <li key={g.id}>
                    <label
                      className={`flex items-center gap-2.5 px-3.5 py-2.5 transition-colors ${
                        ja ? 'text-slate-400' : marcados.has(g.id) ? 'cursor-pointer bg-brand-50/80 font-semibold text-brand-900' : 'cursor-pointer hover:bg-brand-50/60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={ja || marcados.has(g.id)}
                        disabled={ja}
                        onChange={() => alternar(g.id)}
                      />
                      <span className="flex-1">{g.nome}</span>
                      {ja && <span className="chip chip-slate">já está na {daLista}</span>}
                    </label>
                  </li>
                );
              })}
              {!mostrados.length && <li className="px-3 py-2 text-slate-400">Nada com esse nome.</li>}
            </ul>
          </>
        )}

        {erro && <p className="alert alert-error">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={!marcados.size || adicionar.isPending} onClick={confirmar}>
            {adicionar.isPending && <Spinner />}
            {adicionar.isPending ? 'Adicionando…' : `Adicionar${marcados.size ? ` (${marcados.size})` : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
