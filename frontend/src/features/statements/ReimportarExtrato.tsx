import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useReimportStatement } from './api';
import { ErroImportacao } from './ErroImportacao';
import type { RespostasTravas } from './travas';

const ACCEPT = '.pdf,.ofx,.qfx,.csv,.txt,.xls,.xlsx';

/**
 * Troca o arquivo de uma importação existente. Substitui os lançamentos e volta
 * o extrato pra "em revisão". Cliente, lote e saldo inicial são mantidos.
 * Importação de planilha Excel (colunas escolhidas na mão) não reimporta — a
 * leitura automática não sabe as colunas.
 */
export function ReimportarExtrato({
  statementId,
  qtd,
  as = 'link',
  excel = false,
}: {
  statementId: string;
  qtd: number;
  as?: 'link' | 'button';
  excel?: boolean;
}) {
  if (excel) {
    return (
      <span
        className={`cursor-help text-slate-400 ${as === 'button' ? 'btn border border-brand-200 bg-white' : ''}`}
        title="Importação de planilha Excel: para trocar a planilha, faça uma nova importação Excel."
      >
        reimportar
      </span>
    );
  }
  return <Reimportar statementId={statementId} qtd={qtd} as={as} />;
}

function Reimportar({ statementId, qtd, as }: { statementId: string; qtd: number; as: 'link' | 'button' }) {
  const navigate = useNavigate();
  const reimport = useReimportStatement(statementId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');

  function fechar() {
    if (reimport.isPending) return;
    setFile(null);
    setPdfPassword('');
    reimport.reset();
  }

  function confirmar(respostas?: RespostasTravas) {
    if (!file) return;
    reimport.mutate(
      { file, pdf_password: pdfPassword || undefined, respostas },
      { onSuccess: () => navigate(`/revisao/${statementId}`) },
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={as === 'button' ? 'btn-ghost' : 'text-brand-600 hover:underline'}
        onClick={() => inputRef.current?.click()}
      >
        reimportar
      </button>

      <Modal open={!!file} onClose={fechar} title="Reimportar extrato">
        <p className="text-sm text-slate-600">
          Trocar pelo arquivo <span className="font-medium">"{file?.name}"</span>? Os{' '}
          <span className="font-medium">{qtd}</span> lançamento(s) atuais serão substituídos.
          Suas classificações se perdem — a memória do cliente reaplica o que puder.
        </p>

        {isPdf && (
          <div className="mt-3">
            <label className="label">Senha do PDF (se tiver)</label>
            <input
              className="input"
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              placeholder="deixe em branco se não tem"
            />
          </div>
        )}

        {reimport.error != null && (
          <div className="mt-3">
            <ErroImportacao err={reimport.error} enviando={reimport.isPending} onReenviar={(r) => confirmar(r)} />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={fechar} disabled={reimport.isPending}>
            Cancelar
          </button>
          <button
            className="btn bg-red-600 text-white hover:bg-red-700"
            onClick={() => confirmar()}
            disabled={reimport.isPending}
          >
            {reimport.isPending ? 'Lendo…' : 'Reimportar'}
          </button>
        </div>
      </Modal>
    </>
  );
}
