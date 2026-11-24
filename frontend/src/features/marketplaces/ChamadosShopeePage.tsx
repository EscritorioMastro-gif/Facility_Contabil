import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CarregandoLinhas, ErroCarregar, PageHeader, Vazio } from '@/components/ui';
import { IconDownload, IconLixeira, IconSacola } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import {
  buscarPedidosDoChamado,
  useAlterarChamado,
  useChamadosShopee,
  useConferenciaShopee,
  useExcluirChamado,
  usePedidoDoChamado,
  type Chamado,
} from './api';
import { baixarArquivo, dataCurta, nomeDoArquivo, planilhaDoLote, reais, SITUACAO, tarifaAMais } from './formato';

const SITUACAO_CHAMADO: Record<Chamado['situacao'], { texto: string; cls: string }> = {
  aberto: { texto: 'aberto', cls: 'chip-amber' },
  concluido: { texto: 'todos pagos/resolvidos', cls: 'chip-green' },
  resolvido: { texto: 'resolvido', cls: 'chip-green' },
};

const erroDe = (e: unknown, padrao: string) => (e instanceof ApiError ? e.message : e ? padrao : null);

/**
 * Chamados abertos na Shopee (em lote): cada um com os pedidos dele. Aqui se
 * informa o nº depois, baixa a planilha do lote de novo, resolve o lote ou um
 * pedido, tira um pedido do chamado ou exclui o chamado (os pedidos ficam livres).
 */
export function ChamadosShopeePage() {
  const { data: clients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  useEffect(() => {
    if (!clientId && clients?.length === 1) setClientId(clients[0]!.id);
  }, [clients, clientId]);
  const { data: chamados, isLoading, error } = useChamadosShopee(clientId);
  const [aberto, setAberto] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<Chamado | null>(null);
  const alterar = useAlterarChamado();
  const excluir = useExcluirChamado();
  const empresa = clients?.find((c) => c.id === clientId)?.razao_social ?? 'empresa';
  const [baixando, setBaixando] = useState<string | null>(null);

  async function baixar(c: Chamado) {
    setBaixando(c.id);
    try {
      const { pedidos } = await buscarPedidosDoChamado(clientId, c.id);
      baixarArquivo(nomeDoArquivo(empresa, c), planilhaDoLote(pedidos, c));
    } finally {
      setBaixando(null);
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Chamados Shopee"
        descricao="Os chamados abertos na Shopee e os pedidos de cada um. Cada pedido entra em um chamado só."
        acoes={
          <Link to="/marketplaces/shopee" className="btn-ghost">
            Conferência Shopee
          </Link>
        }
      />

      <label className="flex flex-col">
        <span className="mb-1 text-xs text-slate-500">Empresa</span>
        <select className="input max-w-md" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">— escolha a empresa —</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social}
            </option>
          ))}
        </select>
      </label>

      {erroDe(alterar.error, 'Falha ao alterar o chamado') && <p className="alert alert-error">{erroDe(alterar.error, 'Falha ao alterar o chamado')}</p>}

      {!clientId ? (
        <div className="card">
          <Vazio icone={<IconSacola className="h-6 w-6" />} titulo="Escolha a empresa para ver os chamados" />
        </div>
      ) : isLoading ? (
        <div className="card">
          <CarregandoLinhas />
        </div>
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : !chamados?.length ? (
        <div className="card">
          <Vazio
            icone={<IconSacola className="h-6 w-6" />}
            titulo="Nenhum chamado aberto ainda"
            texto="Na Conferência Shopee, selecione os pedidos não pagos ou cobrados a mais e clique em Abrir chamado."
          />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nº do chamado</th>
                <th className="px-3 py-2">Aberto em</th>
                <th className="px-3 py-2 text-right">Pedidos</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Situação</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {chamados.map((c) => (
                <LinhaChamado
                  key={c.id}
                  c={c}
                  clientId={clientId}
                  expandido={aberto === c.id}
                  baixando={baixando === c.id}
                  ocupado={alterar.isPending}
                  onExpandir={() => setAberto((a) => (a === c.id ? null : c.id))}
                  onNumero={(numero) => alterar.mutate({ id: c.id, numero })}
                  onLote={(acao) => alterar.mutate({ id: c.id, acao })}
                  onBaixar={() => baixar(c)}
                  onExcluir={() => {
                    excluir.reset();
                    setExcluindo(c);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!excluindo}
        title="Excluir o chamado"
        message={`Excluir o chamado ${excluindo?.numero ? `nº ${excluindo.numero}` : `de ${dataCurta(excluindo?.aberto_em)}`}? Os ${excluindo?.pedidos ?? 0} pedido(s) dele ficam livres para entrar em outro chamado.`}
        confirmLabel="Excluir chamado"
        busy={excluir.isPending}
        error={erroDe(excluir.error, 'Falha ao excluir')}
        onConfirm={() => excluindo && excluir.mutate(excluindo.id, { onSuccess: () => setExcluindo(null) })}
        onCancel={() => setExcluindo(null)}
      />
    </section>
  );
}

function LinhaChamado({
  c,
  clientId,
  expandido,
  baixando,
  ocupado,
  onExpandir,
  onNumero,
  onLote,
  onBaixar,
  onExcluir,
}: {
  c: Chamado;
  clientId: string;
  expandido: boolean;
  baixando: boolean;
  ocupado: boolean;
  onExpandir: () => void;
  onNumero: (numero: string | null) => void;
  onLote: (acao: 'resolver' | 'reabrir') => void;
  onBaixar: () => void;
  onExcluir: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [numero, setNumero] = useState(c.numero ?? '');
  const s = SITUACAO_CHAMADO[c.situacao];
  return (
    <>
      <tr className={expandido ? 'bg-slate-50/70' : ''}>
        <td className="whitespace-nowrap px-3 py-2">
          {editando ? (
            <span className="flex items-center gap-1.5">
              <input className="input h-8 w-36" value={numero} autoFocus aria-label="Nº do chamado" onChange={(e) => setNumero(e.target.value)} />
              <button
                className="btn-primary btn-sm"
                disabled={ocupado}
                onClick={() => {
                  onNumero(numero.trim() || null);
                  setEditando(false);
                }}
              >
                salvar
              </button>
              <button className="btn-quiet btn-sm" onClick={() => setEditando(false)}>
                cancelar
              </button>
            </span>
          ) : c.numero ? (
            <button className="font-mono text-slate-800 hover:underline" title="Corrigir o nº" onClick={() => setEditando(true)}>
              {c.numero}
            </button>
          ) : (
            <button className="link text-xs" onClick={() => setEditando(true)}>
              informar o nº
            </button>
          )}
          {c.obs && <div className="text-[11px] text-slate-400">{c.obs}</div>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">
          {dataCurta(c.aberto_em)}
          <div className="text-[11px] text-slate-400">{c.aberto_por_email}</div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
          {c.pedidos}
          <div className="text-[11px] text-slate-400">
            {c.pagos} pago(s) · {c.resolvidos} resolvido(s)
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{reais(c.valor)}</td>
        <td className="whitespace-nowrap px-3 py-2">
          <span className={`chip ${s.cls}`}>{s.texto}</span>
          {c.resolvido_em && <div className="text-[11px] text-slate-400">em {dataCurta(c.resolvido_em)}</div>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <span className="inline-flex items-center gap-3 text-xs">
            <button className="link" onClick={onExpandir}>
              {expandido ? 'esconder pedidos' : 'ver pedidos'}
            </button>
            <button className="link" disabled={baixando} onClick={onBaixar} title="Baixar a planilha do lote de novo">
              <IconDownload className="h-3.5 w-3.5" />
              {baixando ? 'baixando…' : 'planilha'}
            </button>
            {c.resolvido_em ? (
              <button className="link" disabled={ocupado} onClick={() => onLote('reabrir')}>
                reabrir
              </button>
            ) : (
              <button className="link" disabled={ocupado} onClick={() => onLote('resolver')}>
                lote resolvido
              </button>
            )}
            <button className="link-danger" title="Excluir o chamado" aria-label="Excluir o chamado" onClick={onExcluir}>
              <IconLixeira className="h-4 w-4" />
            </button>
          </span>
        </td>
      </tr>
      {expandido && (
        <tr>
          <td colSpan={6} className="bg-slate-50/70 px-3 pb-3">
            <PedidosDoChamado clientId={clientId} chamadoId={c.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function PedidosDoChamado({ clientId, chamadoId }: { clientId: string; chamadoId: string }) {
  const { data, isLoading, error } = useConferenciaShopee(clientId, { escopo: 'chamado', chamado_id: chamadoId });
  const mudar = usePedidoDoChamado();
  if (isLoading) return <CarregandoLinhas linhas={2} />;
  if (error) return <ErroCarregar erro={error} />;
  if (!data?.pedidos.length) return <p className="p-3 text-xs text-slate-400">Nenhum pedido neste chamado.</p>;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {erroDe(mudar.error, 'Falha ao alterar o pedido') && (
        <p className="alert alert-error m-2">{erroDe(mudar.error, 'Falha ao alterar o pedido')}</p>
      )}
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase text-slate-500">
          <tr>
            <th className="px-3 py-1.5">Pedido</th>
            <th className="px-3 py-1.5">Data</th>
            <th className="px-3 py-1.5 text-right">Valor</th>
            <th className="px-3 py-1.5">Motivo</th>
            <th className="px-3 py-1.5">Hoje</th>
            <th className="px-3 py-1.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.pedidos.map((p) => {
            const s = SITUACAO[p.pagamento];
            return (
              <tr key={p.pedido}>
                <td className="px-3 py-1.5 font-mono">{p.pedido}</td>
                <td className="px-3 py-1.5">{dataCurta(p.criado_em)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{reais(p.valor_produtos)}</td>
                <td className="px-3 py-1.5">{tarifaAMais(p) ? 'tarifa cobrada a mais' : 'enviado e não pago'}</td>
                <td className="px-3 py-1.5">
                  <span className={`chip ${s.cls}`}>{s.texto}</span>
                  {p.chamado_resolvido_em && <span className="chip chip-green ml-1">resolvido {dataCurta(p.chamado_resolvido_em)}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <span className="inline-flex gap-3">
                    {p.chamado_resolvido_em ? (
                      <button className="link" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: chamadoId, pedido: p.pedido, acao: 'reabrir' })}>
                        reabrir
                      </button>
                    ) : (
                      <button className="link" disabled={mudar.isPending} onClick={() => mudar.mutate({ id: chamadoId, pedido: p.pedido, acao: 'resolver' })}>
                        resolvido
                      </button>
                    )}
                    <button
                      className="link-danger"
                      disabled={mudar.isPending}
                      title="Tirar do chamado (o pedido fica livre para outro chamado)"
                      onClick={() => mudar.mutate({ id: chamadoId, pedido: p.pedido, acao: 'tirar' })}
                    >
                      tirar
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
