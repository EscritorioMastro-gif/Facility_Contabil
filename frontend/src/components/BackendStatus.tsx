import { useQuery } from '@tanstack/react-query';
import { acordarLeitor } from '@/lib/acordarLeitor';
import { env } from '@/lib/env';

type Check = { ok: boolean; detail?: string };
type DeepHealth = { ok: boolean; checks: Record<string, Check> };

const NOMES: Record<string, string> = {
  supabase: 'Banco de dados',
  parser: 'Leitor de extratos',
};

/**
 * No plano gratuito do Render cada serviço dorme após 15 min sem uso e leva até
 * ~1 min pra acordar. Com o leitor dormindo, a API responde 503 COM o estado de
 * cada serviço — isso é "leitor dormindo", não "API fora do ar". Por isso o
 * corpo do 503 é lido aqui (o `api()` descarta), e só falha de rede vira erro.
 * A API não consegue acordar o leitor (ver lib/acordarLeitor.ts): a tela acorda.
 */
async function lerStatus(): Promise<DeepHealth> {
  const res = await fetch(`${env.apiUrl}/api/health/deep`);
  const body = (await res.json().catch(() => null)) as DeepHealth | null;
  if (!body?.checks) throw new Error(`HTTP ${res.status}`);
  if (body.checks.parser?.ok === false) acordarLeitor();
  return body;
}

export function BackendStatus() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health', 'deep'],
    queryFn: lerStatus,
    retry: false,
    // enquanto algo está acordando, confere de 10 em 10 s; tudo ok, de 30 em 30 s
    refetchInterval: (q) => (q.state.status === 'success' && q.state.data?.ok ? 30_000 : 10_000),
  });

  return (
    <div className="card p-4 text-sm">
      <p className="font-medium text-slate-700">Status dos serviços</p>
      {isLoading && <p className="mt-2 text-slate-400">verificando…</p>}
      {isError && (
        <p className="mt-2 text-red-600">
          A API não respondeu. Se o sistema ficou parado, ela leva até 1 min pra acordar — tentando de
          novo…
        </p>
      )}
      {data && !isError && (
        <ul className="mt-2 space-y-1">
          <Linha nome="API" estado="ok" />
          {Object.entries(data.checks).map(([nome, c]) => (
            <Linha
              key={nome}
              nome={NOMES[nome] ?? nome}
              estado={c.ok ? 'ok' : nome === 'parser' ? 'acordando' : 'falha'}
              detalhe={c.ok ? undefined : nome === 'parser' ? 'acordando…' : c.detail}
            />
          ))}
        </ul>
      )}
      {data && !data.ok && !isError && (
        <p className="mt-2 text-xs text-slate-400">
          No plano gratuito do Render os serviços dormem após 15 min sem uso. O sistema já pediu pro
          leitor acordar — leva até 1 min. Esta caixa se atualiza sozinha.
        </p>
      )}
    </div>
  );
}

const COR = { ok: 'bg-green-500', acordando: 'bg-amber-400', falha: 'bg-red-500' } as const;

function Linha({ nome, estado, detalhe }: { nome: string; estado: keyof typeof COR; detalhe?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${COR[estado]}`} />
      <span className="text-slate-600">{nome}</span>
      {detalhe && <span className="text-slate-400">— {detalhe}</span>}
    </li>
  );
}
