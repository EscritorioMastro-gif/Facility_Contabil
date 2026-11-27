/**
 * /api/marketplaces — conferência de pedidos da Shopee (migration 0034).
 *
 *   POST   /shopee/importar                (multipart: client_id + arquivos[])  lê e grava os relatórios
 *   GET    /shopee/importacoes?client_id                          o que já foi importado e a loja ligada
 *   GET    /shopee/conferencia?client_id&escopo=mes&mes=AAAA-MM   pedidos do mês (data do pedido)
 *          ...&escopo=periodo&de=AAAA-MM-DD&ate=AAAA-MM-DD        pedidos criados no período (até 366 dias)
 *          ...&escopo=pendentes                                   o que precisa de chamado e ainda não entrou em nenhum (180 dias)
 *          ...&escopo=chamado&chamado_id=                         os pedidos de um chamado
 *   GET    /shopee/custos?client_id&de=AAAA-MM&ate=AAAA-MM        custos do mês a mês (carteira)
 *   GET    /shopee/chamados?client_id                             os chamados da empresa, com os números
 *   POST   /shopee/chamados                                       abrir um chamado com um LOTE de pedidos
 *   PATCH  /shopee/chamados/:id                                   nº, observação, lote resolvido/reaberto
 *   PATCH  /shopee/chamados/:id/pedido                            um pedido do lote: resolver, reabrir, tirar
 *   DELETE /shopee/chamados/:id                                   excluir o chamado (os pedidos ficam livres)
 *   GET    /shopee/tarifas[?client_id]                            a tabela que vale pra empresa (escritório)
 *                                                                 ou a do próprio login (cliente)
 *   PUT    /shopee/tarifas                                        o CLIENTE grava a tabela dele; escritório: 403
 *
 * Os relatórios são lidos em memória e só as colunas de pedido/valor são
 * gravadas (nada do comprador); o arquivo não é guardado.
 */
import { Router, type Request } from 'express';
import multer from 'multer';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { adminDe } from '../lib/admin.js';
import { HttpError, badRequest, forbidden, notFound } from '../lib/httpError.js';
import { lerTodas, mapPgrstError } from '../lib/pgrst.js';
import { empresasDoLogin } from '../portal/acesso.js';
import {
  conferir,
  diaEmSaoPaulo,
  precisaDeChamado,
  sobreposicoes,
  type Item,
  type Movimento,
  type Pedido,
  type Repasse,
  type StatusPedido,
  type Tarifa,
} from './conferencia.js';
import { custosPorMes } from './custos.js';
import { importarRelatorio, lojaDaEmpresa, travarLoja, type ResultadoImportacao } from './importar.js';
import { lerRelatorioShopee, RelatorioDesconhecido, type RelatorioShopee } from './shopee.js';
import { lerXlsx, XlsxInvalido } from './xlsx.js';

const MARKETPLACE = 'shopee';
const uuid = z.string().uuid();
/** "Pendentes sem chamado" olha os pedidos dos últimos 180 dias. */
const DIAS_PENDENTES = 180;
/** Custos: no máximo 12 meses por consulta. */
const MESES_CUSTOS = 12;
/** Conferência por período: no máximo um ano de pedidos por consulta. */
const DIAS_PERIODO = 366;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
});

type Acesso = {
  sb: SupabaseClient;
  papel: 'escritorio' | 'cliente';
  userId: string;
  email: string;
  /** cliente: as empresas liberadas pro login (com o escritório dono) */
  empresas: Array<{ id: string; owner_id: string }> | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const numOuNulo = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const conflito = (msg: string, details?: unknown) => new HttpError(409, msg, details);
const embed = <T>(v: unknown): T | null => ((Array.isArray(v) ? v[0] : v) as T | null) ?? null;

/** A empresa, se o login pode vê-la — senão 404. */
async function exigirEmpresa(a: Acesso, clientId: string): Promise<{ id: string; owner_id: string }> {
  if (!uuid.safeParse(clientId).success) throw notFound('Empresa não encontrada');
  if (a.empresas) {
    const e = a.empresas.find((x) => x.id === clientId);
    if (!e) throw notFound('Empresa não encontrada');
    return e;
  }
  const { data, error } = await a.sb.from('clients').select('id, owner_id').eq('id', clientId).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar a empresa');
  if (!data) throw notFound('Empresa não encontrada');
  return data as { id: string; owner_id: string };
}

/** O chamado, se é de uma empresa que o login vê — senão 404. */
async function exigirChamado(a: Acesso, id: string): Promise<{ id: string; client_id: string }> {
  if (!uuid.safeParse(id).success) throw notFound('Chamado não encontrado');
  const { data, error } = await a.sb.from('marketplace_chamados').select('id, client_id').eq('id', id).maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar o chamado');
  if (!data) throw notFound('Chamado não encontrado');
  await exigirEmpresa(a, (data as { client_id: string }).client_id);
  return data as { id: string; client_id: string };
}

// --------------------------------------------------------------------------- #
// Tabela de tarifas
// --------------------------------------------------------------------------- #
type LinhaTarifa = Tarifa & { id: string; usuario_id: string; obs: string | null; preenchido_por_email: string; preenchido_em: string };

const COLS_TARIFA =
  'id, usuario_id, vigencia_inicio, vigencia_fim, preco_min, preco_max, comissao_pct, transacao_pct, campanha_pct, por_item, por_pedido, obs, preenchido_por_email, preenchido_em';

function paraTarifa(r: Record<string, unknown>): LinhaTarifa {
  return {
    id: r.id as string,
    usuario_id: r.usuario_id as string,
    vigencia_inicio: r.vigencia_inicio as string,
    vigencia_fim: (r.vigencia_fim as string | null) ?? null,
    preco_min: num(r.preco_min),
    preco_max: numOuNulo(r.preco_max),
    comissao_pct: num(r.comissao_pct),
    transacao_pct: num(r.transacao_pct),
    campanha_pct: num(r.campanha_pct),
    por_item: num(r.por_item),
    por_pedido: num(r.por_pedido),
    obs: (r.obs as string | null) ?? null,
    preenchido_por_email: r.preenchido_por_email as string,
    preenchido_em: r.preenchido_em as string,
  };
}

const ordemTabela = (a: Tarifa, b: Tarifa) =>
  a.vigencia_inicio.localeCompare(b.vigencia_inicio) || a.preco_min - b.preco_min;

/** A tabela de um login de cliente. */
async function tabelaDoLogin(sb: SupabaseClient, usuarioId: string): Promise<LinhaTarifa[]> {
  const { data, error } = await sb
    .from('marketplace_tarifas')
    .select(COLS_TARIFA)
    .eq('usuario_id', usuarioId)
    .eq('marketplace', MARKETPLACE);
  if (error) throw mapPgrstError(error, 'ler a tabela de tarifas');
  return ((data ?? []) as Record<string, unknown>[]).map(paraTarifa).sort(ordemTabela);
}

/**
 * A tabela que vale pra empresa: a dos logins de cliente com acesso a ela.
 * Mais de um login preencheu → vale a salva por último.
 */
async function tabelaDaEmpresa(sb: SupabaseClient, clientId: string) {
  const { data: acessos, error } = await sb.from('cliente_acessos').select('user_id').eq('client_id', clientId);
  if (error) throw mapPgrstError(error, 'ler os logins da empresa');
  const logins = [...new Set(((acessos ?? []) as Array<{ user_id: string }>).map((a) => a.user_id))];
  if (!logins.length) return { linhas: [] as LinhaTarifa[], por_email: null, em: null, sem_login: true };

  const { data, error: tErr } = await sb
    .from('marketplace_tarifas')
    .select(COLS_TARIFA)
    .in('usuario_id', logins)
    .eq('marketplace', MARKETPLACE);
  if (tErr) throw mapPgrstError(tErr, 'ler a tabela de tarifas');
  const todas = ((data ?? []) as Record<string, unknown>[]).map(paraTarifa);
  if (!todas.length) return { linhas: [] as LinhaTarifa[], por_email: null, em: null, sem_login: false };

  // o login que salvou por último
  const ultima = todas.reduce((a, b) => (b.preenchido_em > a.preenchido_em ? b : a));
  const linhas = todas.filter((t) => t.usuario_id === ultima.usuario_id).sort(ordemTabela);
  return { linhas, por_email: ultima.preenchido_por_email, em: ultima.preenchido_em, sem_login: false };
}

// --------------------------------------------------------------------------- #
// Pedidos, pagamentos e carteira
// --------------------------------------------------------------------------- #
type InfoChamado = {
  id: string;
  numero: string | null;
  aberto_em: string;
  aberto_por_email: string;
  obs: string | null;
  resolvido_em: string | null;
};

const COLS_PEDIDO =
  'pedido, status, status_marketplace, status_devolucao, motivo_cancelamento, criado_em, concluido_em, valor_produtos, itens, chamado_id, chamado_resolvido_em, chamado_resolvido_por_email, chamado:marketplace_chamados(id, numero, aberto_em, aberto_por_email, obs, resolvido_em)';

const COLS_REPASSE =
  'pedido, criado_dia, pago_em, preco, reembolso, cupom, incentivo_cupom, voucher_loja, frete_comprador, frete_desconto, frete_transportadora, comissao_bruta, comissao_liquida, servico_bruta, servico_liquida, transacao, campanha, por_item, devolucao_facil, afiliados_comissao, afiliados_servico, pix, envio_reverso, outros, liquido, frete_esperado, frete_real';

const COLS_MOVIMENTO = 'pedido, data, seq, categoria, valor, saldo_apos, tipo, descricao';

const NUM_REPASSE = [
  'preco',
  'reembolso',
  'cupom',
  'incentivo_cupom',
  'voucher_loja',
  'frete_comprador',
  'frete_desconto',
  'frete_transportadora',
  'comissao_bruta',
  'comissao_liquida',
  'servico_bruta',
  'servico_liquida',
  'transacao',
  'campanha',
  'por_item',
  'devolucao_facil',
  'afiliados_comissao',
  'afiliados_servico',
  'pix',
  'envio_reverso',
  'outros',
  'liquido',
] as const;

function paraRepasse(r: Record<string, unknown>): Repasse {
  const out = {
    pedido: r.pedido as string,
    criado_dia: (r.criado_dia as string | null) ?? null,
    pago_em: (r.pago_em as string | null) ?? null,
    frete_esperado: numOuNulo(r.frete_esperado),
    frete_real: numOuNulo(r.frete_real),
  } as Repasse;
  for (const k of NUM_REPASSE) (out as Record<string, unknown>)[k] = num(r[k]);
  return out;
}

const paraMovimento = (r: Record<string, unknown>): Movimento => ({
  pedido: (r.pedido as string | null) ?? null,
  data: r.data as string,
  seq: num(r.seq),
  categoria: r.categoria as Movimento['categoria'],
  valor: num(r.valor),
  saldo_apos: numOuNulo(r.saldo_apos),
  tipo: (r.tipo as string | undefined) ?? undefined,
  descricao: (r.descricao as string | null) ?? null,
});

/** Lê linhas de uma tabela pelos nº de pedido, em lotes. */
async function porPedidos(
  sb: SupabaseClient,
  tabela: string,
  cols: string,
  clientId: string,
  pedidos: string[],
  contexto: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const unicos = [...new Set(pedidos)];
  for (let i = 0; i < unicos.length; i += 200) {
    const lote = unicos.slice(i, i + 200);
    const linhas = await lerTodas<Record<string, unknown>>(
      (de, ate) =>
        // colunas numa variável: o tipo do supabase-js não deduz as linhas — vão como registro solto
        sb
          .from(tabela)
          .select(cols)
          .eq('client_id', clientId)
          .eq('marketplace', MARKETPLACE)
          .in('pedido', lote)
          .range(de, ate) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: PostgrestError | null }>,
      contexto,
    );
    out.push(...linhas);
  }
  return out;
}

function paraPedido(p: Record<string, unknown>): Pedido {
  const c = embed<InfoChamado>(p.chamado);
  return {
    pedido: p.pedido as string,
    status: p.status as StatusPedido,
    criado_em: (p.criado_em as string | null) ?? null,
    concluido_em: (p.concluido_em as string | null) ?? null,
    status_devolucao: (p.status_devolucao as string | null) ?? null,
    motivo_cancelamento: (p.motivo_cancelamento as string | null) ?? null,
    itens: ((p.itens as Item[] | null) ?? []).map((i) => ({ ...i, preco: num(i.preco), qtd: num(i.qtd), devolvidos: num(i.devolvidos) })),
    chamado_aberto_em: c?.aberto_em ?? null,
    chamado_resolvido_em: (p.chamado_resolvido_em as string | null) ?? c?.resolvido_em ?? null,
  };
}

/** Itens que pagaram tarifa em cada pedido (devolução antes do pagamento: na proporção do que ficou). */
function unidadesDosPedidos(pedidos: Pedido[], repasses: Map<string, Repasse>): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pedidos) {
    if (!p.itens.length) continue;
    const qtd = p.itens.reduce((s, i) => s + i.qtd, 0);
    const x = repasses.get(p.pedido);
    const fatia = x && x.preco > 0 && x.reembolso < 0 ? Math.max(0, x.preco + x.reembolso) / x.preco : 1;
    out.set(p.pedido, Math.round(qtd * fatia));
  }
  return out;
}

const ultimoDia = (mes: string) => {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const mesesEntre = (de: string, ate: string) => {
  const [a1, m1] = de.split('-').map(Number) as [number, number];
  const [a2, m2] = ate.split('-').map(Number) as [number, number];
  return (a2 - a1) * 12 + (m2 - m1) + 1;
};

/** Os pedidos conferidos (pagamentos, carteira e a tabela do cliente). */
async function conferirPedidos(sb: SupabaseClient, clientId: string, brutos: Record<string, unknown>[]) {
  const ids = brutos.map((p) => p.pedido as string);
  const repasses = (await porPedidos(sb, 'marketplace_repasses', COLS_REPASSE, clientId, ids, 'ler os pagamentos')).map(paraRepasse);
  const movimentos = (await porPedidos(sb, 'marketplace_carteira', COLS_MOVIMENTO, clientId, ids, 'ler a carteira')).map(paraMovimento);
  const tabela = await tabelaDaEmpresa(sb, clientId);
  const pedidos = brutos.map(paraPedido);
  const { pedidos: conferidos, resumo } = conferir(pedidos, repasses, movimentos, tabela.linhas, new Date());
  const repDe = new Map(repasses.map((x) => [x.pedido, x]));
  return { conferidos, resumo, tabela, repDe };
}

// --------------------------------------------------------------------------- #
// Validação
// --------------------------------------------------------------------------- #
const mesFmt = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'mês no formato AAAA-MM');
const diaFmt = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'data no formato AAAA-MM-DD');
/** Dias entre duas datas AAAA-MM-DD (as duas contam). */
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000) + 1;
const conferenciaQuery = z
  .object({
    client_id: z.string().uuid(),
    escopo: z.enum(['mes', 'periodo', 'pendentes', 'chamado']).default('mes'),
    mes: mesFmt.optional(),
    de: diaFmt.optional(),
    ate: diaFmt.optional(),
    chamado_id: z.string().uuid().optional(),
  })
  .refine((q) => q.escopo !== 'mes' || !!q.mes, 'mês no formato AAAA-MM')
  .refine((q) => q.escopo !== 'periodo' || (!!q.de && !!q.ate), 'informe as datas de início e fim')
  .refine((q) => q.escopo !== 'periodo' || !q.de || !q.ate || q.de <= q.ate, 'a data inicial vem depois da final')
  .refine(
    (q) => q.escopo !== 'periodo' || !q.de || !q.ate || diasEntre(q.de, q.ate) <= DIAS_PERIODO,
    `no máximo ${DIAS_PERIODO} dias por vez`,
  )
  .refine((q) => q.escopo !== 'chamado' || !!q.chamado_id, 'escolha o chamado');
const custosQuery = z
  .object({ client_id: z.string().uuid(), de: mesFmt, ate: mesFmt })
  .refine((q) => q.de <= q.ate, 'o mês inicial vem depois do final')
  .refine((q) => mesesEntre(q.de, q.ate) <= MESES_CUSTOS, `no máximo ${MESES_CUSTOS} meses por vez`);

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD');
const texto = (max: number) => z.string().trim().max(max).nullable().optional();

const abrirChamadoBody = z.object({
  client_id: z.string().uuid(),
  pedidos: z.array(z.string().trim().min(1).max(64)).min(1, 'Escolha pelo menos um pedido.').max(2000),
  numero: texto(60),
  aberto_em: data,
  obs: texto(500),
});
const alterarChamadoBody = z.object({
  numero: texto(60),
  obs: texto(500),
  acao: z.enum(['resolver', 'reabrir']).optional(),
});
const pedidoDoChamadoBody = z.object({
  pedido: z.string().trim().min(1).max(64),
  acao: z.enum(['resolver', 'reabrir', 'tirar']),
});

const dinheiro = z.coerce.number().min(0).max(1_000_000_000);
const percentual = z.coerce.number().min(0).max(100);
const linhaTarifaBody = z
  .object({
    id: z.string().uuid().optional(),
    vigencia_inicio: data,
    vigencia_fim: data.nullable().optional(),
    preco_min: dinheiro,
    preco_max: dinheiro.nullable().optional(),
    comissao_pct: percentual,
    transacao_pct: percentual.default(0),
    campanha_pct: percentual.default(0),
    por_item: dinheiro.default(0),
    por_pedido: dinheiro.default(0),
    obs: z.string().trim().max(200).nullable().optional(),
  })
  .refine((t) => !t.vigencia_fim || t.vigencia_fim >= t.vigencia_inicio, 'o fim da vigência vem antes do início')
  .refine((t) => t.preco_max === null || t.preco_max === undefined || t.preco_max >= t.preco_min, 'o preço máximo é menor que o mínimo');
const tarifasBody = z.object({ tarifas: z.array(linhaTarifaBody).max(200) });

const primeiroErro = (e: z.ZodError, padrao: string) => {
  const i = e.issues[0];
  const linha = typeof i?.path[1] === 'number' && i.path[0] === 'tarifas' ? `Linha ${i.path[1] + 1}: ` : '';
  return `${linha}${i?.message ?? padrao}`;
};

/** Erro de nº de chamado repetido (índice único). */
const numeroRepetido = (error: { code?: string; message?: string }) =>
  error.code === '23505' && /numero/i.test(error.message ?? '');

/** Nome do arquivo que veio no upload (o multer às vezes entrega UTF-8 lido como latin1: "lanÃ§ado"). */
const nomeDoArquivo = (f: Express.Multer.File) => {
  const bruto = f.originalname || 'arquivo.xlsx';
  const convertido = Buffer.from(bruto, 'latin1').toString('utf8');
  return convertido.includes('�') ? bruto : convertido;
};

function rotas(acesso: (req: Request) => Promise<Acesso>) {
  const router = Router();

  // ------------------------------------------------------------------------ #
  router.post('/shopee/importar', upload.array('arquivos', 6), async (req, res, next) => {
    try {
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, String((req.body as Record<string, unknown>)?.client_id ?? ''));
      const arquivos = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (!arquivos.length) throw badRequest('Escolha pelo menos um relatório da Shopee (.xlsx).');

      // lê tudo antes de gravar qualquer coisa
      const lidos: Array<{ nome: string; rel: RelatorioShopee }> = [];
      const erros: Array<{ arquivo: string; erro: string }> = [];
      for (const f of arquivos) {
        const nome = nomeDoArquivo(f);
        try {
          lidos.push({ nome, rel: lerRelatorioShopee(lerXlsx(f.buffer)) });
        } catch (e) {
          if (e instanceof XlsxInvalido || e instanceof RelatorioDesconhecido) erros.push({ arquivo: nome, erro: e.message });
          else throw e;
        }
      }
      if (erros.length) {
        throw badRequest(
          erros.length === 1 ? `${erros[0]!.arquivo}: ${erros[0]!.erro}` : 'Alguns arquivos não são relatórios da Shopee.',
          { code: 'arquivo_invalido', arquivos: erros },
        );
      }
      const lojas = [...new Set(lidos.map((l) => l.rel.loja?.trim()).filter((l): l is string => !!l))];
      if (lojas.length > 1) {
        throw conflito(`Os relatórios são de lojas diferentes (${lojas.join(', ')}). Importe uma loja por vez.`, {
          code: 'lojas_diferentes',
          lojas,
        });
      }
      if (lojas[0]) await travarLoja(a.sb, empresa, lojas[0]);

      const importados: ResultadoImportacao[] = [];
      for (const l of lidos) importados.push(await importarRelatorio(a.sb, empresa, l.rel, l.nome, a.email));
      res.status(201).json({ importados, loja: lojas[0] ?? (await lojaDaEmpresa(a.sb, empresa.id)) });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/shopee/importacoes', async (req, res, next) => {
    try {
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, String(req.query.client_id ?? ''));
      const { data: linhas, error } = await a.sb
        .from('marketplace_importacoes')
        .select('id, tipo, arquivo, loja, periodo_de, periodo_ate, linhas, importado_por_email, importado_em')
        .eq('client_id', empresa.id)
        .eq('marketplace', MARKETPLACE)
        .order('importado_em', { ascending: false })
        .limit(100);
      if (error) throw mapPgrstError(error, 'ler as importações');
      res.json({ loja: await lojaDaEmpresa(a.sb, empresa.id), importacoes: linhas ?? [] });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/shopee/conferencia', async (req, res, next) => {
    try {
      const q = conferenciaQuery.safeParse(req.query);
      if (!q.success) throw badRequest(primeiroErro(q.error, 'Filtro inválido'));
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, q.data.client_id);
      const { escopo, mes, chamado_id, de: periodoDe, ate: periodoAte } = q.data;

      const brutos = await lerTodas<Record<string, unknown>>((de, ate) => {
        let qb = a.sb.from('marketplace_pedidos').select(COLS_PEDIDO).eq('client_id', empresa.id).eq('marketplace', MARKETPLACE);
        if (escopo === 'mes') {
          qb = qb.gte('criado_em', `${mes}-01T00:00:00-03:00`).lte('criado_em', `${ultimoDia(mes!)}T23:59:59.999-03:00`);
        } else if (escopo === 'periodo') {
          // data de criação do pedido, em São Paulo, com os dois dias inclusos
          qb = qb.gte('criado_em', `${periodoDe}T00:00:00-03:00`).lte('criado_em', `${periodoAte}T23:59:59.999-03:00`);
        } else if (escopo === 'pendentes') {
          qb = qb.gte('criado_em', new Date(Date.now() - DIAS_PENDENTES * 24 * 60 * 60 * 1000).toISOString());
        } else {
          qb = qb.eq('chamado_id', chamado_id!);
        }
        return qb.order('criado_em').order('pedido').range(de, ate);
      }, 'ler os pedidos');

      let { conferidos, resumo, tabela, repDe } = await conferirPedidos(a.sb, empresa.id, brutos);
      let escolhidos = brutos;
      if (escopo === 'pendentes') {
        // só o que precisa de chamado e ainda não entrou em nenhum
        const ficam = conferidos.map((c, i) => precisaDeChamado(c) && !brutos[i]!.chamado_id);
        escolhidos = brutos.filter((_, i) => ficam[i]);
        ({ conferidos, resumo, tabela, repDe } = await conferirPedidos(a.sb, empresa.id, escolhidos));
      }

      res.json({
        escopo,
        mes: mes ?? null,
        de: periodoDe ?? null,
        ate: periodoAte ?? null,
        tabela: { preenchida: tabela.linhas.length > 0, por_email: tabela.por_email, em: tabela.em },
        resumo,
        pedidos: conferidos.map((c, i) => {
          const p = escolhidos[i]!;
          const x = repDe.get(c.pedido);
          return {
            ...c,
            status_marketplace: (p.status_marketplace as string | null) ?? null,
            motivo_cancelamento: (p.motivo_cancelamento as string | null) ?? null,
            criado_em: (p.criado_em as string | null) ?? null,
            concluido_em: (p.concluido_em as string | null) ?? null,
            valor_produtos: numOuNulo(p.valor_produtos) ?? x?.preco ?? null,
            itens: ((p.itens as Item[] | null) ?? []).reduce((s, it) => s + num(it.qtd), 0),
            chamado_info: embed<InfoChamado>(p.chamado),
            chamado_resolvido_em: p.chamado_resolvido_em ?? null,
            chamado_resolvido_por_email: p.chamado_resolvido_por_email ?? null,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/shopee/custos', async (req, res, next) => {
    try {
      const q = custosQuery.safeParse(req.query);
      if (!q.success) throw badRequest(primeiroErro(q.error, 'Período inválido'));
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, q.data.client_id);
      const movimentos = (
        await lerTodas<Record<string, unknown>>(
          (de, ate) =>
            a.sb
              .from('marketplace_carteira')
              .select(COLS_MOVIMENTO)
              .eq('client_id', empresa.id)
              .eq('marketplace', MARKETPLACE)
              .gte('data', `${q.data.de}-01T00:00:00-03:00`)
              .lte('data', `${ultimoDia(q.data.ate)}T23:59:59.999-03:00`)
              .order('data')
              .order('seq')
              .range(de, ate),
          'ler a carteira',
        )
      ).map(paraMovimento);
      const ids = movimentos.map((m) => m.pedido).filter((p): p is string => !!p);
      const repasses = (await porPedidos(a.sb, 'marketplace_repasses', COLS_REPASSE, empresa.id, ids, 'ler os pagamentos')).map(
        paraRepasse,
      );
      const pedidos = (
        await porPedidos(a.sb, 'marketplace_pedidos', 'pedido, status, criado_em, concluido_em, itens', empresa.id, ids, 'ler os pedidos')
      ).map(paraPedido);
      const repDe = new Map(repasses.map((x) => [x.pedido, x]));
      const r = custosPorMes(movimentos, repasses, unidadesDosPedidos(pedidos, repDe));
      res.json({ de: q.data.de, ate: q.data.ate, ...r, sem_carteira: movimentos.length === 0 });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/shopee/chamados', async (req, res, next) => {
    try {
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, String(req.query.client_id ?? ''));
      const { data: cs, error } = await a.sb
        .from('marketplace_chamados')
        .select('id, numero, aberto_em, aberto_por_email, obs, resolvido_em, resolvido_por_email, created_at')
        .eq('client_id', empresa.id)
        .eq('marketplace', MARKETPLACE)
        .order('aberto_em', { ascending: false })
        .limit(500);
      if (error) throw mapPgrstError(error, 'ler os chamados');
      const chamados = (cs ?? []) as Array<Record<string, unknown> & { id: string; resolvido_em: string | null }>;

      // os pedidos de cada chamado, conferidos: pago sem nada a cobrar = resolvido sozinho;
      // pago COM cobrança a mais continua pendente (o chamado é justamente pela cobrança)
      const brutos: Record<string, unknown>[] = [];
      const ids = chamados.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: ps, error: pErr } = await a.sb
          .from('marketplace_pedidos')
          .select(COLS_PEDIDO)
          .eq('client_id', empresa.id)
          .in('chamado_id', ids.slice(i, i + 200));
        if (pErr) throw mapPgrstError(pErr, 'ler os pedidos dos chamados');
        brutos.push(...((ps ?? []) as Record<string, unknown>[]));
      }
      const { conferidos } = await conferirPedidos(a.sb, empresa.id, brutos);
      const pedidos = brutos.map((p, i) => ({
        chamado_id: p.chamado_id as string,
        valor: num(p.valor_produtos),
        pago: conferidos[i]!.pagamento === 'pago',
        resolvido: !!p.chamado_resolvido_em || (conferidos[i]!.pagamento === 'pago' && !precisaDeChamado(conferidos[i]!)),
      }));

      res.json({
        chamados: chamados.map((c) => {
          const dele = pedidos.filter((p) => p.chamado_id === c.id);
          const resolvidos = dele.filter((p) => p.resolvido).length;
          return {
            ...c,
            pedidos: dele.length,
            valor: Math.round(dele.reduce((s, p) => s + p.valor, 0) * 100) / 100,
            pagos: dele.filter((p) => p.pago).length,
            resolvidos,
            situacao: c.resolvido_em ? 'resolvido' : dele.length && resolvidos === dele.length ? 'concluido' : 'aberto',
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.post('/shopee/chamados', async (req, res, next) => {
    try {
      const b = abrirChamadoBody.safeParse(req.body);
      if (!b.success) throw badRequest(primeiroErro(b.error, 'Chamado inválido'));
      if (b.data.aberto_em > diaEmSaoPaulo(new Date().toISOString())) throw badRequest('A data de abertura está no futuro.');
      const a = await acesso(req);
      const empresa = await exigirEmpresa(a, b.data.client_id);
      const { data: r, error } = await a.sb.rpc('abrir_chamado_marketplace', {
        p_client: empresa.id,
        p_marketplace: MARKETPLACE,
        p_pedidos: [...new Set(b.data.pedidos)],
        p_numero: b.data.numero ?? null,
        p_aberto_em: b.data.aberto_em,
        p_obs: b.data.obs ?? null,
        p_email: a.email,
      });
      if (error) {
        if (error.code === 'MP409') {
          let ocupados: unknown = [];
          try {
            ocupados = JSON.parse(error.details ?? '[]');
          } catch {
            /* detalhe fora do formato: segue sem a lista */
          }
          throw conflito('Há pedido(s) que já estão em outro chamado — tire-os da seleção.', {
            code: 'pedido_em_chamado',
            pedidos: ocupados,
          });
        }
        if (numeroRepetido(error)) throw conflito('Já existe um chamado com esse número nesta empresa.');
        if (error.code === 'P0002') throw notFound(error.message);
        if (error.code === '22023') throw badRequest(error.message);
        throw mapPgrstError(error, 'abrir o chamado');
      }
      res.status(201).json({ chamado: r });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.patch('/shopee/chamados/:id', async (req, res, next) => {
    try {
      const b = alterarChamadoBody.safeParse(req.body);
      if (!b.success) throw badRequest(primeiroErro(b.error, 'Alteração inválida'));
      const a = await acesso(req);
      const chamado = await exigirChamado(a, req.params.id);
      const mudanca: Record<string, unknown> = {};
      if (b.data.numero !== undefined) mudanca.numero = b.data.numero || null;
      if (b.data.obs !== undefined) mudanca.obs = b.data.obs || null;
      if (b.data.acao === 'resolver') {
        mudanca.resolvido_em = diaEmSaoPaulo(new Date().toISOString());
        mudanca.resolvido_por_email = a.email;
      }
      if (b.data.acao === 'reabrir') {
        mudanca.resolvido_em = null;
        mudanca.resolvido_por_email = null;
      }
      if (!Object.keys(mudanca).length) throw badRequest('Nada para alterar.');
      const { data: linha, error } = await a.sb
        .from('marketplace_chamados')
        .update(mudanca)
        .eq('id', chamado.id)
        .select('id, numero, aberto_em, aberto_por_email, obs, resolvido_em, resolvido_por_email')
        .maybeSingle();
      if (error) {
        if (numeroRepetido(error)) throw conflito('Já existe um chamado com esse número nesta empresa.');
        throw mapPgrstError(error, 'alterar o chamado');
      }
      res.json({ chamado: linha });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.patch('/shopee/chamados/:id/pedido', async (req, res, next) => {
    try {
      const b = pedidoDoChamadoBody.safeParse(req.body);
      if (!b.success) throw badRequest(primeiroErro(b.error, 'Alteração inválida'));
      const a = await acesso(req);
      const chamado = await exigirChamado(a, req.params.id);
      const mudanca =
        b.data.acao === 'resolver'
          ? { chamado_resolvido_em: diaEmSaoPaulo(new Date().toISOString()), chamado_resolvido_por_email: a.email }
          : b.data.acao === 'reabrir'
            ? { chamado_resolvido_em: null, chamado_resolvido_por_email: null }
            : { chamado_id: null, chamado_resolvido_em: null, chamado_resolvido_por_email: null };
      const { data: linha, error } = await a.sb
        .from('marketplace_pedidos')
        .update(mudanca)
        .eq('client_id', chamado.client_id)
        .eq('chamado_id', chamado.id)
        .eq('pedido', b.data.pedido)
        .select('pedido, chamado_id, chamado_resolvido_em')
        .maybeSingle();
      if (error) throw mapPgrstError(error, 'alterar o pedido do chamado');
      if (!linha) throw notFound('Esse pedido não está neste chamado');
      res.json({ pedido: linha });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.delete('/shopee/chamados/:id', async (req, res, next) => {
    try {
      const a = await acesso(req);
      const chamado = await exigirChamado(a, req.params.id);
      const { error } = await a.sb.from('marketplace_chamados').delete().eq('id', chamado.id);
      if (error) throw mapPgrstError(error, 'excluir o chamado');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.get('/shopee/tarifas', async (req, res, next) => {
    try {
      const a = await acesso(req);
      if (a.papel === 'cliente' && !req.query.client_id) {
        const linhas = await tabelaDoLogin(a.sb, a.userId);
        return res.json({ tarifas: linhas, pode_editar: true, empresas: a.empresas?.length ?? 0 });
      }
      const empresa = await exigirEmpresa(a, String(req.query.client_id ?? ''));
      const t = await tabelaDaEmpresa(a.sb, empresa.id);
      res.json({
        tarifas: t.linhas,
        preenchido_por_email: t.por_email,
        preenchido_em: t.em,
        sem_login: t.sem_login,
        pode_editar: false,
      });
    } catch (err) {
      next(err);
    }
  });

  // ------------------------------------------------------------------------ #
  router.put('/shopee/tarifas', async (req, res, next) => {
    try {
      const a = await acesso(req);
      if (a.papel !== 'cliente') throw forbidden('A tabela de tarifas é preenchida pelo cliente, no portal.');
      const b = tarifasBody.safeParse(req.body);
      if (!b.success) throw badRequest(primeiroErro(b.error, 'Tabela inválida'));
      const novas = b.data.tarifas.map((t) => ({
        ...t,
        vigencia_fim: t.vigencia_fim ?? null,
        preco_max: t.preco_max ?? null,
        obs: t.obs || null,
      }));
      const sobre = sobreposicoes(novas);
      if (sobre.length) {
        const [i, j] = sobre[0]!;
        throw badRequest(
          `As linhas ${i + 1} e ${j + 1} valem para o mesmo preço no mesmo período — ajuste a faixa de preço ou a vigência.`,
        );
      }
      const dono = a.empresas?.[0]?.owner_id;
      if (!dono) throw badRequest('O seu login ainda não tem empresa liberada.');

      const atuais = await tabelaDoLogin(a.sb, a.userId);
      const porId = new Map(atuais.map((t) => [t.id, t]));
      const mantidas = new Set<string>();
      const agora = new Date().toISOString();
      const CAMPOS = [
        'vigencia_inicio',
        'vigencia_fim',
        'preco_min',
        'preco_max',
        'comissao_pct',
        'transacao_pct',
        'campanha_pct',
        'por_item',
        'por_pedido',
        'obs',
      ] as const;
      const mudou = (x: LinhaTarifa, y: (typeof novas)[number]) => CAMPOS.some((k) => (x[k] ?? null) !== (y[k] ?? null));

      const inserir: Record<string, unknown>[] = [];
      for (const t of novas) {
        const campos = Object.fromEntries(CAMPOS.map((k) => [k, t[k] ?? null]));
        const atual = t.id ? porId.get(t.id) : undefined;
        if (atual) {
          mantidas.add(atual.id);
          if (!mudou(atual, t)) continue;
          const { error } = await a.sb
            .from('marketplace_tarifas')
            .update({ ...campos, preenchido_por_email: a.email, preenchido_em: agora })
            .eq('id', atual.id)
            .eq('usuario_id', a.userId);
          if (error) throw mapPgrstError(error, 'salvar a tabela de tarifas');
        } else {
          inserir.push({
            ...campos,
            owner_id: dono,
            usuario_id: a.userId,
            marketplace: MARKETPLACE,
            preenchido_por_email: a.email,
            preenchido_em: agora,
          });
        }
      }
      const remover = atuais.filter((t) => !mantidas.has(t.id)).map((t) => t.id);
      if (remover.length) {
        const { error } = await a.sb.from('marketplace_tarifas').delete().in('id', remover).eq('usuario_id', a.userId);
        if (error) throw mapPgrstError(error, 'salvar a tabela de tarifas');
      }
      if (inserir.length) {
        const { error } = await a.sb.from('marketplace_tarifas').insert(inserir);
        if (error) throw mapPgrstError(error, 'salvar a tabela de tarifas');
      }
      res.json({ tarifas: await tabelaDoLogin(a.sb, a.userId), pode_editar: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Login do escritório: o banco com o próprio login (RLS = só o escritório dele). */
export const marketplacesRouter = rotas(async (req) => {
  if (!req.supabase) throw new Error('supabase client ausente');
  return { sb: req.supabase, papel: 'escritorio', userId: req.auth!.userId, email: req.auth!.email ?? '', empresas: null };
});

/** Login de cliente: secret key, só as empresas liberadas pro login. */
export const portalMarketplacesRouter = rotas(async (req) => {
  const admin = adminDe(req);
  const userId = req.auth!.userId;
  const empresas = (await empresasDoLogin(admin, userId)).map((e) => ({ id: e.id, owner_id: e.owner_id }));
  let email = req.auth!.email ?? null;
  if (!email) {
    const { data } = await admin.from('cliente_acessos').select('email').eq('user_id', userId).limit(1);
    email = (data?.[0]?.email as string | undefined) ?? '(sem e-mail)';
  }
  return { sb: admin, papel: 'cliente', userId, email, empresas };
});
