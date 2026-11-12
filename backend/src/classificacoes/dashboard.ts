/**
 * Dashboard do módulo Classificação (pedido de 2026-11-12): receitas por
 * classificação de entrada, despesas por classificação de saída, evolução por
 * mês e o que falta classificar — de uma empresa ou de todas as do mesmo
 * cliente, num período. A conta é feita no banco (RPC
 * dashboard_classificacao, migration 0025); aqui só o formato da resposta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { mapPgrstError } from '../lib/pgrst.js';

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');

export const dashboardQuerySchema = z.object({
  client_id: z.string().uuid().optional(),
  /** escritório: soma todas as empresas do mesmo login de cliente */
  grupo: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  de: dia.optional(),
  ate: dia.optional(),
});

type Linha = { direction: 'entrada' | 'saida'; nome: string; total: number | string; qtd: number };
type Mes = { mes: string; receitas: number | string; despesas: number | string };
type Bruto = {
  por_classificacao: Linha[];
  por_mes: Mes[];
  /** cada classificação em cada mês (as roscas "no mês") */
  por_mes_classificacao?: Array<Linha & { mes: string }>;
  pendentes: { qtd: number; total: number | string };
};

export type ItemDashboard = { nome: string; total_cents: number; qtd: number; percentual: number };

const centavos = (v: number | string) => Math.round(Number(v) * 100);

function lado(linhas: Linha[], direction: 'entrada' | 'saida'): { itens: ItemDashboard[]; total: number } {
  const doLado = linhas.filter((l) => l.direction === direction);
  const total = doLado.reduce((a, l) => a + centavos(l.total), 0);
  const itens = doLado
    .map((l) => ({
      nome: l.nome,
      total_cents: centavos(l.total),
      qtd: Number(l.qtd),
      // % do total de receitas (ou de despesas), 1 casa
      percentual: total ? Math.round((centavos(l.total) / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total_cents - a.total_cents || a.nome.localeCompare(b.nome));
  return { itens, total };
}

export async function montarDashboard(
  db: SupabaseClient,
  p: { empresas: Array<{ id: string; razao_social: string }>; de?: string; ate?: string },
) {
  const vazio = { por_classificacao: [], por_mes: [], por_mes_classificacao: [], pendentes: { qtd: 0, total: 0 } } satisfies Bruto;
  let bruto: Bruto = vazio;
  if (p.empresas.length) {
    const { data, error } = await db.rpc('dashboard_classificacao', {
      p_clients: p.empresas.map((e) => e.id),
      p_de: p.de ?? null,
      p_ate: p.ate ?? null,
    });
    if (error) throw mapPgrstError(error, 'montar o dashboard');
    bruto = (data as Bruto | null) ?? vazio;
  }

  const receitas = lado(bruto.por_classificacao, 'entrada');
  const despesas = lado(bruto.por_classificacao, 'saida');

  // no mês, o nome sai igual ao do período (a mesma classificação pode vir com
  // maiúsculas diferentes de uma empresa pra outra) — a tela casa pelo nome
  const nomeNoPeriodo = new Map(bruto.por_classificacao.map((l) => [`${l.direction}|${l.nome.toLowerCase()}`, l.nome]));
  const doMes = new Map<string, Linha[]>();
  for (const l of bruto.por_mes_classificacao ?? []) {
    const nome = nomeNoPeriodo.get(`${l.direction}|${l.nome.toLowerCase()}`) ?? l.nome;
    const lista = doMes.get(l.mes) ?? [];
    lista.push({ ...l, nome });
    doMes.set(l.mes, lista);
  }
  return {
    empresas: p.empresas,
    periodo: { de: p.de ?? null, ate: p.ate ?? null },
    totais: {
      receitas_cents: receitas.total,
      despesas_cents: despesas.total,
      resultado_cents: receitas.total - despesas.total,
    },
    receitas: receitas.itens,
    despesas: despesas.itens,
    meses: bruto.por_mes.map((m) => ({
      mes: m.mes,
      receitas_cents: centavos(m.receitas),
      despesas_cents: centavos(m.despesas),
      // % de cada classificação sobre o total do mês
      receitas: lado(doMes.get(m.mes) ?? [], 'entrada').itens,
      despesas: lado(doMes.get(m.mes) ?? [], 'saida').itens,
    })),
    pendentes: { qtd: Number(bruto.pendentes.qtd), total_cents: centavos(bruto.pendentes.total) },
  };
}
