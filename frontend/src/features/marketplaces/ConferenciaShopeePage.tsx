import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { Modal } from '@/components/Modal';
import { CarregandoLinhas, ErroCarregar, Metrica, PageHeader, Segmented, Vazio } from '@/components/ui';
import { IconSacola } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import {
  useAbrirChamado,
  useConferenciaShopee,
  useImportacoesShopee,
  useImportarShopee,
  type Escopo,
  type Importado,
  type ParteTarifa,
  type PedidoConferido,
  type TipoRelatorio,
} from './api';
import {
  baixarArquivo,
  dataCurta,
  devolucaoComProblema,
  hojeEmSaoPaulo,
  mesAnterior,
  nomeDoArquivo,
  planilhaDoLote,
  precisaDeChamado,
  reais,
  rotuloChamado,
  SITUACAO,
  tarifaAMais,
} from './formato';

type Filtro = 'todos' | 'nao_pago' | 'tarifa' | 'devolucao' | 'frete' | 'aguardando' | 'pago' | 'outros';

const TIPO: Record<TipoRelatorio, string> = { pedidos: 'Pedidos', renda: 'Minha renda', carteira: 'Carteira' };

const filtrar = (p: PedidoConferido, f: Filtro) =>
  f === 'todos'
    ? true
    : f === 'tarifa'
      ? tarifaAMais(p)
      : f === 'devolucao'
        ? !!p.devolucao || !!p.perdido
        : f === 'frete'
          ? !!p.frete_a_mais
          : f === 'outros'
            ? ['em_andamento', 'cancelado', 'devolvido'].includes(p.pagamento)
            : p.pagamento === f;

/**
 * Conferência de pedidos da Shopee: pedido enviado e não pago (concluído há 7
 * dias sem pagamento), comissão e taxas cobradas a mais pela tabela do
 * cliente, débito de devolução maior que o recebido, pacote perdido sem
 * compensação e frete a mais por peso. Os problemas viram chamado EM LOTE:
 * seleciona, informa a data (e o nº, se já tiver) e baixa a planilha só desses
 * pedidos. Cada pedido entra em um chamado só.
 */
export function ConferenciaShopeePage() {
  const { ehCliente } = useAuth();
  const { data: clients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  useEffect(() => {
    if (!clientId && clients?.length === 1) setClientId(clients[0]!.id);
  }, [clients, clientId]);
  const [modo, setModo] = useState<'mes' | 'pendentes'>('mes');
  const [mes, setMes] = useState(mesAnterior());
  const escopo: Escopo = modo === 'mes' ? { escopo: 'mes', mes } : { escopo: 'pendentes' };
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const { data, isLoading, error } = useConferenciaShopee(clientId, escopo);
  const { data: importacoes } = useImportacoesShopee(clientId);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [abrindo, setAbrindo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [extrato, setExtrato] = useState<PedidoConferido | null>(null);
  useEffect(() => setSelecionados(new Set()), [clientId, modo, mes]);

  const pedidos = useMemo(() => data?.pedidos ?? [], [data]);
  const conta = useMemo(() => {
    const n = (f: Filtro) => pedidos.filter((p) => filtrar(p, f)).length;
    return { todos: pedidos.length, nao_pago: n('nao_pago'), tarifa: n('tarifa'), devolucao: n('devolucao'), frete: n('frete'), aguardando: n('aguardando'), pago: n('pago'), outros: n('outros') };
  }, [pedidos]);
  const lista = useMemo(() => pedidos.filter((p) => filtrar(p, filtro)), [pedidos, filtro]);
  // só dá pra selecionar o que está livre (cada pedido entra em um chamado só)
  const livres = lista.filter((p) => !p.chamado_info);
  const todosMarcados = livres.length > 0 && livres.every((p) => selecionados.has(p.pedido));
  const escolhidos = pedidos.filter((p) => selecionados.has(p.pedido));
  const empresa = clients?.find((c) => c.id === clientId);
  const r = data?.resumo;

  const alternar = (pedido: string) =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (n.has(pedido)) n.delete(pedido);
      else n.add(pedido);
      return n;
    });
  const alternarTodos = () =>
    setSelecionados((s) => {
      const n = new Set(s);
      if (todosMarcados) livres.forEach((p) => n.delete(p.pedido));
      else livres.forEach((p) => n.add(p.pedido));
      return n;
    });

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Conferência Shopee"
        descricao="Pedidos enviados e não pagos, comissão e taxas cobradas a mais, devoluções e frete a mais — pelos relatórios da Central do Vendedor e a tabela de tarifas do cliente."
        acoes={
          <>
            <button className="btn-primary" disabled={!clientId} onClick={() => setImportando(true)}>
              Importar relatórios
            </button>
            <Link to="/classificacao/shopee/custos" className="btn-ghost">
              Custos
            </Link>
            <Link to="/classificacao/shopee/chamados" className="btn-ghost">
              Chamados
            </Link>
            <Link to="/classificacao/shopee/tarifas" className="btn-ghost">
              Tabela de tarifas
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Empresa</span>
          <select className="input min-w-64" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— escolha a empresa —</option>
            {clients?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.razao_social}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Pedidos</span>
          <Segmented
            label="Quais pedidos"
            value={modo}
            onChange={setModo}
            options={[
              { value: 'mes', label: 'Do mês' },
              { value: 'pendentes', label: 'Pendentes sem chamado', title: 'O que precisa de chamado nos últimos 180 dias e ainda não entrou em nenhum' },
            ]}
          />
        </div>
        {modo === 'mes' && (
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-slate-500">Mês dos pedidos</span>
            <input className="input w-44" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>
        )}
        {importacoes?.loja && (
          <span className="chip chip-slate mb-1.5" title="A loja da Shopee ligada a esta empresa — relatório de outra loja é recusado">
            loja {importacoes.loja}
          </span>
        )}
      </div>

      {clientId && importacoes && <RelatoriosImportados itens={importacoes.importacoes} />}

      {!clientId ? (
        <div className="card">
          <Vazio icone={<IconSacola className="h-6 w-6" />} titulo="Escolha a empresa para conferir os pedidos da Shopee" />
        </div>
      ) : isLoading ? (
        <div className="card">
          <CarregandoLinhas />
        </div>
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : data ? (
        <>
          {data.tabela.preenchida ? (
            <p className="text-xs text-slate-500">
              Tabela de tarifas preenchida por {data.tabela.por_email} em {dataCurta(data.tabela.em)}.
            </p>
          ) : (
            <p className="alert alert-warn">
              {ehCliente ? (
                <>
                  Preencha a sua <Link to="/classificacao/shopee/tarifas" className="link">tabela de tarifas</Link> para conferir a
                  comissão e as taxas cobradas pela Shopee.
                </>
              ) : (
                'O cliente ainda não preencheu a tabela de tarifas — a comissão e as taxas não são conferidas.'
              )}
            </p>
          )}

          {!pedidos.length ? (
            <div className="card">
              <Vazio
                icone={<IconSacola className="h-6 w-6" />}
                titulo={modo === 'pendentes' ? 'Nada pendente sem chamado' : 'Nenhum pedido da Shopee neste mês'}
                texto={
                  modo === 'pendentes'
                    ? 'Tudo o que precisava de chamado nos últimos 180 dias já está em algum chamado.'
                    : 'Importe os relatórios da Central do Vendedor: pedidos, Minha renda e as transações da carteira.'
                }
              />
            </div>
          ) : (
            <>
              {r && (
                <div className="card grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-5">
                  <Metrica rotulo="Pedidos" valor={r.pedidos} />
                  <Metrica rotulo="Pagos" valor={r.por_pagamento.pago} tom="green" detalhe={`recebido ${reais(r.recebido)}`} />
                  <Metrica rotulo="Aguardando" valor={r.por_pagamento.aguardando} tom="brand" detalhe="menos de 7 dias" />
                  <Metrica
                    rotulo="Enviados e não pagos"
                    valor={r.por_pagamento.nao_pago}
                    tom={r.por_pagamento.nao_pago ? 'red' : 'slate'}
                    detalhe={reais(r.nao_pago_valor)}
                  />
                  <Metrica rotulo="Cancelados / devolvidos" valor={r.por_pagamento.cancelado + r.por_pagamento.devolvido} />
                  <Metrica
                    rotulo="Comissão a mais"
                    valor={reais(r.comissao_a_mais.valor)}
                    tom={r.comissao_a_mais.pedidos ? 'red' : 'slate'}
                    detalhe={`${r.comissao_a_mais.pedidos} pedido(s)`}
                  />
                  <Metrica
                    rotulo="Taxas a mais"
                    valor={reais(r.taxas_a_mais.valor)}
                    tom={r.taxas_a_mais.pedidos ? 'red' : 'slate'}
                    detalhe={`${r.taxas_a_mais.pedidos} pedido(s)`}
                  />
                  <Metrica
                    rotulo="Devoluções"
                    valor={r.devolucoes.pedidos}
                    tom={r.devolucoes.debitado_a_mais.pedidos || r.devolucoes.sem_solicitacao ? 'red' : 'slate'}
                    detalhe={
                      r.devolucoes.debitado_a_mais.pedidos
                        ? `${reais(r.devolucoes.debitado_a_mais.valor)} debitado a mais`
                        : r.devolucoes.sem_solicitacao
                          ? `${r.devolucoes.sem_solicitacao} débito(s) sem solicitação`
                          : 'débitos conferidos'
                    }
                  />
                  <Metrica
                    rotulo="Frete a mais (peso)"
                    valor={reais(r.frete_a_mais.valor)}
                    tom={r.frete_a_mais.pedidos ? 'amber' : 'slate'}
                    detalhe={`${r.frete_a_mais.pedidos} pedido(s)`}
                  />
                  <Metrica
                    rotulo="Sem tabela"
                    valor={r.tarifa_sem_tabela}
                    tom={r.tarifa_sem_tabela ? 'amber' : 'slate'}
                    detalhe="pagos sem faixa na tabela"
                  />
                </div>
              )}

              <Segmented
                label="Filtrar pedidos"
                value={filtro}
                onChange={setFiltro}
                options={[
                  { value: 'todos', label: 'Todos', count: conta.todos },
                  { value: 'nao_pago', label: 'Não pagos', count: conta.nao_pago },
                  { value: 'tarifa', label: 'Cobrado a mais', count: conta.tarifa },
                  { value: 'devolucao', label: 'Devoluções', count: conta.devolucao },
                  { value: 'frete', label: 'Frete a mais', count: conta.frete },
                  { value: 'aguardando', label: 'Aguardando', count: conta.aguardando },
                  { value: 'pago', label: 'Pagos', count: conta.pago },
                  { value: 'outros', label: 'Outros', count: conta.outros },
                ]}
              />

              {selecionados.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 text-sm">
                  <span className="text-brand-900">
                    <b>{selecionados.size}</b> pedido(s) selecionado(s) ·{' '}
                    {reais(escolhidos.reduce((s, p) => s + (p.valor_produtos ?? 0), 0))}
                    {escolhidos.some((p) => !precisaDeChamado(p)) && (
                      <span className="ml-2 text-xs text-amber-800">(há pedido sem problema na seleção)</span>
                    )}
                  </span>
                  <span className="flex gap-2">
                    <button className="btn-quiet btn-sm" onClick={() => setSelecionados(new Set())}>
                      limpar seleção
                    </button>
                    <button className="btn-primary btn-sm" onClick={() => setAbrindo(true)}>
                      Abrir chamado com {selecionados.size} pedido(s)
                    </button>
                  </span>
                </div>
              )}

              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos os pedidos livres deste filtro"
                          title="Selecionar todos os pedidos deste filtro que ainda não estão em chamado"
                          checked={todosMarcados}
                          disabled={!livres.length}
                          onChange={alternarTodos}
                        />
                      </th>
                      <th className="px-3 py-2">Pedido</th>
                      <th className="px-3 py-2">Data</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2">Pagamento</th>
                      <th className="px-3 py-2 text-right">Recebido</th>
                      <th className="px-3 py-2 text-right">Comissão</th>
                      <th className="px-3 py-2 text-right" title="Transação + Campanha de Destaque + por item + por pedido">
                        Taxas
                      </th>
                      <th className="px-3 py-2">Avisos</th>
                      <th className="px-3 py-2">Chamado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lista.map((p) => (
                      <LinhaPedido
                        key={p.pedido}
                        p={p}
                        marcado={selecionados.has(p.pedido)}
                        onMarcar={() => alternar(p.pedido)}
                        onExtrato={() => setExtrato(p)}
                      />
                    ))}
                  </tbody>
                </table>
                {!lista.length && <p className="p-6 text-sm text-slate-400">Nenhum pedido neste filtro.</p>}
              </div>
            </>
          )}
        </>
      ) : null}

      <ModalAbrirChamado
        open={abrindo}
        clientId={clientId}
        pedidos={escolhidos}
        empresa={empresa?.razao_social ?? 'empresa'}
        onFechar={() => setAbrindo(false)}
        onAberto={() => {
          setAbrindo(false);
          setSelecionados(new Set());
        }}
      />
      <ModalImportar
        open={importando}
        clientId={clientId}
        empresa={empresa?.razao_social ?? 'empresa'}
        onFechar={() => setImportando(false)}
      />
      <ModalExtrato p={extrato} onFechar={() => setExtrato(null)} />
    </section>
  );
}

/** O pedido desmontado: preço, cada taxa da Shopee, cupom, frete e o que ficou para a loja. */
function ModalExtrato({ p, onFechar }: { p: PedidoConferido | null; onFechar: () => void }) {
  const e = p?.extrato;
  const pctDe = (v: number) =>
    e && e.base > 0 ? `${((v / e.base) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% de ${reais(e.base)}` : '';
  const esp = p?.tarifa.esperado;
  const linhas: Array<{ rotulo: string; sub?: string; valor: number; sinal: '-' | '+' | '' }> = [];
  if (e) {
    linhas.push({ rotulo: 'Preço do produto', valor: e.preco, sinal: '' });
    if (e.devolvido_antes) linhas.push({ rotulo: 'Devolvido ao comprador', sub: 'antes do pagamento', valor: e.devolvido_antes, sinal: '-' });
    if (e.voucher_loja) linhas.push({ rotulo: 'Voucher da loja', sub: 'desconto que a loja deu', valor: e.voucher_loja, sinal: '-' });
    linhas.push({ rotulo: 'Comissão', sub: pctDe(e.comissao), valor: e.comissao, sinal: '-' });
    linhas.push({ rotulo: 'Taxa de transação', sub: pctDe(e.transacao), valor: e.transacao, sinal: '-' });
    if (e.campanha) linhas.push({ rotulo: 'Campanha de Destaque', sub: `${pctDe(e.campanha)} · opcional`, valor: e.campanha, sinal: '-' });
    linhas.push({ rotulo: 'Taxa por item', sub: esp && esp.itens ? `${esp.itens} item(ns)${p?.tarifa.itens_estimados ? ' (pela taxa cobrada)' : ''}` : undefined, valor: e.por_item, sinal: '-' });
    linhas.push({ rotulo: 'Devolução Fácil', sub: 'por pedido', valor: e.devolucao_facil, sinal: '-' });
    if (e.cupom) {
      linhas.push({ rotulo: 'Cupom da Shopee', sub: 'desconto dado ao comprador', valor: e.cupom, sinal: '-' });
      linhas.push({ rotulo: 'A Shopee devolveu nas taxas', sub: 'compensação do cupom', valor: e.desconto_taxas, sinal: '+' });
    }
    linhas.push({
      rotulo: 'Frete pago pela loja',
      sub: `comprador ${reais(e.frete.comprador)} + Shopee ${reais(e.frete.desconto_shopee)} − transportadora ${reais(e.frete.transportadora)}`,
      valor: e.frete.loja_pagou,
      sinal: e.frete.loja_pagou ? '-' : '',
    });
    if (e.outros) linhas.push({ rotulo: 'Outros', valor: e.outros, sinal: e.outros > 0 ? '-' : '+' });
  }
  const shopee = e ? Math.round((e.preco - e.devolvido_antes - e.liquido) * 100) / 100 : 0;
  const final = e ? Math.round((e.liquido - e.debito_devolucao + e.compensacao) * 100) / 100 : 0;
  return (
    <Modal open={!!p} onClose={onFechar} title={p ? `Extrato do pedido ${p.pedido}` : ''}>
      {p && !e ? (
        <p className="text-sm text-slate-600">Este pedido ainda não tem pagamento no relatório Minha renda.</p>
      ) : p && e ? (
        <div className="space-y-3 text-sm text-slate-700">
          <p className="text-xs text-slate-500">
            Criado em {dataCurta(p.criado_em)}
            {p.concluido_em ? ` · concluído em ${dataCurta(p.concluido_em)}` : ''}
            {p.pago_em ? ` · pago em ${dataCurta(p.pago_em)}` : ''}
            {p.itens ? ` · ${p.itens} item(ns)` : ''}
          </p>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {linhas.map((l) => (
              <div key={l.rotulo} className="flex items-start justify-between gap-3 px-3 py-2">
                <span>
                  {l.rotulo}
                  {l.sub && <span className="block text-xs text-slate-400">{l.sub}</span>}
                </span>
                <span className={`whitespace-nowrap tabular-nums ${l.sinal === '+' ? 'text-emerald-700' : ''}`}>
                  {l.sinal === '-' && l.valor ? '− ' : l.sinal === '+' ? '+ ' : ''}
                  {reais(l.valor)}
                </span>
              </div>
            ))}
            <div className="flex justify-between bg-slate-50 px-3 py-2.5 font-semibold text-slate-900">
              <span>A loja recebeu</span>
              <span className="tabular-nums">{reais(e.liquido)}</span>
            </div>
            {(e.debito_devolucao > 0 || e.compensacao > 0) && (
              <>
                {e.debito_devolucao > 0 && (
                  <div className="flex justify-between px-3 py-2">
                    <span>
                      Débito da devolução
                      <span className="block text-xs text-slate-400">depois do pagamento, na carteira</span>
                    </span>
                    <span className="tabular-nums">− {reais(e.debito_devolucao)}</span>
                  </div>
                )}
                {e.compensacao > 0 && (
                  <div className="flex justify-between px-3 py-2">
                    <span>Compensação da Shopee</span>
                    <span className="tabular-nums text-emerald-700">+ {reais(e.compensacao)}</span>
                  </div>
                )}
                <div className="flex justify-between bg-slate-50 px-3 py-2.5 font-semibold text-slate-900">
                  <span>Ficou para a loja</span>
                  <span className="tabular-nums">{reais(final)}</span>
                </div>
              </>
            )}
          </div>
          {e.preco - e.devolvido_antes > 0 && (
            <div>
              <div className="flex h-5 gap-0.5 overflow-hidden rounded text-[11px] text-white">
                <div className="flex items-center bg-sky-600 pl-1.5" style={{ width: `${Math.max(0, (e.liquido / (e.preco - e.devolvido_antes)) * 100)}%` }}>
                  {Math.round((e.liquido / (e.preco - e.devolvido_antes)) * 100)}%
                </div>
                <div className="flex items-center bg-orange-500 pl-1.5" style={{ width: `${Math.max(0, (shopee / (e.preco - e.devolvido_antes)) * 100)}%` }}>
                  {Math.round((shopee / (e.preco - e.devolvido_antes)) * 100)}%
                </div>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Ficou para a loja {reais(e.liquido)} · foi em taxas, frete e descontos {reais(shopee)}
                {p.tarifa.situacao === 'ok' ? ' — conferido com a tabela de tarifas.' : p.tarifa.situacao === 'cobrado_a_mais' ? ' — cobrado a mais que a tabela.' : '.'}
              </p>
            </div>
          )}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end">
        <button className="btn-ghost" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </Modal>
  );
}

/** Os relatórios já importados: o período mais recente de cada tipo. */
function RelatoriosImportados({ itens }: { itens: Array<{ tipo: TipoRelatorio; periodo_de: string | null; periodo_ate: string | null; importado_em: string; importado_por_email: string }> }) {
  if (!itens.length) {
    return (
      <p className="alert alert-info">
        Nenhum relatório importado ainda. Na Central do Vendedor, baixe <b>Minhas vendas</b> (pedidos), <b>Minha renda</b> (lançado) e as{' '}
        <b>transações da carteira</b> do mesmo período e clique em “Importar relatórios”.
      </p>
    );
  }
  const ultimo = (t: TipoRelatorio) => itens.find((i) => i.tipo === t);
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {(['pedidos', 'renda', 'carteira'] as TipoRelatorio[]).map((t) => {
        const u = ultimo(t);
        return (
          <span
            key={t}
            className={`chip ${u ? 'chip-slate' : 'chip-amber'}`}
            title={u ? `Importado em ${dataCurta(u.importado_em)} por ${u.importado_por_email}` : 'Ainda não importado'}
          >
            {TIPO[t]}: {u ? `${dataCurta(u.periodo_de)} a ${dataCurta(u.periodo_ate)}` : 'falta importar'}
          </span>
        );
      })}
    </div>
  );
}

function LinhaPedido({ p, marcado, onMarcar, onExtrato }: { p: PedidoConferido; marcado: boolean; onMarcar: () => void; onExtrato: () => void }) {
  const s = SITUACAO[p.pagamento];
  const semTabela = p.tarifa.situacao === 'sem_tabela' || p.tarifa.situacao === 'tabela_ambigua';
  const problema = precisaDeChamado(p);
  const c = p.chamado_info;
  // dentro do chamado: resolvido (marcado), pago (o dinheiro chegou depois) ou ainda aberto
  const fimDoChamado = p.chamado === 'resolvido' ? 'resolvido' : p.pagamento === 'pago' && !problema ? 'pago' : null;
  return (
    <tr className={marcado ? 'bg-brand-50/60' : problema && !c ? 'bg-red-50/40' : ''}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Selecionar o pedido ${p.pedido}`}
          checked={marcado}
          disabled={!!c}
          title={c ? `Já está no ${rotuloChamado(c)} — cada pedido entra em um chamado só` : undefined}
          onChange={onMarcar}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <button className="link font-mono text-xs" title="Ver o extrato do pedido: cada taxa e o que ficou para a loja" onClick={onExtrato}>
          {p.pedido}
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">{dataCurta(p.criado_em)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {reais(p.valor_produtos)}
        {p.itens > 1 && <div className="text-[11px] text-slate-400">{p.itens} itens</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className={`chip ${s.cls}`} title={p.status_marketplace ?? undefined}>
          {s.texto}
          {p.pagamento === 'nao_pago' && p.dias_desde_conclusao !== null ? ` · ${p.dias_desde_conclusao} dias` : ''}
        </span>
        {p.concluido_em && <div className="mt-0.5 text-[11px] text-slate-400">concluído {dataCurta(p.concluido_em)}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
        {p.pagamento === 'pago' || p.pagamento === 'devolvido' ? reais(p.recebido_final) : '—'}
        {p.pago_em && <div className="text-[11px] text-slate-400">{dataCurta(p.pago_em)}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {semTabela ? (
          <span className="chip chip-amber" title="Nenhuma faixa da tabela de tarifas vale para este pedido (ou mais de uma)">
            {p.tarifa.situacao === 'sem_tabela' ? 'sem tabela' : 'tabela ambígua'}
          </span>
        ) : (
          <Parte p={p.tarifa.comissao} />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {semTabela ? null : (
          <Parte
            p={p.tarifa.taxas}
            dica={
              p.tarifa.esperado
                ? `Esperado: transação ${reais(p.tarifa.esperado.transacao)} + campanha ${reais(p.tarifa.esperado.campanha)} + ${p.tarifa.esperado.itens} item(ns) ${reais(p.tarifa.esperado.por_item)} + por pedido ${reais(p.tarifa.esperado.por_pedido)}${p.tarifa.itens_estimados ? ' (itens pela taxa cobrada — sem o relatório de pedidos)' : ''}`
                : undefined
            }
          />
        )}
      </td>
      <td className="px-3 py-2">
        <Avisos p={p} />
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        {c ? (
          <span
            className={`chip ${fimDoChamado ? 'chip-green' : 'chip-amber'}`}
            title={`Aberto por ${c.aberto_por_email}${c.obs ? ` — ${c.obs}` : ''}`}
          >
            {rotuloChamado(c)}
            {fimDoChamado ? ` · ${fimDoChamado}` : ''}
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

/** Devolução, pacote perdido, frete a mais e cupom do pedido. */
function Avisos({ p }: { p: PedidoConferido }) {
  const avisos: Array<{ texto: string; cls: string; dica: string }> = [];
  if (p.devolucao) {
    const d = p.devolucao;
    if (d.situacao === 'debitado_a_mais')
      avisos.push({ texto: `devolução: +${reais(d.a_mais)} debitado`, cls: 'chip-red', dica: `Debitado ${reais(d.depois)}; a loja tinha recebido ${reais(d.limite)} por esses itens` });
    else if (d.situacao === 'sem_solicitacao')
      avisos.push({ texto: 'débito sem devolução', cls: 'chip-red', dica: `Débito de ${reais(d.depois)} sem devolução aprovada no relatório de pedidos` });
    else
      avisos.push({
        texto: 'devolvido',
        cls: 'chip-slate',
        dica: `${d.antes ? `Devolvido ao comprador antes do pagamento: ${reais(d.antes)}. ` : ''}${d.depois ? `Debitado depois: ${reais(d.depois)} (até ${reais(d.limite)}). ` : ''}${d.compensado ? `Compensado: ${reais(d.compensado)}.` : ''}`,
      });
  }
  if (p.perdido) {
    avisos.push(
      p.perdido.situacao === 'compensado'
        ? { texto: 'perdido · compensado', cls: 'chip-green', dica: `A Shopee compensou ${reais(p.perdido.compensado)}` }
        : p.perdido.situacao === 'aguardando'
          ? { texto: 'perdido · aguardando', cls: 'chip-sky', dica: 'Pacote perdido: a compensação deve cair na carteira' }
          : { texto: 'perdido sem compensação', cls: 'chip-red', dica: 'Pacote perdido e nenhuma compensação na carteira' },
    );
  }
  if (p.frete_a_mais) {
    avisos.push({
      texto: `frete +${reais(p.frete_a_mais.valor)}`,
      cls: 'chip-amber',
      dica:
        p.frete_a_mais.esperado !== null
          ? `Frete esperado ${reais(p.frete_a_mais.esperado)}, cobrado ${reais(p.frete_a_mais.real)} — o peso real é maior que o do cadastro`
          : 'A loja pagou parte do frete',
    });
  }
  if (p.cupom && p.cupom.cupom) {
    const liquido = Math.round((p.cupom.cupom - p.cupom.desconto_taxas) * 100) / 100;
    avisos.push({
      texto: liquido > 0 ? `cupom: custo ${reais(liquido)}` : 'cupom compensado',
      cls: liquido > 0 ? 'chip-amber' : 'chip-slate',
      dica: `Cupom da Shopee ${reais(p.cupom.cupom)}; a Shopee devolveu ${reais(p.cupom.desconto_taxas)} em desconto nas taxas`,
    });
  }
  if (!avisos.length) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {avisos.map((a) => (
        <span key={a.texto} className={`chip ${a.cls}`} title={a.dica}>
          {a.texto}
        </span>
      ))}
    </div>
  );
}

/** Comissão ou taxas: o cobrado, o esperado e a diferença. */
function Parte({ p, dica }: { p: ParteTarifa | null; dica?: string }) {
  if (!p) return <span className="text-slate-300">—</span>;
  return (
    <div title={dica}>
      <div className="tabular-nums">{reais(p.cobrada)}</div>
      <div className="text-[11px] text-slate-400">esperado {reais(p.esperada)}</div>
      {p.situacao === 'a_mais' && <span className="chip chip-red mt-0.5">+{reais(p.diferenca)} a mais</span>}
      {p.situacao === 'a_menos' && <span className="chip chip-sky mt-0.5">{reais(p.diferenca)} a menos</span>}
    </div>
  );
}

/**
 * Importar os relatórios da Central do Vendedor (pode escolher os três de uma
 * vez). O servidor lê só os pedidos e valores — nada do comprador é gravado.
 */
function ModalImportar({ open, clientId, empresa, onFechar }: { open: boolean; clientId: string; empresa: string; onFechar: () => void }) {
  const importar = useImportarShopee();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setArquivos([]);
      importar.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const detalhes = importar.error instanceof ApiError ? (importar.error.details as { code?: string; arquivos?: Array<{ arquivo: string; erro: string }> } | undefined) : undefined;
  const feito = importar.data?.importados;

  return (
    <Modal open={open} onClose={importar.isPending ? () => {} : onFechar} title={`Importar relatórios da Shopee — ${empresa}`}>
      <div className="space-y-3 text-sm text-slate-700">
        {!feito ? (
          <>
            <p>Escolha os relatórios baixados da Central do Vendedor (pode escolher os três de uma vez):</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              <li>
                <b>Pedidos</b> — Minhas vendas › Exportar (Order.all…xlsx)
              </li>
              <li>
                <b>Minha renda</b> — Minha renda › Lançado › Exportar (Income.lançado…xlsx)
              </li>
              <li>
                <b>Carteira</b> — Minha carteira › Transações › Exportar (my_balance_transaction_report…xlsx)
              </li>
            </ul>
            <p className="text-xs text-slate-500">
              Só o nº do pedido, datas, itens e valores são gravados — nome, endereço, telefone e CPF do comprador ficam de fora.
              Importar o mesmo período de novo atualiza, não duplica.
            </p>
            <input
              ref={entrada}
              type="file"
              multiple
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full text-sm"
              onChange={(e) => setArquivos(Array.from(e.target.files ?? []))}
            />
            {arquivos.length > 0 && (
              <ul className="text-xs text-slate-600">
                {arquivos.map((f) => (
                  <li key={f.name}>
                    {f.name} · {(f.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB
                  </li>
                ))}
              </ul>
            )}
            {importar.error && (
              <div className="alert alert-error">
                <p>{importar.error instanceof ApiError ? importar.error.message : 'Falha ao importar'}</p>
                {detalhes?.arquivos && (
                  <ul className="mt-1 list-disc pl-5 text-xs">
                    {detalhes.arquivos.map((a) => (
                      <li key={a.arquivo}>
                        {a.arquivo}: {a.erro}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <p className="alert alert-success">
              Importado{importar.data?.loja ? ` — loja ${importar.data.loja}` : ''}.
            </p>
            <ul className="space-y-1">
              {feito.map((i: Importado) => (
                <li key={i.arquivo} className="flex flex-wrap justify-between gap-2 text-xs">
                  <span>
                    <b>{TIPO[i.tipo]}</b> · {i.arquivo}
                  </span>
                  <span className="text-slate-500">
                    {i.periodo ? `${dataCurta(i.periodo.de)} a ${dataCurta(i.periodo.ate)} · ` : ''}
                    {i.linhas.toLocaleString('pt-BR')} {i.tipo === 'carteira' ? 'movimentos' : 'pedidos'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onFechar} disabled={importar.isPending}>
          {feito ? 'Fechar' : 'Cancelar'}
        </button>
        {!feito && (
          <button
            className="btn-primary"
            disabled={importar.isPending || !arquivos.length || !clientId}
            onClick={() => importar.mutate({ clientId, arquivos })}
          >
            {importar.isPending ? 'Importando…' : `Importar ${arquivos.length || ''} arquivo(s)`}
          </button>
        )}
      </div>
    </Modal>
  );
}

/**
 * Abrir o chamado do lote: a data em que foi aberto na Shopee, o nº (se já
 * tiver — dá pra informar depois na lista de chamados) e uma observação. Ao
 * confirmar, marca os pedidos e baixa a planilha só deles.
 */
function ModalAbrirChamado({
  open,
  clientId,
  pedidos,
  empresa,
  onFechar,
  onAberto,
}: {
  open: boolean;
  clientId: string;
  pedidos: PedidoConferido[];
  empresa: string;
  onFechar: () => void;
  onAberto: () => void;
}) {
  const abrir = useAbrirChamado();
  const [abertoEm, setAbertoEm] = useState(hojeEmSaoPaulo());
  const [numero, setNumero] = useState('');
  const [obs, setObs] = useState('');
  useEffect(() => {
    if (open) {
      setAbertoEm(hojeEmSaoPaulo());
      setNumero('');
      setObs('');
      abrir.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ocupados =
    abrir.error instanceof ApiError && (abrir.error.details as { code?: string } | undefined)?.code === 'pedido_em_chamado'
      ? ((abrir.error.details as { pedidos?: Array<{ pedido: string; numero: string | null; aberto_em: string }> }).pedidos ?? [])
      : [];

  function confirmar() {
    const chamado = { numero: numero.trim() || null, aberto_em: abertoEm };
    abrir.mutate(
      { client_id: clientId, pedidos: pedidos.map((p) => p.pedido), ...chamado, obs: obs.trim() || null },
      {
        onSuccess: () => {
          baixarArquivo(nomeDoArquivo(empresa, chamado), planilhaDoLote(pedidos, chamado));
          onAberto();
        },
      },
    );
  }

  const comDevolucao = pedidos.filter(devolucaoComProblema).length;
  return (
    <Modal open={open} onClose={abrir.isPending ? () => {} : onFechar} title={`Abrir chamado com ${pedidos.length} pedido(s)`}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          Os pedidos ficam marcados com este chamado e a planilha só com eles é baixada para você anexar na Shopee. Cada pedido
          entra em um chamado só.
          {comDevolucao > 0 && ` ${comDevolucao} pedido(s) com débito de devolução a conferir.`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-slate-500">Data em que o chamado foi aberto</span>
            <input className="input" type="date" value={abertoEm} max={hojeEmSaoPaulo()} onChange={(e) => setAbertoEm(e.target.value)} />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-slate-500">Nº do chamado (se já tiver)</span>
            <input className="input" value={numero} placeholder="pode informar depois" onChange={(e) => setNumero(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Observação (opcional)</span>
          <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        {abrir.error && (
          <div className="alert alert-error">
            <p>{abrir.error instanceof ApiError ? abrir.error.message : 'Falha ao abrir o chamado'}</p>
            {ocupados.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {ocupados.map((o) => (
                  <li key={o.pedido}>
                    {o.pedido} — já no {rotuloChamado(o)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onFechar} disabled={abrir.isPending}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={confirmar} disabled={abrir.isPending || !abertoEm || !pedidos.length}>
          {abrir.isPending ? 'Abrindo…' : 'Abrir chamado e baixar a planilha'}
        </button>
      </div>
    </Modal>
  );
}
