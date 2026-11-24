import { nomeDoMes, reais, type MesAcima } from './retiradas';

/**
 * Aviso no topo da classificação: no mês, a empresa passou de R$ 50.000,00 em
 * pró-labore + distribuição de lucro (todos os extratos dela, contando o que
 * ainda não foi salvo). O cliente avisa o escritório; o escritório gera a guia.
 */
export function AvisoRetiradas({ meses, ehCliente }: { meses: MesAcima[]; ehCliente: boolean }) {
  if (!meses.length) return null;
  return (
    <>
      {meses.map((m) => (
        <div key={m.mes} className="alert alert-error" role="alert">
          <p className="font-semibold">Retiradas de {nomeDoMes(m.mes)} acima de R$ 50.000,00</p>
          <table className="mt-1.5 w-full max-w-md text-[13px]">
            <tbody>
              <tr>
                <td className="py-0.5">Pró-labore</td>
                <td className="py-0.5 text-right tabular-nums">{reais(m.pro_labore)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Distribuição de lucro</td>
                <td className="py-0.5 text-right tabular-nums">{reais(m.distribuicao)}</td>
              </tr>
              <tr className="border-t border-red-200 font-semibold">
                <td className="pt-1">Total no mês</td>
                <td className="pt-1 text-right tabular-nums">{reais(m.total)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2">
            {ehCliente ? 'Avise o escritório para gerar a guia do imposto: passou' : 'Gerar a guia do imposto: passou'} de
            R$ 50.000,00 no mês, incide 10% sobre o valor retirado da Pessoa Jurídica.
          </p>
          <p className="mt-1 text-xs opacity-90">
            Soma de todos os extratos desta empresa no mês, contando o que {ehCliente ? 'você ainda não salvou' : 'ainda não foi salvo'}.
          </p>
        </div>
      ))}
    </>
  );
}
