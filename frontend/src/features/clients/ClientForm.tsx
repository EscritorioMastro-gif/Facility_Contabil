import { useForm } from 'react-hook-form';
import { Spinner } from '@/components/icons';
import { Secao } from '@/components/ui';
import type { Client, ClientInput } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { origemDoSaldo } from './saldo';

type FormValues = {
  razao_social: string;
  cnpj: string;
  dominio_code: string;
  banco_conta_contabil: string;
  hist_code_entrada: string;
  hist_code_saida: string;
  conta_width: number;
  saldo_inicial: string;
  ativo: boolean;
  observacoes: string;
  /** só no cadastro novo: libera o portal (módulo Classificação) pra esse e-mail */
  email_acesso: string;
};

function toDefaults(c?: Client): FormValues {
  return {
    razao_social: c?.razao_social ?? '',
    cnpj: c?.cnpj ?? '',
    dominio_code: c?.dominio_code ?? '',
    banco_conta_contabil: c?.banco_conta_contabil ?? '',
    hist_code_entrada: c?.hist_code_entrada ?? '138',
    hist_code_saida: c?.hist_code_saida ?? '186',
    conta_width: c?.conta_width ?? 7,
    saldo_inicial: c ? String(Number(c.saldo_inicial ?? 0)).replace('.', ',') : '0',
    ativo: c?.ativo ?? true,
    observacoes: c?.observacoes ?? '',
    email_acesso: '',
  };
}

export function ClientForm({
  client,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  client?: Client;
  onSubmit: (input: ClientInput, emailAcesso: string) => void;
  onCancel: () => void;
  submitting: boolean;
  error?: unknown;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields },
  } = useForm<FormValues>({ defaultValues: toDefaults(client) });

  const submit = handleSubmit((v) => {
    onSubmit({
      razao_social: v.razao_social.trim(),
      cnpj: v.cnpj,
      dominio_code: v.dominio_code.trim(),
      banco_conta_contabil: v.banco_conta_contabil.trim() || null,
      hist_code_entrada: v.hist_code_entrada.trim() || '138',
      hist_code_saida: v.hist_code_saida.trim() || '186',
      conta_width: Number(v.conta_width) || 7,
      // Na edição, só manda o saldo se ele foi mexido: o saldo anda sozinho ao
      // gerar o arquivo do Domínio, e salvar o cadastro aberto antes disso não
      // pode voltar pro valor velho.
      ...(client && !dirtyFields.saldo_inicial ? {} : { saldo_inicial: v.saldo_inicial.trim() || '0' }),
      ativo: v.ativo,
      observacoes: v.observacoes.trim() || null,
    }, v.email_acesso.trim());
  });

  const apiMsg =
    error instanceof ApiError
      ? `${error.message}${error.details ? ` — ${JSON.stringify(error.details)}` : ''}`
      : error
        ? String(error)
        : null;

  return (
    <form onSubmit={submit} className="space-y-6">
      <Secao titulo="Identificação">
      <div>
        <label className="label">Razão social</label>
        <input className="input" autoFocus={!client} {...register('razao_social', { required: true, minLength: 2 })} />
        {errors.razao_social && <p className="mt-1 text-xs font-semibold text-red-600">obrigatório</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">CNPJ / CPF</label>
          <input
            className="input input-mono"
            placeholder="00.000.000/0000-00"
            {...register('cnpj', { required: true })}
          />
        </div>
        <div>
          <label className="label">Código no Domínio</label>
          <input
            className="input input-mono"
            placeholder="168"
            inputMode="numeric"
            {...register('dominio_code', { required: true, pattern: /^\d{1,7}$/ })}
          />
          {errors.dominio_code && (
            <p className="mt-1 text-xs font-semibold text-red-600">só números, até 7 dígitos</p>
          )}
        </div>
      </div>
      </Secao>

      <div className="divider" />

      <Secao titulo="Banco e Domínio" descricao="Vêm preenchidos em cada importação deste cliente.">

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Conta contábil do banco (padrão)</label>
          <input
            className="input input-mono"
            placeholder="ex: 10002 — pode deixar em branco"
            {...register('banco_conta_contabil')}
          />
        </div>
        <div>
          <label className="label">Saldo inicial da conta bancária</label>
          <input
            className="input tabular-nums"
            inputMode="decimal"
            placeholder="0,00"
            {...register('saldo_inicial')}
          />
          <p className="hint">
            {!client
              ? 'Saldo no início do primeiro extrato. Depois ele anda sozinho: cada arquivo do Domínio gerado traz pra cá o saldo final do extrato.'
              : origemDoSaldo(client)
                ? `Atualizado sozinho: ${origemDoSaldo(client)}. Se mudar aqui, vale o seu valor até o próximo arquivo do Domínio.`
                : 'Digitado no cadastro. Ao gerar o arquivo do Domínio de um extrato deste cliente, o saldo final dele vem pra cá.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label">Cód. histórico entrada</label>
          <input className="input input-mono" inputMode="numeric" {...register('hist_code_entrada')} />
        </div>
        <div>
          <label className="label">Cód. histórico saída</label>
          <input className="input input-mono" inputMode="numeric" {...register('hist_code_saida')} />
        </div>
        <div>
          <label className="label">Dígitos da conta</label>
          <input
            className="input input-mono"
            type="number"
            min={1}
            max={20}
            {...register('conta_width', { valueAsNumber: true })}
          />
        </div>
      </div>

      </Secao>

      <div className="divider" />

      <div>
        <label className="label">Observações</label>
        <textarea className="input" rows={2} {...register('observacoes')} />
      </div>

      {!client && (
        <div>
          <label className="label">E-mail de acesso do cliente (opcional)</label>
          <input
            className="input"
            type="email"
            placeholder="cliente@empresa.com.br"
            {...register('email_acesso', { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ })}
          />
          {errors.email_acesso && <p className="mt-1 text-xs font-semibold text-red-600">e-mail inválido</p>}
          <p className="hint">
            Se preencher, o cliente recebe um convite por e-mail para criar a senha e passa a ver só o
            módulo Classificação desta empresa. Pode deixar em branco e liberar depois, na edição.
          </p>
        </div>
      )}

      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-brand-50">
        <input type="checkbox" {...register('ativo')} />
        Cliente ativo
      </label>

      {apiMsg && <p className="alert alert-error">{apiMsg}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting && <Spinner />}
          {submitting ? 'Salvando…' : client ? 'Salvar alterações' : 'Cadastrar cliente'}
        </button>
      </div>
    </form>
  );
}
