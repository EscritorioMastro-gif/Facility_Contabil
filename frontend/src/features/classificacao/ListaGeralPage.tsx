import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Lista geral de classificações</h1>
        <p className="text-sm text-slate-500">
          A lista do escritório (limpeza e higiene, energia elétrica…). Cada cliente escolhe dela, no módulo
          Classificação, o que vai usar — pelos botões “Adicionar classificações de entradas/saídas”. A lista que o
          cliente monta vale para todas as empresas dele.
        </p>
        {data && !podeEditar && (
          <p className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
            Só quem administra o escritório (Cadastros → Equipe) inclui ou exclui itens da lista geral.
          </p>
        )}
      </div>

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
    <div className="card p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">
        {titulo} <span className="font-normal text-slate-400">({itens.length})</span>
      </p>

      {podeEditar && (
        <form onSubmit={incluir} className="mb-3 flex gap-2">
          <input
            className="input h-9 flex-1"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={direction === 'saida' ? 'ex: LIMPEZA E HIGIENE' : 'ex: RECEBIMENTO DE CLIENTES'}
          />
          <button className="btn-primary h-9 px-3" disabled={!nome.trim() || criar.isPending}>
            {criar.isPending ? 'Incluindo…' : 'Incluir'}
          </button>
        </form>
      )}
      {erroCriar && <p className="mb-3 text-xs text-red-600">{erroCriar}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Falha ao carregar'}</p>
      ) : !itens.length ? (
        <p className="text-sm text-slate-400">Nenhum item ainda.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {itens.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-2 py-2 text-sm text-slate-700">
              <span>{g.nome}</span>
              {podeEditar && (
                <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => setExcluindo(g)}>
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
