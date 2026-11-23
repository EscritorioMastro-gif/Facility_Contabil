import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconEmpresa } from '@/components/icons';
import { CarregandoLinhas, ErroCarregar, PageHeader, Vazio } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import type { Classificacao, Direction } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import {
  useClassificacoes,
  useCreateClassificacao,
  useDeleteClassificacao,
  useUpdateClassificacao,
} from './api';
import { AdicionarDaListaGeral } from './AdicionarDaListaGeral';

/**
 * Lista própria de classificações de uma empresa. Vem da lista geral do
 * escritório (botões "Adicionar classificações…") e é a mesma em todas as
 * empresas do mesmo login de cliente. Classificação avulsa (fora da lista
 * geral) e renomear: só o escritório.
 */
export function CategoriasPage() {
  const { ehCliente } = useAuth();
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [escolhido, setEscolhido] = useState('');
  // cliente com uma empresa só: já abre nela
  const clientId = escolhido || (ehCliente && clients?.length === 1 ? clients[0]!.id : '');
  const { data: entradas, isLoading: le, error: ee } = useClassificacoes(clientId || undefined, 'entrada');
  const { data: saidas, isLoading: ls, error: es } = useClassificacoes(clientId || undefined, 'saida');
  const lista = [...(entradas ?? []), ...(saidas ?? [])];

  return (
    <section className="space-y-6">
      <PageHeader
        titulo={ehCliente ? 'Minhas classificações' : 'Classificações'}
        descricao={
          ehCliente
            ? 'As classificações que você usa nos extratos (água, energia, recebimento de clientes…). Escolha da lista geral do escritório; a lista vale para todas as suas empresas e para qualquer mês.'
            : 'Classificações de cada cliente (água, energia, telefone, recebimento de clientes…), escolhidas da lista geral do escritório. A lista é a mesma em todas as empresas do mesmo login de cliente e vale pra qualquer mês.'
        }
      />

      <select
        className="input max-w-md"
        aria-label={ehCliente ? 'Empresa' : 'Cliente'}
        value={clientId}
        onChange={(e) => setEscolhido(e.target.value)}
        disabled={loadingClients}
      >
        <option value="">{loadingClients ? 'Carregando…' : ehCliente ? 'Selecione a empresa…' : 'Selecione o cliente…'}</option>
        {clients?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.razao_social}
            {c.dominio_code ? ` — Domínio ${c.dominio_code}` : ''}
          </option>
        ))}
      </select>

      {!clientId ? (
        <div className="card">
          <Vazio
            icone={<IconEmpresa className="h-6 w-6" />}
            titulo={ehCliente ? 'Escolha uma empresa' : 'Escolha um cliente'}
            texto="As classificações de entradas e saídas aparecem aqui."
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Catalogo clientId={clientId} direction="saida" titulo="Saídas" items={saidas} lista={lista} isLoading={ls} error={es} />
          <Catalogo
            clientId={clientId}
            direction="entrada"
            titulo="Entradas"
            items={entradas}
            lista={lista}
            isLoading={le}
            error={ee}
          />
        </div>
      )}
    </section>
  );
}

function Catalogo({
  clientId,
  direction,
  titulo,
  items,
  lista,
  isLoading,
  error,
}: {
  clientId: string;
  direction: Direction;
  titulo: string;
  items: Classificacao[] | undefined;
  lista: Classificacao[];
  isLoading: boolean;
  error: unknown;
}) {
  const { ehCliente } = useAuth();
  const createMut = useCreateClassificacao();
  const updateMut = useUpdateClassificacao();
  const deleteMut = useDeleteClassificacao();

  const [novoNome, setNovoNome] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftNome, setDraftNome] = useState('');
  const [deleting, setDeleting] = useState<Classificacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;
    createMut.mutate({ client_id: clientId, direction, nome }, { onSuccess: () => setNovoNome('') });
  }

  function salvarNome(c: Classificacao) {
    const nome = draftNome.trim();
    if (!nome || nome === c.nome) {
      setEditing(null);
      return;
    }
    updateMut.mutate({ id: c.id, input: { nome } }, { onSuccess: () => setEditing(null) });
  }

  function remover(c: Classificacao) {
    deleteMut.mutate(c.id, {
      onSuccess: (r) => {
        setDeleting(null);
        setAviso(
          r.desativadas
            ? `"${c.nome}" já é usada em lançamentos — ficou desativada (some da lista de escolha, os lançamentos antigos continuam com ela).`
            : null,
        );
      },
    });
  }

  const createErr =
    createMut.error instanceof ApiError ? createMut.error.message : createMut.error ? 'Falha ao criar' : null;
  const updateErr =
    updateMut.error instanceof ApiError ? updateMut.error.message : updateMut.error ? 'Falha ao salvar' : null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${direction === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="card-title">{titulo}</span>
          {items && <span className="chip chip-slate">{items.length}</span>}
        </p>
        <AdicionarDaListaGeral clientId={clientId} direction={direction} naLista={lista} className="btn-ghost btn-sm" />
      </div>

      {/* classificação avulsa (fora da lista geral): só o escritório */}
      {!ehCliente && (
        <form onSubmit={criar} className="mb-3 flex gap-2">
          <input
            className="input h-9 flex-1"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder={direction === 'saida' ? 'avulsa — ex: ÁGUA E ESGOTO' : 'avulsa — ex: RECEBIMENTO DE CLIENTES'}
          />
          <button className="btn-primary h-9 px-3" disabled={!novoNome.trim() || createMut.isPending}>
            {createMut.isPending ? 'Criando…' : 'Criar avulsa'}
          </button>
        </form>
      )}
      {createErr && <p className="mb-3 text-xs text-red-600">{createErr}</p>}
      {updateErr && <p className="mb-3 text-xs text-red-600">{updateErr}</p>}
      {aviso && <p className="alert alert-warn mb-3 text-xs">{aviso}</p>}

      {isLoading ? (
        <CarregandoLinhas linhas={4} className="px-0" />
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : !items?.length ? (
        <Vazio titulo="Nenhuma classificação ainda" texto="Use “Adicionar classificações” para escolher da lista geral." className="py-6" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((c) => (
            <li key={c.id} className="group flex items-center justify-between gap-2 rounded-lg px-1 py-2 text-sm transition-colors hover:bg-brand-50/50">
              {editing === c.id ? (
                <span className="flex flex-1 gap-1">
                  <input
                    className="input h-8 flex-1 px-2 text-xs"
                    value={draftNome}
                    autoFocus
                    onChange={(e) => setDraftNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') salvarNome(c);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <button className="btn-primary btn-sm h-8" onClick={() => salvarNome(c)}>
                    ok
                  </button>
                </span>
              ) : ehCliente ? (
                <span className={`flex-1 ${c.ativo ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{c.nome}</span>
              ) : (
                <button
                  className={`flex-1 text-left hover:text-brand-700 hover:underline hover:underline-offset-4 ${
                    c.ativo ? 'text-slate-700' : 'text-slate-400 line-through'
                  }`}
                  title="Renomear"
                  onClick={() => {
                    setEditing(c.id);
                    setDraftNome(c.nome);
                  }}
                >
                  {c.nome}
                </button>
              )}
              {!ehCliente && !c.geral_id && (
                <span className="chip chip-slate" title="Criada fora da lista geral">
                  avulsa
                </span>
              )}
              {!c.ativo && (
                <button
                  className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
                  title="Volta a aparecer pra escolher"
                  onClick={() => updateMut.mutate({ id: c.id, input: { ativo: true } })}
                >
                  reativar
                </button>
              )}
              {c.ativo && !ehCliente && (
                <button
                  className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
                  title="Desativar (não aparece mais pra escolher)"
                  onClick={() => updateMut.mutate({ id: c.id, input: { ativo: false } })}
                >
                  desativar
                </button>
              )}
              {c.ativo && (
                <button className="link-danger text-xs" onClick={() => setDeleting(c)}>
                  remover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Remover da lista"
        message={`Tirar "${deleting?.nome}" da lista? Vale para todas as empresas do mesmo login de cliente. Onde ela já foi usada em lançamentos, fica só desativada (os lançamentos antigos continuam com ela).`}
        confirmLabel="Remover"
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao remover'
            : null
        }
        onConfirm={() => deleting && remover(deleting)}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />
    </div>
  );
}
