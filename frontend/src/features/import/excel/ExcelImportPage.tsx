import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { duplicado, ErroImportacao } from '@/features/statements/ErroImportacao';
import { travasDoErro, type RespostasTravas } from '@/features/statements/travas';
import { formatDate, formatMoney } from '@/lib/format';
import type { Planilha } from '@/lib/types';
import { FileDrop } from '@/components/FileDrop';
import { IconRaio, IconSetaDireita, IconSetaEsquerda, Spinner } from '@/components/icons';
import { Ajuda, Carregando, Etapas, PageHeader, PassoAjuda, Secao } from '@/components/ui';
import { ETAPAS_EXCEL } from '@/lib/etapas';
import { useCreateStatementExcel, useLerPlanilha, type ImportResult } from '@/features/statements/api';
import { useCabecalhoImportacao } from '../useCabecalhoImportacao';
import { CamposCabecalho, NotaContaBanco } from '../CamposCabecalho';
import { ResultadoImportacao } from '../ResultadoImportacao';
import { MapeamentoPlanilha } from './MapeamentoPlanilha';
import {
  SEM_COLUNAS,
  colunasIniciais,
  colunasQueCabem,
  lerLinhas,
  mapeamentoFinal,
  resumir,
  type Colunas,
  type Resumo,
} from './planilha';

function mensagem(err: unknown): string | null {
  if (!err) return null;
  if (!(err instanceof ApiError)) return String(err);
  const campos = (err.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
  const extra = campos
    ? Object.entries(campos)
        .map(([k, v]) => `${k}: ${v.join(', ')}`)
        .join('; ')
    : '';
  return extra ? `${err.message} (${extra})` : err.message;
}

/**
 * Nova importação Excel — planilha de controle do próprio cliente. Separada da
 * importação de extrato (PDF/OFX/CSV): aqui nada é adivinhado, o operador diz
 * qual coluna é Data, Valor e Histórico. Depois segue o fluxo normal (Revisão).
 */
export function ExcelImportPage() {
  const cab = useCabecalhoImportacao();
  const lerMut = useLerPlanilha();
  const createMut = useCreateStatementExcel();

  const [etapa, setEtapa] = useState<'dados' | 'colunas'>('dados');
  const [file, setFile] = useState<File | null>(null);
  const [lida, setLida] = useState<{ file: File; planilha: Planilha } | null>(null);
  const [colunas, setColunas] = useState<Colunas>(SEM_COLUNAS);
  const [origemColunas, setOrigemColunas] = useState<'anterior' | 'cabecalho' | null>(null);
  const [invertidas, setInvertidas] = useState<ReadonlySet<number>>(new Set());
  const [result, setResult] = useState<ImportResult | null>(null);

  const planilha = lida?.planilha ?? null;
  const linhas = useMemo(() => (planilha ? lerLinhas(planilha, colunas) : []), [planilha, colunas]);
  const resumo = useMemo(() => resumir(linhas, invertidas), [linhas, invertidas]);
  const mapeamento = planilha ? mapeamentoFinal(planilha.aba, colunas, linhas, invertidas) : null;

  function escolherColunas(e: React.FormEvent) {
    e.preventDefault();
    if (!cab.completo || !file) return;
    // voltou só pra mexer no cabeçalho: a planilha já está lida, não perde as colunas
    if (lida?.file === file) {
      setEtapa('colunas');
      return;
    }
    lerMut.mutate(
      { file, client_id: cab.clientId },
      {
        onSuccess: (r) => {
          const ini = colunasIniciais(r.planilha, r.mapeamento_anterior);
          setLida({ file, planilha: r.planilha });
          setColunas(ini.colunas);
          setOrigemColunas(ini.origem);
          setInvertidas(new Set());
          createMut.reset();
          setEtapa('colunas');
        },
      },
    );
  }

  function trocarAba(aba: number) {
    if (!lida) return;
    lerMut.mutate(
      { file: lida.file, aba },
      {
        onSuccess: (r) => {
          setLida({ file: lida.file, planilha: r.planilha });
          // Abas mensais costumam ter o mesmo layout: se a escolha atual ainda
          // lê lançamentos na aba nova, fica; senão vale o cabeçalho da aba nova.
          const mantidas = colunasQueCabem(colunas, r.planilha.colunas);
          const serve =
            mantidas.data != null &&
            mantidas.valor != null &&
            mantidas.historico.length > 0 &&
            lerLinhas(r.planilha, mantidas).some((l) => l.situacao === 'entra');
          if (serve) {
            setColunas(mantidas);
          } else {
            const ini = colunasIniciais(r.planilha, null);
            setColunas(ini.colunas);
            setOrigemColunas(ini.origem);
          }
          setInvertidas(new Set());
        },
      },
    );
  }

  function inverter(n: number) {
    setInvertidas((antes) => {
      const s = new Set(antes);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });
  }

  function importar(respostas?: RespostasTravas) {
    if (!lida || !mapeamento || !resumo.lancamentos) return;
    createMut.mutate({ ...cab.dados, file: lida.file, mapeamento, respostas }, { onSuccess: (r) => setResult(r) });
  }

  function recomecar() {
    setResult(null);
    setLida(null);
    setFile(null);
    setColunas(SEM_COLUNAS);
    setOrigemColunas(null);
    setInvertidas(new Set());
    setEtapa('dados');
    lerMut.reset();
    createMut.reset();
  }

  if (result) {
    return (
      <ResultadoImportacao
        titulo="Planilha importada"
        result={result}
        saldoInicial={cab.saldoInicialNum}
        onSaldoInicial={(v) => cab.setSaldoInicial(v.toFixed(2).replace('.', ','))}
        onNova={recomecar}
        etapas={ETAPAS_EXCEL}
      />
    );
  }

  if (etapa === 'colunas' && lida && planilha) {
    const falta = [
      colunas.data == null && 'Data',
      colunas.valor == null && 'Valor',
      !colunas.historico.length && 'Histórico',
    ].filter((x): x is string => !!x);
    const podeImportar = !!mapeamento && resumo.lancamentos > 0 && !createMut.isPending && !lerMut.isPending;
    const erro = mensagem(createMut.error) ?? mensagem(lerMut.error);

    return (
      <section className="space-y-5">
        <PageHeader
          titulo="Escolha as colunas"
          descricao={
            <>
              <span className="font-semibold text-slate-700">{cab.selected?.razao_social ?? 'cliente'}</span> · {lida.file.name}
            </>
          }
          acoes={
            <>
              <button className="btn-ghost" onClick={() => setEtapa('dados')} disabled={createMut.isPending}>
                <IconSetaEsquerda className="h-4 w-4" />
                Voltar
              </button>
              <button className="btn-primary" onClick={() => importar()} disabled={!podeImportar}>
                {createMut.isPending ? <Spinner /> : <IconRaio className="h-4 w-4" />}
                {createMut.isPending
                  ? 'Importando…'
                  : `Importar ${resumo.lancamentos} lançamento${resumo.lancamentos === 1 ? '' : 's'}`}
              </button>
            </>
          }
        >
          <Etapas etapas={ETAPAS_EXCEL} atual={1} />
        </PageHeader>

        <div className="card space-y-2 p-5 text-sm text-slate-600">
          {planilha.abas.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <label className="font-semibold text-slate-700" htmlFor="aba-planilha">
                Aba da planilha
              </label>
              <select
                id="aba-planilha"
                className="input w-auto"
                value={planilha.aba}
                disabled={lerMut.isPending}
                onChange={(e) => trocarAba(Number(e.target.value))}
              >
                {planilha.abas.map((a, i) => (
                  <option key={i} value={i}>
                    {a.nome}
                    {a.oculta ? ' (oculta)' : ''}
                  </option>
                ))}
              </select>
              {lerMut.isPending && <Carregando texto="Lendo a aba…" />}
            </div>
          )}
          <p>
            Em cada coluna, escolha <b>Data</b>, <b>Valor</b> ou <b>Histórico</b> — dá pra marcar mais
            de uma coluna como Histórico (os textos são juntados). <b>Valor negativo vira saída; positivo
            vira entrada.</b> Linhas sem data ou sem valor (cabeçalho, títulos, totais) ficam de fora
            sozinhas.
          </p>
          {origemColunas === 'anterior' && (
            <p className="alert alert-success">
              Colunas da última importação Excel deste cliente — confira se a planilha continua do
              mesmo jeito.
            </p>
          )}
          {origemColunas === 'cabecalho' && (
            <p className="alert alert-success">Colunas sugeridas pelo cabeçalho da planilha — confira.</p>
          )}
        </div>

        <ResumoPlanilha resumo={resumo} falta={falta} />

        {planilha.truncado && (
          <p className="alert alert-warn">
            A aba tem {planilha.total_linhas.toLocaleString('pt-BR')} linhas preenchidas — a prévia
            mostra só as primeiras {planilha.linhas.length.toLocaleString('pt-BR')}. O limite é
            10.000 lançamentos por importação.
          </p>
        )}
        {duplicado(createMut.error) || travasDoErro(createMut.error) ? (
          <ErroImportacao err={createMut.error} enviando={createMut.isPending} onReenviar={(r) => importar(r)} />
        ) : (
          erro && <p className="alert alert-error">{erro}</p>
        )}

        <MapeamentoPlanilha
          planilha={planilha}
          colunas={colunas}
          onColunas={setColunas}
          linhas={linhas}
          invertidas={invertidas}
          onInverter={inverter}
        />
      </section>
    );
  }

  const erro = mensagem(lerMut.error);
  return (
    <section className="space-y-6">
      <PageHeader
        titulo="Nova importação Excel"
        descricao={
          <>
            Para a planilha de controle do próprio cliente. Na próxima tela você diz qual coluna é a data, o valor e o
            histórico. Extrato de banco (PDF, OFX, CSV) continua na{' '}
            <Link to="/importar" className="link">
              Nova importação
            </Link>
            .
          </>
        }
      >
        <Etapas etapas={ETAPAS_EXCEL} atual={0} />
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <form onSubmit={escolherColunas} className="card animate-fade-up space-y-7 p-6 sm:p-7">
          <Secao numero={1} titulo="Cliente e parâmetros do Domínio">
            <CamposCabecalho cab={cab} />
          </Secao>

          <div className="divider" />

          <Secao numero={2} titulo="Planilha">
            <FileDrop
              file={file}
              onFile={setFile}
              accept=".xls,.xlsx,.xlsm"
              titulo="Arraste a planilha aqui ou clique para escolher"
              formatos="XLS ou XLSX"
            />
          </Secao>

          {erro && <p className="alert alert-error">{erro}</p>}

          <div className="flex justify-end">
            <button
              type="submit"
              className="btn-primary sm:min-w-[12rem]"
              disabled={!cab.completo || !file || lerMut.isPending}
            >
              {lerMut.isPending && <Spinner />}
              {lerMut.isPending ? 'Lendo a planilha…' : 'Escolher as colunas'}
              {!lerMut.isPending && <IconSetaDireita className="h-4 w-4" />}
            </button>
          </div>
        </form>

        <Ajuda>
          <PassoAjuda n={1}>Escolha o cliente e arraste a planilha de controle dele (XLS ou XLSX).</PassoAjuda>
          <PassoAjuda n={2}>
            Diga qual coluna é a <b>data</b>, o <b>valor</b> e o <b>histórico</b>. Valor negativo vira saída; positivo vira
            entrada.
          </PassoAjuda>
          <PassoAjuda n={3}>A escolha de colunas volta pronta na próxima planilha do mesmo cliente.</PassoAjuda>
          <NotaContaBanco cab={cab} />
        </Ajuda>
      </div>
    </section>
  );
}

function ResumoPlanilha({ resumo, falta }: { resumo: Resumo; falta: string[] }) {
  if (falta.length) {
    return (
      <p className="alert alert-warn">
        Falta escolher a coluna de {falta.join(', ').replace(/, ([^,]*)$/, ' e $1')}.
      </p>
    );
  }
  const f = resumo.fora;
  const motivos = [
    f.semData > 0 && `${f.semData} sem data (cabeçalho, títulos…)`,
    f.semValor > 0 && `${f.semValor} sem valor`,
    f.zero > 0 && `${f.zero} com valor zero`,
    f.saldo > 0 && `${f.saldo} de saldo/total`,
    f.tiradas > 0 && `${f.tiradas} tirada${f.tiradas > 1 ? 's' : ''} por você`,
  ].filter(Boolean);

  return (
    <div className="card grid grid-cols-2 gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-4">
      <Info label="Lançamentos" value={String(resumo.lancamentos)} />
      <Info
        label="Entradas"
        value={`${resumo.entradas.n} · ${formatMoney(resumo.entradas.cents)}`}
        tone="green"
      />
      <Info label="Saídas" value={`${resumo.saidas.n} · ${formatMoney(resumo.saidas.cents)}`} tone="red" />
      <Info
        label="Período"
        value={resumo.inicio && resumo.fim ? `${formatDate(resumo.inicio)} a ${formatDate(resumo.fim)}` : '—'}
      />
      {motivos.length > 0 && (
        <p className="col-span-full text-xs text-slate-500">
          Ficam de fora {f.total} linha{f.total > 1 ? 's' : ''}: {motivos.join(' · ')}.
        </p>
      )}
    </div>
  );
}

function Info({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p
        className={`mt-0.5 font-display font-semibold tabular-nums ${
          tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
