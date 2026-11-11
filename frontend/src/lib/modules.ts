import type { Papel } from '@/auth/authContext';

/** Módulos do sistema — usado pelo hub (seleção) e pelo layout (nav contextual). */
export type ModuleDef = {
  id: string;
  label: string;
  description: string;
  home: string;
  match: (pathname: string) => boolean;
  /** soEscritorio: o item não aparece pro login de cliente */
  nav: { to: string; label: string; soEscritorio?: boolean }[];
  /** só o escritório usa — login de cliente vê com cadeado */
  soEscritorio?: boolean;
};

export const MODULES: ModuleDef[] = [
  {
    id: 'cadastros',
    label: 'Cadastros',
    description: 'Cadastro de clientes e os ajustes ligados a eles (código Domínio, conta do banco, saldo inicial).',
    home: '/clientes',
    match: (p) => p.startsWith('/clientes') || p.startsWith('/equipe'),
    nav: [
      { to: '/clientes', label: 'Clientes' },
      { to: '/equipe', label: 'Equipe' },
    ],
    soEscritorio: true,
  },
  {
    id: 'importacao',
    label: 'Importação',
    description: 'Escolhe o cliente, importa o extrato (ou a planilha Excel do cliente, ou puxa do módulo Classificação), define a conta contábil de cada lançamento e gera o arquivo do Domínio.',
    home: '/importar',
    match: (p) => p.startsWith('/importar') || p.startsWith('/historico') || p.startsWith('/memoria') || p.startsWith('/revisao'),
    nav: [
      { to: '/importar', label: 'Nova importação' },
      { to: '/importar/excel', label: 'Nova importação Excel' },
      { to: '/historico', label: 'Histórico' },
      { to: '/memoria', label: 'Memória' },
    ],
    soEscritorio: true,
  },
  {
    id: 'classificacao',
    label: 'Classificação',
    description: 'Importa o extrato e classifica cada lançamento por categoria (água, luz, recebimentos...) antes de virar contabilidade.',
    home: '/classificacao',
    match: (p) => p.startsWith('/classificacao'),
    nav: [
      { to: '/classificacao', label: 'Nova importação' },
      { to: '/classificacao/historico', label: 'Histórico' },
      { to: '/classificacao/categorias', label: 'Classificações' },
      { to: '/classificacao/lista-geral', label: 'Lista geral', soEscritorio: true },
    ],
  },
];

export function moduleAtPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => m.match(pathname));
}

/** O módulo aparece com cadeado pra esse login? */
export function moduloBloqueado(m: ModuleDef, papel: Papel): boolean {
  return papel === 'cliente' && !!m.soEscritorio;
}

/** Itens do menu do módulo que esse login vê. */
export function navDoPapel(m: ModuleDef, papel: Papel): ModuleDef['nav'] {
  return m.nav.filter((n) => !(n.soEscritorio && papel === 'cliente'));
}
