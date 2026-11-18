/**
 * Travas na entrada do extrato (pedido de 2026-11-18): empresa errada, mesmo
 * extrato em qualquer empresa e extrato sobreposto.
 */
import { describe, expect, it } from 'vitest';
import { HttpError } from '../lib/httpError.js';
import { makeFakeSupabase, type FakeOp, type FakeRpcOp } from '../test/fakeSupabase.js';
import type { ParseResult } from './parserClient.js';
import { conferirTravas, contaChave, documentoEhDa, pedidoTravasSchema, type Trava } from './travas.js';

const ESC = 'esc-1';
const VALTER = { id: 'c-valter', razao_social: 'VALTER DE OLIVEIRA JUNIOR CONFECCAO LIMITADA', cnpj: '12345678000195' };
const JUNIOR = { id: 'c-junior', razao_social: 'JUNIOR CONFECCOES LIMITADA', cnpj: '98765432000110' };
const MEI = { id: 'c-mei', razao_social: 'ANDERSON DE OLIVEIRA PEREIRA JUNIOR 40014105837', cnpj: '35179467000125' };
const CLIENTES = [VALTER, JUNIOR, MEI];

type Gravado = { client_id: string; titular_doc?: string; conta_chave?: string; impressao?: string };

function lido(p: Partial<ParseResult> = {}): ParseResult {
  return {
    format: 'pdf',
    bank_id: null,
    account_id: null,
    titular_doc: null,
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    warnings: [],
    transactions: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      description: `LANC ${i}`,
      amount_cents: 1000 + i,
      direction: 'saida' as const,
      raw: {},
    })),
    ...p,
  };
}

const filtro = (op: FakeOp, col: string) => op.filters.find(([c]) => c === col)?.[1];

/** Banco falso: clientes do escritório + extratos já gravados + resultado da sobreposição. */
function banco(gravados: Gravado[] = [], sobreposicao: Record<string, unknown> = { total: 10, iguais: 0, extratos: [] }) {
  const rpcs: FakeRpcOp[] = [];
  const fake = makeFakeSupabase(
    (op) => {
      if (op.table === 'clients') {
        // donasDoDocumento: .or('cnpj.eq.X,cnpj.like.BASE*,razao_social.ilike.*CPF*')
        const ors = (op.or ?? '').split(',');
        const exceto = op.notFilters.find((n) => n.col === 'id')?.val;
        const achou = CLIENTES.filter(
          (c) =>
            c.id !== exceto &&
            ors.some((o) => {
              const [col, oper, ...resto] = o.split('.');
              const val = resto.join('.');
              const campo = col === 'cnpj' ? c.cnpj : c.razao_social;
              if (oper === 'eq') return campo === val;
              if (oper === 'like') return campo.startsWith(val.replace('*', ''));
              return campo.includes(val.replaceAll('*', ''));
            }),
        );
        return { data: achou, error: null };
      }
      if (op.table === 'statements') {
        const impressao = filtro(op, 'impressao');
        const titular = filtro(op, 'titular_doc');
        const conta = filtro(op, 'conta_chave');
        const linhas = gravados.filter(
          (g) =>
            (impressao === undefined || g.impressao === impressao) &&
            (titular === undefined || g.titular_doc === titular) &&
            (conta === undefined || g.conta_chave === conta),
        );
        return {
          data: linhas.map((g, i) => ({
            id: `s-${i}`,
            client_id: g.client_id,
            client: CLIENTES.find((c) => c.id === g.client_id),
            arquivo_nome: 'outubro.pdf',
            period_start: '2026-10-01',
            period_end: '2026-10-31',
            origem_modulo: 'classificacao',
            status: 'classificacao',
            created_at: '2026-11-03T14:00:00Z',
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    },
    undefined,
    (op) => {
      rpcs.push(op);
      return { data: sobreposicao, error: null };
    },
  );
  return { supabase: fake.client, ops: fake.ops, rpcs };
}

const ESCRITORIO = { papel: 'escritorio' as const, userId: 'u-esc', email: 'contador@escritorio.com' };
const CLIENTE = { papel: 'cliente' as const, userId: 'u-cli', email: 'cliente@empresa.com' };

async function travas(fn: () => Promise<unknown>): Promise<{ status: number; message: string; travas: Trava[]; code: string }> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof HttpError) {
      const d = e.details as { code: string; travas?: Trava[] };
      return { status: e.status, message: e.message, travas: d.travas ?? [], code: d.code };
    }
    throw e;
  }
  throw new Error('esperava o 409 das travas');
}

describe('de quem é o extrato', () => {
  it('documento da própria empresa: mesmo CNPJ, mesma raiz (filial) ou o CPF do MEI na razão social', () => {
    expect(documentoEhDa('12345678000195', VALTER)).toBe(true);
    expect(documentoEhDa('12345678000276', VALTER)).toBe(true);
    expect(documentoEhDa('40014105837', MEI)).toBe(true);
    expect(documentoEhDa('98765432000110', VALTER)).toBe(false);
    expect(documentoEhDa('40014105837', VALTER)).toBe(false);
  });

  it('conta: só dígitos, sem zeros à esquerda, 4 a 20 dígitos', () => {
    expect(contaChave('0290536074-4')).toBe('2905360744');
    expect(contaChave('12-3')).toBeNull();
    expect(contaChave(null)).toBeNull();
  });

  it('CNPJ do titular é o da empresa escolhida: entra, e grava titular e conta', async () => {
    const { supabase } = banco();
    const r = await conferirTravas(supabase, {
      ownerId: ESC,
      empresa: VALTER,
      parsed: lido({ titular_doc: VALTER.cnpj, account_id: '290536074-4' }),
      excetoId: 's-novo',
      quem: CLIENTE,
      pedido: { confirmo_empresa: false, liberar: [] },
    });
    expect(r.titular_doc).toBe(VALTER.cnpj);
    expect(r.conta_chave).toBe('2905360744');
    expect(r.conferencia).toMatchObject({ identificacao: 'titular', por: { user_id: 'u-cli', papel: 'cliente' } });
  });
});

describe('extrato de outra empresa (Junior subido na Valter)', () => {
  it('login de cliente que também é dono da Junior: recusa e oferece enviar na Junior', async () => {
    const { supabase } = banco();
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed: lido({ titular_doc: JUNIOR.cnpj }),
        excetoId: 's-novo',
        quem: CLIENTE,
        pedido: { confirmo_empresa: true, liberar: ['outra_empresa'] },
        visiveis: new Set([VALTER.id, JUNIOR.id]),
      }),
    );
    expect(r.status).toBe(409);
    expect(r.code).toBe('conferir_extrato');
    expect(r.travas).toEqual([
      expect.objectContaining({
        tipo: 'outra_empresa',
        por: 'titular',
        empresa: { id: JUNIOR.id, razao_social: JUNIOR.razao_social },
        pode_liberar: false,
      }),
    ]);
    expect(r.message).toBe(
      'Este extrato é da JUNIOR CONFECCOES LIMITADA (CNPJ/CPF 98.765.432/0001-10) e você está enviando na ' +
        'VALTER DE OLIVEIRA JUNIOR CONFECCAO LIMITADA.',
    );
  });

  it('login de cliente sem acesso à dona: recusa sem dizer de quem é', async () => {
    const { supabase } = banco();
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed: lido({ titular_doc: JUNIOR.cnpj }),
        excetoId: 's-novo',
        quem: CLIENTE,
        pedido: { confirmo_empresa: true, liberar: [] },
        visiveis: new Set([VALTER.id]),
      }),
    );
    expect(r.travas[0]).toMatchObject({ tipo: 'outra_empresa', empresa: null, pode_liberar: false });
    expect(r.message).not.toContain('JUNIOR CONFECCOES');
  });

  it('escritório pode liberar, e fica registrado quem liberou', async () => {
    const { supabase } = banco();
    const pedido = { ownerId: ESC, empresa: VALTER, parsed: lido({ titular_doc: JUNIOR.cnpj }), excetoId: 's-novo', quem: ESCRITORIO };
    const r = await travas(() => conferirTravas(supabase, { ...pedido, pedido: { confirmo_empresa: false, liberar: [] } }));
    expect(r.travas[0]).toMatchObject({ tipo: 'outra_empresa', pode_liberar: true, empresa: { id: JUNIOR.id } });

    const ok = await conferirTravas(supabase, { ...pedido, pedido: { confirmo_empresa: false, liberar: ['outra_empresa'] } });
    expect(ok.conferencia).toMatchObject({
      identificacao: 'liberado',
      liberado: ['outra_empresa'],
      por: { user_id: 'u-esc', email: 'contador@escritorio.com', papel: 'escritorio' },
    });
  });

  it('documento de ninguém cadastrado, mas que já entrou em outra empresa: é dela', async () => {
    const { supabase } = banco([{ client_id: JUNIOR.id, titular_doc: '11122233344' }]);
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed: lido({ titular_doc: '11122233344' }),
        excetoId: 's-novo',
        quem: ESCRITORIO,
        pedido: { confirmo_empresa: false, liberar: [] },
      }),
    );
    expect(r.travas[0]).toMatchObject({ tipo: 'outra_empresa', por: 'titular', empresa: { id: JUNIOR.id } });
  });
});

describe('documento que não é de ninguém', () => {
  it('cliente: bloqueado, manda falar com o escritório; escritório libera e o documento fica ligado', async () => {
    const vazio = banco();
    const base = {
      ownerId: ESC,
      empresa: VALTER,
      parsed: lido({ titular_doc: '11122233344' }),
      excetoId: 's-novo',
    };
    const cli = await travas(() =>
      conferirTravas(vazio.supabase, { ...base, quem: CLIENTE, pedido: { confirmo_empresa: true, liberar: ['titular_desconhecido'] } }),
    );
    expect(cli.travas[0]).toMatchObject({ tipo: 'titular_desconhecido', pode_liberar: false });
    expect(cli.message).toContain('Fale com o escritório');

    const esc = await conferirTravas(vazio.supabase, {
      ...base,
      quem: ESCRITORIO,
      pedido: { confirmo_empresa: false, liberar: ['titular_desconhecido'] },
    });
    expect(esc.titular_doc).toBe('11122233344');

    // da próxima vez, o mesmo CPF nessa empresa entra direto
    const depois = banco([{ client_id: VALTER.id, titular_doc: '11122233344' }]);
    const ok = await conferirTravas(depois.supabase, { ...base, quem: CLIENTE, pedido: { confirmo_empresa: false, liberar: [] } });
    expect(ok.conferencia).toMatchObject({ identificacao: 'titular' });
  });
});

describe('sem CNPJ: a conta', () => {
  const sem = (conta: string) => lido({ account_id: conta });

  it('conta que já entrou nesta empresa: entra direto', async () => {
    const { supabase } = banco([{ client_id: VALTER.id, conta_chave: '2905360744' }]);
    const r = await conferirTravas(supabase, {
      ownerId: ESC,
      empresa: VALTER,
      parsed: sem('290536074-4'),
      excetoId: 's-novo',
      quem: CLIENTE,
      pedido: { confirmo_empresa: false, liberar: [] },
    });
    expect(r.conferencia).toMatchObject({ identificacao: 'conta' });
  });

  it('conta que é de outra empresa: recusa', async () => {
    const { supabase } = banco([{ client_id: JUNIOR.id, conta_chave: '2905360744' }]);
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed: sem('290536074-4'),
        excetoId: 's-novo',
        quem: CLIENTE,
        pedido: { confirmo_empresa: true, liberar: [] },
        visiveis: new Set([VALTER.id]),
      }),
    );
    expect(r.travas[0]).toMatchObject({ tipo: 'outra_empresa', por: 'conta', empresa: null });
  });

  it('conta nunca vista: o usuário confirma uma vez', async () => {
    const { supabase } = banco();
    const base = { ownerId: ESC, empresa: VALTER, parsed: sem('290536074-4'), excetoId: 's-novo', quem: CLIENTE };
    const r = await travas(() => conferirTravas(supabase, { ...base, pedido: { confirmo_empresa: false, liberar: [] } }));
    expect(r.travas).toEqual([expect.objectContaining({ tipo: 'confirmar_empresa', empresa: { id: VALTER.id, razao_social: VALTER.razao_social } })]);
    expect(r.message).toContain('primeiro extrato da conta 2905360744');

    const ok = await conferirTravas(supabase, { ...base, pedido: { confirmo_empresa: true, liberar: [] } });
    expect(ok.conta_chave).toBe('2905360744');
    expect(ok.conferencia).toMatchObject({ identificacao: 'confirmado', confirmado: true, por: { user_id: 'u-cli' } });
  });

  it('nem CNPJ nem conta (OFX/CSV/planilha sem cabeçalho): confirma a empresa', async () => {
    const { supabase } = banco();
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed: lido(),
        excetoId: 's-novo',
        quem: ESCRITORIO,
        pedido: { confirmo_empresa: false, liberar: ['outra_empresa'] },
        origem: 'planilha',
      }),
    );
    expect(r.travas[0]).toMatchObject({ tipo: 'confirmar_empresa' });
    expect(r.message).toBe(
      'A planilha não diz de qual empresa é. Confirme que ela é da VALTER DE OLIVEIRA JUNIOR CONFECCAO LIMITADA.',
    );
  });
});

describe('mesmo extrato em qualquer empresa', () => {
  it('já está em outra empresa: recusa dizendo onde (escritório) — e nem o escritório libera', async () => {
    const parsed = lido({ titular_doc: VALTER.cnpj });
    const { impressaoDoExtrato } = await import('./impressao.js');
    const { supabase, ops } = banco([{ client_id: JUNIOR.id, impressao: impressaoDoExtrato(parsed.transactions) }]);
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed,
        excetoId: 's-novo',
        quem: ESCRITORIO,
        pedido: { confirmo_empresa: true, liberar: ['outra_empresa', 'sobreposto'] },
      }),
    );
    expect(r.code).toBe('extrato_duplicado');
    expect(r.message).toMatch(/^Esse extrato já foi importado na empresa JUNIOR CONFECCOES LIMITADA: "outubro\.pdf"/);
    const busca = ops.find((o) => o.table === 'statements' && filtro(o, 'impressao'))!;
    expect(busca.filters).toContainEqual(['owner_id', ESC]);
    expect(busca.filters.some(([c]) => c === 'client_id')).toBe(false);
  });

  it('portal: o original está numa empresa que o login não vê — recusa sem nome nem arquivo', async () => {
    const parsed = lido({ titular_doc: VALTER.cnpj });
    const { impressaoDoExtrato } = await import('./impressao.js');
    const { supabase } = banco([{ client_id: JUNIOR.id, impressao: impressaoDoExtrato(parsed.transactions) }]);
    const r = await travas(() =>
      conferirTravas(supabase, {
        ownerId: ESC,
        empresa: VALTER,
        parsed,
        excetoId: 's-novo',
        quem: CLIENTE,
        pedido: { confirmo_empresa: true, liberar: [] },
        visiveis: new Set([VALTER.id]),
      }),
    );
    expect(r.code).toBe('extrato_duplicado');
    expect(r.message).not.toMatch(/JUNIOR|outubro/);
  });
});

describe('extrato que se sobrepõe a outro da empresa', () => {
  const pedido = (quem: typeof CLIENTE | typeof ESCRITORIO, liberar: Array<'sobreposto'> = []) => ({
    ownerId: ESC,
    empresa: VALTER,
    parsed: lido({ titular_doc: VALTER.cnpj }),
    excetoId: 's-novo',
    quem,
    pedido: { confirmo_empresa: false, liberar },
  });
  const quinzena = {
    total: 10,
    iguais: 9,
    extratos: [
      {
        id: 's-q',
        arquivo_nome: 'quinzena.pdf',
        period_start: '2026-10-01',
        period_end: '2026-10-15',
        origem_modulo: 'classificacao',
        status: 'classificacao',
        created_at: '2026-10-16T10:00:00Z',
        iguais: 9,
      },
    ],
  };

  it('80% ou mais já existe: recusa dizendo em qual extrato', async () => {
    const { supabase, rpcs } = banco([], quinzena);
    const r = await travas(() => conferirTravas(supabase, pedido(CLIENTE)));
    expect(r.travas).toEqual([expect.objectContaining({ tipo: 'sobreposto', iguais: 9, total: 10, pode_liberar: false })]);
    expect(r.message).toContain('9 dos 10 lançamentos deste extrato já estão em outro extrato');
    expect(r.message).toContain('"quinzena.pdf", de 01/10/2026 a 15/10/2026');
    expect(rpcs[0]).toMatchObject({
      fn: 'sobreposicao_extrato',
      args: { p_client: VALTER.id, p_excluir: 's-novo' },
    });
    expect((rpcs[0]!.args.p_linhas as string[])[0]).toBe('2026-10-01|1000|saida');
  });

  it('menos de 80%: entra (duas contas da mesma empresa podem ter um ou outro lançamento igual)', async () => {
    const { supabase } = banco([], { ...quinzena, iguais: 7 });
    const r = await conferirTravas(supabase, pedido(CLIENTE));
    expect(r.conferencia).toMatchObject({ identificacao: 'titular' });
  });

  it('o cliente não libera; o escritório sim, e fica registrado', async () => {
    const { supabase } = banco([], quinzena);
    const cli = await travas(() => conferirTravas(supabase, { ...pedido(CLIENTE, ['sobreposto']) }));
    expect(cli.travas[0]).toMatchObject({ tipo: 'sobreposto' });
    const esc = await conferirTravas(supabase, pedido(ESCRITORIO, ['sobreposto']));
    expect(esc.conferencia).toMatchObject({ liberado: ['sobreposto'], sobreposicao: { iguais: 9, total: 10 } });
  });

  it('várias travas de uma vez: a tela recebe todas', async () => {
    const { supabase } = banco([], quinzena);
    const r = await travas(() =>
      conferirTravas(supabase, { ...pedido(CLIENTE), parsed: lido({ titular_doc: JUNIOR.cnpj }), visiveis: new Set([VALTER.id]) }),
    );
    expect(r.travas.map((t) => t.tipo)).toEqual(['outra_empresa', 'sobreposto']);
  });
});

describe('respostas da tela (multipart)', () => {
  it('lê confirmo_empresa e a lista de liberações; trava desconhecida é erro', () => {
    expect(pedidoTravasSchema.parse({ confirmo_empresa: 'true', liberar: 'outra_empresa, sobreposto' })).toEqual({
      confirmo_empresa: true,
      liberar: ['outra_empresa', 'sobreposto'],
    });
    expect(pedidoTravasSchema.parse({})).toEqual({ confirmo_empresa: false, liberar: [] });
    expect(pedidoTravasSchema.safeParse({ liberar: 'extrato_duplicado' }).success).toBe(false);
  });
});
