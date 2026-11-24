import { Modal } from '@/components/Modal';
import { IconChevronDireita, IconEscudo, Spinner } from '@/components/icons';
import { formatMoney } from '@/lib/format';
import type { Statement } from '@/lib/types';
import { useAprovacoes } from './api';
import { dataHora, parteAprovada, plural, situacaoAprovacao } from './aprovacao';

/**
 * Aprovação das classificações pelo cliente (migrations 0026 e 0028): o aviso
 * da situação no topo da tela de classificação, a janela "Salvar e aprovar" e
 * o histórico das aprovações (cada parte que o cliente aprovou).
 */

/** Situação da aprovação do extrato — o escritório vê quem aprovou e quando; o cliente vê o que falta. */
export function AvisoAprovacao({ st, ehCliente }: { st: Statement; ehCliente: boolean }) {
  const situacao = situacaoAprovacao(st);
  const quem = st.aprovado_por_email ?? 'cliente';

  if (situacao === 'aprovado') {
    return (
      <p className="alert alert-success" role="status">
        {ehCliente ? (
          <>
            Você aprovou as classificações deste extrato em <b>{dataHora(st.aprovado_em!)}</b> ({quem}).
          </>
        ) : (
          <>
            <b>Aprovado pelo cliente</b> — {quem} em {dataHora(st.aprovado_em!)}
            {st.aprovado_qtd ? ` (${st.aprovado_qtd} lançamentos)` : ''}.
          </>
        )}
      </p>
    );
  }

  if (situacao === 'parcial') {
    return (
      <p className="alert alert-sky" role="status">
        {ehCliente ? (
          <>
            Você aprovou <b>{parteAprovada(st)} lançamentos</b> em {dataHora(st.aprovado_em!)}. Continue
            classificando e clique em <b>Salvar e aprovar</b> para aprovar a próxima parte.
          </>
        ) : (
          <>
            <b>Aprovação parcial do cliente</b> — {quem} aprovou {parteAprovada(st)} lançamentos em{' '}
            {dataHora(st.aprovado_em!)}.
          </>
        )}
      </p>
    );
  }

  if (situacao === 'alterado') {
    return (
      <p className="alert alert-warn" role="status">
        Aprovado por {quem} em {dataHora(st.aprovado_em!)}, mas{' '}
        <b>lançamentos já aprovados tiveram a classificação alterada</b> (em{' '}
        {dataHora(st.classificacao_alterada_em!)}).{' '}
        {ehCliente ? 'Confira e clique em "Salvar e aprovar" de novo.' : 'Aguardando nova aprovação do cliente.'}
      </p>
    );
  }

  if (!ehCliente)
    return (
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Ainda sem aprovação do cliente.
      </p>
    );
  return (
    <p className="alert alert-info">
      Classifique e confira os lançamentos e clique em <b>Salvar e aprovar</b>: ele salva e registra que você
      conferiu o que já está classificado. Dá pra aprovar em partes, ao longo do mês.
    </p>
  );
}

export function ModalAprovacao({
  open,
  st,
  qtd,
  novos,
  pendentes,
  email,
  busy,
  erro,
  avisoRetiradas = null,
  onAprovar,
  onCancelar,
}: {
  open: boolean;
  st: Statement;
  /** lançamentos classificados (contando o que ainda não foi salvo) — é o que vai ser aprovado */
  qtd: number;
  /** quantos entraram ou mudaram desde a última aprovação */
  novos: number;
  /** lançamentos ainda sem classificação (ficam pra próxima aprovação) */
  pendentes: number;
  email: string | null;
  busy: boolean;
  erro: string | null;
  /** pró-labore + distribuição de lucro passaram de R$ 50 mil no mês (retiradas.ts) */
  avisoRetiradas?: string | null;
  onAprovar: () => void;
  onCancelar: () => void;
}) {
  const fechar = busy ? () => {} : onCancelar;
  const periodo =
    st.period_start && st.period_end
      ? `${new Date(`${st.period_start}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${st.period_end}T12:00:00`).toLocaleDateString('pt-BR')}`
      : st.arquivo_nome;
  const parcial = pendentes > 0;
  const jaAprovou = !!st.aprovado_em;

  return (
    <Modal
      open={open}
      onClose={fechar}
      title={parcial ? 'Salvar e aprovar o que já foi classificado' : 'Salvar e aprovar as classificações do mês'}
      icone={
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-200">
          <IconEscudo className="h-5 w-5" />
        </span>
      }
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50/80 to-white px-4 py-3 leading-relaxed">
          Declaro que <b>conferi as classificações {parcial ? 'dos' : 'de todos os'} {plural(qtd, 'lançamento', 'lançamentos')}{' '}
          {parcial ? 'já classificados' : ''}</b> deste extrato
          {st.client?.razao_social ? ` de ${st.client.razao_social}` : ''} ({periodo}) e as aprovo.
        </p>
        {jaAprovou && novos > 0 && novos < qtd && (
          <p className="text-xs text-slate-600">
            Desde a sua última aprovação: {plural(novos, 'lançamento novo ou alterado', 'lançamentos novos ou alterados')}.
          </p>
        )}
        {parcial && (
          <p className="alert alert-sky">
            Ainda {pendentes === 1 ? 'falta 1 lançamento' : `faltam ${pendentes} lançamentos`} sem classificação.{' '}
            {pendentes === 1 ? 'Ele fica' : 'Eles ficam'} para a próxima aprovação — dá pra continuar depois.
          </p>
        )}
        {avisoRetiradas && <p className="alert alert-error">{avisoRetiradas}</p>}
        <p className="text-xs text-slate-500">
          As suas classificações são salvas e fica registrado o seu login{email ? ` (${email})` : ''}, a data, a hora
          e o IP. Se um lançamento que você aprovou for alterado depois, o extrato volta a aguardar a sua aprovação.
        </p>
        {erro && <p className="alert alert-error">{erro}</p>}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onCancelar} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={onAprovar} disabled={busy || qtd === 0}>
          {busy ? <Spinner /> : <IconEscudo className="h-4 w-4" />}
          {busy ? 'Salvando…' : 'Conferi, salvar e aprovar'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Histórico das aprovações do extrato: cada parte que o cliente aprovou, com
 * quem, quando, quantos, quantos novos e quantos ainda faltavam. O IP aparece
 * só pro escritório (o portal não devolve).
 */
export function HistoricoAprovacoes({ st, ehCliente }: { st: Statement; ehCliente: boolean }) {
  const { data: aprovacoes, isLoading, error } = useAprovacoes(st.id, !!st.aprovado_em);
  if (!st.aprovado_em) return null;

  return (
    <details className="card group px-5 py-3.5 text-sm" open={!ehCliente}>
      <summary className="card-title flex list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <IconChevronDireita className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
        {ehCliente ? 'Suas aprovações' : 'Aprovações do cliente'}
        {aprovacoes ? ` (${aprovacoes.length})` : ''}
      </summary>
      {isLoading && <p className="mt-2 text-xs text-slate-400">Carregando…</p>}
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {error instanceof Error ? error.message : 'Falha ao buscar as aprovações'}
        </p>
      )}
      {aprovacoes && aprovacoes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1">Quando</th>
                <th className="px-2 py-1">Quem</th>
                {!ehCliente && <th className="px-2 py-1">IP</th>}
                <th className="px-2 py-1 text-right">Aprovados</th>
                <th className="px-2 py-1 text-right">Novos nesta parte</th>
                <th className="px-2 py-1 text-right">Faltavam</th>
                <th className="px-2 py-1 text-right">Entradas</th>
                <th className="px-2 py-1 text-right">Saídas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {aprovacoes.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap px-2 py-1">{dataHora(a.aprovado_em)}</td>
                  <td className="px-2 py-1">{a.email}</td>
                  {!ehCliente && <td className="whitespace-nowrap px-2 py-1 font-mono">{a.ip ?? '—'}</td>}
                  <td className="px-2 py-1 text-right tabular-nums">{a.qtd}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{a.novos ?? '—'}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {a.pendentes > 0 ? (
                      <span className="text-sky-800">{a.pendentes}</span>
                    ) : (
                      <span className="text-green-700">0 (tudo)</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {formatMoney(Math.round(Number(a.entradas) * 100))}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {formatMoney(Math.round(Number(a.saidas) * 100))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-400">
            Entradas e saídas = soma dos lançamentos aprovados naquela vez.
          </p>
        </div>
      )}
    </details>
  );
}
