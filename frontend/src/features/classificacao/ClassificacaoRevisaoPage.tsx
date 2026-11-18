import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { TabelaRolavel } from '@/components/TabelaRolavel';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import { formatDate, formatMoney } from '@/lib/format';
import type { Direction, Transaction } from '@/lib/types';
import { useStatement } from '@/features/statements/api';
import { StatementSummary } from '@/features/statements/StatementSummary';
import { buscarSugestoes, useAprovarClassificacao, useClassificacoes, useSaveClassificacoes } from './api';
import { useClassificacaoDraft, type OrigemMemoria } from './useClassificacaoDraft';
import { ClassificacaoSelect } from './ClassificacaoSelect';
import { AdicionarDaListaGeral } from './AdicionarDaListaGeral';
import { AvisoAprovacao, HistoricoAprovacoes, ModalAprovacao } from './AprovacaoCliente';
import { plural, situacaoAprovacao } from './aprovacao';

type Filter = 'todas' | 'entrada' | 'saida' | 'pendentes' | 'sugestoes';

/** Mesma descrição = igual sem diferença de maiúsculas e espaços (a mesma regra da memória). */
const chaveDaDescricao = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export function ClassificacaoRevisaoPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStatement(id);
  const save = useSaveClassificacoes(id);
  const aprovar = useAprovarClassificacao(id);
  const [aprovando, setAprovando] = useState(false);
  const [filter, setFilter] = useState<Filter>('saida');
  const [confirmSair, setConfirmSair] = useState(false);
  const [bulkDir, setBulkDir] = useState<Direction>('saida');
  const [bulkClassif, setBulkClassif] = useState('');
  const [memoria, setMemoria] = useState<{ buscando: boolean; msg: string | null; rodada: number }>({
    buscando: false,
    msg: null,
    rodada: 0,
  });
  // linhas iguais preenchidas junto com a que o operador classificou (pra poder desfazer)
  const [iguais, setIguais] = useState<{ n: number; nome: string; antes: Map<string, string | null> } | null>(null);
  const { ehCliente, user } = useAuth();

  const clientId = data?.statement.client_id ?? '';
  const transactions = useMemo(() => data?.transactions ?? [], [data]);
  const { get, patchRow, patchMany, aplicarSugestoes, aceitar, origemDe, reset, changes, isDirty } =
    useClassificacaoDraft(transactions);

  const { data: entradas } = useClassificacoes(clientId, 'entrada');
  const { data: saidas } = useClassificacoes(clientId, 'saida');
  const catalogo = useMemo(() => ({ entrada: entradas ?? [], saida: saidas ?? [] }), [entradas, saidas]);
  const lista = useMemo(() => [...catalogo.entrada, ...catalogo.saida], [catalogo]);

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
    let classificados = 0;
    let pend = 0;
    // classificados que ainda não foram aprovados assim pelo cliente (novos ou mudados)
    let novos = 0;
    const sugestoes: string[] = [];
    let daMemoria = 0;
    const ativos = transactions.filter((t) => !t.ignorado);
    for (const t of ativos) {
      const v = get(t.id);
      if (v) {
        classificados++;
        if (v !== (t.aprovado_classificacao_id ?? null)) novos++;
      } else pend++;
      const o = origemDe(t);
      if (o === 'conferir') sugestoes.push(t.id);
      else if (o === 'memoria') daMemoria++;
    }
    return { ativos: ativos.length, classificados, pend, novos, sugestoes, daMemoria };
  }, [transactions, get, origemDe]);

  // Pendentes/Sugestões pelo que está SALVO (ou acabou de ser sugerido): a linha
  // não some da tela no meio da digitação — só depois de salvar.
  const shown = useMemo(() => {
    return transactions.filter((t) => {
      if (t.ignorado) return false;
      if (filter === 'todas') return true;
      if (filter === 'pendentes') return !t.classificacao_id;
      if (filter === 'sugestoes') return t.classificacao_origem === 'conferir' || (origemDe(t) !== null && !t.classificacao_id);
      return t.direction === filter;
    });
    // origemDe muda a cada sugestão aceita; a lista só se refaz quando a memória preenche de novo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, filter, memoria.rodada]);

  const pag = usePaginacao(shown, 'classificacao', filter);

  // Enter desce pro lançamento de baixo (Shift+Enter sobe), passando de página
  const selects = useRef<Array<HTMLSelectElement | null>>([]);
  const focarDepois = useRef<number | 'ultima' | null>(null);
  useEffect(() => {
    const alvo = focarDepois.current;
    if (alvo === null) return;
    focarDepois.current = null;
    const i = alvo === 'ultima' ? pag.daPagina.length - 1 : alvo;
    selects.current[i]?.focus();
  }, [pag.pagina, pag.daPagina]);

  function navegar(e: React.KeyboardEvent<HTMLSelectElement>, i: number) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const destino = e.shiftKey ? i - 1 : i + 1;
    if (destino >= 0 && destino < pag.daPagina.length) {
      selects.current[destino]?.focus();
    } else if (destino >= pag.daPagina.length && pag.pagina < pag.paginas) {
      focarDepois.current = 0;
      pag.setPagina(pag.pagina + 1);
    } else if (destino < 0 && pag.pagina > 1) {
      focarDepois.current = 'ultima';
      pag.setPagina(pag.pagina - 1);
    }
  }

  if (isLoading) return <p className="text-sm text-slate-400">Carregando…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-red-600">
        {error instanceof Error ? error.message : 'Importação não encontrada'}
      </p>
    );

  const st = data.statement;
  const jaPuxado = st.status !== 'classificacao';
  // login de cliente: depois que o escritório puxou o extrato, só consulta
  const somenteLeitura = ehCliente && jaPuxado;

  // Login de cliente: um botão só, "Salvar e aprovar". Salva o que ele classificou
  // e registra que conferiu e aprova o que JÁ está classificado — mesmo com
  // pendentes (aprovação em partes, migration 0028). Sem nada novo desde a
  // última aprovação, o botão fica parado.
  const situacao = situacaoAprovacao(st);
  const temNovidade = isDirty || stats.novos > 0 || situacao === 'alterado';
  const podeAbrirAprovacao =
    ehCliente &&
    ['classificacao', 'revisao', 'gerado'].includes(st.status) &&
    stats.classificados > 0 &&
    temNovidade;
  const ocupado = save.isPending || aprovar.isPending;

  function onSave() {
    if (!isDirty) return;
    setIguais(null);
    save.mutate(changes);
  }

  function abrirAprovacao() {
    setIguais(null);
    aprovar.reset();
    save.reset();
    setAprovando(true);
  }

  async function confirmarAprovacao() {
    try {
      if (isDirty) await save.mutateAsync(changes);
      await aprovar.mutateAsync();
      setAprovando(false);
    } catch {
      // o erro aparece na janela (save.error / aprovar.error)
    }
  }

  const erroAprovacao =
    aprovar.error instanceof ApiError
      ? aprovar.error.message
      : aprovar.error
        ? String(aprovar.error)
        : save.error instanceof ApiError
          ? save.error.message
          : null;

  const botaoAprovar = ehCliente && (
    <button
      className="btn-primary"
      onClick={abrirAprovacao}
      disabled={!podeAbrirAprovacao || ocupado}
      title={
        stats.classificados === 0
          ? 'Classifique pelo menos um lançamento para aprovar'
          : !temNovidade
            ? situacao === 'aprovado'
              ? 'Você já aprovou este mês'
              : 'Você já aprovou o que está classificado — classifique mais lançamentos para aprovar a próxima parte'
            : stats.pend > 0
              ? `Salvar e aprovar o que já classificou (${plural(stats.pend, 'lançamento fica', 'lançamentos ficam')} para a próxima parte)`
              : 'Salvar e declarar que conferiu as classificações'
      }
    >
      {ocupado
        ? 'Salvando…'
        : !temNovidade && situacao === 'aprovado'
          ? 'Aprovado ✓'
          : !temNovidade && situacao === 'parcial'
            ? 'Parte aprovada ✓'
            : isDirty
              ? `Salvar e aprovar (${changes.length})`
              : 'Salvar e aprovar'}
    </button>
  );

  /**
   * Classificou uma linha → as outras do MESMO extrato com a mesma descrição
   * (e o mesmo tipo) vão junto: as vazias e as que ainda são sugestão. Linha já
   * escolhida por alguém (ou "memória") fica como está; limpar não se espalha.
   */
  function classificar(txn: Transaction, valor: string | null) {
    patchRow(txn.id, valor);
    if (!valor) return;
    const chave = chaveDaDescricao(txn.descricao_raw);
    const mesmas = transactions.filter(
      (t) =>
        t.id !== txn.id &&
        !t.ignorado &&
        t.direction === txn.direction &&
        chaveDaDescricao(t.descricao_raw) === chave,
    );
    const preencher = mesmas.filter((t) => get(t.id) !== valor && (!get(t.id) || origemDe(t) === 'conferir'));
    // sugestão que já era essa mesma classificação: o operador acabou de confirmar
    const confirmar = mesmas.filter((t) => get(t.id) === valor && origemDe(t) === 'conferir').map((t) => t.id);
    if (confirmar.length) aceitar(confirmar);
    if (!preencher.length) {
      setIguais(null);
      return;
    }
    const antes = new Map(preencher.map((t) => [t.id, get(t.id)]));
    patchMany((t) => antes.has(t.id), valor);
    const nome = catalogo[txn.direction].find((c) => c.id === valor)?.nome ?? '';
    setIguais({ n: preencher.length, nome, antes });
  }

  function desfazerIguais() {
    if (!iguais) return;
    for (const [idLinha, anterior] of iguais.antes) patchRow(idLinha, anterior);
    setIguais(null);
  }

  async function preencherPelaMemoria() {
    setMemoria((m) => ({ ...m, buscando: true, msg: null }));
    try {
      const { sugestoes } = await buscarSugestoes(id);
      const livres = sugestoes.filter((s) => !get(s.id));
      aplicarSugestoes(livres);
      setMemoria((m) => ({
        rodada: m.rodada + 1,
        buscando: false,
        msg: livres.length
          ? `${livres.length} lançamento(s) preenchido(s) pela memória — confira e salve.`
          : 'A memória não tem sugestão para os lançamentos pendentes (descrições que ainda não foram classificadas antes).',
      }));
    } catch (err) {
      setMemoria((m) => ({ ...m, buscando: false, msg: err instanceof Error ? err.message : 'Falha ao ler a memória' }));
    }
  }

  const saveErr =
    save.error instanceof ApiError ? save.error.message : save.error ? String(save.error) : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Classificação</h1>
          <p className="text-sm text-slate-500">
            {st.client?.razao_social ?? 'cliente'} · {st.arquivo_nome} ·{' '}
            {st.period_start && st.period_end
              ? `${formatDate(st.period_start)} a ${formatDate(st.period_end)}`
              : 'sem período'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => (isDirty ? setConfirmSair(true) : navigate('/classificacao/historico'))}
          >
            Voltar
          </button>
          {/* cliente salva pelo "Salvar e aprovar" */}
          {!ehCliente && (
            <button className="btn-primary" onClick={onSave} disabled={!isDirty || save.isPending}>
              {save.isPending ? 'Salvando…' : isDirty ? `Salvar (${changes.length})` : 'Salvo'}
            </button>
          )}
          {botaoAprovar}
        </div>
      </div>

      <AvisoAprovacao st={st} ehCliente={ehCliente} />
      <HistoricoAprovacoes st={st} ehCliente={ehCliente} />

      {jaPuxado && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {somenteLeitura ? (
            'Este extrato já foi enviado para a contabilidade — as classificações ficam só para consulta.'
          ) : (
            <>
              Este extrato já foi puxado pro módulo Importação (status atual: {st.status}). Você ainda
              pode ajustar as classificações aqui — elas seguem valendo pro arquivo do Domínio.
            </>
          )}
        </p>
      )}

      {st.erro_msg && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{st.erro_msg}</p>
      )}
      {saveErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{saveErr}</p>}

      <StatementSummary statement={st} resumido={ehCliente} />

      <div className="card grid grid-cols-2 gap-x-6 gap-y-1 p-3 text-sm sm:grid-cols-4">
        <Stat label="Ativos" value={String(stats.ativos)} />
        <Stat label="Classificados" value={String(stats.classificados)} tone="green" />
        <Stat label="Pendentes" value={String(stats.pend)} tone={stats.pend ? 'amber' : undefined} />
        <Stat
          label="Sugestões p/ conferir"
          value={String(stats.sugestoes.length)}
          tone={stats.sugestoes.length ? 'amber' : undefined}
        />
      </div>

      {(stats.daMemoria > 0 || stats.sugestoes.length > 0) && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {stats.daMemoria > 0 && (
            <>
              {stats.daMemoria} lançamento(s) classificado(s) pela memória (a mesma descrição já foi classificada
              assim antes).{' '}
            </>
          )}
          {stats.sugestoes.length > 0 && (
            <span className="text-amber-800">
              {stats.sugestoes.length} com sugestão para conferir: a descrição já teve classificações diferentes
              (o sistema pôs a mais usada) ou foi classificada assim em outra empresa do mesmo cliente.
            </span>
          )}
        </p>
      )}

      {!somenteLeitura && (
        <div className="card space-y-3 p-4 text-sm">
          <p className="text-sm font-medium text-slate-700">Ações em massa</p>
          <div className="flex flex-wrap gap-2">
            <AdicionarDaListaGeral clientId={clientId} direction="entrada" naLista={lista} />
            <AdicionarDaListaGeral clientId={clientId} direction="saida" naLista={lista} />
            <button
              className="btn-ghost h-9 px-3"
              disabled={!stats.pend || memoria.buscando}
              title="Classifica os pendentes cuja descrição já foi classificada antes nesta empresa"
              onClick={preencherPelaMemoria}
            >
              {memoria.buscando ? 'Lendo a memória…' : 'Preencher pela memória'}
            </button>
            {stats.sugestoes.length > 0 && (
              <button className="btn-ghost h-9 px-3" onClick={() => aceitar(stats.sugestoes)}>
                Aceitar as sugestões ({stats.sugestoes.length})
              </button>
            )}
          </div>
          {memoria.msg && <p className="text-xs text-slate-600">{memoria.msg}</p>}

          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <label className="flex flex-col">
              <span className="mb-1 text-xs text-slate-500">Classificar em</span>
              <select
                className="input h-9 w-44"
                value={bulkDir}
                onChange={(e) => {
                  setBulkDir(e.target.value as Direction);
                  setBulkClassif('');
                }}
              >
                <option value="saida">todas as saídas</option>
                <option value="entrada">todas as entradas</option>
              </select>
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs text-slate-500">Classificação</span>
              <ClassificacaoSelect
                clientId={clientId}
                direction={bulkDir}
                options={catalogo[bulkDir]}
                value={bulkClassif || null}
                onChange={(v) => setBulkClassif(v ?? '')}
                className="input h-9 w-56"
              />
            </label>
            <button
              className="btn-ghost h-9 px-3"
              disabled={!bulkClassif}
              onClick={() => patchMany((tx) => tx.direction === bulkDir && !tx.ignorado, bulkClassif || null)}
            >
              aplicar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 text-sm">
        {(
          [
            ['saida', 'Saídas'],
            ['entrada', 'Entradas'],
            ['pendentes', `Pendentes (${stats.pend})`],
            ...(stats.sugestoes.length || filter === 'sugestoes'
              ? [['sugestoes', `Sugestões (${stats.sugestoes.length})`] as [Filter, string]]
              : []),
            ['todas', 'Todas'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 font-medium ${
              filter === f ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!somenteLeitura && shown.length > 0 && (
        <p className="text-xs text-slate-500">
          Dica: no campo da classificação, digite as primeiras letras para escolher e aperte <b>Enter</b> para ir ao
          lançamento de baixo (<b>Shift+Enter</b> volta). Os lançamentos com a mesma descrição neste extrato são
          classificados junto.
        </p>
      )}

      {iguais && (
        <p className="flex flex-wrap items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span>
            Também classifiquei {iguais.n} lançamento(s) com a mesma descrição
            {iguais.nome ? ` como "${iguais.nome}"` : ''}.
          </span>
          <button type="button" className="font-medium underline" onClick={desfazerIguais}>
            desfazer
          </button>
          <button type="button" className="ml-auto text-xs text-brand-700/70 hover:text-brand-800" onClick={() => setIguais(null)}>
            fechar
          </button>
        </p>
      )}

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
              <th className="px-2 py-2">Data</th>
              <th className="px-2 py-2">Histórico do extrato</th>
              <th className="px-2 py-2 text-right">Valor</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Classificação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pag.daPagina.map((txn: Transaction, i) => {
              const origem = origemDe(txn);
              return (
                <tr key={txn.id} className={origem === 'conferir' ? 'bg-amber-50/60' : ''}>
                  <td className="whitespace-nowrap px-2 py-1 text-xs">{formatDate(txn.data)}</td>
                  <td className="px-2 py-1 text-xs text-slate-700">{txn.descricao_raw}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums">
                    {formatMoney(Math.round(Number(txn.valor) * 100))}
                  </td>
                  <td className="px-2 py-1">
                    <span
                      className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                        txn.direction === 'entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {txn.direction === 'entrada' ? 'ent' : 'saí'}
                    </span>
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1.5">
                      <ClassificacaoSelect
                        ref={(el) => {
                          selects.current[i] = el;
                        }}
                        aria-label={`Classificação do lançamento ${pag.inicio + i + 1}`}
                        clientId={clientId}
                        direction={txn.direction}
                        options={catalogo[txn.direction]}
                        value={get(txn.id)}
                        onChange={(v) => classificar(txn, v)}
                        onKeyDown={(e) => navegar(e, i)}
                        disabled={somenteLeitura}
                        className="input h-8 w-56 px-2 py-1 text-xs disabled:bg-slate-100"
                      />
                      <SeloMemoria
                        origem={origem}
                        onAceitar={somenteLeitura ? undefined : () => aceitar([txn.id])}
                      />
                      <SeloAprovado aprovado={txn.aprovado_classificacao_id ?? null} atual={get(txn.id)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="p-6 text-sm text-slate-400">Nenhum lançamento neste filtro.</p>
        )}
      </TabelaRolavel>

      <Paginacao
        pagina={pag.pagina}
        paginas={pag.paginas}
        porPagina={pag.porPagina}
        total={pag.total}
        onPagina={pag.setPagina}
        onPorPagina={pag.setPorPagina}
      />

      <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm">
        <span className="text-slate-500">
          {isDirty
            ? ehCliente
              ? `${changes.length} alteração(ões) ainda não salva(s) — clique em "Salvar e aprovar" para salvar.`
              : 'Salve as alterações antes de ir pra Importação.'
            : stats.pend > 0
              ? `${stats.pend} lançamento(s) ainda sem classificação.`
              : ehCliente && temNovidade
                ? `Tudo classificado (${stats.classificados}/${stats.ativos}) — falta aprovar.`
                : `Tudo classificado (${stats.classificados}/${stats.ativos}).`}
        </span>
        <div className="flex gap-2">
          {isDirty && (
            <button
              className="btn-ghost"
              onClick={() => {
                reset();
                setIguais(null);
              }}
            >
              Descartar alterações
            </button>
          )}
          {botaoAprovar}
          {/* puxar pra Importação é do escritório */}
          {!ehCliente && (
            <button
              className="btn-primary"
              disabled={isDirty}
              title={isDirty ? 'Salve as alterações primeiro' : 'Ir definir as contas contábeis'}
              onClick={() => navigate(`/importar?puxar=${st.id}`)}
            >
              {jaPuxado ? 'Ir para Importação →' : 'Puxar para Importação →'}
            </button>
          )}
        </div>
      </div>

      <ModalAprovacao
        open={aprovando}
        st={st}
        qtd={stats.classificados}
        novos={stats.novos}
        pendentes={stats.pend}
        email={user?.email ?? null}
        busy={ocupado}
        erro={erroAprovacao}
        onAprovar={confirmarAprovacao}
        onCancelar={() => setAprovando(false)}
      />

      <ConfirmDialog
        open={confirmSair}
        title="Sair sem salvar?"
        message={`Você tem ${changes.length} alteração(ões) não salva(s). Se sair agora, elas se perdem.`}
        confirmLabel="Sair sem salvar"
        onConfirm={() => navigate('/classificacao/historico')}
        onCancel={() => setConfirmSair(false)}
      />
    </section>
  );
}

function SeloMemoria({ origem, onAceitar }: { origem: OrigemMemoria | null; onAceitar?: () => void }) {
  if (origem === 'memoria') {
    return (
      <span
        className="whitespace-nowrap rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700"
        title="Classificado pela memória: essa descrição já foi classificada assim antes"
      >
        memória
      </span>
    );
  }
  if (origem === 'conferir') {
    return (
      <span className="flex items-center gap-1 whitespace-nowrap">
        <span
          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
          title="Sugestão para conferir: essa descrição já teve classificações diferentes (o sistema pôs a mais usada) ou foi classificada assim em outra empresa do mesmo cliente"
        >
          sugestão
        </span>
        {onAceitar && (
          <button
            type="button"
            className="rounded border border-amber-300 px-1.5 text-[11px] text-amber-800 hover:bg-amber-100"
            title="Está certa — aceitar a sugestão"
            onClick={onAceitar}
          >
            ✓
          </button>
        )}
      </span>
    );
  }
  return null;
}

/** O cliente já aprovou este lançamento? ✓ = aprovado como está; âmbar = mudou depois da aprovação. */
function SeloAprovado({ aprovado, atual }: { aprovado: string | null; atual: string | null }) {
  if (!aprovado) return null;
  if (aprovado === atual) {
    return (
      <span
        className="whitespace-nowrap rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700"
        title="O cliente aprovou esta classificação"
      >
        ✓ aprovado
      </span>
    );
  }
  return (
    <span
      className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
      title="A classificação mudou depois que o cliente aprovou — precisa de nova aprovação"
    >
      mudou após aprovação
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
      <p
        className={`font-semibold ${
          tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
