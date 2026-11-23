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

function useStatus(intervaloOk: number) {
  return useQuery({
    queryKey: ['health', 'deep'],
    queryFn: lerStatus,
    retry: false,
    // enquanto algo está acordando, confere de 10 em 10 s; tudo ok, no intervalo pedido
    refetchInterval: (q) => (q.state.status === 'success' && q.state.data?.ok ? intervaloOk : 10_000),
  });
}

export function BackendStatus() {
  const { data, isLoading, isError } = useStatus(30_000);

  return (
    <div className="card p-4 text-sm">
      <p className="card-title">Status dos serviços</p>
      {isLoading && <p className="mt-2 text-slate-400">verificando…</p>}
      {isError && (
        <p className="mt-2 text-red-600">
          A API não respondeu. Se o sistema ficou parado, ela leva até 1 min pra acordar — tentando de
          novo…
        </p>
      )}
      {data && !isError && (
        <ul className="mt-2.5 space-y-1.5">
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
        <p className="mt-2 text-xs text-slate-500">
          No plano gratuito do Render os serviços dormem após 15 min sem uso. O sistema já pediu pro
          leitor acordar — leva até 1 min. Esta caixa se atualiza sozinha.
        </p>
      )}
    </div>
  );
}

/**
 * Selo compacto da barra superior: um ponto verde quando está tudo no ar,
 * âmbar enquanto o leitor de extratos acorda, vermelho se a API não responde.
 */
export function StatusServicos() {
  const { data, isLoading, isError } = useStatus(60_000);
  const estado: keyof typeof COR = isLoading ? 'verificando' : isError ? 'falha' : data?.ok ? 'ok' : 'acordando';
  const texto = {
    verificando: 'Verificando serviços…',
    ok: 'Serviços no ar',
    acordando: 'Leitor acordando…',
    falha: 'API sem resposta',
  }[estado];
  const dica = {
    verificando: 'Conferindo a API, o banco de dados e o leitor de extratos',
    ok: 'API, banco de dados e leitor de extratos respondendo',
    acordando: 'O leitor de extratos estava parado e está acordando (até 1 min). A tela confere de novo sozinha.',
    falha: 'A API não respondeu. Se o sistema ficou parado, ela leva até 1 min pra acordar.',
  }[estado];

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-brand-200/80 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 backdrop-blur"
      title={dica}
      role="status"
    >
      <span className="relative flex h-2 w-2">
        {estado !== 'ok' && estado !== 'verificando' && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${COR[estado]}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${COR[estado]}`} />
      </span>
      {texto}
    </span>
  );
}

const COR = {
  ok: 'bg-green-500',
  acordando: 'bg-amber-400',
  falha: 'bg-red-500',
  verificando: 'bg-slate-300',
} as const;

function Linha({ nome, estado, detalhe }: { nome: string; estado: 'ok' | 'acordando' | 'falha'; detalhe?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${COR[estado]} ${estado === 'ok' ? 'shadow-[0_0_8px_rgb(34_197_94/0.6)]' : ''}`} />
      <span className="text-slate-600">{nome}</span>
      {detalhe && <span className="text-slate-400">— {detalhe}</span>}
    </li>
  );
}
