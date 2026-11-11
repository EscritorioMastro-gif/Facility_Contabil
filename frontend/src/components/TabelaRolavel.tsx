/**
 * Tabela larga com rolagem PRÓPRIA (pedido do user, 2026-11-11): antes a barra
 * de rolagem para o lado ficava no fim da tabela — com 200 lançamentos era
 * preciso descer a tela inteira para passar para o lado. Agora a tabela tem
 * altura máxima da tela, rola dentro dela nos dois sentidos (a barra lateral
 * fica sempre à vista) e o cabeçalho fica parado no topo enquanto desce.
 */
export function TabelaRolavel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`card max-h-[72vh] overflow-auto overscroll-contain [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-slate-50 [&_thead_th]:shadow-[inset_0_-1px_0_#e2e8f0] ${className}`}
    >
      {children}
    </div>
  );
}
