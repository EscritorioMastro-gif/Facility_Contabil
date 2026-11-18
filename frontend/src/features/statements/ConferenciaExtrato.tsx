import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { formatDate } from '@/lib/format';
import type { Liberavel, RespostasTravas, Trava } from './travas';

/**
 * O extrato parou numa trava de entrada (empresa errada, sem identificação ou
 * sobreposto). Mostra cada uma com o que dá pra fazer: confirmar a empresa,
 * enviar na empresa certa, ou — só o escritório — importar assim mesmo (fica
 * registrado quem liberou). "Enviar de novo" reenvia o mesmo arquivo.
 */
export function ConferenciaExtrato({
  travas,
  enviando,
  onReenviar,
  onTrocarEmpresa,
}: {
  travas: Trava[];
  enviando: boolean;
  onReenviar: (r: RespostasTravas) => void;
  /** troca a empresa escolhida pela dona do extrato (quando o login enxerga a dona) */
  onTrocarEmpresa?: (empresa: { id: string; razao_social: string }) => void;
}) {
  const { ehCliente } = useAuth();
  const [confirmo, setConfirmo] = useState(false);
  const [liberar, setLiberar] = useState<ReadonlySet<Liberavel>>(new Set());

  const marcar = (t: Liberavel, sim: boolean) =>
    setLiberar((antes) => {
      const s = new Set(antes);
      if (sim) s.add(t);
      else s.delete(t);
      return s;
    });

  const resolvida = (t: Trava) =>
    t.tipo === 'confirmar_empresa' ? confirmo : t.pode_liberar && liberar.has(t.tipo);
  const temSaida = travas.every((t) => t.tipo === 'confirmar_empresa' || t.pode_liberar);
  const pronto = temSaida && travas.every(resolvida);

  const abrir = (e: { id: string; status: string; origem_modulo: string }) =>
    ehCliente
      ? e.origem_modulo === 'classificacao'
        ? `/classificacao/revisao/${e.id}`
        : null
      : e.status === 'classificacao'
        ? `/classificacao/revisao/${e.id}`
        : `/revisao/${e.id}`;

  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Antes de importar, confira:</p>

      {travas.map((t) => (
        <div key={t.tipo} className="space-y-2 border-t border-amber-200 pt-2 first-of-type:border-t-0 first-of-type:pt-0">
          <p>{t.mensagem}</p>

          {t.tipo === 'outra_empresa' && t.empresa && onTrocarEmpresa && (
            <button
              type="button"
              className="btn-primary"
              disabled={enviando}
              onClick={() => onTrocarEmpresa(t.empresa!)}
            >
              Enviar na {t.empresa.razao_social}
            </button>
          )}

          {t.tipo === 'confirmar_empresa' && (
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmo}
                onChange={(e) => setConfirmo(e.target.checked)}
              />
              Confirmo que este extrato é da {t.empresa.razao_social}
            </label>
          )}

          {t.tipo === 'sobreposto' && t.extratos.length > 0 && (
            <ul className="list-inside list-disc text-amber-800">
              {t.extratos.map((e) => {
                const destino = abrir(e);
                const texto = `${e.arquivo_nome}${
                  e.period_start && e.period_end ? ` (${formatDate(e.period_start)} a ${formatDate(e.period_end)})` : ''
                } — ${e.iguais} lançamento(s) iguais`;
                return (
                  <li key={e.id}>
                    {destino ? (
                      <Link to={destino} className="underline">
                        {texto}
                      </Link>
                    ) : (
                      texto
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {t.tipo !== 'confirmar_empresa' && t.pode_liberar && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={liberar.has(t.tipo)}
                onChange={(e) => marcar(t.tipo, e.target.checked)}
              />
              {t.tipo === 'titular_desconhecido'
                ? 'Liberar: este CNPJ/CPF é desta empresa (os próximos extratos dele entram direto)'
                : 'Importar nesta empresa assim mesmo (fica registrado em seu nome)'}
            </label>
          )}
        </div>
      ))}

      {temSaida ? (
        <button
          type="button"
          className="btn-primary"
          disabled={!pronto || enviando}
          onClick={() => onReenviar({ confirmo_empresa: confirmo, liberar: [...liberar] })}
        >
          {enviando ? 'Enviando…' : 'Enviar de novo'}
        </button>
      ) : (
        <p className="font-medium">
          {ehCliente
            ? 'Este extrato não pode entrar nesta empresa. Escolha a empresa certa ou fale com o escritório.'
            : 'Este extrato não pode entrar nesta empresa.'}
        </p>
      )}
    </div>
  );
}
