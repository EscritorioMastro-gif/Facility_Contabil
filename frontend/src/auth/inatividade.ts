/**
 * Logout por inatividade.
 *
 * O Supabase guarda a sessão no navegador e a renova sozinho: sem isto, quem
 * abrisse o computador do escritório (ou o celular do cliente) dias depois
 * continuaria logado, com acesso aos dados financeiros. Passou o limite sem
 * mouse/teclado/rolagem em nenhuma aba do sistema → sai.
 *
 * Só conta como uso: login com senha, chegada pelo link de e-mail e interação
 * real. A renovação automática da sessão (inclusive ao voltar pra aba) NÃO conta.
 */
export const LIMITE_INATIVIDADE_MS = 60 * 60 * 1000;

const CHAVE = 'fc:ultima-atividade';
const AVISO = 'fc:saiu-por-inatividade';
const EVENTOS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;

export function registrarAtividade(): void {
  try {
    localStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    /* navegador sem storage: vale só o vigia desta aba */
  }
}

/** true se a última atividade registrada passou do limite. Sem registro: false. */
export function inativoHaMuito(): boolean {
  try {
    const ultima = Number(localStorage.getItem(CHAVE));
    return ultima > 0 && Date.now() - ultima > LIMITE_INATIVIDADE_MS;
  } catch {
    return false;
  }
}

export function marcarSaidaPorInatividade(): void {
  try {
    sessionStorage.setItem(AVISO, '1');
  } catch {
    /* sem aviso na tela de entrada */
  }
}

export function avisoDeInatividadePendente(): boolean {
  try {
    return sessionStorage.getItem(AVISO) === '1';
  } catch {
    return false;
  }
}

export function limparAvisoDeInatividade(): void {
  try {
    sessionStorage.removeItem(AVISO);
  } catch {
    /* nada a limpar */
  }
}

/**
 * Vigia a inatividade enquanto há login. A conferência vem ANTES de registrar a
 * interação nova — senão quem voltasse depois de horas e mexesse o mouse
 * "renovaria" a sessão vencida. Devolve a função que para o vigia.
 */
export function vigiarInatividade(aoEstourar: () => void): () => void {
  let ultimaGravacao = 0;
  let estourou = false;
  const estourar = () => {
    if (estourou) return;
    estourou = true;
    aoEstourar();
  };
  const aoInteragir = () => {
    if (inativoHaMuito()) return estourar();
    const agora = Date.now();
    if (agora - ultimaGravacao > 30_000) {
      ultimaGravacao = agora;
      registrarAtividade();
    }
  };
  const aoVoltarPraAba = () => {
    if (document.visibilityState === 'visible' && inativoHaMuito()) estourar();
  };

  EVENTOS.forEach((e) => window.addEventListener(e, aoInteragir, { passive: true }));
  document.addEventListener('visibilitychange', aoVoltarPraAba);
  const timer = window.setInterval(() => {
    if (inativoHaMuito()) estourar();
  }, 60_000);

  return () => {
    EVENTOS.forEach((e) => window.removeEventListener(e, aoInteragir));
    document.removeEventListener('visibilitychange', aoVoltarPraAba);
    window.clearInterval(timer);
  };
}
