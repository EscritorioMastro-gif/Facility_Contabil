import { formatDate } from '@/lib/format';
import type { Client } from '@/lib/types';

/**
 * De onde veio o saldo do cadastro do cliente. O saldo anda sozinho: gerar o
 * arquivo do Domínio de um extrato põe o saldo final dele no cadastro
 * (migration 0029). `null` = saldo digitado no cadastro.
 */
export function origemDoSaldo(c: Pick<Client, 'saldo_inicial_ate' | 'saldo_inicial_em'>): string | null {
  if (!c.saldo_inicial_ate) return null;
  const quando = c.saldo_inicial_em ? `, arquivo do Domínio gerado em ${formatDate(c.saldo_inicial_em)}` : '';
  return `saldo final do extrato até ${formatDate(c.saldo_inicial_ate)}${quando}`;
}
