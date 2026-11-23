import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconLixeira, IconMais, Spinner } from '@/components/icons';
import { CarregandoLinhas, ErroCarregar, PageHeader, Vazio } from '@/components/ui';
import { ApiError } from '@/lib/api';
import type { ClassificacaoGeral, Direction } from '@/lib/types';
import { useClassificacoesGerais, useCreateGeral, useDeleteGeral } from './api';

/**
 * Lista geral de classificações do escritório (pedido de 2026-11-11). Só quem
 * administra o escritório (Cadastros → Equipe) inclui e exclui; os clientes
 * escolhem dela a lista própria, no módulo Classificação.
 */
export function ListaGeralPage() {
  const { data } = useClassificacoesGerais();
  const podeEditar = data?.pode_editar ?? false;

  return (
    <section className="space-y-6">
      <PageHeader
        titulo="Lista geral de classificações"
        descricao="A lista do escritório (limpeza e higiene, energia elétrica…). Cada cliente escolhe dela, no módulo Classificação, o que vai usar — pelos botões “Adicionar classificações de entradas/saídas”. A lista que o cliente monta vale para todas as empresas dele."
      >
        {data && !podeEditar && (
          <p className="alert alert-info">
            Só quem administra o escritório (Cadastros → Equipe) inclui ou exclui itens da lista geral.
          </p>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Coluna direction="saida" titulo="Saídas" podeEditar={podeEditar} />
        <Coluna direction="entrada" titulo="Entradas" podeEditar={podeEditar} />
      </div>
    </section>
  );
}

function Coluna({ direction, titulo, podeEditar }: { direction: Direction; titulo: string; podeEditar: boolean }) {
  const { data, isLoading, error } = useClassificacoesGerais(direction);
  const criar = useCreateGeral();
  const excluir = useDeleteGeral();
  const [nome, setNome] = useState('');
  const [excluindo, setExcluindo] = useState<ClassificacaoGeral | null>(null);

  function incluir(e: React.FormEvent) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) return;
    criar.mutate({ direction, nome: n }, { onSuccess: () => setNome('') });
  }

  const erroCriar = criar.error instanceof ApiError ? criar.error.message : criar.error ? 'Falha ao incluir' : null;
  const itens = data?.gerais ?? [];

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${direction === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`} />
        <p className="card-title">{titulo}</p>
        <span className="chip chip-slate">{itens.length}</span>
      </div>

      {podeEditar && (
        <form onSubmit={incluir} className="mb-3 flex gap-2">
          <input
            className="input h-9 flex-1"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={direction === 'saida' ? 'ex: LIMPEZA E HIGIENE' : 'ex: RECEBIMENTO DE CLIENTES'}
          />
          <button className="btn-primary h-9 px-3" disabled={!nome.trim() || criar.isPending}>
            {criar.isPending ? <Spinner /> : <IconMais className="h-4 w-4" />}
            {criar.isPending ? 'Incluindo…' : 'Incluir'}
          </button>
        </form>
      )}
      {erroCriar && <p className="mb-3 text-xs text-red-600">{erroCriar}</p>}

      {isLoading ? (
        <CarregandoLinhas linhas={4} className="px-0" />
      ) : error ? (
        <ErroCarregar erro={error} />
      ) : !itens.length ? (
        <Vazio titulo="Nenhum item ainda" texto={podeEditar ? 'Inclua o primeiro pelo campo acima.' : undefined} className="py-6" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {itens.map((g) => (
            <li key={g.id} className="group flex items-center justify-between gap-2 rounded-lg px-1 py-2 text-sm text-slate-700 transition-colors hover:bg-brand-50/50">
              <span>{g.nome}</span>
              {podeEditar && (
                <button className="link-danger text-xs opacity-60 group-hover:opacity-100" onClick={() => setExcluindo(g)}>
                  <IconLixeira className="h-3.5 w-3.5" />
                  excluir
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!excluindo}
        title="Excluir da lista geral"
        message={`Excluir "${excluindo?.nome}" da lista geral? Ninguém mais consegue escolher esse item; os clientes que já o têm na lista própria continuam com ele.`}
        busy={excluir.isPending}
        error={
          excluir.isError ? (excluir.error instanceof ApiError ? excluir.error.message : 'Falha ao excluir') : null
        }
        onConfirm={() => excluindo && excluir.mutate(excluindo.id, { onSuccess: () => setExcluindo(null) })}
        onCancel={() => {
          setExcluindo(null);
          excluir.reset();
        }}
      />
    </div>
  );
}
