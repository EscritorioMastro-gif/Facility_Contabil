import { Modal } from '@/components/Modal';
import type { Statement } from '@/lib/types';
import { dataHora, situacaoAprovacao } from './aprovacao';

/**
 * Aprovação das classificações pelo cliente (migration 0026): o aviso da
 * situação no topo da tela de classificação e a janela em que o cliente
 * declara que conferiu e aprova o mês.
 */

/** Situação da aprovação do extrato — o escritório vê quem aprovou e quando; o cliente vê o que falta. */
export function AvisoAprovacao({ st, ehCliente, podeAprovar }: { st: Statement; ehCliente: boolean; podeAprovar: boolean }) {
  const situacao = situacaoAprovacao(st);
  const quem = st.aprovado_por_email ?? 'cliente';

  if (situacao === 'aprovado') {
    return (
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
        ✓{' '}
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

  if (situacao === 'alterado') {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
        Aprovado por {quem} em {dataHora(st.aprovado_em!)}, mas{' '}
        <b>classificações foram alteradas depois</b> (em {dataHora(st.classificacao_alterada_em!)}).{' '}
        {ehCliente ? 'Confira e aprove de novo.' : 'Aguardando nova aprovação do cliente.'}
      </p>
    );
  }

  if (!ehCliente) return <p className="text-xs text-slate-500">Ainda sem aprovação do cliente.</p>;
  return (
    <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
      {podeAprovar
        ? 'Tudo classificado. Confira e clique em "Aprovar" — fica registrado que você conferiu.'
        : 'Classifique e confira os lançamentos e clique em "Aprovar" — ele salva o que você classificou. Com tudo classificado, fica registrado que você conferiu e aprovou o mês.'}
    </p>
  );
}

export function ModalAprovacao({
  open,
  st,
  qtd,
  pendentes,
  email,
  temAlteracoes,
  busy,
  erro,
  onSalvar,
  onAprovar,
  onCancelar,
}: {
  open: boolean;
  st: Statement;
  qtd: number;
  /** lançamentos ainda sem classificação (contando o que não foi salvo) */
  pendentes: number;
  email: string | null;
  /** há alterações não salvas: aprovar salva antes */
  temAlteracoes: boolean;
  busy: boolean;
  erro: string | null;
  /** com pendentes: grava o que já foi classificado, sem aprovar */
  onSalvar: () => void;
  onAprovar: () => void;
  /** fecha a janela (com pendentes = continuar a classificação) */
  onCancelar: () => void;
}) {
  const fechar = busy ? () => {} : onCancelar;

  // ainda falta classificar: salva o que já tem ou volta pra classificar
  if (pendentes > 0) {
    const falta = pendentes === 1 ? 'Falta 1 lançamento' : `Faltam ${pendentes} lançamentos`;
    return (
      <Modal open={open} onClose={fechar} title="Ainda há lançamentos sem classificação">
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <b>{falta} para classificar.</b>{' '}
            {temAlteracoes ? 'Deseja salvar o que já classificou ou continuar a classificação?' : ''}
          </p>
          <p className="text-xs text-slate-500">
            Para aprovar o mês, todos os lançamentos precisam estar classificados. O que você salvar agora fica
            guardado, e dá pra continuar depois.
          </p>
          {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className={temAlteracoes ? 'btn-ghost' : 'btn-primary'} onClick={onCancelar} disabled={busy}>
            Continuar a classificação
          </button>
          {temAlteracoes && (
            <button className="btn-primary" onClick={onSalvar} disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </Modal>
    );
  }

  const periodo =
    st.period_start && st.period_end
      ? `${new Date(`${st.period_start}T12:00:00`).toLocaleDateString('pt-BR')} a ${new Date(`${st.period_end}T12:00:00`).toLocaleDateString('pt-BR')}`
      : st.arquivo_nome;
  return (
    <Modal open={open} onClose={fechar} title="Aprovar as classificações do mês">
      <div className="space-y-3 text-sm text-slate-700">
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          Declaro que <b>conferi as classificações dos {qtd} lançamentos</b> deste extrato
          {st.client?.razao_social ? ` de ${st.client.razao_social}` : ''} ({periodo}) e as aprovo.
        </p>
        <p className="text-xs text-slate-500">
          {temAlteracoes ? 'As suas classificações são salvas e fica' : 'Fica'} registrado o seu login
          {email ? ` (${email})` : ''}, a data e a hora. Se alguma classificação for alterada depois, o extrato volta
          a aguardar a sua aprovação.
        </p>
        {erro && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onCancelar} disabled={busy}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={onAprovar} disabled={busy}>
          {busy ? 'Aprovando…' : 'Conferi e aprovo'}
        </button>
      </div>
    </Modal>
  );
}
