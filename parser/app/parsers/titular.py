"""De quem é o extrato: CNPJ/CPF do titular e nº da conta (pedido de 2026-11-18).

Serve à trava "extrato na empresa errada" do backend (statements/travas.ts): o
login de um cliente com várias empresas subia o extrato da JUNIOR CONFECÇÃO na
VALTER CONFECÇÃO sem aviso nenhum.

A regra de achar o titular veio da rotina "Extrator de Extrato Bancário do
E-mail" (main.py, `_extrair_cnpj_confiavel`), que já roda em produção desde
2026-08 sobre os extratos reais dos clientes do escritório. As salvaguardas
abaixo nasceram de erros reais de lá:

- só vale número com o RÓTULO "CNPJ"/"CPF" logo antes — sem rótulo, o número
  costuma ser a CONTRAPARTE de um Pix ("Transferência Recebida - BELLA STORE
  LIMITADA - 45.239.500/0001-19");
- descarta CNPJ de PRODUTO financeiro ("RF Simples Ágil - CNPJ: ...") e da
  própria INSTITUIÇÃO (rodapé "Nu Pagamentos S.A. - Instituição de Pagamento");
- entre os que sobram, o mais frequente (o do titular se repete a cada página).

Sem candidato confiável devolve None: o backend então pede para o usuário
confirmar a empresa, em vez de arriscar uma identidade errada.
"""
from __future__ import annotations

import re
from collections import Counter

CNPJ_CPF_ROTULADO_RE = re.compile(
    r"(?:CNPJ|CPF)\s*[:\.]?\s*(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{14}\b|\d{11}\b)",
    re.IGNORECASE,
)
PALAVRAS_PRODUTO_FINANCEIRO_RE = re.compile(
    r"\bRF\b|FUNDO|\bFIC\b|MULTIMERCADO|PREVID[ÊE]NCIA|A[ÇC][ÕO]ES|C[ÂA]MBIO",
    re.IGNORECASE,
)
PALAVRAS_INSTITUICAO_FINANCEIRA_RE = re.compile(
    r"INSTITUI[ÇC][ÃA]O\s+DE\s+PAGAMENTO|SOCIEDADE\s+DE\s+CR[ÉE]DITO|"
    r"FINANCIAMENTO\s+E\s+INVESTIMENTO|\bOUVIDORIA\b",
    re.IGNORECASE,
)
CNPJS_INSTITUICAO_FINANCEIRA = {
    "18236120000158",  # Nu Pagamentos S.A. - Instituição de Pagamento
    "30680829000143",  # Nu Financeira S.A. - Sociedade de Crédito, Financiamento e Investimento
}
# Nubank "Extrato de Rendimentos" / "Caixinhas PJ": o titular vem depois de
# "Empresa beneficiária dos rendimentos", com o rótulo CNPJ na linha de cima.
BENEFICIARIO_RENDIMENTOS_RE = re.compile(
    r"Empresa\s+benefici[áa]ria\s+dos\s+rendimentos\s+(?:CNPJ\s+)?"
    r"([^\n]+?)\s+(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})",
    re.IGNORECASE,
)
# C6 Bank: "RAZÃO SOCIAL • 57.075.695/0001-98" no cabeçalho, sem rótulo.
C6_TITULAR_BULLET_RE = re.compile(
    r"([A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú0-9 &.,'\-]{1,80}?)\s*•\s*"
    r"(\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})"
)
# Sicoob: "Conta: <ag/conta> / 59.545.429 DANIELA ..." — a base do CNPJ vem no
# nome; o CNPJ inteiro só aparece solto no corpo, às vezes com espaço no lugar
# da "/". Só é aceito quando a base bate com a do cabeçalho.
SICOOB_TITULAR_RE = re.compile(r"Conta:\s*[\d./\-]+\s*/\s*([^\n]+)", re.IGNORECASE)
CNPJ_SEP_FLEXIVEL_RE = re.compile(r"(\d{2})\.(\d{3})\.(\d{3})[\s/](\d{4})-?(\d{2})")
_BASE_NO_INICIO_RE = re.compile(r"\s*(\d{2})\.(\d{3})\.(\d{3})\s+[A-ZÀ-Ú]")

# nº da conta — só procurado no CABEÇALHO (antes do 1º lançamento): no corpo,
# "Conta: 39239222-1" costuma ser a conta da contraparte de um Pix.
CONTA_RE = re.compile(
    r"\bconta(?:\s+corrente|\s+atual)?\s*(?:n[ºo°.]\s*)?[:\s]\s*([\d][\d.\-/ ]{3,22}\d)",
    re.IGNORECASE,
)
BRADESCO_AG_CC_RE = re.compile(r"Ag:\s*(\d+)\s*\|\s*CC:\s*([\d.\-]+)", re.IGNORECASE)
CONTA_PONTO_E_VIRGULA_RE = re.compile(r'CONTA\s*;\s*"?(\d{4,20})"?', re.IGNORECASE)

# linha que já é lançamento (data + valor): o cabeçalho acaba aí
_LINHA_LANCAMENTO_RE = re.compile(r"\d{2}[/.-]\d{2}.*\d,\d{2}")


def _digitos(s: str) -> str:
    return re.sub(r"\D", "", s)


def _valido(d: str) -> bool:
    return len(d) in (11, 14) and d not in CNPJS_INSTITUICAO_FINANCEIRA and len(set(d)) > 1


def documento_do_titular(texto: str) -> str | None:
    """CNPJ (14) ou CPF (11) do titular, só dígitos — None se não der pra ter certeza."""
    if not texto:
        return None

    m = BENEFICIARIO_RENDIMENTOS_RE.search(texto)
    if m and _valido(_digitos(m.group(2))):
        return _digitos(m.group(2))

    m = C6_TITULAR_BULLET_RE.search(texto)
    if m and _valido(_digitos(m.group(2))):
        return _digitos(m.group(2))

    bases: set[str] = set()
    m = SICOOB_TITULAR_RE.search(texto)
    if m:
        bm = re.match(r"\s*(\d{2})\.(\d{3})\.(\d{3})\b", m.group(1))
        if bm:
            bases.add("".join(bm.groups()))
    bm = _BASE_NO_INICIO_RE.match(texto)
    if bm:
        bases.add("".join(bm.groups()))
    if bases:
        for c in CNPJ_SEP_FLEXIVEL_RE.finditer(texto):
            cand = "".join(c.groups())
            if cand[:8] in bases and _valido(cand):
                return cand

    candidatos: list[str] = []
    for m in CNPJ_CPF_ROTULADO_RE.finditer(texto):
        d = _digitos(m.group(1))
        if not _valido(d):
            continue
        if PALAVRAS_PRODUTO_FINANCEIRO_RE.search(texto[max(0, m.start() - 40) : m.start()]):
            continue
        if PALAVRAS_INSTITUICAO_FINANCEIRA_RE.search(texto[max(0, m.start() - 100) : m.start()]):
            continue
        candidatos.append(d)
    if not candidatos:
        return None
    return Counter(candidatos).most_common(1)[0][0]


def cabecalho(texto: str, max_linhas: int = 60) -> str:
    """As linhas antes do 1º lançamento (no máximo `max_linhas`)."""
    linhas: list[str] = []
    for ln in texto.splitlines():
        if _LINHA_LANCAMENTO_RE.search(ln):
            break
        linhas.append(ln)
        if len(linhas) >= max_linhas:
            break
    return "\n".join(linhas)


def conta_do_cabecalho(texto: str) -> str | None:
    """Nº da conta escrito no cabeçalho do extrato, só dígitos (com o DV) — ou None."""
    cab = cabecalho(texto)
    m = BRADESCO_AG_CC_RE.search(cab)
    if m:
        return _conta(m.group(2))
    for rx in (CONTA_PONTO_E_VIRGULA_RE, CONTA_RE):
        for m in rx.finditer(cab):
            # "Saldo em conta 1.234,56" é valor, não nº de conta
            if re.match(r"\s?,\d{2}", cab[m.end(1) :]):
                continue
            c = _conta(m.group(1))
            if c:
                return c
    return None


def _conta(s: str) -> str | None:
    d = _digitos(s).lstrip("0")
    # 4 a 20 dígitos: menos que isso é número de agência/página; mais, é CNPJ/código de barras
    return d if 4 <= len(d) <= 20 else None
