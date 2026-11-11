/**
 * Banco em memória pro makeFakeSupabase: as tabelas são listas de linhas e as
 * operações (select/insert/upsert/update/delete com eq/in/neq) mexem nelas de
 * verdade — pra testar regra que depende do estado (lista de classificações
 * compartilhada entre empresas, por exemplo) sem roteirizar cada resposta.
 */
import type { FakeHandler, FakeOp, FakeResult } from './fakeSupabase.js';

export type Linha = Record<string, unknown>;
export type Tabelas = Record<string, Linha[]>;

type Opcoes = {
  /** colunas únicas por tabela (cada item = um índice único) */
  unicos?: Record<string, string[][]>;
  /** valores padrão de uma linha nova */
  padroes?: Record<string, Linha>;
  /** resposta fixa pra uma tabela (ex.: count de uso), quando não dá pra simular */
  fixo?: (op: FakeOp, tabelas: Tabelas) => FakeResult | undefined;
};

function casa(linha: Linha, op: FakeOp): boolean {
  for (const [col, val] of op.filters) {
    if (Array.isArray(val) ? !val.includes(linha[col]) : linha[col] !== val) return false;
  }
  for (const f of op.notFilters) {
    if (f.op === 'eq' && linha[f.col] === f.val) return false;
    if (f.op === 'is' && f.val === null && linha[f.col] == null) return false;
  }
  for (const r of op.rangeFilters) {
    const v = String(linha[r.col] ?? '');
    if (r.op === 'gte' && v < String(r.val)) return false;
    if (r.op === 'lte' && v > String(r.val)) return false;
  }
  return true;
}

function ordenar(linhas: Linha[], op: FakeOp): Linha[] {
  const ordens = op.orderCalls.filter((o) => !o.foreignTable);
  return [...linhas].sort((a, b) => {
    for (const o of ordens) {
      const x = String(a[o.col] ?? '');
      const y = String(b[o.col] ?? '');
      if (x !== y) return (x < y ? -1 : 1) * (o.ascending === false ? -1 : 1);
    }
    return 0;
  });
}

export function bancoEmMemoria(tabelas: Tabelas, opcoes: Opcoes = {}): FakeHandler {
  let seq = 0;
  const violaUnico = (tabela: string, nova: Linha, ignorar?: Linha) =>
    (opcoes.unicos?.[tabela] ?? []).some((cols) =>
      (tabelas[tabela] ?? []).some((l) => l !== ignorar && cols.every((c) => l[c] === nova[c])),
    );

  return (op) => {
    const fixo = opcoes.fixo?.(op, tabelas);
    if (fixo) return fixo;
    const linhas = (tabelas[op.table] ??= []);

    if (op.verb === 'select') {
      let out = ordenar(linhas.filter((l) => casa(l, op)), op);
      const count = out.length;
      if (op.range) out = out.slice(op.range[0], op.range[1] + 1);
      if (op.limit !== undefined) out = out.slice(0, op.limit);
      if (op.single) return { data: out[0] ?? null, error: null, count };
      return { data: out, error: null, count };
    }

    if (op.verb === 'insert' || op.verb === 'upsert') {
      const novas = (Array.isArray(op.payload) ? op.payload : [op.payload]) as Linha[];
      const gravadas: Linha[] = [];
      for (const n of novas) {
        const linha = { id: `${op.table}-${++seq}`, ...opcoes.padroes?.[op.table], ...n };
        if (violaUnico(op.table, linha)) {
          if (op.verb === 'upsert' && op.ignoreDuplicates) continue;
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        linhas.push(linha);
        gravadas.push(linha);
      }
      return { data: op.single ? (gravadas[0] ?? null) : gravadas, error: null };
    }

    if (op.verb === 'update') {
      const alvo = linhas.filter((l) => casa(l, op));
      for (const l of alvo) {
        const nova = { ...l, ...(op.payload as Linha) };
        if (violaUnico(op.table, nova, l)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
      }
      for (const l of alvo) Object.assign(l, op.payload as Linha);
      return { data: op.single ? (alvo[0] ?? null) : alvo, error: null, count: alvo.length };
    }

    // delete
    const ficam = linhas.filter((l) => !casa(l, op));
    const count = linhas.length - ficam.length;
    tabelas[op.table] = ficam;
    return { data: null, error: null, count };
  };
}
