import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BackendStatus } from '@/components/BackendStatus';
import { IconBusca, IconChevronDireita, IconEmpresa, IconLixeira, IconMais, IconX } from '@/components/icons';
import { Carregando, CarregandoLinhas, ErroCarregar, PageHeader, Segmented, Vazio } from '@/components/ui';
import { useToast } from '@/lib/toast';
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
  const toast = useToast();

  function handleCreate(input: ClientInput, emailAcesso: string) {
    createMut.mutate(input, {
      onSuccess: ({ client }) => {
        setCreating(false);
        if (!emailAcesso) {
          toast({ texto: 'Cliente cadastrado', detalhe: input.razao_social });
          return;
        }
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
    updateMut.mutate(
      { id: editing.id, input },
      {
        onSuccess: () => {
          setEditing(null);
          toast({ texto: 'Cliente atualizado', detalhe: input.razao_social });
        },
      },
    );
  }
  function confirmDelete() {
    if (!deleting) return;
    const nome = deleting.razao_social;
    deleteMut.mutate(deleting.id, {
      onSuccess: () => {
        setDeleting(null);
        toast({ texto: 'Cliente excluído', detalhe: nome });
      },
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Clientes"
        descricao="Código no Domínio, conta contábil do banco, históricos padrão e saldo inicial de cada cliente — tudo que a importação preenche sozinha."
        acoes={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <IconMais className="h-4 w-4" />
            Novo cliente
          </button>
        }
      />

      {liberarMut.isPending && <Carregando texto="Enviando o convite de acesso…" />}
      {aviso && (
        <div className={`alert flex items-start justify-between gap-3 ${aviso.ok ? 'alert-success' : 'alert-error'}`}>
          <span>{aviso.texto}</span>
          <button className="shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            <IconX className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <IconBusca className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            type="search"
            aria-label="Buscar cliente"
            placeholder="Buscar por razão social ou CNPJ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Segmented
          label="Situação do cliente"
          value={ativo ?? 'all'}
          onChange={(v) => setAtivo(v)}
          options={[
            { value: 'all', label: 'Todos' },
            { value: 'true', label: 'Ativos' },
            { value: 'false', label: 'Inativos' },
          ]}
        />
        {clients && <span className="ml-auto text-xs font-medium text-slate-500">{clients.length} cliente(s)</span>}
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <CarregandoLinhas />
        ) : error ? (
          <ErroCarregar erro={error} className="m-5" />
        ) : !clients?.length ? (
          <Vazio
            icone={<IconEmpresa className="h-6 w-6" />}
            titulo={search || ativo !== 'all' ? 'Nenhum cliente com esse filtro' : 'Nenhum cliente ainda'}
            texto={search || ativo !== 'all' ? 'Troque a busca ou o filtro.' : 'Cadastre o primeiro cliente para começar a importar extratos.'}
            acao={
              !search && ativo === 'all' && (
                <button className="btn-primary" onClick={() => setCreating(true)}>
                  <IconMais className="h-4 w-4" />
                  Novo cliente
                </button>
              )
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
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
                <tr key={c.id} className={c.ativo ? '' : 'opacity-60'}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand-50 to-brand-100 font-display text-xs font-bold text-brand-700 ring-1 ring-brand-200">
                        {iniciais(c.razao_social)}
                      </span>
                      <div className="min-w-0">
                        <button className="block truncate text-left font-semibold text-slate-800 hover:text-brand-700" onClick={() => setEditing(c)}>
                          {c.razao_social}
                        </button>
                        {!c.ativo && <span className="chip chip-slate mt-0.5">inativo</span>}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-slate-600">{formatCnpjCpf(c.cnpj)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{c.dominio_code}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">
                    {c.banco_conta_contabil ?? <span className="chip chip-amber font-sans">sem conta</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {c.hist_code_entrada} / {c.hist_code_saida}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(c)}>
                      Editar
                    </button>
                    <button
                      className="link-danger ml-3 align-middle"
                      onClick={() => setDeleting(c)}
                      title="Excluir cliente"
                      aria-label={`Excluir ${c.razao_social}`}
                    >
                      <IconLixeira className="h-4 w-4" />
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

      <details className="group text-sm text-slate-500">
        <summary className="inline-flex items-center gap-1.5 font-medium hover:text-slate-700">
          <IconChevronDireita className="h-4 w-4 transition-transform group-open:rotate-90" />
          Status dos serviços
        </summary>
        <div className="mt-3 max-w-sm">
          <BackendStatus />
        </div>
      </details>
    </section>
  );
}

/** "Padaria Pão Dourado LTDA" → "PP" (selo da linha). */
function iniciais(nome: string): string {
  const partes = nome
    .replace(/\b(LTDA|ME|EPP|S\.?A\.?|EIRELI)\b/gi, '')
    .split(/\s+/)
    .filter((p) => p.length > 2);
  return ((partes[0]?.[0] ?? nome[0] ?? '?') + (partes[1]?.[0] ?? '')).toUpperCase();
}
