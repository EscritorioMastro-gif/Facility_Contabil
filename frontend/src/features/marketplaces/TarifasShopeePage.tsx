import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { CarregandoLinhas, ErroCarregar, PageHeader, Vazio } from '@/components/ui';
import { IconLixeira, IconMais, IconSalvar } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { useSalvarTarifas, useTarifasShopee, type LinhaTarifa, type NovaTarifa } from './api';
import { dataCurta } from './formato';

/** Linha em edição: os campos como o usuário digita. */
type Rascunho = {
  chave: string;
  id?: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  preco_min: string;
  preco_max: string;
  comissao_pct: string;
  transacao_pct: string;
  campanha_pct: string;
  por_item: string;
  por_pedido: string;
  obs: string;
  preenchido_por_email?: string;
  preenchido_em?: string;
};

type CampoNumero = 'preco_min' | 'preco_max' | 'comissao_pct' | 'transacao_pct' | 'campanha_pct' | 'por_item' | 'por_pedido';

const texto = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
const paraRascunho = (t: LinhaTarifa): Rascunho => ({
  chave: t.id,
  id: t.id,
  vigencia_inicio: t.vigencia_inicio,
  vigencia_fim: t.vigencia_fim ?? '',
  preco_min: texto(t.preco_min),
  preco_max: texto(t.preco_max),
  comissao_pct: texto(t.comissao_pct),
  transacao_pct: texto(t.transacao_pct),
  campanha_pct: texto(t.campanha_pct),
  por_item: texto(t.por_item),
  por_pedido: texto(t.por_pedido),
  obs: t.obs ?? '',
  preenchido_por_email: t.preenchido_por_email,
  preenchido_em: t.preenchido_em,
});
/** "18,6", "1.234,56" ou "18.6" → número (vazio = 0). */
const numero = (s: string) => {
  const t = s.trim();
  if (!t) return 0;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};
let seq = 0;
const nova = (): Rascunho => ({
  chave: `nova-${++seq}`,
  vigencia_inicio: new Date().toISOString().slice(0, 10),
  vigencia_fim: '',
  preco_min: '0',
  preco_max: '',
  comissao_pct: '',
  transacao_pct: '0',
  campanha_pct: '0',
  por_item: '0',
  por_pedido: '0',
  obs: '',
});

/** As colunas de valor: rótulo, placeholder e largura. */
const COLUNAS: Array<{ campo: CampoNumero; titulo: string; dica: string; ph?: string; w: string }> = [
  { campo: 'preco_min', titulo: 'Preço de', dica: 'Preço unitário do item a partir de (R$)', w: 'w-20' },
  { campo: 'preco_max', titulo: 'até', dica: 'Preço unitário do item até (R$; vazio = sem limite)', ph: 'sem limite', w: 'w-24' },
  { campo: 'comissao_pct', titulo: 'Comissão %', dica: 'Comissão (% do preço)', ph: '18,6', w: 'w-20' },
  { campo: 'transacao_pct', titulo: 'Transação %', dica: 'Taxa de transação (% do preço)', ph: '1,4', w: 'w-20' },
  { campo: 'campanha_pct', titulo: 'Campanha de Destaque %', dica: 'Taxa de serviço adicional — 0 se a loja não participa', ph: '0', w: 'w-20' },
  { campo: 'por_item', titulo: 'R$ por item', dica: 'Taxa fixa por item vendido (R$)', ph: '4,50', w: 'w-20' },
  { campo: 'por_pedido', titulo: 'R$ por pedido', dica: 'Taxa fixa por pedido — Devolução Fácil (R$)', ph: '0,49', w: 'w-20' },
];

/**
 * Tabela de tarifas da Shopee: o CLIENTE preenche (vale pra todas as empresas
 * do login dele; a responsabilidade pelos números é dele). O escritório escolhe
 * a empresa e só consulta. Cinco partes: comissão, transação e Campanha de
 * Destaque em % do preço; R$ por item e R$ por pedido.
 */
export function TarifasShopeePage() {
  const { ehCliente } = useAuth();
  const { data: clients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const { data, isLoading, error } = useTarifasShopee(ehCliente ? undefined : clientId, ehCliente || !!clientId);
  const salvar = useSalvarTarifas();
  const [linhas, setLinhas] = useState<Rascunho[]>([]);
  useEffect(() => {
    if (data) setLinhas(data.tarifas.map(paraRascunho));
  }, [data]);

  const original = useMemo(() => JSON.stringify((data?.tarifas ?? []).map(paraRascunho)), [data]);
  const mudou = JSON.stringify(linhas) !== original;
  const podeEditar = !!data?.pode_editar;

  const alterar = (chave: string, campo: keyof Rascunho, valor: string) =>
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));

  function gravar() {
    const tarifas: NovaTarifa[] = linhas.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      vigencia_inicio: l.vigencia_inicio,
      vigencia_fim: l.vigencia_fim || null,
      preco_min: numero(l.preco_min),
      preco_max: l.preco_max.trim() ? numero(l.preco_max) : null,
      comissao_pct: numero(l.comissao_pct),
      transacao_pct: numero(l.transacao_pct),
      campanha_pct: numero(l.campanha_pct),
      por_item: numero(l.por_item),
      por_pedido: numero(l.por_pedido),
      obs: l.obs.trim() || null,
    }));
    salvar.mutate(tarifas);
  }

  return (
    <section className="space-y-5">
      <PageHeader
        titulo="Tarifas Shopee"
        descricao={
          ehCliente
            ? 'O que a Shopee cobra em cada venda: comissão, transação e Campanha de Destaque em % do preço, mais as taxas fixas por item e por pedido. Copie da Central do Vendedor — os valores são de sua responsabilidade.'
            : 'A tabela que o cliente preencheu (a conferência usa ela). Só o cliente altera, pelo portal.'
        }
        acoes={
          <Link to="/marketplaces/shopee" className="btn-ghost">
            Conferência Shopee
          </Link>
        }
      />

      {!ehCliente && (
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
      )}

      {!ehCliente && !clientId ? (
        <div className="card">
          <Vazio titulo="Escolha a empresa para ver a tabela de tarifas do cliente" />
        </div>
      ) : isLoading ? (
        <div className="card">
          <CarregandoLinhas />
        </div>
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : data ? (
        <>
          {ehCliente ? (
            <div className="alert alert-info space-y-1">
              <p>
                Vale para {data.empresas === 1 ? 'a sua empresa' : `as suas ${data.empresas ?? 0} empresas`}. Cada faixa vale
                para o <b>preço unitário</b> do item, dos dois extremos inclusos (ex.: de 8,00 a 79,99), e pela{' '}
                <b>data de criação</b> do pedido.
              </p>
              <p>
                A <b>Campanha de Destaque</b> é opcional: preencha 0 se a loja não participa. Quando a Shopee mudar a tabela,
                ponha um <b>fim de vigência</b> na faixa antiga e crie a nova a partir da data da mudança.
              </p>
            </div>
          ) : data.preenchido_por_email ? (
            <p className="text-xs text-slate-500">
              Preenchida por {data.preenchido_por_email} em {dataCurta(data.preenchido_em)}.
            </p>
          ) : (
            <p className="alert alert-warn">
              {data.sem_login
                ? 'Esta empresa ainda não tem login de cliente — sem login, ninguém preenche a tabela.'
                : 'O cliente ainda não preencheu a tabela de tarifas.'}
            </p>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-left text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Vale de</th>
                  <th className="px-2 py-2">até</th>
                  {COLUNAS.map((c) => (
                    <th key={c.campo} className="px-2 py-2" title={c.dica}>
                      {c.titulo}
                    </th>
                  ))}
                  <th className="px-2 py-2">Observação</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.map((l) => (
                  <tr key={l.chave}>
                    <td className="px-2 py-1.5">
                      <input className="input h-8 w-36" type="date" value={l.vigencia_inicio} disabled={!podeEditar}
                        aria-label="Vale a partir de" onChange={(e) => alterar(l.chave, 'vigencia_inicio', e.target.value)} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input h-8 w-36" type="date" value={l.vigencia_fim} disabled={!podeEditar}
                        aria-label="Vale até (vazio = em vigor)" onChange={(e) => alterar(l.chave, 'vigencia_fim', e.target.value)} />
                    </td>
                    {COLUNAS.map((c) => (
                      <td key={c.campo} className="px-2 py-1.5">
                        <input className={`input h-8 ${c.w} text-right`} inputMode="decimal" value={l[c.campo]} placeholder={c.ph}
                          disabled={!podeEditar} aria-label={c.dica} title={c.dica} onChange={(e) => alterar(l.chave, c.campo, e.target.value)} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5">
                      <input className="input h-8 w-40" value={l.obs} disabled={!podeEditar} aria-label="Observação"
                        onChange={(e) => alterar(l.chave, 'obs', e.target.value)} />
                      {l.preenchido_por_email && (
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          {l.preenchido_por_email} · {dataCurta(l.preenchido_em)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {podeEditar && (
                        <button className="link-danger" title="Tirar esta faixa" aria-label="Tirar esta faixa"
                          onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}>
                          <IconLixeira className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!linhas.length && (
              <p className="p-6 text-sm text-slate-400">
                {podeEditar ? 'Nenhuma faixa ainda — clique em "Adicionar faixa".' : 'Nenhuma faixa preenchida.'}
              </p>
            )}
          </div>

          {salvar.error && (
            <p className="alert alert-error">
              {salvar.error instanceof ApiError ? salvar.error.message : 'Falha ao salvar a tabela'}
            </p>
          )}
          {salvar.isSuccess && !mudou && <p className="alert alert-success">Tabela salva.</p>}

          {podeEditar && (
            <div className="flex flex-wrap justify-between gap-2">
              <button className="btn-ghost" onClick={() => setLinhas((ls) => [...ls, nova()])}>
                <IconMais className="h-4 w-4" />
                Adicionar faixa
              </button>
              <button className="btn-primary" disabled={!mudou || salvar.isPending} onClick={gravar}>
                <IconSalvar className="h-4 w-4" />
                {salvar.isPending ? 'Salvando…' : 'Salvar tabela'}
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
