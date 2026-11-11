"""Período do extrato (pedido de 2026-11-11): o do extrato, não do 1º ao último
dia com lançamento."""

from __future__ import annotations

from datetime import date

import pytest

from app.parsers import parse_statement
from app.parsers.periodo import periodo_do_extrato, periodo_no_nome

D = date


def _ofx(dtstart: str, dtend: str, datas: list[str]) -> bytes:
    trns = "".join(
        f"<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>{d}120000<TRNAMT>-10.00<FITID>{i}<MEMO>TARIFA</STMTTRN>"
        for i, d in enumerate(datas)
    )
    return (
        "OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341"
        f"<ACCTID>1</BANKACCTFROM><BANKTRANLIST><DTSTART>{dtstart}<DTEND>{dtend}{trns}"
        "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
    ).encode("cp1252")


def test_ofx_usa_o_periodo_declarado():
    r = parse_statement("extrato.ofx", _ofx("20261001", "20261031", ["20261005", "20261028"]))
    assert (r.period_start, r.period_end) == ("2026-10-01", "2026-10-31")


def test_ofx_com_data_de_geracao_no_periodo_cai_no_mes_inteiro():
    # C6: DTSTART/DTEND = hora em que o arquivo foi gerado, não contém os lançamentos
    r = parse_statement("extrato.ofx", _ofx("20261103", "20261103", ["20261005", "20261028"]))
    assert (r.period_start, r.period_end) == ("2026-10-01", "2026-10-31")


def test_sem_periodo_declarado_vale_o_mes_inteiro_dos_lancamentos():
    csv = "Data;Descrição;Valor\n05/09/2026;PIX;-10,00\n28/10/2026;TARIFA;-5,00\n".encode()
    r = parse_statement("extrato.csv", csv)
    assert (r.period_start, r.period_end) == ("2026-09-01", "2026-10-31")


def test_periodo_no_nome_do_arquivo():
    csv = "Data;Descrição;Valor\n05/07/2026;PIX;-10,00\n".encode()
    r = parse_statement("Extrato-01-07-2026-a-15-07-2026-CSV.csv", csv)
    assert (r.period_start, r.period_end) == ("2026-07-01", "2026-07-15")


@pytest.mark.parametrize(
    ("nome", "esperado"),
    [
        ("Extrato-01-07-2026-a-31-07-2026-CSV.csv", (D(2026, 7, 1), D(2026, 7, 31))),
        ("2026-07-01_2026-07-31.ofx", (D(2026, 7, 1), D(2026, 7, 31))),
        ("679a81e6-be81-4fbd-b5fe-e90b4f688964-2026-07-01-2026-07-31.csv", (D(2026, 7, 1), D(2026, 7, 31))),
        ("extrato-pj-05_08_2026-11h39m44s.pdf", (None, None)),  # só a data de geração
        ("Bradesco_03082026_154514.PDF", (None, None)),
        ("31-07-2026_01-07-2026.csv", (None, None)),  # fim antes do início
    ],
)
def test_le_o_periodo_do_nome(nome, esperado):
    assert periodo_no_nome(nome) == esperado


def test_periodo_declarado_que_nao_contem_os_lancamentos_e_ignorado():
    datas = [D(2026, 10, 5), D(2026, 11, 2)]
    assert periodo_do_extrato([(D(2026, 10, 1), D(2026, 10, 31))], datas) == (D(2026, 10, 1), D(2026, 11, 30))


def test_periodo_declarado_longo_demais_e_ignorado():
    datas = [D(2026, 10, 5)]
    assert periodo_do_extrato([(D(2020, 1, 1), D(2026, 12, 31))], datas) == (D(2026, 10, 1), D(2026, 10, 31))


def test_periodo_declarado_com_o_dia_anterior_fica_no_mes_dos_lancamentos():
    # OFX real (Kaiene, 07/2026): DTSTART 20260630, DTEND 20260731, lançamentos só em julho
    datas = [D(2026, 7, 1), D(2026, 7, 31)]
    assert periodo_do_extrato([(D(2026, 6, 30), D(2026, 7, 31))], datas) == (D(2026, 7, 1), D(2026, 7, 31))
    # com lançamento em 30/06 de verdade, o 30/06 fica
    assert periodo_do_extrato([(D(2026, 6, 30), D(2026, 7, 31))], [D(2026, 6, 30), *datas]) == (
        D(2026, 6, 30),
        D(2026, 7, 31),
    )


def test_periodo_parcial_declarado_fica_como_esta():
    assert periodo_do_extrato([(D(2026, 10, 5), D(2026, 10, 20))], [D(2026, 10, 6)]) == (D(2026, 10, 5), D(2026, 10, 20))


def test_fevereiro_e_ano_bissexto():
    assert periodo_do_extrato([], [D(2028, 2, 10)]) == (D(2028, 2, 1), D(2028, 2, 29))
