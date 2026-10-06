/**
 * Para onde voltar depois do login — só caminho INTERNO do sistema.
 *
 * O caminho vem da URL que a pessoa abriu. Sem esta checagem, um link como
 * `https://<sistema>/\site-falso.com` levaria a pessoa, logo depois de digitar
 * a senha, para um site de terceiro (o navegador lê "/\" como "//"): golpe
 * clássico de phishing ("sua sessão expirou, digite a senha de novo").
 */
export function destinoSeguro(caminho: unknown): string {
  if (typeof caminho !== 'string' || !caminho.startsWith('/') || caminho.startsWith('//')) return '/';
  // barra invertida e caracteres de controle não fazem parte de nenhuma rota
  for (const ch of caminho) {
    const c = ch.charCodeAt(0);
    if (ch === '\\' || c < 0x20 || c === 0x7f) return '/';
  }
  return caminho;
}
