/**
 * Travas na entrada do extrato (pedido de 2026-11-18, migration 0027).
 *
 * Toda importação (escritório e portal do cliente, extrato novo, planilha e
 * reimportação) passa por aqui depois da leitura e antes de gravar:
 *
 * 1. MESMO EXTRATO — mesma impressão em qualquer empresa do escritório: recusa
 *    sempre (impressao.ts), nem o escritório libera.
 * 2. EMPRESA CERTA — de quem é o extrato, nesta ordem:
 *    a. CNPJ/CPF do titular lido no extrato (parser/app/parsers/titular.py):
 *       é da empresa escolhida (mesmo CNPJ, mesma raiz de CNPJ, ou o CPF que
 *       está na razão social do MEI) → entra. É de outra empresa cadastrada →
 *       trava "outra_empresa". Não é de ninguém cadastrado, mas já entrou
 *       antes numa empresa → é dela. Senão → "titular_desconhecido".
 *    b. Sem titular: a conta. Conta que já entrou nesta empresa → entra; em
 *       outra → "outra_empresa"; nunca vista → o usuário confirma uma vez.
 *    c. Nada (OFX/CSV/planilha sem nada, PDF sem CNPJ nem conta) → o usuário
 *       confirma ("confirmar_empresa").
 *    A ligação documento/conta → empresa sai dos próprios extratos gravados
 *    (statements.titular_doc / conta_chave): excluir o extrato desfaz junto.
 * 3. SOBREPOSIÇÃO — 80% ou mais dos lançamentos já estão em outros extratos da
 *    empresa (quinzena + mês inteiro, mês + trimestre) → "sobreposto".
 *
 * Quem resolve: "confirmar_empresa" o próprio usuário (cliente ou escritório),
 * marcando que confere. As outras só o escritório libera ("liberar"), e fica
 * registrado em statements.conferencia quem e quando. O login de cliente nunca
 * libera — e nunca fica sabendo o nome de uma empresa que não é dele.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { HttpError } from '../lib/httpError.js';
import { mapPgrstError } from '../lib/pgrst.js';
import { dataBr, impressaoDoExtrato, linhasDoExtrato, recusarDuplicado } from './impressao.js';
import type { ParseResult } from './parserClient.js';

export const LIBERAVEIS = ['outra_empresa', 'titular_desconhecido', 'sobreposto'] as const;
export type Liberavel = (typeof LIBERAVEIS)[number];

/** A partir de quanto do extrato já existente na empresa ele é tratado como sobreposto. */
export const LIMITE_SOBREPOSICAO = 0.8;

/** Campos do multipart com as respostas do usuário às travas (tudo chega como string). */
export const pedidoTravasSchema = z.object({
  confirmo_empresa: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  liberar: z
    .string()
    .max(200)
    .optional()
    .transform((s, ctx) => {
      const itens = (s ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      for (const i of itens) {
        if (!(LIBERAVEIS as readonly string[]).includes(i)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `trava desconhecida: ${i}` });
          return z.NEVER;
        }
      }
      return itens as Liberavel[];
    }),
});
export type PedidoTravas = z.infer<typeof pedidoTravasSchema>;

type EmpresaRef = { id: string; razao_social: string; cnpj: string };

type ExtratoAchado = {
  id: string;
  arquivo_nome: string;
  period_start: string | null;
  period_end: string | null;
  origem_modulo: string;
  status: string;
  created_at: string;
  iguais: number;
};

export type Trava =
  | {
      tipo: 'outra_empresa';
      mensagem: string;
      por: 'titular' | 'conta';
      /** a dona do extrato — null quando o login não enxerga a empresa */
      empresa: { id: string; razao_social: string } | null;
      pode_liberar: boolean;
    }
  | { tipo: 'titular_desconhecido'; mensagem: string; documento: string; pode_liberar: boolean }
  | { tipo: 'confirmar_empresa'; mensagem: string; empresa: { id: string; razao_social: string } }
  | {
      tipo: 'sobreposto';
      mensagem: string;
      iguais: number;
      total: number;
      extratos: ExtratoAchado[];
      pode_liberar: boolean;
    };

/** O que vai pro extrato gravado (colunas da 0027). */
export type Conferencia = {
  titular_doc: string | null;
  conta_chave: string | null;
  conferencia: Record<string, unknown>;
};

export type QuemEnvia = { papel: 'escritorio' | 'cliente'; userId: string; email: string | null };

/** Só dígitos, sem zeros à esquerda; 4 a 20 dígitos (igual ao check da 0027) — senão null. */
export function contaChave(conta: string | null | undefined): string | null {
  const d = (conta ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 4 && d.length <= 20 ? d : null;
}

function documentoValido(doc: string | null | undefined): string | null {
  const d = (doc ?? '').replace(/\D/g, '');
  return d.length === 11 || d.length === 14 ? d : null;
}

export function formatarDoc(d: string): string {
  return d.length === 14
    ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

/**
 * O documento lido no extrato é desta empresa? Mesmo CNPJ; mesma raiz (8
 * primeiros dígitos — matriz e filial são a mesma empresa); ou, no MEI, o CPF
 * do dono que está na razão social ("ANDERSON ... 40014105837").
 */
export function documentoEhDa(doc: string, empresa: { cnpj: string; razao_social: string }): boolean {
  if (doc === empresa.cnpj) return true;
  if (doc.length === 14 && empresa.cnpj.length === 14 && doc.slice(0, 8) === empresa.cnpj.slice(0, 8)) return true;
  if (doc.length === 11 && empresa.razao_social.replace(/\D/g, '').includes(doc)) return true;
  return false;
}

/** Empresas cadastradas (fora a escolhida) a quem o documento pertence — a de CNPJ igual primeiro. */
async function donasDoDocumento(
  supabase: SupabaseClient,
  p: { ownerId: string; doc: string; exceto: string },
): Promise<EmpresaRef[]> {
  const filtros = [`cnpj.eq.${p.doc}`];
  if (p.doc.length === 14) filtros.push(`cnpj.like.${p.doc.slice(0, 8)}*`);
  if (p.doc.length === 11) filtros.push(`razao_social.ilike.*${p.doc}*`);
  const { data, error } = await supabase
    .from('clients')
    .select('id, razao_social, cnpj')
    .eq('owner_id', p.ownerId)
    .neq('id', p.exceto)
    .or(filtros.join(','))
    .limit(20);
  if (error) throw mapPgrstError(error, 'conferir de quem é o extrato');
  return ((data ?? []) as EmpresaRef[])
    .filter((c) => documentoEhDa(p.doc, c))
    .sort((a, b) => Number(b.cnpj === p.doc) - Number(a.cnpj === p.doc));
}

/** Empresas onde já entrou extrato (fora os com erro e o próprio) com este titular / esta conta. */
async function empresasQueJaUsaram(
  supabase: SupabaseClient,
  p: { ownerId: string; coluna: 'titular_doc' | 'conta_chave'; valor: string; excetoId: string },
): Promise<EmpresaRef[]> {
  const { data, error } = await supabase
    .from('statements')
    .select('client_id, client:clients(id, razao_social, cnpj)')
    .eq('owner_id', p.ownerId)
    .eq(p.coluna, p.valor)
    .neq('status', 'erro')
    .neq('id', p.excetoId)
    .limit(50);
  if (error) throw mapPgrstError(error, 'conferir de quem é o extrato');
  const porId = new Map<string, EmpresaRef>();
  for (const s of (data ?? []) as unknown as Array<{ client_id: string; client: EmpresaRef | null }>) {
    porId.set(s.client_id, s.client ?? { id: s.client_id, razao_social: 'outra empresa', cnpj: '' });
  }
  return [...porId.values()];
}

type Identificacao =
  | { ok: true; como: 'titular' | 'conta' }
  | { ok: false; trava: Exclude<Trava, { tipo: 'sobreposto' }> };

async function identificar(
  supabase: SupabaseClient,
  p: {
    ownerId: string;
    empresa: EmpresaRef;
    doc: string | null;
    conta: string | null;
    excetoId: string;
    origem: 'extrato' | 'planilha';
    escritorio: boolean;
    visiveis: Set<string> | null;
  },
): Promise<Identificacao> {
  const { empresa, doc, conta } = p;
  const ref = (e: EmpresaRef) => (p.visiveis && !p.visiveis.has(e.id) ? null : { id: e.id, razao_social: e.razao_social });

  if (doc) {
    if (documentoEhDa(doc, empresa)) return { ok: true, como: 'titular' };

    let dona: EmpresaRef | undefined = (await donasDoDocumento(supabase, { ownerId: p.ownerId, doc, exceto: empresa.id }))[0];
    if (!dona) {
      const usaram = await empresasQueJaUsaram(supabase, {
        ownerId: p.ownerId,
        coluna: 'titular_doc',
        valor: doc,
        excetoId: p.excetoId,
      });
      if (usaram.some((e) => e.id === empresa.id)) return { ok: true, como: 'titular' };
      dona = usaram[0];
    }

    if (dona) {
      const visivel = ref(dona);
      return {
        ok: false,
        trava: {
          tipo: 'outra_empresa',
          por: 'titular',
          empresa: visivel,
          pode_liberar: p.escritorio,
          mensagem: visivel
            ? `Este extrato é da ${visivel.razao_social} (CNPJ/CPF ${formatarDoc(doc)}) e você está enviando na ${empresa.razao_social}.`
            : `O CNPJ/CPF deste extrato (${formatarDoc(doc)}) não é o da ${empresa.razao_social}. Confira se escolheu a empresa certa.`,
        },
      };
    }

    return {
      ok: false,
      trava: {
        tipo: 'titular_desconhecido',
        documento: doc,
        pode_liberar: p.escritorio,
        mensagem:
          `O CNPJ/CPF deste extrato (${formatarDoc(doc)}) não é o da ${empresa.razao_social} ` +
          'nem de nenhuma empresa cadastrada no escritório. ' +
          (p.escritorio
            ? 'Se ele é mesmo desta empresa (ex.: conta no CPF do sócio), libere — o documento fica ligado a ela.'
            : 'Fale com o escritório para liberar este extrato.'),
      },
    };
  }

  if (conta) {
    const usaram = await empresasQueJaUsaram(supabase, {
      ownerId: p.ownerId,
      coluna: 'conta_chave',
      valor: conta,
      excetoId: p.excetoId,
    });
    if (usaram.some((e) => e.id === empresa.id)) return { ok: true, como: 'conta' };
    const dona = usaram[0];
    if (dona) {
      const visivel = ref(dona);
      return {
        ok: false,
        trava: {
          tipo: 'outra_empresa',
          por: 'conta',
          empresa: visivel,
          pode_liberar: p.escritorio,
          mensagem: visivel
            ? `A conta ${conta} deste extrato é da ${visivel.razao_social} (já entrou extrato dela lá) e você está enviando na ${empresa.razao_social}.`
            : `A conta deste extrato já é de outra empresa do escritório. Confira se escolheu a empresa certa.`,
        },
      };
    }
    return {
      ok: false,
      trava: {
        tipo: 'confirmar_empresa',
        empresa: { id: empresa.id, razao_social: empresa.razao_social },
        mensagem:
          `É o primeiro extrato da conta ${conta} no sistema. Confirme que ela é da ${empresa.razao_social} — ` +
          'os próximos extratos dessa conta entram direto.',
      },
    };
  }

  return {
    ok: false,
    trava: {
      tipo: 'confirmar_empresa',
      empresa: { id: empresa.id, razao_social: empresa.razao_social },
      mensagem:
        p.origem === 'planilha'
          ? `A planilha não diz de qual empresa é. Confirme que ela é da ${empresa.razao_social}.`
          : `Não consegui ler neste extrato o CNPJ do titular nem o número da conta. Confirme que ele é da ${empresa.razao_social}.`,
    },
  };
}

async function sobreposicao(
  supabase: SupabaseClient,
  p: { empresa: EmpresaRef; parsed: ParseResult; excetoId: string; escritorio: boolean },
): Promise<Extract<Trava, { tipo: 'sobreposto' }> | null> {
  const linhas = linhasDoExtrato(p.parsed.transactions);
  if (!linhas.length) return null;
  const { data, error } = await supabase.rpc('sobreposicao_extrato', {
    p_client: p.empresa.id,
    p_linhas: linhas,
    p_excluir: p.excetoId,
  });
  if (error) throw mapPgrstError(error, 'conferir se o extrato repete lançamentos já importados');
  const r = (data ?? {}) as { total?: number; iguais?: number; extratos?: ExtratoAchado[] };
  const total = Number(r.total ?? linhas.length);
  const iguais = Number(r.iguais ?? 0);
  if (!total || iguais / total < LIMITE_SOBREPOSICAO) return null;

  const extratos = (r.extratos ?? []).slice(0, 5);
  const principal = extratos[0];
  const onde = principal
    ? `"${principal.arquivo_nome}"` +
      (principal.period_start && principal.period_end
        ? `, de ${dataBr(principal.period_start)} a ${dataBr(principal.period_end)}`
        : '') +
      (extratos.length > 1 ? ` e mais ${extratos.length - 1}` : '')
    : 'outro extrato';
  return {
    tipo: 'sobreposto',
    iguais,
    total,
    extratos,
    pode_liberar: p.escritorio,
    mensagem:
      `${iguais} dos ${total} lançamentos deste extrato já estão em outro extrato da ${p.empresa.razao_social} (${onde}). ` +
      'Parece o mesmo período enviado de novo (ex.: quinzena e depois o mês inteiro). ' +
      (p.escritorio
        ? 'Exclua o outro antes, ou importe assim mesmo se tiver certeza.'
        : 'Se for o caso, exclua o outro antes de enviar este.'),
  };
}

/**
 * Passa o extrato lido pelas travas. Tudo certo (ou resolvido pelo usuário) →
 * devolve o que gravar no extrato. Senão → 409 `conferir_extrato` com a lista
 * de travas pendentes (a tela mostra e reenvia com as respostas), ou o 409
 * `extrato_duplicado` de sempre.
 */
export async function conferirTravas(
  supabase: SupabaseClient,
  p: {
    ownerId: string;
    empresa: EmpresaRef;
    parsed: ParseResult;
    /** o extrato que acabou de ser criado (ou o que está sendo reimportado) */
    excetoId: string;
    quem: QuemEnvia;
    pedido: PedidoTravas;
    origem?: 'extrato' | 'planilha';
    /** portal: empresas do login — as outras não têm o nome revelado */
    visiveis?: Set<string> | null;
  },
): Promise<Conferencia> {
  const escritorio = p.quem.papel === 'escritorio';
  const visiveis = escritorio ? null : (p.visiveis ?? new Set([p.empresa.id]));

  await recusarDuplicado(supabase, {
    ownerId: p.ownerId,
    clientId: p.empresa.id,
    impressao: impressaoDoExtrato(p.parsed.transactions),
    excetoId: p.excetoId,
    visiveis,
  });

  const doc = documentoValido(p.parsed.titular_doc);
  const conta = contaChave(p.parsed.account_id);
  const id = await identificar(supabase, {
    ownerId: p.ownerId,
    empresa: p.empresa,
    doc,
    conta,
    excetoId: p.excetoId,
    origem: p.origem ?? 'extrato',
    escritorio,
    visiveis,
  });
  const sobreposto = await sobreposicao(supabase, {
    empresa: p.empresa,
    parsed: p.parsed,
    excetoId: p.excetoId,
    escritorio,
  });

  const travas: Trava[] = [...(id.ok ? [] : [id.trava]), ...(sobreposto ? [sobreposto] : [])];
  const liberar = new Set(p.pedido.liberar ?? []);
  const resolvida = (t: Trava) =>
    t.tipo === 'confirmar_empresa' ? p.pedido.confirmo_empresa === true : escritorio && liberar.has(t.tipo);
  const pendentes = travas.filter((t) => !resolvida(t));
  if (pendentes.length) {
    throw new HttpError(409, pendentes.map((t) => t.mensagem).join(' '), {
      code: 'conferir_extrato',
      travas: pendentes,
    });
  }

  const liberadas = travas.filter((t) => t.tipo !== 'confirmar_empresa').map((t) => t.tipo);
  const identificacao = id.ok
    ? id.como
    : id.trava.tipo === 'confirmar_empresa'
      ? 'confirmado'
      : 'liberado';
  return {
    titular_doc: doc,
    conta_chave: conta,
    conferencia: {
      identificacao,
      em: new Date().toISOString(),
      por: { user_id: p.quem.userId, email: p.quem.email, papel: p.quem.papel },
      ...(identificacao === 'confirmado' ? { confirmado: true } : {}),
      ...(liberadas.length ? { liberado: liberadas } : {}),
      ...(sobreposto ? { sobreposicao: { iguais: sobreposto.iguais, total: sobreposto.total } } : {}),
    },
  };
}
