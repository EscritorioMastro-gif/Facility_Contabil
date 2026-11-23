import type { Papel } from '@/auth/authContext';

/** Ícone de cada item (nome resolvido em components/Sidebar e na paleta de comandos). */
export type IconeNav =
  | 'clientes'
  | 'equipe'
  | 'importar'
  | 'excel'
  | 'historico'
  | 'memoria'
  | 'dashboard'
  | 'classificar'
  | 'categorias'
  | 'lista';

export type NavItem = {
  to: string;
  label: string;
  /** soEscritorio: o item não aparece pro login de cliente */
  soEscritorio?: boolean;
  icone: IconeNav;
  /** o que mostrar na paleta de comandos (Ctrl+K) */
  descricao?: string;
};

/** Módulos do sistema — usado pelo hub (seleção) e pelo layout (nav contextual). */
export type ModuleDef = {
  id: string;
  label: string;
  description: string;
  /** frase curta pro cartão do hub */
  resumo: string;
  home: string;
  match: (pathname: string) => boolean;
  nav: NavItem[];
  /** só o escritório usa — login de cliente vê com cadeado */
  soEscritorio?: boolean;
};

export const MODULES: ModuleDef[] = [
  {
    id: 'cadastros',
    label: 'Cadastros',
    description: 'Cadastro de clientes e os ajustes ligados a eles (código Domínio, conta do banco, saldo inicial).',
    resumo: 'Clientes, contas do banco, saldos e a equipe do escritório.',
    home: '/clientes',
    match: (p) => p.startsWith('/clientes') || p.startsWith('/equipe'),
    nav: [
      { to: '/clientes', label: 'Clientes', icone: 'clientes', descricao: 'Cadastrar e editar clientes' },
      { to: '/equipe', label: 'Equipe', icone: 'equipe', descricao: 'Quem do escritório tem acesso' },
    ],
    soEscritorio: true,
  },
  {
    id: 'importacao',
    label: 'Importação',
    description: 'Escolhe o cliente, importa o extrato (ou a planilha Excel do cliente, ou puxa do módulo Classificação), define a conta contábil de cada lançamento e gera o arquivo do Domínio.',
    resumo: 'Do extrato bancário ao arquivo .txt do Domínio, com memória de contas.',
    home: '/importar',
    match: (p) => p.startsWith('/importar') || p.startsWith('/historico') || p.startsWith('/memoria') || p.startsWith('/revisao'),
    nav: [
      { to: '/importar', label: 'Nova importação', icone: 'importar', descricao: 'Ler um extrato (PDF, OFX, CSV, XLS)' },
      { to: '/importar/excel', label: 'Nova importação Excel', icone: 'excel', descricao: 'Planilha de controle do cliente' },
      { to: '/historico', label: 'Histórico', icone: 'historico', descricao: 'Importações feitas e arquivos gerados' },
      { to: '/memoria', label: 'Memória', icone: 'memoria', descricao: 'Descrição do extrato → conta contábil' },
    ],
    soEscritorio: true,
  },
  {
    id: 'classificacao',
    label: 'Classificação',
    description: 'Importa o extrato e classifica cada lançamento por categoria (água, luz, recebimentos...) antes de virar contabilidade.',
    resumo: 'Categorias por lançamento, aprovação do cliente e dashboard.',
    home: '/classificacao',
    match: (p) => p.startsWith('/classificacao'),
    nav: [
      { to: '/classificacao/dashboard', label: 'Dashboard', icone: 'dashboard', descricao: 'Receitas e despesas por classificação' },
      { to: '/classificacao', label: 'Classificar extrato', icone: 'classificar', descricao: 'Enviar um extrato para classificar' },
      { to: '/classificacao/historico', label: 'Histórico', icone: 'historico', descricao: 'Extratos classificados e aprovações' },
      { to: '/classificacao/categorias', label: 'Classificações', icone: 'categorias', descricao: 'A lista própria de cada cliente' },
      { to: '/classificacao/lista-geral', label: 'Lista geral', soEscritorio: true, icone: 'lista', descricao: 'A lista do escritório' },
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

/**
 * Item do menu que corresponde à rota (o mais específico). Telas internas
 * (Revisão, Classificação de um extrato) caem no item "pai" pra o caminho
 * de navegação (breadcrumb) fazer sentido.
 */
export function itemAtPath(pathname: string): { mod: ModuleDef; item?: NavItem; detalhe?: string } | undefined {
  const mod = moduleAtPath(pathname);
  if (!mod) return undefined;
  if (pathname.startsWith('/revisao/')) {
    return { mod, item: mod.nav.find((n) => n.to === '/historico'), detalhe: 'Revisão' };
  }
  if (pathname.startsWith('/classificacao/revisao/')) {
    return { mod, item: mod.nav.find((n) => n.to === '/classificacao/historico'), detalhe: 'Classificar lançamentos' };
  }
  const item = [...mod.nav].sort((a, b) => b.to.length - a.to.length).find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return { mod, item };
}
