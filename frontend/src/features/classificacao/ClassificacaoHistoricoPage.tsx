import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconHistorico, IconLixeira, IconMais, IconSetaDireita, IconX } from '@/components/icons';
import { CarregandoLinhas, ErroCarregar, PageHeader, Vazio } from '@/components/ui';
import { Paginacao, useItensPorPagina } from '@/components/Paginacao';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/auth/useAuth';
import { formatDate } from '@/lib/format';
import type { Statement, StatementStatus } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { useDeleteStatement, useStatementsPaginados } from '@/features/statements/api';
import { dataHora, parteAprovada, situacaoAprovacao } from './aprovacao';

const STATUS_LABEL: Partial<Record<StatementStatus, { text: string; cls: string }>> = {
  parsing: { text: 'lendo', cls: 'chip-slate' },
  classificacao: { text: 'classificando', cls: 'chip-brand' },
  revisao: { text: 'puxado p/ importação', cls: 'chip-amber' },
  gerado: { text: 'arquivo gerado', cls: 'chip-green' },
  erro: { text: 'erro', cls: 'chip-red' },
};

export function ClassificacaoHistoricoPage() {
  const { data: clients } = useClients({ ativo: 'all' });
  const { ehCliente } = useAuth();
  const [clientId, setClientId] = useState('');
  // todos os extratos ficam no histórico, página a página (sem teto de quantos aparecem)
  const [porPagina, setPorPagina] = useItensPorPagina('historico-classificacao');
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [clientId, porPagina]);
  const { data, isLoading, error } = useStatementsPaginados(
    { client_id: clientId || undefined, origem_modulo: 'classificacao' },
    pagina,
    porPagina,
  );
  const statements = data?.statements;
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  useEffect(() => {
    if (data && pagina > paginas) setPagina(paginas);
  }, [data, pagina, paginas]);

  const delMut = useDeleteStatement();
  const [deleting, setDeleting] = useState<Statement | null>(null);

  const shown = statements ?? [];

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Histórico da classificação"
        descricao="Todos os extratos enviados para classificar, com a situação e a aprovação do cliente."
        acoes={
          <Link to="/classificacao" className="btn-primary">
            <IconMais className="h-4 w-4" />
            Classificar extrato
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" aria-label="Filtrar por cliente" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social}
            </option>
          ))}
        </select>
        {clientId && (
          <button className="btn-quiet btn-sm" onClick={() => setClientId('')}>
            <IconX className="h-3.5 w-3.5" />
            limpar filtro
          </button>
        )}
      </div>

      <Paginacao
        pagina={pagina}
        paginas={paginas}
        porPagina={porPagina}
        total={total}
        onPagina={setPagina}
        onPorPagina={setPorPagina}
        rotulo="extratos"
      />

      <div className="card overflow-x-auto">
        {isLoading ? (
          <CarregandoLinhas />
        ) : error ? (
          <ErroCarregar erro={error} className="m-5" />
        ) : !shown.length ? (
          <Vazio
            icone={<IconHistorico className="h-6 w-6" />}
            titulo={clientId ? 'Nenhum extrato com esse filtro' : 'Nenhum extrato classificado ainda'}
            acao={
              !clientId && (
                <Link to="/classificacao" className="btn-primary">
                  Classificar o primeiro extrato
                </Link>
              )
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Arquivo</th>
                <th className="px-4 py-2">Período</th>
                <th className="px-4 py-2 text-right">Lanç.</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Aprovação do cliente</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s: Statement) => {
                const enviado = ehCliente && (s.status === 'revisao' || s.status === 'gerado');
                const st = enviado
                  ? { text: 'enviado à contabilidade', cls: 'chip-green' }
                  : (STATUS_LABEL[s.status] ?? { text: s.status, cls: 'chip-slate' });
                const totais = 'qtd' in s.totais ? s.totais : null;
                // login de cliente sempre abre pela Classificação (a Revisão da Importação é do escritório)
                const destino =
                  s.status === 'classificacao' || ehCliente ? `/classificacao/revisao/${s.id}` : `/revisao/${s.id}`;
                const podeExcluir = !ehCliente || s.status === 'classificacao' || s.status === 'erro';
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{s.client?.razao_social ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.arquivo_nome}
                      <span className="ml-1.5 font-mono text-[10px] font-semibold text-slate-400">{s.formato.toUpperCase()}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start)}–${formatDate(s.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{totais?.qtd ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`chip chip-dot ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <SeloAprovacao s={s} ehCliente={ehCliente} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {s.status !== 'parsing' && (
                        <Link to={destino} className="link">
                          {s.status === 'classificacao' ? 'classificar' : 'abrir'}
                          <IconSetaDireita className="h-3.5 w-3.5" />
                        </Link>
                      )}
                      {podeExcluir && (
                        <button className="link-danger ml-4" onClick={() => setDeleting(s)} title="Excluir extrato" aria-label={`Excluir ${s.arquivo_nome}`}>
                          <IconLixeira className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Paginacao
        pagina={pagina}
        paginas={paginas}
        porPagina={porPagina}
        total={total}
        onPagina={setPagina}
        onPorPagina={setPorPagina}
        rotulo="extratos"
      />

      <ConfirmDialog
        open={!!deleting}
        title="Excluir extrato"
        message={`Excluir o extrato "${deleting?.arquivo_nome}"? Os lançamentos e classificações serão apagados.`}
        busy={delMut.isPending}
        error={
          delMut.isError ? (delMut.error instanceof ApiError ? delMut.error.message : 'Falha ao excluir') : null
        }
        onConfirm={() => deleting && delMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onCancel={() => {
          setDeleting(null);
          delMut.reset();
        }}
      />
    </section>
  );
}

function SeloAprovacao({ s, ehCliente }: { s: Statement; ehCliente: boolean }) {
  if (s.status === 'parsing' || s.status === 'erro') return <span className="text-slate-300">—</span>;
  const situacao = situacaoAprovacao(s);
  if (situacao === 'aprovado') {
    return (
      <span
        className="chip chip-green"
        title={`Aprovado por ${s.aprovado_por_email ?? 'cliente'} em ${dataHora(s.aprovado_em!)}`}
      >
        ✓ aprovado {new Date(s.aprovado_em!).toLocaleDateString('pt-BR')}
      </span>
    );
  }
  if (situacao === 'parcial') {
    return (
      <span
        className="chip chip-sky"
        title={`Aprovação parcial: ${s.aprovado_por_email ?? 'cliente'} aprovou ${parteAprovada(s)} lançamentos em ${dataHora(s.aprovado_em!)}`}
      >
        parcial {parteAprovada(s).replace(' de ', '/')} · {new Date(s.aprovado_em!).toLocaleDateString('pt-BR')}
      </span>
    );
  }
  if (situacao === 'alterado') {
    return (
      <span
        className="chip chip-amber"
        title={`Aprovado por ${s.aprovado_por_email ?? 'cliente'} em ${dataHora(s.aprovado_em!)}; classificações alteradas em ${dataHora(s.classificacao_alterada_em!)}`}
      >
        alterado após aprovação
      </span>
    );
  }
  return <span className="text-xs text-slate-400">{ehCliente ? 'falta aprovar' : 'aguardando'}</span>;
}
