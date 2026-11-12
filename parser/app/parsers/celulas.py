"""Descrição completa dos lançamentos de PDF em tabela, pelas POSIÇÕES na página.

Pedido do user (2026-11-12): a descrição tem que vir completa em todos os
extratos. Nos PDFs em tabela (Bradesco, Santander, C6, Itaú, PagBank,
Sicredi...) o histórico que não cabe na largura da coluna quebra em linhas
ACIMA e ABAIXO da linha do valor (a célula é centralizada na altura) e o nº do
documento fica no meio. No texto corrido não dá pra saber de quem é cada linha
— o leitor genérico pegava pedaço do lançamento vizinho, deixava o documento
no meio ou cortava o nome.

Aqui cada palavra tem posição: o cabeçalho da tabela diz onde está cada
coluna; cada linha com valor é um lançamento; cada linha só de texto vai pro
lançamento mais PRÓXIMO na altura. A descrição junta as colunas de texto
(Histórico/Lançamento/Tipo/Descrição/Razão Social/CNPJ...) na ordem das
colunas, sem a Data e sem o Documento.

Não decide data nem valor — isso continua com o leitor do banco (conferido
contra o OFX/CSV e o saldo). `melhorar_descricoes` só troca a descrição de um
lançamento quando acha aqui uma linha com o MESMO valor, na mesma ordem.
"""

from __future__ import annotations

import re
import statistics
import unicodedata
from dataclasses import dataclass, field

from ..schemas import NormalizedTransaction

# valor com sinal, parênteses ou letra colada (Sicoob: "85,00C", "1,80D", "0,00*")
_DINHEIRO = re.compile(r"^\(?-?R?\$?-?\d{1,3}(?:\.\d{3})*,\d{2}-?\)?[CD*]?$")
_DATA = re.compile(r"^\d{2}/\d{2}(?:/\d{2,4})?$")


def _sem_acento(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


# cabeçalhos de coluna (sem acento, minúsculo)
_COL_DATA = re.compile(r"^(data|dt\.?|dia)$")
_COL_TEXTO = re.compile(r"^(historico|lancamentos?|descricao|tipo|razao|cnpj/cpf|cnpj|cpf|detalhes?|complemento)$")
_COL_DOC = re.compile(r"^(documento|dcto\.?|doc\.?|n[oº]?\.?\s*doc\.?|lote)$")
_COL_VALOR = re.compile(r"^(valor|credito|debito|entradas?|saidas?)$")
_COL_SALDO = re.compile(r"^saldo$")


@dataclass
class _Coluna:
    x0: float
    tipo: str  # data | texto | doc | valor | saldo | outra


@dataclass
class _Linha:
    top: float
    bottom: float
    palavras: list[dict] = field(default_factory=list)

    @property
    def meio(self) -> float:
        return (self.top + self.bottom) / 2


def _linhas(words: list[dict]) -> list[_Linha]:
    out: list[_Linha] = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if out and abs(out[-1].top - w["top"]) < 2.5:
            out[-1].palavras.append(w)
            out[-1].bottom = max(out[-1].bottom, w["bottom"])
        else:
            out.append(_Linha(w["top"], w["bottom"], [w]))
    for ln in out:
        ln.palavras.sort(key=lambda w: w["x0"])
    return out


def _cabecalho(linhas: list[_Linha]) -> tuple[int, list[_Coluna]] | None:
    """Linha do cabeçalho da tabela (pode vir quebrado em 2-3 linhas, como no C6)."""
    for i, ln in enumerate(linhas):
        nomes = [_sem_acento(w["text"]).strip(":") for w in ln.palavras]
        if not any(_COL_TEXTO.match(n) for n in nomes) or not any(_COL_VALOR.match(n) for n in nomes):
            continue
        # junta as palavras das linhas coladas (cabeçalho em várias linhas)
        perto = [w for lj in linhas if abs(lj.meio - ln.meio) < 14 for w in lj.palavras]
        colunas: list[_Coluna] = []
        for w in sorted(perto, key=lambda w: w["x0"]):
            n = _sem_acento(w["text"]).strip(":")
            tipo = (
                "data" if _COL_DATA.match(n)
                else "texto" if _COL_TEXTO.match(n) or n == "social"
                else "doc" if _COL_DOC.match(n)
                else "valor" if _COL_VALOR.match(n)
                else "saldo" if _COL_SALDO.match(n)
                else None
            )
            if tipo is None:
                continue  # "(R$)", "lançamento contábil" etc.
            if colunas and abs(colunas[-1].x0 - w["x0"]) < 4:
                continue
            colunas.append(_Coluna(w["x0"], tipo))
        if any(c.tipo == "texto" for c in colunas) and any(c.tipo == "valor" for c in colunas):
            fim = max(j for j, lj in enumerate(linhas) if abs(lj.meio - ln.meio) < 14)
            return fim, colunas
    return None


def _coluna_de(x0: float, colunas: list[_Coluna]) -> int:
    """Índice da coluna onde a palavra começa: cada coluna vai até a metade do
    caminho pra próxima (o rótulo do cabeçalho nem sempre fica alinhado com o
    dado — no Bradesco a página 2 tem o cabeçalho 4 pt deslocado)."""
    idx = 0
    for i in range(1, len(colunas)):
        if x0 >= (colunas[i - 1].x0 + colunas[i].x0) / 2:
            idx = i
    return idx


def _pedacos(palavras: list[dict]) -> list[list[dict]]:
    """Palavras de uma linha em pedaços: as coladas (frase) ficam juntas; um
    espaço grande separa colunas."""
    out: list[list[dict]] = []
    for w in palavras:
        if out and w["x0"] - out[-1][-1]["x1"] < 9:
            out[-1].append(w)
        else:
            out.append([w])
    return out


@dataclass
class Celula:
    centavos: int  # com sinal
    descricao: str


def _valor(palavras: list[dict], colunas: list[_Coluna]) -> int | None:
    """Valor do lançamento (não o saldo): o 1º dinheiro numa coluna de valor."""
    for i, w in enumerate(palavras):
        t = w["text"]
        if not _DINHEIRO.match(t):
            continue
        col = colunas[_coluna_de(w["x0"], colunas)]
        if col.tipo == "saldo":
            continue
        if col.tipo != "valor" and not any(c.tipo == "valor" for c in colunas[_coluna_de(w["x0"], colunas):]):
            continue
        neg = (
            t.startswith(("-", "("))
            or t.endswith(("-", "D"))
            or (i > 0 and palavras[i - 1]["text"] in ("-", "-R$"))
        )
        num = re.sub(r"[^\d,]", "", t).replace(",", "")
        if not num:
            continue
        cents = int(num)
        return -cents if neg else cents
    return None


@dataclass
class Pagina:
    celulas: list[Celula]
    colunas: list[_Coluna] | None
    # pedaço de célula partida na quebra de página: o fim da última célula da
    # página anterior (no topo) e o começo da 1ª da próxima (no pé)
    topo: str = ""
    pe: str = ""


def celulas_da_pagina(words: list[dict], colunas_anteriores: list[_Coluna] | None = None) -> Pagina:
    """Lançamentos de uma página, e as colunas usadas. A página pode ter mais de
    uma tabela (Bradesco: fim de um bloco, "Total", e outro bloco com cabeçalho
    próprio) — cada trecho usa o cabeçalho de cima dele; o trecho antes do 1º
    cabeçalho continua a tabela da página anterior."""
    linhas = _linhas(words)
    trechos: list[tuple[list[_Linha], list[_Coluna] | None]] = []
    colunas, inicio = colunas_anteriores, 0
    while True:
        cab = _cabecalho(linhas[inicio:])
        if cab is None:
            trechos.append((linhas[inicio:], colunas))
            break
        fim_cab, novas = cab
        trechos.append((linhas[inicio : inicio + fim_cab], colunas))
        colunas, inicio = novas, inicio + fim_cab + 1
    paginas = [_celulas_do_trecho(lns, cols) for lns, cols in trechos if cols is not None]
    if not paginas:
        return Pagina([], None)
    com = [p for p in paginas if p.celulas]
    return Pagina(
        [c for p in paginas for c in p.celulas],
        colunas,
        com[0].topo if com and com[0] is paginas[0] else "",
        com[-1].pe if com else "",
    )


def _celulas_do_trecho(linhas: list[_Linha], colunas: list[_Coluna]) -> Pagina:
    # o cabeçalho de cima do trecho pode ter sobrado (linhas do cabeçalho quebrado)
    linhas = [ln for ln in linhas if _cabecalho([ln]) is None]

    def pedacos_de_texto(ln: _Linha) -> list[tuple[int, float, list[dict]]]:
        """(coluna, altura, palavras) de cada pedaço de descrição da linha."""
        out = []
        for p in _pedacos(ln.palavras):
            # o hífen solto fica: é da descrição ("Vendas - Disponivel PIX")
            p = [w for w in p if not _DINHEIRO.match(w["text"]) and w["text"] not in ("R$", "-R$")]
            # a data em si sai; o que vier colado depois vale pela coluna onde
            # começa (C6: "Entrada PIX" é texto; Sicoob: "129" é documento)
            while p and _DATA.match(p[0]["text"]) and colunas[_coluna_de(p[0]["x0"], colunas)].tipo == "data":
                p = p[1:]
            if not p:
                continue
            idx = _coluna_de(p[0]["x0"], colunas)
            tipo = colunas[idx].tipo
            if tipo in ("valor", "saldo", "doc"):
                continue  # valor, saldo e nº/código do documento ("58", "PIX_CRED", "Pix", "SICOOB SEG")
            if p:
                out.append((idx, p[0]["top"], p))
        return out

    valores: list[tuple[_Linha, int]] = []
    textos: list[_Linha] = []
    for ln in linhas:
        v = _valor(ln.palavras, colunas)
        if v is not None:
            valores.append((ln, v))
        elif pedacos_de_texto(ln):
            textos.append(ln)
    if not valores:
        return Pagina([], colunas)

    # Linha quebrada da célula fica a ~meia linha do valor (4-7 pt nos extratos
    # reais; o complemento do Sicoob, embaixo, a ~11 pt com linha de 10,5); o
    # lançamento vizinho, a 10-25 pt — e o dono é sempre o MAIS PERTO. Mais
    # longe que ~1,3 altura de linha não é de célula nenhuma desta página.
    altura = statistics.median([ln.bottom - ln.top for ln, _ in valores]) or 8.0
    limite = max(1.3 * altura, 7.0)
    donos: dict[int, list[_Linha]] = {i: [] for i in range(len(valores))}
    topo: list[_Linha] = []
    pe: list[_Linha] = []
    primeiro, ultimo = valores[0][0].meio, valores[-1][0].meio
    for t in textos:
        dist, i = min((abs(t.meio - lv.meio), i) for i, (lv, _) in enumerate(valores))
        if dist <= limite:
            donos[i].append(t)
        elif t.meio < primeiro and primeiro - t.meio <= 3 * altura:
            topo.append(t)  # fim da célula que começou na página anterior
        elif t.meio > ultimo and t.meio - ultimo <= 3 * altura:
            pe.append(t)  # começo da célula que termina na próxima página

    def texto_de(lns: list[_Linha]) -> str:
        # ordem de leitura: coluna, depois de cima pra baixo (o pedaço inteiro
        # vai junto, mesmo que uma palavra dele passe da metade da coluna)
        pedacos = sorted((pd for ln in lns for pd in pedacos_de_texto(ln)), key=lambda pd: (pd[0], round(pd[1])))
        texto = " ".join(w["text"] for _, _, p in pedacos for w in p)
        return re.sub(r"\s+", " ", texto).strip(" -")

    out = [Celula(cents, texto_de([lv, *donos[i]])) for i, (lv, cents) in enumerate(valores)]
    return Pagina(out, colunas, texto_de(topo), texto_de(pe))


def celulas_do_documento(paginas_words) -> list[Celula]:
    """Todas as células do PDF, juntando as partidas na quebra de página."""
    todas: list[Celula] = []
    colunas = None
    pe_anterior = ""
    for words in paginas_words:
        pg = celulas_da_pagina(words, colunas)
        colunas = pg.colunas or colunas
        if pg.topo and todas:
            todas[-1].descricao = f"{todas[-1].descricao} {pg.topo}".strip()
        if pe_anterior and pg.celulas:
            pg.celulas[0].descricao = f"{pe_anterior} {pg.celulas[0].descricao}".strip()
        pe_anterior = pg.pe
        todas.extend(pg.celulas)
    return todas


_SALDO = re.compile(r"^(saldo|s a l d o|total)\b", re.IGNORECASE)


def melhorar_descricoes(txns: list[NormalizedTransaction], celulas: list[Celula]) -> int:
    """Troca a descrição de cada lançamento pela da célula de MESMO valor, na
    mesma ordem (anda nas duas listas; o que não casa fica como estava).
    Devolve quantas descrições foram trocadas."""
    celulas = [c for c in celulas if c.descricao and not _SALDO.match(c.descricao)]
    j = 0
    trocadas = 0
    for t in txns:
        alvo = t.amount_cents if t.direction == "entrada" else -t.amount_cents
        for k in range(j, min(len(celulas), j + 4)):
            c = celulas[k]
            if abs(c.centavos) == t.amount_cents and (c.centavos == alvo or c.centavos > 0):
                if c.descricao != t.description:
                    t.description = c.descricao
                    trocadas += 1
                j = k + 1
                break
    return trocadas
