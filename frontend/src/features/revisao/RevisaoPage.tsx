import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { TabelaRolavel } from '@/components/TabelaRolavel';
import { IconDownload, IconSalvar, IconSetaEsquerda, Spinner } from '@/components/icons';
import { BarraAcoes, BarraProgresso, Carregando, ErroCarregar, Etapas, Kbd, Metrica, PageHeader, Segmented, Vazio } from '@/components/ui';
import { ETAPAS_IMPORTACAO } from '@/lib/etapas';
import { useToast } from '@/lib/toast';
import { useAtalhoSalvar } from '@/lib/useAtalhoSalvar';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import {
  type SaldoDoCliente,
  useGenerateDominio,
  useSaveTransactions,
  useStatement,
  useUpdateStatementHeader,
} from '@/features/statements/api';
import { SaldoReconciliacao } from '@/features/statements/SaldoReconciliacao';
import { ReimportarExtrato } from '@/features/statements/ReimportarExtrato';
import { useClassificacoes } from '@/features/classificacao/api';
import { BulkBar } from './BulkBar';
import { TransactionRow } from './TransactionRow';
import { useRevisaoDraft } from './useRevisaoDraft';

type Filter = 'todas' | 'entrada' | 'saida' | 'pendentes' | 'conferir' | 'inativadas';

/** O que gerar o arquivo fez com o saldo do cadastro do cliente, em uma frase. */
function textoSaldoDoCliente(s: SaldoDoCliente | null): string | null {
  if (!s) return null;
  const valor = s.valor === null ? '' : formatMoney(Math.round(s.valor * 100));
  if (s.situacao === 'atualizado') {
    return `Saldo do cliente agora é ${valor}: é o saldo inicial do próximo extrato.`;
  }
  if (s.situacao === 'mantido') {
    return `O saldo do cliente continua ${valor}: ele já vem de um extrato mais novo${s.ate ? ` (até ${formatDate(s.ate)})` : ''}.`;
  }
  return 'O saldo do cliente NÃO foi atualizado — confira o saldo no cadastro antes da próxima importação.';
}

export function RevisaoPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStatement(id);
  const save = useSaveTransactions(id);
  const header = useUpdateStatementHeader(id);
  const gerar = useGenerateDominio(id);
  const [filter, setFilter] = useState<Filter>('saida');
  const [confirmSair, setConfirmSair] = useState(false);
  const toast = useToast();

  const transactions = useMemo(() => data?.transactions ?? [], [data]);
  const { get, patchRow, patchMany, reset, changes, isDirty } = useRevisaoDraft(transactions);

  // extratos que vieram do módulo Classificação trazem a categoria de cada
  // lançamento — mostra o nome como contexto pra escolher a conta contábil.
  const clientId = data?.statement.client_id;
  const { data: entradasClassif } = useClassificacoes(clientId, 'entrada');
  const { data: saidasClassif } = useClassificacoes(clientId, 'saida');
  const classificacaoPorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of [...(entradasClassif ?? []), ...(saidasClassif ?? [])]) m.set(c.id, c.nome);
    return m;
  }, [entradasClassif, saidasClassif]);

  // avisa antes de fechar a aba/atualizar com alterações não salvas
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const stats = useMemo(() => {
    let pend = 0;
    let prontos = 0;
    let inut = 0;
    let conferir = 0;
    for (const t of transactions) {
      const d = get(t.id);
      if (d.ignorado) inut++;
      else if (d.conta_contabil.trim() && d.hist_code.trim()) {
        prontos++;
        if (t.origem_preenchimento === 'conferir') conferir++;
      } else pend++;
    }
    return { pend, prontos, inut, conferir, ativos: transactions.length - inut };
  }, [transactions, get]);

  const shown = useMemo(() => {
    return transactions.filter((t) => {
      const d = get(t.id);
      if (filter === 'todas') return true;
      if (filter === 'inativadas') return d.ignorado;
      if (filter === 'pendentes')
        return !d.ignorado && !(d.conta_contabil.trim() && d.hist_code.trim());
      if (filter === 'conferir') return !d.ignorado && t.origem_preenchimento === 'conferir';
      return !d.ignorado && t.direction === filter;
    });
  }, [transactions, get, filter]);

  const pag = usePaginacao(shown, 'revisao', filter);

  // Ctrl+S salva (o mesmo que o botão "Salvar")
  useAtalhoSalvar(() => onSave());

  if (isLoading) return <Carregando texto="Carregando a importação…" className="py-10" />;
  if (error || !data) return <ErroCarregar erro={error} padrao="Importação não encontrada" />;

  const st = data.statement;
  const complementoModo = st.complemento_modo ?? 'extrato';
  const saldoInicial = Number(st.saldo_inicial ?? 0) || 0;

  function applyConta(dir: 'entrada' | 'saida', conta: string) {
    patchMany((tx) => tx.direction === dir && !get(tx.id).ignorado, { conta_contabil: conta });
  }
  function applyHist(dir: 'entrada' | 'saida', hist: string) {
    patchMany((tx) => tx.direction === dir && !get(tx.id).ignorado, { hist_code: hist });
  }
  function bulkIgnore(target: 'entrada' | 'saida' | 'reativar') {
    if (target === 'reativar') patchMany(() => true, { ignorado: false });
    else patchMany((tx) => tx.direction === target, { ignorado: true });
  }

  function onSave() {
    if (!isDirty || save.isPending) return;
    const n = changes.length;
    save.mutate(changes, {
      onSuccess: () =>
        toast({ texto: 'Alterações salvas', detalhe: `${n} lançamento(s) atualizado(s) — a memória do cliente já aprendeu.` }),
    });
  }

  function gerarArquivo() {
    gerar.mutate(undefined, {
      onSuccess: (r) =>
        toast({
          texto: 'Arquivo do Domínio gerado',
          detalhe: [
            `${r.filename} · ${r.linhas} linhas — importe em Utilitários → Importação → Lançamentos contábeis em lote.`,
            textoSaldoDoCliente(r.saldo),
          ]
            .filter(Boolean)
            .join(' '),
          duracao: 10000,
        }),
    });
  }

  const saveErr =
    save.error instanceof ApiError ? save.error.message : save.error ? String(save.error) : null;

  const gerarErr =
    gerar.error instanceof ApiError
      ? gerar.error.message +
        (gerar.error.details && typeof gerar.error.details === 'object' && 'ordens' in gerar.error.details
          ? ` (linhas ${(gerar.error.details as { ordens: number[] }).ordens.map((o) => o + 1).join(', ')})`
          : '')
      : gerar.error
        ? String(gerar.error)
        : null;

  const podeGerar = !isDirty && stats.pend === 0 && stats.ativos > 0 && !gerar.isPending;

  const sair = () => (isDirty ? setConfirmSair(true) : navigate('/historico'));

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Revisão das contas"
        descricao={
          <>
            <span className="font-semibold text-slate-700">{st.client?.razao_social ?? 'cliente'}</span> · {st.arquivo_nome} ·{' '}
            {st.period_start && st.period_end
              ? `${formatDate(st.period_start)} a ${formatDate(st.period_end)}`
              : 'sem período'}
          </>
        }
        acoes={
          <>
            <button className="btn-ghost" onClick={sair}>
              <IconSetaEsquerda className="h-4 w-4" />
              Voltar
            </button>
            <ReimportarExtrato
              statementId={id}
              qtd={transactions.length}
              as="button"
              excel={!!st.excel_mapeamento}
              aprovado={!!st.aprovado_em}
            />
          </>
        }
      >
        <Etapas etapas={ETAPAS_IMPORTACAO} atual={st.status === 'gerado' ? 4 : 2} />
      </PageHeader>

      {st.erro_msg && <p className="alert alert-error">{st.erro_msg}</p>}
      {saveErr && <p className="alert alert-error">{saveErr}</p>}
      {stats.conferir > 0 && (
        <p className="alert alert-warn">
          {stats.conferir} lançamento(s) preenchido(s) pela memória, mas a descrição já teve outras
          contas — confira o filtro "Conferir".
        </p>
      )}

      {/* progresso */}
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Metrica rotulo="Ativos" valor={stats.ativos} tom="brand" />
          <Metrica rotulo="Prontos" valor={stats.prontos} tom="green" />
          <Metrica rotulo="Pendentes" valor={stats.pend} tom={stats.pend ? 'amber' : undefined} />
          <Metrica rotulo="Conferir" valor={stats.conferir} tom={stats.conferir ? 'amber' : undefined} />
          <Metrica rotulo="Inativados" valor={stats.inut} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <BarraProgresso feito={stats.prontos} total={stats.ativos} rotulo="Lançamentos prontos" />
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
            {stats.ativos ? Math.round((stats.prontos / stats.ativos) * 100) : 0}% pronto
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <HeaderForm
            st={{
              banco_conta_contabil: st.banco_conta_contabil ?? '',
              hist_code_entrada: st.hist_code_entrada,
              hist_code_saida: st.hist_code_saida,
              lote_numero: st.lote_numero,
            }}
            onSave={(f) => header.mutate(f, { onSuccess: () => toast({ texto: 'Cabeçalho salvo' }) })}
            saving={header.isPending}
          />
          <BulkBar
            onApplyConta={applyConta}
            onApplyHist={applyHist}
            onIgnore={bulkIgnore}
            complementoModo={complementoModo}
            onComplementoModo={(m) => header.mutate({ complemento_modo: m })}
            savingModo={header.isPending}
          />
        </div>
        <SaldoReconciliacao
          transactions={transactions}
          saldoInicial={saldoInicial}
          onSaldoInicial={(v) => header.mutate({ saldo_inicial: v.toFixed(2) })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Segmented
          label="Filtrar lançamentos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'saida', label: 'Saídas' },
            { value: 'entrada', label: 'Entradas' },
            { value: 'pendentes', label: 'Pendentes', count: stats.pend },
            ...(stats.conferir ? [{ value: 'conferir' as Filter, label: 'Conferir', count: stats.conferir }] : []),
            { value: 'inativadas', label: 'Inativadas', count: stats.inut },
            { value: 'todas', label: 'Todas', count: transactions.length },
          ]}
        />
        <p className="hidden items-center gap-1.5 text-xs text-slate-500 lg:flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>S</Kbd> salva as alterações
        </p>
      </div>

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
      />

      <TabelaRolavel>
        <table className="w-full text-sm">
          <thead className="text-left text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2" title="Inativar: o lançamento não vai para o arquivo">
                Inativar
              </th>
              <th className="px-2 py-2">Data</th>
              <th className="px-2 py-2">Histórico do extrato</th>
              <th className="px-2 py-2 text-right">Valor</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Classificação</th>
              <th className="px-2 py-2">Conta contábil</th>
              <th className="px-2 py-2">Cód. hist.</th>
              <th className="px-2 py-2">Complemento</th>
              <th className="px-2 py-2">No arquivo →</th>
              <th className="px-2 py-2 text-center">Memória</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pag.daPagina.map((txn: Transaction) => (
              <TransactionRow
                key={txn.id}
                txn={txn}
                draft={get(txn.id)}
                onPatch={(p) => patchRow(txn.id, p)}
                complementoModo={complementoModo}
                classificacaoNome={txn.classificacao_id ? classificacaoPorId.get(txn.classificacao_id) : null}
              />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <Vazio titulo="Nenhum lançamento neste filtro" texto="Troque o filtro acima para ver os outros lançamentos." />}
      </TabelaRolavel>

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
      />

      {gerarErr && <p className="alert alert-error">{gerarErr}</p>}
      {gerar.isSuccess && gerar.data && (
        <p className="alert alert-success">
          Arquivo <span className="font-mono">{gerar.data.filename}</span> gerado ({gerar.data.linhas}{' '}
          linhas) e baixado. Importe no Domínio: Utilitários → Importação → Lançamentos contábeis em
          lote.
          {gerar.data.saldo && gerar.data.saldo.situacao !== 'erro' && (
            <> {textoSaldoDoCliente(gerar.data.saldo)}</>
          )}
        </p>
      )}
      {gerar.isSuccess && gerar.data?.saldo?.situacao === 'erro' && (
        <p className="alert alert-warn">{textoSaldoDoCliente(gerar.data.saldo)}</p>
      )}

      <BarraAcoes
        status={
          isDirty ? (
            <span className="flex items-center gap-2 font-semibold text-amber-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              {changes.length} alteração(ões) não salva(s) — salve antes de gerar o arquivo.
            </span>
          ) : stats.pend > 0 ? (
            `${stats.pend} lançamento(s) ainda sem conta contábil ou código de histórico.`
          ) : (
            <span className="flex items-center gap-2 font-semibold text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Pronto: {stats.ativos} lançamento(s) ativo(s).
            </span>
          )
        }
      >
        {isDirty && (
          <button className="btn-quiet" onClick={reset}>
            Descartar
          </button>
        )}
        <button className={isDirty ? 'btn-primary' : 'btn-ghost'} onClick={onSave} disabled={!isDirty || save.isPending} title="Salvar (Ctrl+S)">
          {save.isPending ? <Spinner /> : <IconSalvar className="h-4 w-4" />}
          {save.isPending ? 'Salvando…' : isDirty ? `Salvar (${changes.length})` : 'Salvo'}
        </button>
        <button
          className={isDirty ? 'btn-ghost' : 'btn-primary'}
          disabled={!podeGerar}
          title={
            isDirty
              ? 'Salve as alterações primeiro'
              : stats.pend > 0
                ? 'Classifique os lançamentos pendentes'
                : 'Gera o .txt no Leiaute Domínio'
          }
          onClick={gerarArquivo}
        >
          {gerar.isPending ? <Spinner /> : <IconDownload className="h-4 w-4" />}
          {gerar.isPending
            ? 'Gerando…'
            : st.status === 'gerado'
              ? 'Gerar de novo'
              : 'Gerar arquivo Domínio'}
        </button>
      </BarraAcoes>

      <ConfirmDialog
        open={confirmSair}
        title="Sair sem salvar?"
        message={`Você tem ${changes.length} alteração(ões) não salva(s). Se sair agora, elas se perdem.`}
        confirmLabel="Sair sem salvar"
        onConfirm={() => navigate('/historico')}
        onCancel={() => setConfirmSair(false)}
      />
    </section>
  );
}

function HeaderForm({
  st,
  onSave,
  saving,
}: {
  st: {
    banco_conta_contabil: string;
    hist_code_entrada: string;
    hist_code_saida: string;
    lote_numero: number;
  };
  onSave: (f: {
    banco_conta_contabil?: string;
    hist_code_entrada?: string;
    hist_code_saida?: string;
    lote_numero?: number;
  }) => void;
  saving: boolean;
}) {
  const [banco, setBanco] = useState(st.banco_conta_contabil);
  const [he, setHe] = useState(st.hist_code_entrada);
  const [hs, setHs] = useState(st.hist_code_saida);
  const [lote, setLote] = useState(st.lote_numero);

  // useState só pega o valor inicial no primeiro mount — se o cabeçalho ainda
  // não tinha conta/histórico quando a página abriu (ex: acabou de ser puxado
  // do módulo Classificação, com o fetch antigo em cache) e o refetch chega
  // um instante depois, resincroniza os campos com o valor que veio do servidor.
  useEffect(() => {
    setBanco(st.banco_conta_contabil);
    setHe(st.hist_code_entrada);
    setHs(st.hist_code_saida);
    setLote(st.lote_numero);
  }, [st.banco_conta_contabil, st.hist_code_entrada, st.hist_code_saida, st.lote_numero]);

  const dirty =
    banco !== st.banco_conta_contabil ||
    he !== st.hist_code_entrada ||
    hs !== st.hist_code_saida ||
    lote !== st.lote_numero;

  return (
    <div className="card p-5 text-sm">
      <p className="card-title">Cabeçalho do Domínio</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
      <Field label="Conta do banco">
        <input className="input input-mono h-9 w-28" value={banco} onChange={(e) => setBanco(e.target.value)} />
      </Field>
      <Field label="Hist. entrada">
        <input className="input input-mono h-9 w-20" value={he} onChange={(e) => setHe(e.target.value)} />
      </Field>
      <Field label="Hist. saída">
        <input className="input input-mono h-9 w-20" value={hs} onChange={(e) => setHs(e.target.value)} />
      </Field>
      <Field label="Lote Domínio">
        <input
          className="input input-mono h-9 w-24"
          type="number"
          value={lote}
          onChange={(e) => setLote(Number(e.target.value))}
        />
      </Field>
      <button
        className={dirty ? 'btn-primary h-9' : 'btn-ghost h-9'}
        disabled={!dirty || saving}
        onClick={() =>
          onSave({
            banco_conta_contabil: banco,
            hist_code_entrada: he,
            hist_code_saida: hs,
            lote_numero: lote,
          })
        }
      >
        {saving ? 'Salvando…' : 'Salvar cabeçalho'}
      </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
