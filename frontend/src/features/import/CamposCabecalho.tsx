import { formatMoney } from '@/lib/format';
import { origemDoSaldo } from '@/features/clients/saldo';
import type { CabecalhoImportacao } from './useCabecalhoImportacao';

/** Campos do cabeçalho da importação: cliente, conta do banco, lote, históricos e saldo inicial. */
export function CamposCabecalho({ cab }: { cab: CabecalhoImportacao }) {
  const { selected } = cab;
  return (
    <>
      <div>
        <label className="label" htmlFor="cab-cliente">
          Cliente
        </label>
        <select
          id="cab-cliente"
          className="input"
          value={cab.clientId}
          onChange={(e) => cab.setClientId(e.target.value)}
          disabled={cab.loadingClients}
          required
        >
          <option value="">{cab.loadingClients ? 'Carregando…' : 'Selecione o cliente…'}</option>
          {cab.clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social} — Domínio {c.dominio_code}
            </option>
          ))}
        </select>
        {selected && !selected.banco_conta_contabil && (
          <p className="hint text-amber-700">Esse cliente ainda não tem conta do banco no cadastro — digite abaixo.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="cab-conta">
            Conta do banco
          </label>
          <input
            id="cab-conta"
            className="input input-mono"
            value={cab.contaBanco}
            onChange={(e) => cab.setContaBanco(e.target.value)}
            placeholder="ex: 10002"
            required
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="label" htmlFor="cab-lote">
            Lote (Domínio)
          </label>
          <input
            id="cab-lote"
            className="input input-mono"
            type="number"
            min={0}
            value={cab.lote}
            onChange={(e) => cab.setLote(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="cab-hist-e" title="Código de histórico padrão das entradas">
            Hist. entrada
          </label>
          <input
            id="cab-hist-e"
            className="input input-mono"
            inputMode="numeric"
            value={cab.histEntrada}
            onChange={(e) => cab.setHistEntrada(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="cab-hist-s" title="Código de histórico padrão das saídas">
            Hist. saída
          </label>
          <input
            id="cab-hist-s"
            className="input input-mono"
            inputMode="numeric"
            value={cab.histSaida}
            onChange={(e) => cab.setHistSaida(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="cab-saldo">
          Saldo inicial da conta bancária
        </label>
        <div className="relative max-w-xs">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
            R$
          </span>
          <input
            id="cab-saldo"
            className="input pl-10 tabular-nums"
            inputMode="decimal"
            value={cab.saldoInicial}
            onChange={(e) => cab.digitarSaldoInicial(e.target.value)}
            placeholder="0,00"
          />
        </div>
        <p className="hint">
          {selected
            ? `Cadastro do cliente: ${formatMoney(Math.round(Number(selected.saldo_inicial ?? 0) * 100))}${origemDoSaldo(selected) ? ` (${origemDoSaldo(selected)})` : ''}. Se o extrato começa com outro saldo, digite aqui — vale o que estiver neste campo.`
            : 'Vem do cadastro do cliente (o saldo final do último arquivo do Domínio gerado); digite outro se o extrato começar com saldo diferente.'}
        </p>
      </div>
    </>
  );
}

/** Nota embaixo do formulário: como entradas e saídas viram débito/crédito. */
export function NotaContaBanco({ cab }: { cab: CabecalhoImportacao }) {
  if (!cab.selected) return null;
  return (
    <p className="text-[13px]">
      Entradas serão lançadas a <b>débito</b> da conta{' '}
      <span className="rounded bg-white px-1 font-mono text-xs font-semibold text-brand-800 ring-1 ring-brand-200">
        {cab.contaBanco || '—'}
      </span>{' '}
      e crédito da conta que você classificar; saídas o contrário. Você ajusta tudo na próxima tela.
    </p>
  );
}
