import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { ErroImportacao } from '@/features/statements/ErroImportacao';
import { useCreateStatement, type ImportResult } from '@/features/statements/api';
import type { RespostasTravas } from '@/features/statements/travas';
import { FileDrop } from '@/components/FileDrop';
import { IconClassificacao, IconRaio, IconUpload, Spinner } from '@/components/icons';
import { Ajuda, Etapas, PageHeader, PassoAjuda, Secao, Segmented } from '@/components/ui';
import { ETAPAS_IMPORTACAO } from '@/lib/etapas';
import { PuxarClassificacaoForm } from './PuxarClassificacaoForm';
import { useCabecalhoImportacao } from './useCabecalhoImportacao';
import { CamposCabecalho, NotaContaBanco } from './CamposCabecalho';
import { ResultadoImportacao } from './ResultadoImportacao';

type Origem = 'novo' | 'classificacao';

export function ImportPage() {
  const [params] = useSearchParams();
  const puxarId = params.get('puxar') ?? undefined;
  const [origem, setOrigem] = useState<Origem>(puxarId ? 'classificacao' : 'novo');
  const cab = useCabecalhoImportacao();
  const createMut = useCreateStatement();

  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const nome = file?.name.toLowerCase() ?? '';
  const isPdf = nome.endsWith('.pdf');
  // planilha que a leitura automática não entendeu → talvez seja controle do cliente
  const sugerirExcel =
    /\.(xls|xlsx|xlsm)$/.test(nome) &&
    createMut.error instanceof ApiError &&
    [400, 422].includes(createMut.error.status);
  const canSubmit = cab.completo && file && !createMut.isPending;

  function enviar(respostas?: RespostasTravas) {
    if (!file) return;
    createMut.mutate(
      { ...cab.dados, pdf_password: pdfPassword || undefined, file, respostas },
      { onSuccess: (r) => setResult(r) },
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    enviar();
  }


  if (result) {
    return (
      <ResultadoImportacao
        titulo="Extrato lido"
        result={result}
        saldoInicial={cab.saldoInicialNum}
        onSaldoInicial={(v) => cab.setSaldoInicial(v.toFixed(2).replace('.', ','))}
        onNova={() => setResult(null)}
      />
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        titulo="Nova importação"
        descricao="Leia o extrato bancário do cliente: o sistema separa entradas e saídas, confere o saldo e já traz as contas que a memória conhece."
      >
        <Etapas etapas={ETAPAS_IMPORTACAO} atual={0} />
      </PageHeader>

      <Segmented
        label="De onde vem o extrato"
        value={origem}
        onChange={setOrigem}
        options={[
          {
            value: 'novo',
            label: (
              <>
                <IconUpload className="h-4 w-4" /> Importar extrato do zero
              </>
            ),
          },
          {
            value: 'classificacao',
            label: (
              <>
                <IconClassificacao className="h-4 w-4" /> Puxar do módulo Classificação
              </>
            ),
          },
        ]}
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        {origem === 'classificacao' ? (
          <PuxarClassificacaoForm initialStatementId={puxarId} />
        ) : (
          <form onSubmit={submit} className="card animate-fade-up space-y-7 p-6 sm:p-7">
            <Secao numero={1} titulo="Cliente e parâmetros do Domínio" descricao="Preenchidos pelo cadastro do cliente — ajuste se este extrato for diferente.">
              <CamposCabecalho cab={cab} />
            </Secao>

            <div className="divider" />

            <Secao numero={2} titulo="Extrato bancário">
              <FileDrop file={file} onFile={setFile} />

              {isPdf && (
                <div className="animate-fade-up">
                  <label className="label" htmlFor="pdf-senha">
                    Senha do PDF <span className="font-normal text-slate-400">(se tiver)</span>
                  </label>
                  <input
                    id="pdf-senha"
                    className="input max-w-xs"
                    type="password"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    placeholder="deixe em branco se o PDF não tem senha"
                  />
                </div>
              )}
            </Secao>

            {createMut.error && (
              <ErroImportacao
                err={createMut.error}
                enviando={createMut.isPending}
                onReenviar={(r) => enviar(r)}
                onTrocarEmpresa={(empresa) => {
                  // aqui não reenvia sozinho: conta do banco e históricos mudam com o cliente
                  cab.setClientId(empresa.id);
                  createMut.reset();
                }}
              >
                {sugerirExcel && (
                  <p className="mt-1">
                    Planilha de controle do próprio cliente? Use a{' '}
                    <Link to="/importar/excel" className="font-semibold underline">
                      Nova importação Excel
                    </Link>
                    , onde você escolhe a coluna de data, de valor e de histórico.
                  </p>
                )}
              </ErroImportacao>
            )}

            <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                {!cab.clientId
                  ? 'Escolha o cliente para continuar.'
                  : !file
                    ? 'Falta escolher o arquivo do extrato.'
                    : !cab.completo
                      ? 'Falta a conta contábil do banco.'
                      : 'Tudo certo — pode ler o extrato.'}
              </p>
              <button type="submit" className="btn-primary sm:min-w-[12rem]" disabled={!canSubmit}>
                {createMut.isPending ? <Spinner /> : <IconRaio className="h-4 w-4" />}
                {createMut.isPending ? 'Lendo o extrato…' : 'Ler extrato'}
              </button>
            </div>
          </form>
        )}

        <Ajuda>
          {origem === 'novo' ? (
            <>
              <PassoAjuda n={1}>Escolha o cliente: conta do banco, históricos e saldo inicial vêm do cadastro.</PassoAjuda>
              <PassoAjuda n={2}>Arraste o extrato (PDF, OFX, CSV, XLS ou XLSX). O leitor separa entradas e saídas.</PassoAjuda>
              <PassoAjuda n={3}>Confira o saldo, defina as contas na Revisão e gere o arquivo do Domínio.</PassoAjuda>
              <NotaContaBanco cab={cab} />
            </>
          ) : (
            <>
              <PassoAjuda n={1}>Escolha o cliente e o extrato que já foi classificado no módulo Classificação.</PassoAjuda>
              <PassoAjuda n={2}>Informe a conta do banco e os históricos — o arquivo não é lido de novo.</PassoAjuda>
              <PassoAjuda n={3}>Na Revisão, a categoria de cada lançamento aparece como contexto para escolher a conta.</PassoAjuda>
            </>
          )}
        </Ajuda>
      </div>
    </section>
  );
}
