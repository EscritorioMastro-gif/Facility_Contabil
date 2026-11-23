import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduloBloqueado, navDoPapel } from '@/lib/modules';
import { FinanceIllustration } from '@/components/FinanceIllustration';
import { IconCadeado, IconSetaDireita, IconTeclado, IconUpload } from '@/components/icons';
import { ModuloIcone, NavIcone } from '@/components/NavIcone';
import { Kbd } from '@/components/ui';

function saudacao(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function HubPage() {
  const { papel, ehCliente } = useAuth();

  return (
    <div className="space-y-8">
      {/* destaque */}
      <section className="relative overflow-hidden rounded-4xl border border-brand-200/80 bg-white/70 p-6 shadow-card backdrop-blur-xl sm:p-10">
        <div className="bg-grid-light pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_80%_20%,black,transparent_70%)]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-300/25 blur-3xl" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center">
          <div className="max-w-xl animate-fade-up">
            <p className="eyebrow flex items-center gap-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400 shadow-glow-sm" />
              {saudacao()}
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.1] sm:text-5xl">
              <span className="text-gradient">Facility Contábil</span>
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
              {ehCliente
                ? 'Classifique os lançamentos do seu extrato, confira e aprove — o escritório recebe tudo pronto para a contabilidade.'
                : 'Do extrato bancário ao arquivo do Domínio: importação, classificação automática pela memória e conferência do saldo, num lugar só.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {ehCliente ? (
                <>
                  <Link to="/classificacao" className="btn-primary">
                    <IconUpload className="h-4 w-4" />
                    Classificar extrato
                  </Link>
                  <Link to="/classificacao/dashboard" className="btn-ghost">
                    Ver dashboard
                  </Link>
                </>
              ) : (
                <>
                  <Link to="/importar" className="btn-primary">
                    <IconUpload className="h-4 w-4" />
                    Nova importação
                  </Link>
                  <Link to="/classificacao" className="btn-ghost">
                    Classificar extrato
                  </Link>
                </>
              )}
            </div>
            <p className="mt-5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <IconTeclado className="h-4 w-4 text-brand-500" />
              Dica: aperte <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd> em qualquer tela para buscar e ir direto para onde quiser.
            </p>
          </div>
          <div className="min-w-0 flex-1">
            <FinanceIllustration className="mx-auto w-full max-w-lg animate-drift drop-shadow-[0_30px_40px_rgb(8_53_58/0.12)]" />
          </div>
        </div>
      </section>

      {/* módulos */}
      <section aria-labelledby="titulo-modulos">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Módulos</p>
            <h2 id="titulo-modulos" className="mt-1 text-xl font-semibold text-slate-800">
              Por onde começar
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {MODULES.map((m, i) => {
              const bloqueado = moduloBloqueado(m, papel);
            const itens = navDoPapel(m, papel);
            return (
              <article
                key={m.id}
                className={`card relative flex animate-fade-up flex-col overflow-hidden p-5 ${bloqueado ? 'opacity-70' : 'card-hover'}`}
                style={{ animationDelay: `${80 + i * 60}ms` }}
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-brand-300/15 blur-2xl" />
                <div className="relative flex items-start justify-between gap-3">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-xl ${
                      bloqueado
                        ? 'bg-slate-100 text-slate-400'
                        : 'bg-gradient-to-br from-brand-600 to-brand-800 text-brand-300 shadow-glow'
                    }`}
                  >
                    <ModuloIcone id={m.id} className="h-5 w-5" />
                  </span>
                  {bloqueado && (
                    <span className="chip chip-slate">
                      <IconCadeado className="h-3 w-3" /> área do escritório
                    </span>
                  )}
                </div>
                <h3 className="relative mt-4 text-lg font-semibold text-slate-800">{m.label}</h3>
                <p className="relative mt-1 text-sm leading-relaxed text-slate-500">{m.resumo}</p>

                {!bloqueado && (
                  <ul className="relative mt-4 flex flex-wrap gap-1.5">
                    {itens.map((n) => (
                      <li key={n.to}>
                        <Link
                          to={n.to}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                        >
                          <NavIcone nome={n.icone} className="h-3.5 w-3.5 text-brand-500" />
                          {n.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="relative mt-auto pt-5">
                  {bloqueado ? (
                    <p className="text-xs text-slate-400">Seu acesso é ao módulo Classificação.</p>
                  ) : (
                    <Link to={m.home} className="link text-sm">
                      Abrir {m.label}
                      <IconSetaDireita className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
