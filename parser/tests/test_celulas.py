"""Descrição completa pelas posições na página (celulas.py) — pedido de
2026-11-12: "a descrição tem que vir completa em todos os extratos".

As páginas aqui são montadas palavra a palavra (texto + posição), reproduzindo
o que os extratos reais de Bradesco, Santander, Sicoob, PagBank e C6 têm de
difícil. Dados fictícios (o repositório é público).
"""

from __future__ import annotations

from app.parsers.celulas import celulas_do_documento, melhorar_descricoes
from app.schemas import NormalizedTransaction


def _linha(top: float, *palavras: tuple[str, float], altura: float = 7.6) -> list[dict]:
    return [
        {"text": t, "x0": x, "x1": x + 4.6 * len(t), "top": top, "bottom": top + altura}
        for t, x in palavras
    ]


def _pagina(*linhas: list[dict]) -> list[dict]:
    return [w for ln in linhas for w in ln]


# Bradesco: Data | Lançamento | Dcto. | Crédito | Débito | Saldo
_CAB_BRADESCO = _linha(
    100, ("Data", 44), ("Lançamento", 104), ("Dcto.", 269), ("Crédito", 338), ("Débito", 428), ("Saldo", 519)
)


def test_historico_quebrado_acima_e_abaixo_do_valor_sem_o_documento():
    pagina = _pagina(
        _CAB_BRADESCO,
        _linha(120, ("01/07/2026", 41), ("RENDIMENTO", 101), ("APLIC", 160), ("1234567", 266), ("0,20", 373), ("1.000,20", 529)),
        _linha(130, ("PAGTO", 101), ("ELETRON", 130), ("COBRANCA", 168)),
        _linha(134.5, ("58", 266), ("-1.104,00", 443), ("-103,80", 529)),
        _linha(139, ("FORNECEDOR", 101), ("FICTICIO", 160), ("LTDA", 205)),
        _linha(149, ("PIX", 101), ("ENVIADO", 115)),
        _linha(153.5, ("1522588", 266), ("-50,00", 449), ("-153,80", 529)),
        _linha(158, ("DES:", 101), ("Fulano", 121), ("de", 150), ("Tal", 162), ("03/07", 180)),
    )
    celulas = celulas_do_documento([pagina])
    assert [(c.centavos, c.descricao) for c in celulas] == [
        (20, "RENDIMENTO APLIC"),
        (-110400, "PAGTO ELETRON COBRANCA FORNECEDOR FICTICIO LTDA"),
        (-5000, "PIX ENVIADO DES: Fulano de Tal 03/07"),
    ]


def test_celula_partida_na_quebra_de_pagina():
    # página 1 termina com o começo da célula; a página 2 (sem repetir o
    # cabeçalho, como no Santander real) começa com o fim dela
    p1 = _pagina(
        _CAB_BRADESCO,
        _linha(120, ("RECEBIMENTO", 101), ("FORNECEDOR", 159)),
        _linha(124.5, ("14/07/2026", 41), ("655604", 266), ("1.340,00", 358), ("5.000,00", 533)),
        _linha(129, ("EMPRESA", 101), ("FICTICIA", 145), ("S/A", 190)),
        _linha(139, ("PIX", 101), ("ENVIADO", 115)),
        _linha(143.5, ("15/07/2026", 41), ("777", 266), ("-10,00", 449), ("4.990,00", 533)),
    )
    p2 = _pagina(
        _linha(44, ("DES:", 101), ("Beltrano", 121), ("15/07", 170)),  # resto da célula da página 1
        _linha(60, ("16/07/2026", 41), ("TARIFA", 101), ("BANCARIA", 130), ("10726", 266), ("-5,00", 458), ("4.985,00", 529)),
    )
    celulas = celulas_do_documento([p1, p2])
    assert [c.descricao for c in celulas] == [
        "RECEBIMENTO FORNECEDOR EMPRESA FICTICIA S/A",
        "PIX ENVIADO DES: Beltrano 15/07",
        "TARIFA BANCARIA",
    ]


def test_duas_tabelas_na_mesma_pagina():
    pagina = _pagina(
        _CAB_BRADESCO,
        _linha(120, ("20/07/2026", 41), ("TARIFA", 101), ("UM", 130), ("1", 266), ("-1,00", 458), ("10,00", 529)),
        _linha(140, ("Total", 41), ("0,00", 354), ("-1,00", 439), ("10,00", 533)),
        _linha(170, ("Data", 48), ("Lançamento", 108), ("Dcto.", 273), ("Crédito", 341), ("Débito", 432), ("Saldo", 523)),
        _linha(190, ("29/07/2026", 41), ("TARIFA", 101), ("DOIS", 130), ("2", 266), ("-2,00", 458), ("8,00", 529)),
    )
    celulas = [c for c in celulas_do_documento([pagina]) if c.descricao != "Total"]
    assert [c.descricao for c in celulas] == ["TARIFA UM", "TARIFA DOIS"]


def test_sicoob_valor_com_letra_documento_em_texto_e_complemento_embaixo():
    # Data | Documento | Histórico | Valor ; "85,00C"/"1,80D"; documento "Pix"/"SICOOB SEG".
    # Alturas e distâncias do extrato real: linha do valor com 10,5 pt; o
    # complemento (fonte menor) ~10,6 pt abaixo dela.
    alta = {"altura": 10.5}
    pagina = _pagina(
        _linha(100, ("Data", 37), ("Documento", 69), ("Histórico", 132), ("Valor", 537), **alta),
        _linha(120, ("03/07", 37), ("Pix", 69), ("PIX", 146), ("RECEBIDO", 162), ("-", 207), ("OUTRA", 212), ("IF", 244), ("R$", 510), ("85,00C", 525), **alta),
        _linha(132.2, ("Recebimento", 132), ("Pix", 179), ("EMPRESA", 191), ("FICTICIA", 230), ("LTDA", 275), altura=7.5),
        _linha(147.8, ("03/07", 37), ("SALDO", 146), ("DO", 177), ("DIA", 191), ("R$", 495), ("3.670,55C", 510), **alta),
        _linha(166.5, ("20/07", 37), ("SICOOB", 69), ("SEG", 103), ("DÉB.", 146), ("CONV.", 168), ("SEGUROS", 195), ("R$", 504), ("157,83D", 519), **alta),
        _linha(185.2, ("21/07", 37), ("129", 69), ("DÉBITO", 146), ("PACOTE", 180), ("R$", 516), ("1,80D", 531), **alta),
    )
    celulas = celulas_do_documento([pagina])
    assert [(c.centavos, c.descricao) for c in celulas] == [
        (8500, "PIX RECEBIDO - OUTRA IF Recebimento Pix EMPRESA FICTICIA LTDA"),
        (367055, "SALDO DO DIA"),
        (-15783, "DÉB. CONV. SEGUROS"),
        (-180, "DÉBITO PACOTE"),
    ]


def test_pagbank_descricao_de_uma_linha_acima_do_valor():
    # a célula de uma linha só também pode ficar acima da linha do valor; quem
    # decide o dono é a distância (a próxima célula fica bem mais perto do valor dela)
    pagina = _pagina(
        _linha(100, ("Data", 35), ("Descrição", 114), ("Valor", 530)),
        _linha(120, ("04/07/2026", 35), ("Vendas", 114), ("-", 143), ("Disponivel", 148), ("PIX", 187), ("R$", 527), ("17,41", 539)),
        _linha(137.4, ("Pagamento", 114), ("de", 157), ("empréstimo", 168), ("-", 212), ("Parcela", 217), ("CCB-0001", 260)),
        _linha(142, ("04/07/2026", 35), ("-R$", 519), ("393,10", 535)),
        _linha(159.4, ("Mensalidade", 114), ("Seguro", 162), ("-", 192), ("Para:", 198), ("EMPRESA", 222), ("FICTICIA", 262), ("DE", 300)),
        _linha(164, ("04/07/2026", 35), ("-R$", 528), ("6,90", 543)),
        _linha(168.7, ("PAGAMENTO", 114)),
    )
    celulas = celulas_do_documento([pagina])
    assert [(c.centavos, c.descricao) for c in celulas] == [
        (1741, "Vendas - Disponivel PIX"),
        (-39310, "Pagamento de empréstimo - Parcela CCB-0001"),
        (-690, "Mensalidade Seguro - Para: EMPRESA FICTICIA DE PAGAMENTO"),
    ]


def test_c6_tipo_na_linha_do_valor_e_descricao_quebrada():
    # Data lançamento | Data contábil | Tipo | Descrição | Valor (cabeçalho em 2 linhas)
    pagina = _pagina(
        _linha(95, ("Data", 37), ("Data", 70)),
        _linha(102, ("Tipo", 104), ("Descrição", 160), ("Valor", 520)),
        _linha(120, ("01/06", 37), ("01/06", 70), ("Entrada", 104), ("PIX", 140), ("Pix", 160), ("recebido", 176), ("de", 212), ("FULANO", 224), ("R$", 500), ("40,00", 515)),
        _linha(132, ("Pix", 160), ("recebido", 176), ("de", 212), ("EMPRESA", 224), ("MUITO", 262), ("COMPRIDA", 290)),
        _linha(136.6, ("01/06", 37), ("01/06", 70), ("Entrada", 104), ("PIX", 140), ("R$", 495), ("3.300,00", 510)),
        _linha(141.2, ("LTDA", 160)),
    )
    celulas = celulas_do_documento([pagina])
    assert [c.descricao for c in celulas] == [
        "Entrada PIX Pix recebido de FULANO",
        "Entrada PIX Pix recebido de EMPRESA MUITO COMPRIDA LTDA",
    ]


def test_so_troca_a_descricao_quando_o_valor_casa():
    def t(cents: int, direction: str, desc: str) -> NormalizedTransaction:
        return NormalizedTransaction(date="2026-07-01", description=desc, amount_cents=cents, direction=direction)

    txns = [t(20, "entrada", "RENDIMENTO 1234567 PAGTO"), t(110400, "saida", "PAGTO 58 FORNECEDOR"), t(999, "saida", "OUTRO")]
    pagina = _pagina(
        _CAB_BRADESCO,
        _linha(120, ("01/07/2026", 41), ("RENDIMENTO", 101), ("1234567", 266), ("0,20", 373), ("1.000,20", 529)),
        _linha(130, ("PAGTO", 101), ("ELETRON", 130)),
        _linha(134.5, ("58", 266), ("-1.104,00", 443), ("-103,80", 529)),
        _linha(139, ("FORNECEDOR", 101)),
    )
    trocadas = melhorar_descricoes(txns, celulas_do_documento([pagina]))
    assert trocadas == 2
    assert [x.description for x in txns] == ["RENDIMENTO", "PAGTO ELETRON FORNECEDOR", "OUTRO"]
