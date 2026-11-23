import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Paginacao, usePaginacao } from '@/components/Paginacao';
import { TabelaRolavel } from '@/components/TabelaRolavel';
import { IconCheck, IconSalvar, IconSetaDireita, IconSetaEsquerda, Spinner } from '@/components/icons';
import { BarraAcoes, BarraProgresso, Carregando, ErroCarregar, Etapas, Kbd, Metrica, PageHeader, Segmented, Vazio } from '@/components/ui';
import { ETAPAS_CLASSIFICACAO } from '@/lib/etapas';
import { useToast } from '@/lib/toast';
import { useAtalhoSalvar } from '@/lib/useAtalhoSalvar';
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
  const toast = useToast();

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

  // Ctrl+S: o escritório salva; o cliente salva pelo "Salvar e aprovar"
  useAtalhoSalvar(() => {
    if (ehCliente) {
      if (isDirty) toast({ tipo: 'info', texto: 'Para salvar, use “Salvar e aprovar”', detalhe: 'Ele salva e registra que você conferiu o que já está classificado.' });
      return;
    }
    onSave();
  });

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

  if (isLoading) return <Carregando texto="Carregando o extrato…" className="py-10" />;
  if (error || !data) return <ErroCarregar erro={error} padrao="Importação não encontrada" />;

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
    if (!isDirty || save.isPending) return;
    setIguais(null);
    const n = changes.length;
    save.mutate(changes, {
      onSuccess: () => toast({ texto: 'Classificações salvas', detalhe: `${n} lançamento(s) atualizado(s) — a memória já aprendeu.` }),
    });
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
      toast({ texto: 'Classificações aprovadas', detalhe: 'O escritório já vê a sua aprovação no histórico.' });
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
      aria-label="Salvar e aprovar"
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
      {ocupado ? <Spinner /> : <IconCheck className="h-4 w-4" />}
      {ocupado
        ? 'Salvando…'
        : !temNovidade && situacao === 'aprovado'
          ? 'Aprovado'
          : !temNovidade && situacao === 'parcial'
            ? 'Parte aprovada'
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

  const voltar = () => (isDirty ? setConfirmSair(true) : navigate('/classificacao/historico'));
  const etapa = jaPuxado ? 3 : stats.pend === 0 && stats.ativos > 0 ? 2 : 1;

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Classificar lançamentos"
        descricao={
          <>
            <span className="font-semibold text-slate-700">{st.client?.razao_social ?? 'cliente'}</span> · {st.arquivo_nome} ·{' '}
            {st.period_start && st.period_end
              ? `${formatDate(st.period_start)} a ${formatDate(st.period_end)}`
              : 'sem período'}
          </>
        }
        acoes={
          <button className="btn-ghost" onClick={voltar}>
            <IconSetaEsquerda className="h-4 w-4" />
            Voltar
          </button>
        }
      >
        <Etapas etapas={ETAPAS_CLASSIFICACAO} atual={etapa} />
      </PageHeader>

      <AvisoAprovacao st={st} ehCliente={ehCliente} />
      <HistoricoAprovacoes st={st} ehCliente={ehCliente} />

      {jaPuxado && (
        <p className="alert alert-info">
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

      {st.erro_msg && <p className="alert alert-error">{st.erro_msg}</p>}
      {saveErr && <p className="alert alert-error">{saveErr}</p>}

      <StatementSummary statement={st} resumido={ehCliente} />

      {/* progresso */}
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Metrica rotulo="Ativos" valor={stats.ativos} tom="brand" />
          <Metrica rotulo="Classificados" valor={stats.classificados} tom="green" />
          <Metrica rotulo="Pendentes" valor={stats.pend} tom={stats.pend ? 'amber' : undefined} />
          <Metrica rotulo="Sugestões p/ conferir" valor={stats.sugestoes.length} tom={stats.sugestoes.length ? 'amber' : undefined} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <BarraProgresso feito={stats.classificados} total={stats.ativos} rotulo="Lançamentos classificados" />
          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
            {stats.ativos ? Math.round((stats.classificados / stats.ativos) * 100) : 0}% classificado
          </span>
        </div>
      </div>

      {(stats.daMemoria > 0 || stats.sugestoes.length > 0) && (
        <p className={`alert ${stats.sugestoes.length > 0 ? 'alert-warn' : 'alert-success'}`}>
          {stats.daMemoria > 0 && (
            <>
              {stats.daMemoria} lançamento(s) classificado(s) pela memória (a mesma descrição já foi classificada
              assim antes).{' '}
            </>
          )}
          {stats.sugestoes.length > 0 && (
            <span>
              {stats.sugestoes.length} com sugestão para conferir: a descrição já teve classificações diferentes
              (o sistema pôs a mais usada) ou foi classificada assim em outra empresa do mesmo cliente.
            </span>
          )}
        </p>
      )}

      {!somenteLeitura && (
        <div className="card space-y-4 p-5 text-sm">
          <p className="card-title">Ações em massa</p>
          <div className="flex flex-wrap gap-2">
            <AdicionarDaListaGeral clientId={clientId} direction="entrada" naLista={lista} />
            <AdicionarDaListaGeral clientId={clientId} direction="saida" naLista={lista} />
            <button
              className="btn-ghost btn-sm h-9"
              disabled={!stats.pend || memoria.buscando}
              title="Classifica os pendentes cuja descrição já foi classificada antes nesta empresa"
              onClick={preencherPelaMemoria}
            >
              {memoria.buscando && <Spinner />}
              {memoria.buscando ? 'Lendo a memória…' : 'Preencher pela memória'}
            </button>
            {stats.sugestoes.length > 0 && (
              <button className="btn-ghost btn-sm h-9" onClick={() => aceitar(stats.sugestoes)}>
                <IconCheck className="h-4 w-4 text-green-600" />
                Aceitar as sugestões ({stats.sugestoes.length})
              </button>
            )}
          </div>
          {memoria.msg && <p className="text-xs text-slate-600">{memoria.msg}</p>}

          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
            <label className="flex flex-col">
              <span className="field-label">Classificar em</span>
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
              <span className="field-label">Classificação</span>
              <ClassificacaoSelect
                clientId={clientId}
                direction={bulkDir}
                options={catalogo[bulkDir]}
                value={bulkClassif || null}
                onChange={(v) => setBulkClassif(v ?? '')}
                className="input h-9 w-60"
              />
            </label>
            <button
              className="btn-ghost btn-sm h-9"
              disabled={!bulkClassif}
              onClick={() => patchMany((tx) => tx.direction === bulkDir && !tx.ignorado, bulkClassif || null)}
            >
              aplicar
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Segmented
          label="Filtrar lançamentos"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'saida', label: 'Saídas' },
            { value: 'entrada', label: 'Entradas' },
            { value: 'pendentes', label: 'Pendentes', count: stats.pend },
            ...(stats.sugestoes.length || filter === 'sugestoes'
              ? [{ value: 'sugestoes' as Filter, label: 'Sugestões', count: stats.sugestoes.length }]
              : []),
            { value: 'todas', label: 'Todas', count: stats.ativos },
          ]}
        />
        {!somenteLeitura && shown.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            Digite as primeiras letras para escolher · <Kbd>Enter</Kbd> próximo · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> anterior
            {!ehCliente && (
              <>
                {' '}
                · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> salva
              </>
            )}
          </p>
        )}
      </div>

      {!somenteLeitura && shown.length > 0 && (
        <p className="text-xs text-slate-500">
          Os lançamentos com a mesma descrição neste extrato são classificados junto.
        </p>
      )}

      {iguais && (
        <div className="alert alert-info flex flex-wrap items-center gap-x-3 gap-y-1" role="status">
          <span>
            Também classifiquei <b>{iguais.n}</b> lançamento(s) com a mesma descrição
            {iguais.nome ? ` como "${iguais.nome}"` : ''}.
          </span>
          <button type="button" className="font-bold underline underline-offset-4" onClick={desfazerIguais}>
            desfazer
          </button>
          <button type="button" className="ml-auto text-xs text-brand-700/70 hover:text-brand-800" onClick={() => setIguais(null)}>
            fechar
          </button>
        </div>
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
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Histórico do extrato</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Classificação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pag.daPagina.map((txn: Transaction, i) => {
              const origem = origemDe(txn);
              const vazio = !get(txn.id);
              return (
                <tr key={txn.id} className={origem === 'conferir' ? 'bg-amber-50/60' : ''}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-600">{formatDate(txn.data)}</td>
                  <td className="min-w-[14rem] px-3 py-1.5 text-xs text-slate-700">{txn.descricao_raw}</td>
                  <td
                    className={`whitespace-nowrap px-3 py-1.5 text-right text-xs font-medium tabular-nums ${
                      txn.direction === 'entrada' ? 'text-green-700' : 'text-slate-700'
                    }`}
                  >
                    {formatMoney(Math.round(Number(txn.valor) * 100))}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={`chip ${txn.direction === 'entrada' ? 'chip-green' : 'chip-red'}`}>
                      {txn.direction === 'entrada' ? 'ent' : 'saí'}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
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
                        className={`input h-8 w-60 rounded-lg px-2 py-1 text-xs disabled:bg-slate-100 ${
                          vazio && !somenteLeitura ? 'border-amber-300 bg-amber-50/40 text-slate-500' : ''
                        }`}
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

      <BarraAcoes
        status={
          isDirty ? (
            <span className="flex items-center gap-2 font-semibold text-amber-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              {ehCliente
                ? `${changes.length} alteração(ões) ainda não salva(s) — clique em "Salvar e aprovar" para salvar.`
                : `${changes.length} alteração(ões) não salva(s) — salve antes de ir pra Importação.`}
            </span>
          ) : stats.pend > 0 ? (
            `${stats.pend} lançamento(s) ainda sem classificação.`
          ) : (
            <span className="flex items-center gap-2 font-semibold text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {ehCliente && temNovidade
                ? `Tudo classificado (${stats.classificados}/${stats.ativos}) — falta aprovar.`
                : `Tudo classificado (${stats.classificados}/${stats.ativos}).`}
            </span>
          )
        }
      >
        {isDirty && (
          <button
            className="btn-quiet"
            onClick={() => {
              reset();
              setIguais(null);
            }}
          >
            Descartar
          </button>
        )}
        {/* cliente salva pelo "Salvar e aprovar" */}
        {!ehCliente && (
          <button className={isDirty ? 'btn-primary' : 'btn-ghost'} onClick={onSave} disabled={!isDirty || save.isPending} title="Salvar (Ctrl+S)">
            {save.isPending ? <Spinner /> : <IconSalvar className="h-4 w-4" />}
            {save.isPending ? 'Salvando…' : isDirty ? `Salvar (${changes.length})` : 'Salvo'}
          </button>
        )}
        {botaoAprovar}
        {/* puxar pra Importação é do escritório */}
        {!ehCliente && (
          <button
            className={isDirty ? 'btn-ghost' : 'btn-primary'}
            disabled={isDirty}
            title={isDirty ? 'Salve as alterações primeiro' : 'Ir definir as contas contábeis'}
            onClick={() => navigate(`/importar?puxar=${st.id}`)}
          >
            {jaPuxado ? 'Ir para Importação' : 'Puxar para Importação'}
            <IconSetaDireita className="h-4 w-4" />
          </button>
        )}
      </BarraAcoes>

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
        className="chip chip-green"
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
          className="chip chip-amber"
          title="Sugestão para conferir: essa descrição já teve classificações diferentes (o sistema pôs a mais usada) ou foi classificada assim em outra empresa do mesmo cliente"
        >
          sugestão
        </span>
        {onAceitar && (
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded-lg border border-amber-300 bg-white text-amber-700 transition-colors hover:bg-amber-100"
            title="Está certa — aceitar a sugestão"
            aria-label="Aceitar a sugestão"
            onClick={onAceitar}
          >
            <IconCheck className="h-3.5 w-3.5" strokeWidth={2.5} />
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
        className="chip chip-green"
        title="O cliente aprovou esta classificação"
      >
        ✓ aprovado
      </span>
    );
  }
  return (
    <span
      className="chip chip-amber"
      title="A classificação mudou depois que o cliente aprovou — precisa de nova aprovação"
    >
      mudou após aprovação
    </span>
  );
}
