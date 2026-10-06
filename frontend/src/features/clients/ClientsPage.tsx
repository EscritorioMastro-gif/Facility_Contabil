import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BackendStatus } from '@/components/BackendStatus';
import { ApiError } from '@/lib/api';
import { formatCnpjCpf } from '@/lib/format';
import type { Client, ClientInput } from '@/lib/types';
import {
  useClients,
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
  type ClientsFilter,
} from './api';
import { ClientForm } from './ClientForm';
import { AcessosCliente } from './AcessosCliente';
import { useLiberarAcesso } from './acessos';

export function ClientsPage() {
  const [search, setSearch] = useState('');
  const [ativo, setAtivo] = useState<ClientsFilter['ativo']>('all');
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const filter = useMemo<ClientsFilter>(() => ({ q: search || undefined, ativo }), [search, ativo]);
  const { data: clients, isLoading, error } = useClients(filter);

  const createMut = useCreateClient();
  const updateMut = useUpdateClient();
  const deleteMut = useDeleteClient();
  const liberarMut = useLiberarAcesso();

  function handleCreate(input: ClientInput, emailAcesso: string) {
    createMut.mutate(input, {
      onSuccess: ({ client }) => {
        setCreating(false);
        if (!emailAcesso) return;
        // cliente já está salvo; o convite é um passo à parte (se falhar, dá pra repetir na edição)
        setAviso(null);
        liberarMut.mutate(
          { client_id: client.id, email: emailAcesso },
          {
            onSuccess: (r) =>
              setAviso({
                ok: true,
                texto: r.convite_enviado
                  ? `Cliente cadastrado. Convite enviado para ${emailAcesso}.`
                  : `Cliente cadastrado. ${emailAcesso} já tinha login e agora também acessa esta empresa.`,
              }),
            onError: (err) => {
              setAviso({
                ok: false,
                texto: `Cliente cadastrado, mas o acesso não foi liberado: ${
                  err instanceof ApiError ? err.message : 'falha'
                }. Tente de novo na edição do cliente.`,
              });
              setEditing(client);
            },
          },
        );
      },
    });
  }
  function handleUpdate(input: ClientInput) {
    if (!editing) return;
    updateMut.mutate({ id: editing.id, input }, { onSuccess: () => setEditing(null) });
  }
  function confirmDelete() {
    if (!deleting) return;
    deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Clientes</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + Novo cliente
        </button>
      </div>

      {liberarMut.isPending && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">Enviando o convite de acesso…</p>
      )}
      {aviso && (
        <p
          className={`flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm ${
            aviso.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'
          }`}
        >
          <span>{aviso.texto}</span>
          <button className="text-xs opacity-60 hover:opacity-100" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            ✕
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Buscar por razão social ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input max-w-[10rem]"
          value={ativo}
          onChange={(e) => setAtivo(e.target.value as ClientsFilter['ativo'])}
        >
          <option value="all">Todos</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !clients?.length ? (
          <p className="p-6 text-sm text-slate-400">Nenhum cliente. Cadastre o primeiro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Razão social</th>
                <th className="px-4 py-2">CNPJ / CPF</th>
                <th className="px-4 py-2">Cód. Domínio</th>
                <th className="px-4 py-2">Conta banco</th>
                <th className="px-4 py-2">Hist. E/S</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className={c.ativo ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {c.razao_social}
                    {!c.ativo && <span className="ml-2 text-xs text-slate-400">(inativo)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatCnpjCpf(c.cnpj)}</td>
                  <td className="px-4 py-2 text-slate-600">{c.dominio_code}</td>
                  <td className="px-4 py-2 text-slate-600">{c.banco_conta_contabil ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.hist_code_entrada} / {c.hist_code_saida}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      className="text-brand-600 hover:underline"
                      onClick={() => setEditing(c)}
                    >
                      Editar
                    </button>
                    <button
                      className="ml-3 text-slate-400 hover:text-red-600"
                      onClick={() => setDeleting(c)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo cliente" wide>
        <ClientForm
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
          submitting={createMut.isPending}
          error={createMut.error}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Editar — ${editing?.razao_social ?? ''}`}
        wide
      >
        {editing && (
          <>
            <ClientForm
              client={editing}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
              submitting={updateMut.isPending}
              error={updateMut.error}
            />
            <AcessosCliente clientId={editing.id} />
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir cliente"
        message={`Excluir "${deleting?.razao_social}"? Essa ação não pode ser desfeita.`}
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />

      <details className="text-sm text-slate-500">
        <summary className="cursor-pointer">Status dos serviços</summary>
        <div className="mt-2 max-w-sm">
          <BackendStatus />
        </div>
      </details>
    </section>
  );
}
