import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconHistorico, IconLixeira, IconMais, IconSetaDireita, IconX } from '@/components/icons';
import { CarregandoLinhas, ErroCarregar, PageHeader, Segmented, Vazio } from '@/components/ui';
import { Paginacao, useItensPorPagina } from '@/components/Paginacao';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Statement, StatementStatus } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { useDeleteStatement, useDeleteStatements, useStatementsPaginados } from '@/features/statements/api';
import { BaixarDominio } from '@/features/statements/BaixarDominio';
import { ReimportarExtrato } from '@/features/statements/ReimportarExtrato';

const STATUS_LABEL: Partial<Record<StatementStatus, { text: string; cls: string }>> = {
  parsing: { text: 'lendo', cls: 'chip-slate' },
  revisao: { text: 'em revisão', cls: 'chip-amber' },
  gerado: { text: 'arquivo gerado', cls: 'chip-green' },
  erro: { text: 'erro', cls: 'chip-red' },
};

export function HistoricoPage() {
  const { data: clients } = useClients({ ativo: 'all' });
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<StatementStatus | ''>('');
  // todos os extratos ficam no histórico, página a página (sem teto de quantos aparecem)
  const [porPagina, setPorPagina] = useItensPorPagina('historico');
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [clientId, status, porPagina]);
  const { data, isLoading, error } = useStatementsPaginados(
    {
      client_id: clientId || undefined,
      status: status || undefined,
      // os que ainda estão no módulo Classificação (não puxados) ficam só no histórico de lá
      exceto_status: status ? undefined : 'classificacao',
    },
    pagina,
    porPagina,
  );
  const statements = data?.statements;
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  // excluiu os últimos da última página: volta uma
  useEffect(() => {
    if (data && pagina > paginas) setPagina(paginas);
  }, [data, pagina, paginas]);

  const delMut = useDeleteStatement();
  const delManyMut = useDeleteStatements();
  const [deleting, setDeleting] = useState<Statement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  // extratos ainda presos no módulo Classificação (não puxados) ficam só no
  // histórico de lá; se o filtro muda e a seleção não existe mais, tira ela.
  const shown = useMemo(
    () => (statements ?? []).filter((s) => s.status !== 'classificacao'),
    [statements],
  );
  const shownIds = useMemo(() => new Set(shown.map((s) => s.id)), [shown]);
  const selecionadosNaLista = [...selected].filter((id) => shownIds.has(id));
  const todosSelecionados = shown.length > 0 && selecionadosNaLista.length === shown.length;

  function toggleAll() {
    setSelected(todosSelecionados ? new Set() : new Set(shownIds));
  }
  function toggleUm(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Histórico de importações"
        descricao="Extratos lidos, em revisão e com arquivo do Domínio gerado — abra, baixe de novo ou troque o arquivo."
        acoes={
          <Link to="/importar" className="btn-primary">
            <IconMais className="h-4 w-4" />
            Nova importação
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <select className="input max-w-xs" aria-label="Filtrar por cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social}
            </option>
          ))}
        </select>
        <Segmented
          label="Filtrar por status"
          value={status || 'todos'}
          onChange={(v) => setStatus(v === 'todos' ? '' : v)}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'revisao', label: 'Em revisão' },
            { value: 'gerado', label: 'Arquivo gerado' },
            { value: 'erro', label: 'Erro' },
            { value: 'parsing', label: 'Lendo' },
          ]}
        />
        {(clientId || status) && (
          <button
            className="btn-quiet btn-sm"
            onClick={() => {
              setClientId('');
              setStatus('');
            }}
          >
            <IconX className="h-3.5 w-3.5" />
            limpar filtros
          </button>
        )}
      </div>

      {selecionadosNaLista.length > 0 && (
        <div className="flex animate-fade-up flex-wrap items-center justify-between gap-3 rounded-2xl bg-brand-800 px-4 py-2.5 text-sm text-white shadow-float">
          <span className="flex items-center gap-2 font-semibold">
            <span className="grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-brand-300 px-1.5 text-xs font-bold text-brand-900">
              {selecionadosNaLista.length}
            </span>
            selecionado(s)
          </span>
          <div className="flex gap-2">
            <button className="rounded-lg px-3 py-1.5 font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>
              limpar seleção
            </button>
            <button className="btn-danger btn-sm" onClick={() => setConfirmBulk(true)}>
              <IconLixeira className="h-3.5 w-3.5" />
              excluir selecionados
            </button>
          </div>
        </div>
      )}

      <Paginacao
        pagina={pagina}
        paginas={paginas}
        porPagina={porPagina}
        total={total}
        onPagina={setPagina}
        onPorPagina={setPorPagina}
        rotulo="importações"
      />

      <div className="card overflow-x-auto">
        {isLoading ? (
          <CarregandoLinhas />
        ) : error ? (
          <ErroCarregar erro={error} className="m-5" />
        ) : !shown.length ? (
          <Vazio
            icone={<IconHistorico className="h-6 w-6" />}
            titulo={clientId || status ? 'Nenhuma importação com esse filtro' : 'Nenhuma importação ainda'}
            acao={
              !clientId &&
              !status && (
                <Link to="/importar" className="btn-primary">
                  Fazer a primeira importação
                </Link>
              )
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="w-8 px-4 py-2">
                  <input type="checkbox" checked={todosSelecionados} onChange={toggleAll} aria-label="Selecionar todas" />
                </th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Arquivo</th>
                <th className="px-4 py-2">Período</th>
                <th className="px-4 py-2 text-right">Lanç.</th>
                <th className="px-4 py-2 text-right">Saldo final</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s: Statement) => {
                const st = STATUS_LABEL[s.status] ?? { text: s.status, cls: 'chip-slate' };
                const totais = 'qtd' in s.totais ? s.totais : null;
                return (
                  <tr key={s.id} className={selected.has(s.id) ? 'bg-brand-50/60' : ''}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleUm(s.id)}
                        aria-label={`Selecionar ${s.arquivo_nome}`}
                      />
                    </td>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {s.client?.razao_social ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.arquivo_nome}
                      <span className="ml-1.5 font-mono text-[10px] font-semibold text-slate-400">
                        {s.formato.toUpperCase()}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start)}–${formatDate(s.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{totais?.qtd ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">
                      {s.saldo_final != null ? formatMoney(Math.round(Number(s.saldo_final) * 100)) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`chip chip-dot ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {s.status !== 'parsing' && (
                        <Link to={`/revisao/${s.id}`} className="link">
                          abrir
                          <IconSetaDireita className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {s.status === 'gerado' && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          <BaixarDominio statementId={s.id} />
                        </>
                      )}
                      {s.status !== 'parsing' && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          <ReimportarExtrato
                            statementId={s.id}
                            qtd={totais?.qtd ?? 0}
                            excel={!!s.excel_mapeamento}
                            aprovado={!!s.aprovado_em}
                          />
                        </>
                      )}
                      <button
                        className="link-danger ml-4 align-middle"
                        onClick={() => setDeleting(s)}
                        title="Excluir importação"
                        aria-label={`Excluir ${s.arquivo_nome}`}
                      >
                        <IconLixeira className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Paginacao
        pagina={pagina}
        paginas={paginas}
        porPagina={porPagina}
        total={total}
        onPagina={setPagina}
        onPorPagina={setPorPagina}
        rotulo="importações"
      />

      <ConfirmDialog
        open={!!deleting}
        title="Excluir importação"
        message={
          `Excluir a importação de "${deleting?.arquivo_nome}"? Os lançamentos lidos serão apagados.` +
          (deleting?.aprovado_em
            ? ' O cliente já aprovou classificações deste extrato: o registro das aprovações dele é apagado junto, e só quem administra o escritório consegue excluir.'
            : '')
        }
        busy={delMut.isPending}
        error={
          delMut.isError
            ? delMut.error instanceof ApiError
              ? delMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() =>
          deleting && delMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
        onCancel={() => {
          setDeleting(null);
          delMut.reset();
        }}
      />

      <ConfirmDialog
        open={confirmBulk}
        title="Excluir importações selecionadas"
        message={`Excluir ${selecionadosNaLista.length} importação(ões)? Os lançamentos lidos serão apagados. Essa ação não pode ser desfeita.`}
        busy={delManyMut.isPending}
        error={
          delManyMut.isError
            ? delManyMut.error instanceof ApiError
              ? delManyMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() =>
          delManyMut.mutate(selecionadosNaLista, {
            onSuccess: () => {
              setSelected(new Set());
              setConfirmBulk(false);
            },
          })
        }
        onCancel={() => {
          setConfirmBulk(false);
          delManyMut.reset();
        }}
      />
    </section>
  );
}
