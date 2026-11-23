import { useNavigate } from 'react-router-dom';
import { useUpdateStatementHeader, type ImportResult } from '@/features/statements/api';
import { StatementSummary } from '@/features/statements/StatementSummary';
import { TransactionsTable } from '@/features/statements/TransactionsTable';
import { SaldoReconciliacao } from '@/features/statements/SaldoReconciliacao';
import { IconSetaDireita, IconSetaEsquerda } from '@/components/icons';
import { Etapas, PageHeader } from '@/components/ui';
import { ETAPAS_IMPORTACAO } from '@/lib/etapas';

/** Tela depois de ler o arquivo: resumo, conferência do saldo, avisos e lançamentos → Revisão. */
export function ResultadoImportacao({
  titulo,
  result,
  saldoInicial,
  onSaldoInicial,
  onNova,
  etapas = ETAPAS_IMPORTACAO,
}: {
  titulo: string;
  /** etapas do fluxo (extrato ou planilha Excel) */
  etapas?: string[];
  result: ImportResult;
  saldoInicial: number;
  /** "ajustar saldo inicial": atualiza o campo da tela (o extrato já é gravado aqui) */
  onSaldoInicial: (v: number) => void;
  onNova: () => void;
}) {
  const navigate = useNavigate();
  const headerMut = useUpdateStatementHeader(result.statement.id);
  const porMemoria = result.transactions.filter(
    (t) => t.origem_preenchimento === 'memoria' || t.origem_preenchimento === 'conferir',
  ).length;

  return (
    <section className="space-y-6">
      <PageHeader
        titulo={titulo}
        descricao="Confira o saldo e os lançamentos lidos. As contas contábeis você define na próxima etapa."
        acoes={
          <>
            <button className="btn-ghost" onClick={onNova}>
              <IconSetaEsquerda className="h-4 w-4" />
              Nova importação
            </button>
            <button className="btn-primary" onClick={() => navigate(`/revisao/${result.statement.id}`)}>
              Ir para revisão
              <IconSetaDireita className="h-4 w-4" />
            </button>
          </>
        }
      >
        <Etapas etapas={etapas} atual={1} />
      </PageHeader>

      <StatementSummary statement={result.statement} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3 lg:order-2">
          <SaldoReconciliacao
            transactions={result.transactions}
            saldoInicial={saldoInicial}
            onSaldoInicial={(v) => {
              onSaldoInicial(v);
              headerMut.mutate({ saldo_inicial: v.toFixed(2) });
            }}
          />
          {porMemoria > 0 && (
            <p className="alert alert-success">
              {porMemoria} lançamento{porMemoria > 1 ? 's já vieram' : ' já veio'} preenchido
              {porMemoria > 1 ? 's' : ''} pela memória do cliente.
            </p>
          )}
          {result.warnings.length > 0 && (
            <div className="alert alert-warn">
              <p className="font-semibold">Avisos do leitor:</p>
              <ul className="ml-4 list-disc">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 lg:order-1">
          <TransactionsTable transactions={result.transactions} readOnly saldoInicial={saldoInicial} />
        </div>
      </div>
    </section>
  );
}
