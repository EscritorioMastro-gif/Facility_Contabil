import type { ComponentType, SVGProps } from 'react';
import type { IconeNav } from '@/lib/modules';
import {
  IconCadastros,
  IconClassificacao,
  IconEquipe,
  IconGrafico,
  IconHistorico,
  IconImportacao,
  IconLista,
  IconMemoria,
  IconPlanilha,
  IconSacola,
  IconUpload,
} from './icons';

type Icone = ComponentType<SVGProps<SVGSVGElement>>;

const ICONE_MODULO: Record<string, Icone> = {
  cadastros: IconCadastros,
  importacao: IconImportacao,
  classificacao: IconClassificacao,
  marketplaces: IconSacola,
};

const ICONE_ITEM: Record<IconeNav, Icone> = {
  clientes: IconCadastros,
  equipe: IconEquipe,
  importar: IconUpload,
  excel: IconPlanilha,
  historico: IconHistorico,
  memoria: IconMemoria,
  dashboard: IconGrafico,
  classificar: IconUpload,
  categorias: IconClassificacao,
  lista: IconLista,
  marketplace: IconSacola,
  chamados: IconLista,
  tarifas: IconPlanilha,
};

export function NavIcone({ nome, className }: { nome: IconeNav; className?: string }) {
  const I = ICONE_ITEM[nome];
  return <I className={className} />;
}

/** Ícone de cada módulo (barra lateral, hub). */
export function ModuloIcone({ id, className }: { id: string; className?: string }) {
  const I = ICONE_MODULO[id];
  return I ? <I className={className} /> : null;
}
