import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { ComplementoModo } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { origemDoSaldo } from '@/features/clients/saldo';
import { moneyToInput, parseMoney } from './useCabecalhoImportacao';
import { useStatement, useStatements, useUpdateStatementHeader } from '@/features/statements/api';
import { IconSetaDireita, Spinner } from '@/components/icons';
import { Carregando, Secao } from '@/components/ui';

const MODO_OPTIONS: { value: ComplementoModo; label: string }[] = [
  { value: 'extrato_classificacao', label: 'Histórico do extrato + classificação' },
  { value: 'tudo', label: 'Histórico do extrato + complemento + classificação' },
  { value: 'ambos', label: 'Histórico do extrato + complemento' },
  { value: 'extrato', label: 'Somente o histórico do extrato' },
  { value: 'complemento', label: 'Somente o complemento' },
];

/** Segunda opção de entrada da Importação: puxa um extrato já lido e
 *  classificado no módulo Classificação, define a conta do banco/histórico e
 *  manda pra Revisão — mesmo lançamento, sem reimportar o arquivo. */
export function PuxarClassificacaoForm({ initialStatementId }: { initialStatementId?: string }) {
  const navigate = useNavigate();
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const { data: preselected } = useStatement(initialStatementId);

  const [clientId, setClientId] = useState('');
  const [selectedId, setSelectedId] = useState(initialStatementId ?? '');

  useEffect(() => {
    if (preselected) setClientId(preselected.statement.client_id);
  }, [preselected]);

  const selected = useMemo(() => clients?.find((c) => c.id === clientId), [clients, clientId]);

  const { data: pendentes, isLoading: loadingStmts } = useStatements(
    { client_id: clientId, status: 'classificacao' },
    { enabled: !!clientId },
  );

  const [contaBanco, setContaBanco] = useState('');
  const [histEntrada, setHistEntrada] = useState('138');
  const [histSaida, setHistSaida] = useState('186');
  const [lote, setLote] = useState(1);
  const [modo, setModo] = useState<ComplementoModo>('extrato_classificacao');
  // O extrato foi lido lá na Classificação (às vezes pelo cliente, semanas
  // antes): o saldo inicial dele é o do cadastro DE AGORA — que anda sozinho a
  // cada arquivo do Domínio gerado —, não o de quando foi enviado.
  const [saldoInicial, setSaldoInicial] = useState('0');

  useEffect(() => {
    if (selected) {
      setContaBanco(selected.banco_conta_contabil ?? '');
      setHistEntrada(selected.hist_code_entrada);
      setHistSaida(selected.hist_code_saida);
      setSaldoInicial(moneyToInput(selected.saldo_inicial ?? 0));
    }
  }, [selected]);

  const header = useUpdateStatementHeader(selectedId);
  const canSubmit = !!selectedId && contaBanco.trim() && !header.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    header.mutate(
      {
        banco_conta_contabil: contaBanco,
        hist_code_entrada: histEntrada,
        hist_code_saida: histSaida,
        lote_numero: lote,
        saldo_inicial: parseMoney(saldoInicial).toFixed(2),
        complemento_modo: modo,
        status: 'revisao',
      },
      { onSuccess: () => navigate(`/revisao/${selectedId}`) },
    );
  }

  const err = header.error;
  const errMsg = err instanceof ApiError ? err.message : err ? String(err) : null;

  return (
    <form onSubmit={submit} className="card animate-fade-up space-y-7 p-6 sm:p-7">
      <Secao numero={1} titulo="Cliente e extrato classificado">
        <div>
          <label className="label" htmlFor="puxar-cliente">
            Cliente
          </label>
          <select
            id="puxar-cliente"
            className="input"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setSelectedId('');
            }}
            disabled={loadingClients}
            required
          >
            <option value="">{loadingClients ? 'Carregando…' : 'Selecione o cliente…'}</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razao_social} — Domínio {c.dominio_code}
              </option>
            ))}
          </select>
        </div>

        {clientId && (
          <div>
            <p className="label">Extrato classificado</p>
            {loadingStmts ? (
              <Carregando />
            ) : !pendentes?.length ? (
              <div className="rounded-xl border border-dashed border-brand-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-500">
                Nenhum extrato pendente de puxar pra esse cliente.{' '}
                <Link to="/classificacao" className="link">
                  Classifique um extrato primeiro →
                </Link>
              </div>
            ) : (
              <ul className="grid gap-2" role="radiogroup" aria-label="Extrato classificado">
                {pendentes.map((s) => {
                  const totais = 'qtd' in s.totais ? s.totais : null;
                  const marcado = selectedId === s.id;
                  return (
                    <li key={s.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-all ${
                          marcado
                            ? 'border-brand-400 bg-brand-50/70 shadow-glow'
                            : 'border-brand-200 bg-white hover:border-brand-300 hover:bg-brand-50/40'
                        }`}
                      >
                        <input
                          type="radio"
                          name="statement"
                          checked={marcado}
                          onChange={() => setSelectedId(s.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800">{s.arquivo_nome}</span>
                          {s.period_start && s.period_end && (
                            <span className="block text-xs text-slate-500">
                              {formatDate(s.period_start)} a {formatDate(s.period_end)}
                            </span>
                          )}
                        </span>
                        <span className="chip chip-brand">{totais?.qtd ?? 0} lanç.</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Secao>

      {selectedId && (
        <>
          <div className="divider" />
          <Secao numero={2} titulo="Parâmetros do Domínio" descricao="Dá pra trocar depois, na tela de Revisão.">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor="puxar-conta">
                  Conta do banco
                </label>
                <input
                  id="puxar-conta"
                  className="input input-mono"
                  value={contaBanco}
                  onChange={(e) => setContaBanco(e.target.value)}
                  placeholder="ex: 10002"
                  required
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="label" htmlFor="puxar-lote">
                  Lote (Domínio)
                </label>
                <input
                  id="puxar-lote"
                  className="input input-mono"
                  type="number"
                  min={0}
                  value={lote}
                  onChange={(e) => setLote(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="label" htmlFor="puxar-he">
                  Hist. entrada
                </label>
                <input id="puxar-he" className="input input-mono" value={histEntrada} onChange={(e) => setHistEntrada(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="puxar-hs">
                  Hist. saída
                </label>
                <input id="puxar-hs" className="input input-mono" value={histSaida} onChange={(e) => setHistSaida(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="puxar-modo">
                Complemento no arquivo do Domínio
              </label>
              <select id="puxar-modo" className="input" value={modo} onChange={(e) => setModo(e.target.value as ComplementoModo)}>
                {MODO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="puxar-saldo">
                Saldo inicial da conta bancária
              </label>
              <div className="relative max-w-xs">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                  R$
                </span>
                <input
                  id="puxar-saldo"
                  className="input pl-10 tabular-nums"
                  inputMode="decimal"
                  value={saldoInicial}
                  onChange={(e) => setSaldoInicial(e.target.value)}
                  placeholder="0,00"
                />
              </div>
              {selected && (
                <p className="hint">
                  Cadastro do cliente: {formatMoney(Math.round(Number(selected.saldo_inicial ?? 0) * 100))}
                  {origemDoSaldo(selected) ? ` (${origemDoSaldo(selected)})` : ''}. Se o extrato começa com outro
                  saldo, digite aqui — vale o que estiver neste campo.
                </p>
              )}
            </div>
          </Secao>
        </>
      )}

      {errMsg && <p className="alert alert-error">{errMsg}</p>}

      <div className="flex justify-end">
        <button type="submit" className="btn-primary sm:min-w-[12rem]" disabled={!canSubmit}>
          {header.isPending && <Spinner />}
          {header.isPending ? 'Enviando…' : 'Ir para revisão'}
          {!header.isPending && <IconSetaDireita className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
