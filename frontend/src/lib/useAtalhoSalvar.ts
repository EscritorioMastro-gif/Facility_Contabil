import { useEffect, useRef } from 'react';

/**
 * Ctrl+S (⌘S no Mac) salva a tela em vez de abrir o "Salvar página" do
 * navegador — o atalho que todo mundo já tenta por reflexo.
 */
export function useAtalhoSalvar(salvar: () => void): void {
  const ref = useRef(salvar);
  useEffect(() => {
    ref.current = salvar;
  }, [salvar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
