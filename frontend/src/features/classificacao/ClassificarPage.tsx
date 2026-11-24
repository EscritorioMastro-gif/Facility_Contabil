import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErroImportacao } from '@/features/statements/ErroImportacao';
import { useClients } from '@/features/clients/api';
import { FileDrop } from '@/components/FileDrop';
import { IconRaio, Spinner } from '@/components/icons';
import { Ajuda, Etapas, PageHeader, PassoAjuda, Secao } from '@/components/ui';
import { ETAPAS_CLASSIFICACAO } from '@/lib/etapas';
import type { RespostasTravas } from '@/features/statements/travas';
import { useAuth } from '@/auth/useAuth';
import { useCreateStatementClassificar } from './api';

export function ClassificarPage() {
  const navigate = useNavigate();
  // só o cliente classifica (migration 0031): o escritório envia o extrato e consulta
  const { ehCliente } = useAuth();
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const createMut = useCreateStatementClassificar();

  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  const canSubmit = clientId && file && !createMut.isPending;

  function enviar(respostas?: RespostasTravas, empresa = clientId) {
    if (!empresa || !file) return;
    createMut.mutate(
      { client_id: empresa, pdf_password: pdfPassword || undefined, file, respostas },
      { onSuccess: (r) => navigate(`/classificacao/revisao/${r.statement.id}`) },
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    enviar();
  }


  return (
    <section className="space-y-6">
      <PageHeader
        titulo={ehCliente ? 'Classificar extrato' : 'Enviar extrato para classificar'}
        descricao={
          ehCliente
            ? 'Importe o extrato e categorize cada lançamento (água, energia, telefone, recebimento de clientes…). Depois o escritório puxa o extrato já classificado para a contabilidade.'
            : 'Envie o extrato do cliente. Quem categoriza cada lançamento e aprova é o cliente, no acesso dele — o escritório consulta e depois puxa o extrato já classificado para a contabilidade.'
        }
      >
        <Etapas etapas={ETAPAS_CLASSIFICACAO} atual={0} />
      </PageHeader>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <form onSubmit={submit} className="card animate-fade-up space-y-7 p-6 sm:p-7">
          <Secao numero={1} titulo="Empresa">
            <select
              className="input"
              aria-label="Empresa"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={loadingClients}
              required
            >
              <option value="">{loadingClients ? 'Carregando…' : 'Selecione a empresa…'}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razao_social}
                  {c.dominio_code ? ` — Domínio ${c.dominio_code}` : ''}
                </option>
              ))}
            </select>
          </Secao>

          <div className="divider" />

          <Secao numero={2} titulo="Extrato bancário">
            <FileDrop file={file} onFile={setFile} />

            {isPdf && (
              <div className="animate-fade-up">
                <label className="label" htmlFor="pdf-senha-c">
                  Senha do PDF <span className="font-normal text-slate-400">(se tiver)</span>
                </label>
                <input
                  id="pdf-senha-c"
                  className="input max-w-xs"
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="deixe em branco se o PDF não tem senha"
                />
              </div>
            )}
          </Secao>

          <ErroImportacao
            err={createMut.error}
            enviando={createMut.isPending}
            onReenviar={(r) => enviar(r)}
            onTrocarEmpresa={(empresa) => {
              // a dona do extrato: escolhe ela e envia lá (as travas conferem de novo)
              setClientId(empresa.id);
              enviar(undefined, empresa.id);
            }}
          />

          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              {!clientId ? 'Escolha a empresa para continuar.' : !file ? 'Falta escolher o arquivo do extrato.' : 'Tudo certo — pode ler o extrato.'}
            </p>
            <button type="submit" className="btn-primary sm:min-w-[12rem]" disabled={!canSubmit}>
              {createMut.isPending ? <Spinner /> : <IconRaio className="h-4 w-4" />}
              {createMut.isPending ? 'Lendo o extrato…' : 'Ler extrato'}
            </button>
          </div>
        </form>

        <Ajuda>
          <PassoAjuda n={1}>Escolha a empresa e arraste o extrato do mês (PDF, OFX, CSV, XLS ou XLSX).</PassoAjuda>
          <PassoAjuda n={2}>
            {ehCliente ? (
              <>
                O que a memória já conhece vem classificado; o resto você escolhe com o teclado — <b>Enter</b> desce
                para o próximo lançamento.
              </>
            ) : (
              <>
                O que a memória já conhece vem classificado; o resto <b>só o cliente classifica</b>, no acesso dele.
              </>
            )}
          </PassoAjuda>
          <PassoAjuda n={3}>O cliente confere e aprova; o escritório puxa para a Importação e gera o arquivo do Domínio.</PassoAjuda>
        </Ajuda>
      </div>
    </section>
  );
}
