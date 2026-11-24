/**
 * Limite mensal de retiradas (pedido do user em 2026-11-23).
 *
 * Lei 15.270/2025: lucros e dividendos que a MESMA empresa paga a uma pessoa
 * física acima de R$ 50.000,00 no mês sofrem retenção de 10% sobre o total.
 * O escritório pediu que o PRÓ-LABORE entre na soma junto com a distribuição
 * de lucro — alguns clientes classificam distribuição como pró-labore — e que a
 * conta seja POR EMPRESA (o extrato não diz qual sócio recebeu).
 *
 * Conta: saídas classificadas como PRO-LABORE ou DISTRIBUIÇÃO DE LUCRO (os
 * nomes da lista geral, que o escritório cadastra), não inativadas, de TODOS
 * os extratos da empresa no mês do lançamento. Passou de R$ 50.000,00 → a
 * tela avisa o cliente pra pedir a guia ao escritório, e o Histórico marca.
 *
 *   GET /api/retiradas/extrato/:id   — o que os OUTROS extratos da empresa já
 *        somam em cada mês deste extrato (a tela soma o deste, com o que ainda
 *        não foi salvo) + quais classificações contam
 *   GET /api/retiradas/historico?ids=a,b — os extratos da lista cujo mês passou
 */
import { Router, type Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { lerTodas, mapPgrstError } from '../lib/pgrst.js';
import { empresasDoLogin } from '../portal/acesso.js';

export const LIMITE_RETIRADAS = 50_000;
export type TipoRetirada = 'pro_labore' | 'distribuicao';
export type Soma = { pro_labore: number; distribuicao: number };

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/** "PRO-LABORE", "Pró-labore", "PRO LABORE SÓCIOS" → pró-labore; "DISTRIBUIÇÃO DE LUCRO(S)" → distribuição. */
export function tipoRetirada(nome: string | null | undefined): TipoRetirada | null {
  const n = normalizar(nome ?? '');
  if (/^PRO ?LABORE\b/.test(n)) return 'pro_labore';
  if (/^DISTRIBUICAO DE LUCROS?\b/.test(n)) return 'distribuicao';
  return null;
}

const centavos = (v: number) => Math.round(v * 100) / 100;
export const mesDe = (data: string) => data.slice(0, 7);

/** "2026-08" .. "2026-10" → ["2026-08", "2026-09", "2026-10"] */
export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  let [a, m] = de.split('-').map(Number) as [number, number];
  const [aFim, mFim] = ate.split('-').map(Number) as [number, number];
  for (let i = 0; (a < aFim || (a === aFim && m <= mFim)) && i < 60; i++) {
    meses.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return meses;
}

const ultimoDia = (mes: string) => {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

type LinhaRetirada = { statement_id: string; data: string; valor: number | string; classificacao_id: string };

/** Classificação que conta no limite: o tipo e a empresa dela. */
export type ClassifRetirada = { tipo: TipoRetirada; client_id: string };

/** Soma por chave (o mês, ou empresa + mês), separando pró-labore e distribuição. */
export function somarRetiradas(
  linhas: LinhaRetirada[],
  tipos: Map<string, ClassifRetirada>,
  chave: (l: LinhaRetirada, c: ClassifRetirada) => string = (l) => mesDe(l.data),
): Map<string, Soma> {
  const somas = new Map<string, Soma>();
  for (const l of linhas) {
    const c = tipos.get(l.classificacao_id);
    if (!c) continue;
    const k = chave(l, c);
    const s = somas.get(k) ?? { pro_labore: 0, distribuicao: 0 };
    s[c.tipo] = centavos(s[c.tipo] + Number(l.valor));
    somas.set(k, s);
  }
  return somas;
}

/** Classificações de saída das empresas que contam no limite (pelo nome da lista geral ou o próprio). */
async function classificacoesDeRetirada(sb: SupabaseClient, clientIds: string[]): Promise<Map<string, ClassifRetirada>> {
  const tipos = new Map<string, ClassifRetirada>();
  if (!clientIds.length) return tipos;
  const { data, error } = await sb
    .from('classificacoes')
    .select('id, client_id, nome, geral:classificacoes_gerais(nome)')
    .in('client_id', clientIds)
    .eq('direction', 'saida');
  if (error) throw mapPgrstError(error, 'ler as classificações');
  type Linha = { id: string; client_id: string; nome: string; geral?: { nome?: string } | Array<{ nome?: string }> | null };
  for (const c of (data ?? []) as Linha[]) {
    const geral = Array.isArray(c.geral) ? c.geral[0] : c.geral;
    const tipo = tipoRetirada(geral?.nome) ?? tipoRetirada(c.nome);
    if (tipo) tipos.set(c.id, { tipo, client_id: c.client_id });
  }
  return tipos;
}

/** Lançamentos de retirada (saída, ativos, de extrato que não deu erro) num intervalo de datas. */
function lerRetiradas(
  sb: SupabaseClient,
  classificacaoIds: string[],
  de: string,
  ate: string,
  filtro: { exceto?: string; extratos?: string[] } = {},
): Promise<LinhaRetirada[]> {
  return lerTodas<LinhaRetirada>((ini, fim) => {
    let q = sb
      .from('transactions')
      .select('statement_id, data, valor, classificacao_id, statement:statements!inner(status)')
      .in('classificacao_id', classificacaoIds)
      .eq('direction', 'saida')
      .eq('ignorado', false)
      .neq('statement.status', 'erro')
      .gte('data', de)
      .lte('data', ate);
    if (filtro.exceto) q = q.neq('statement_id', filtro.exceto);
    if (filtro.extratos) q = q.in('statement_id', filtro.extratos);
    return q.order('data').order('id').range(ini, fim);
  }, 'ler as retiradas');
}

type Extrato = { id: string; client_id: string; period_start: string | null; period_end: string | null; origem_modulo?: string };

/** De onde vêm os dados: escritório = o banco com o login dele (RLS); portal = secret key + as empresas do login. */
type Acesso = { sb: SupabaseClient; empresas: string[] | null };

function rotas(acesso: (req: Request) => Promise<Acesso>) {
  const router = Router();
  const uuid = z.string().uuid();

  // ------------------------------------------------------------------------ #
  router.get('/extrato/:id', async (req, res, next) => {
    try {
      if (!uuid.safeParse(req.params.id).success) throw notFound('Extrato não encontrado');
      const { sb, empresas } = await acesso(req);
      const { data: st, error } = await sb
        .from('statements')
        .select('id, client_id, period_start, period_end, origem_modulo')
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw mapPgrstError(error, 'buscar o extrato');
      const extrato = st as Extrato | null;
      if (!extrato || (empresas && (!empresas.includes(extrato.client_id) || extrato.origem_modulo !== 'classificacao'))) {
        throw notFound('Extrato não encontrado');
      }

      const tipos = await classificacoesDeRetirada(sb, [extrato.client_id]);
      const classificacoes = [...tipos].map(([id, c]) => ({ id, tipo: c.tipo }));
      if (!tipos.size) return res.json({ limite: LIMITE_RETIRADAS, classificacoes, meses: [] });

      // meses do extrato: o período e as datas dos lançamentos (o período pode faltar)
      const datas = await Promise.all(
        [true, false].map(async (asc) => {
          const { data, error: e } = await sb
            .from('transactions')
            .select('data')
            .eq('statement_id', extrato.id)
            .order('data', { ascending: asc })
            .limit(1);
          if (e) throw mapPgrstError(e, 'ler as datas do extrato');
          return (data?.[0] as { data?: string } | undefined)?.data ?? null;
        }),
      );
      const limites = [extrato.period_start, extrato.period_end, ...datas].filter((d): d is string => !!d).sort();
      if (!limites.length) return res.json({ limite: LIMITE_RETIRADAS, classificacoes, meses: [] });
      const meses = mesesEntre(mesDe(limites[0]!), mesDe(limites.at(-1)!));

      const outros = somarRetiradas(
        await lerRetiradas(sb, [...tipos.keys()], `${meses[0]}-01`, ultimoDia(meses.at(-1)!), { exceto: extrato.id }),
        tipos,
      );
      res.json({
        limite: LIMITE_RETIRADAS,
        classificacoes,
        meses: meses.map((mes) => ({ mes, outros: outros.get(mes) ?? { pro_labore: 0, distribuicao: 0 } })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/historico', async (req, res, next) => {
    try {
      const ids = String(req.query.ids ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length > 200 || !ids.every((i) => uuid.safeParse(i).success)) throw badRequest('Lista de extratos inválida');
      if (!ids.length) return res.json({ limite: LIMITE_RETIRADAS, acima: {} });

      const { sb, empresas } = await acesso(req);
      const { data, error } = await sb
        .from('statements')
        .select('id, client_id, period_start, period_end, origem_modulo')
        .in('id', ids);
      if (error) throw mapPgrstError(error, 'buscar os extratos');
      const extratos = ((data ?? []) as Extrato[]).filter(
        (s) => !empresas || (empresas.includes(s.client_id) && s.origem_modulo === 'classificacao'),
      );
      const tipos = await classificacoesDeRetirada(sb, [...new Set(extratos.map((s) => s.client_id))]);
      if (!extratos.length || !tipos.size) return res.json({ limite: LIMITE_RETIRADAS, acima: {} });

      // meses de cada extrato: o período + os meses em que ele tem retirada
      const mesesDo = new Map<string, Set<string>>(extratos.map((s) => [s.id, new Set<string>()]));
      for (const s of extratos) {
        if (s.period_start && s.period_end) {
          for (const m of mesesEntre(mesDe(s.period_start), mesDe(s.period_end))) mesesDo.get(s.id)!.add(m);
        }
      }
      const proprias = await lerRetiradas(sb, [...tipos.keys()], '1900-01-01', '2999-12-31', {
        extratos: extratos.map((s) => s.id),
      });
      for (const l of proprias) mesesDo.get(l.statement_id)?.add(mesDe(l.data));

      const todos = [...mesesDo.values()].flatMap((m) => [...m]).sort();
      if (!todos.length) return res.json({ limite: LIMITE_RETIRADAS, acima: {} });

      // tudo o que as empresas retiraram nesses meses (todos os extratos delas)
      const porEmpresaMes = somarRetiradas(
        await lerRetiradas(sb, [...tipos.keys()], `${todos[0]}-01`, ultimoDia(todos.at(-1)!)),
        tipos,
        (l, c) => `${c.client_id}|${mesDe(l.data)}`,
      );

      const acima: Record<string, Array<Soma & { mes: string; total: number }>> = {};
      for (const s of extratos) {
        for (const mes of [...mesesDo.get(s.id)!].sort()) {
          const soma = porEmpresaMes.get(`${s.client_id}|${mes}`);
          const total = soma ? centavos(soma.pro_labore + soma.distribuicao) : 0;
          if (soma && total > LIMITE_RETIRADAS) (acima[s.id] ??= []).push({ mes, ...soma, total });
        }
      }
      res.json({ limite: LIMITE_RETIRADAS, acima });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Login do escritório: o banco com o próprio login (RLS = só o escritório dele). */
export const retiradasRouter = rotas(async (req) => {
  if (!req.supabase) throw new Error('supabase client ausente');
  return { sb: req.supabase, empresas: null };
});

/** Login de cliente: secret key, mas só as empresas liberadas pro login e só extratos da Classificação. */
export const portalRetiradasRouter = rotas(async (req) => {
  const admin = adminDe(req);
  const empresas = (await empresasDoLogin(admin, req.auth!.userId)).map((e) => e.id);
  return { sb: admin, empresas };
});
