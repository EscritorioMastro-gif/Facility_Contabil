import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@/lib/types';

type DraftMap = Map<string, string | null>;
export type OrigemMemoria = 'memoria' | 'conferir';

/** Rascunho local de `classificacao_id` por lançamento — mesmo padrão do
 *  useRevisaoDraft, só que com um campo em vez de conta/histórico/ignorado.
 *
 *  Memória: o lançamento pode ter vindo classificado pela memória
 *  (`classificacao_origem`) ou receber uma sugestão agora ("Preencher pela
 *  memória"). Sugestão ('conferir') aceita sem mudar o valor também é
 *  alteração: ao salvar, deixa de ser sugestão. */
export function useClassificacaoDraft(transactions: Transaction[]) {
  const initial = useMemo<DraftMap>(() => {
    const m = new Map<string, string | null>();
    for (const t of transactions) m.set(t.id, t.classificacao_id);
    return m;
  }, [transactions]);

  const [draft, setDraft] = useState<DraftMap>(() => new Map(initial));
  const [aceitas, setAceitas] = useState<Set<string>>(() => new Set());
  const [sugeridas, setSugeridas] = useState<Map<string, OrigemMemoria>>(() => new Map());

  useEffect(() => {
    setDraft(new Map(initial));
    setAceitas(new Set());
    setSugeridas(new Map());
  }, [initial]);

  const get = useCallback((id: string): string | null => draft.get(id) ?? null, [draft]);

  const patchRow = useCallback((id: string, classificacaoId: string | null) => {
    setDraft((d) => {
      if (!d.has(id)) return d;
      const next = new Map(d);
      next.set(id, classificacaoId);
      return next;
    });
    setSugeridas((s) => {
      if (!s.has(id)) return s;
      const next = new Map(s);
      next.delete(id);
      return next;
    });
  }, []);

  const patchMany = useCallback(
    (predicate: (t: Transaction) => boolean, classificacaoId: string | null) => {
      const ids = transactions.filter(predicate).map((t) => t.id);
      setDraft((d) => {
        const next = new Map(d);
        for (const id of ids) if (next.has(id)) next.set(id, classificacaoId);
        return next;
      });
      setSugeridas((s) => {
        const next = new Map(s);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    [transactions],
  );

  /** Sugestões da memória entram no rascunho (o operador confere e salva). */
  const aplicarSugestoes = useCallback(
    (lista: Array<{ id: string; classificacao_id: string; origem: OrigemMemoria }>) => {
      setDraft((d) => {
        const next = new Map(d);
        for (const s of lista) if (next.has(s.id) && !next.get(s.id)) next.set(s.id, s.classificacao_id);
        return next;
      });
      setSugeridas((cur) => {
        const next = new Map(cur);
        for (const s of lista) if (!draft.get(s.id)) next.set(s.id, s.origem);
        return next;
      });
    },
    [draft],
  );

  /** O operador concorda com a sugestão (sem trocar a classificação). */
  const aceitar = useCallback((ids: string[]) => {
    setAceitas((a) => new Set([...a, ...ids]));
    setSugeridas((s) => {
      const next = new Map(s);
      for (const id of ids) if (next.get(id) === 'conferir') next.set(id, 'memoria');
      return next;
    });
  }, []);

  /** De onde veio a classificação que está na tela agora (null = escolhida por alguém). */
  const origemDe = useCallback(
    (t: Transaction): OrigemMemoria | null => {
      const atual = draft.get(t.id) ?? null;
      const sugerida = sugeridas.get(t.id);
      if (sugerida) return sugerida;
      if (atual !== (initial.get(t.id) ?? null) || !atual) return null;
      if (aceitas.has(t.id)) return null;
      return t.classificacao_origem ?? null;
    },
    [draft, sugeridas, initial, aceitas],
  );

  const reset = useCallback(() => {
    setDraft(new Map(initial));
    setAceitas(new Set());
    setSugeridas(new Map());
  }, [initial]);

  const changes = useMemo(() => {
    const out: { id: string; classificacao_id: string | null }[] = [];
    for (const t of transactions) {
      const d = draft.get(t.id);
      const base = initial.get(t.id);
      if (d === undefined) continue;
      if (d === base && !aceitas.has(t.id)) continue;
      out.push({ id: t.id, classificacao_id: d });
    }
    return out;
  }, [transactions, draft, initial, aceitas]);

  return {
    get,
    patchRow,
    patchMany,
    aplicarSugestoes,
    aceitar,
    origemDe,
    reset,
    changes,
    isDirty: changes.length > 0,
  };
}
