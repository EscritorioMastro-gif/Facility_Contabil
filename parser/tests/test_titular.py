"""De quem é o extrato (titular.py) — casos tirados de extratos reais.

Medido em 2026-11-18 contra 480 PDFs reais da rotina Extrator de Extrato
Bancário: 423 com o titular certo, 35 sem documento (29 deles com a conta no
cabeçalho) e 19 "errados" que eram, na verdade, extratos de OUTRA empresa
arquivados na pasta errada pela rotina (ou notas fiscais) — o leitor acertou.
"""
from app.parsers.tabular import rows_to_result
from app.parsers.titular import conta_do_cabecalho, documento_do_titular

NUBANK_PJ = """
                                   AMERICAN BULL CONFECCOES LTDA
                         CNPJ 57.051.659/0001-94 Agência 0001 Conta
                                   290536074-4
 01 DE AGOSTO DE 2026 a 31 DE AGOSTO DE 2026        VALORES EM R$
 Saldo inicial             56,86
 05 AGO 2026   Transferência recebida pelo Pix  BELLA STORE LIMITADA - 45.239.500/0001-19   1.200,00
 06 AGO 2026   Transferência enviada pelo Pix  FORNECEDOR X - CNPJ 11.222.333/0001-81   300,00
 Nu Financeira S.A. - Sociedade de Crédito, Financiamento e Investimento CNPJ: 30.680.829/0001-43
 Nu Pagamentos S.A. - Instituição de Pagamento CNPJ: 18.236.120/0001-58
                                   AMERICAN BULL CONFECCOES LTDA
                         CNPJ 57.051.659/0001-94 Agência 0001 Conta
"""


def test_titular_do_cabecalho_e_nao_a_contraparte_nem_o_banco():
    assert documento_do_titular(NUBANK_PJ) == "57051659000194"


def test_contraparte_sem_rotulo_nao_vira_titular():
    texto = "EXTRATO\n10/08/2026 Pix recebido BELLA STORE LIMITADA 45.239.500/0001-19 100,00"
    assert documento_do_titular(texto) is None


def test_cnpj_de_fundo_de_investimento_nao_e_o_titular():
    texto = "Extratos - Investimentos Fundos\nBB RF Simples Ágil - CNPJ: 43.617.343/0001-02\n"
    assert documento_do_titular(texto) is None


def test_c6_razao_social_com_ponto_e_cnpj():
    texto = "Extrato exportado no dia 01/09/2026\nDINIZ SHOP LTDA • 57.075.695/0001-98\nAgência: 1 • Conta: 123"
    assert documento_do_titular(texto) == "57075695000198"


def test_sicoob_base_do_cabecalho_casa_com_o_cnpj_inteiro_no_corpo():
    texto = (
        "SICOOB - SISTEMA DE COOPERATIVAS DE CRÉDITO\n"
        "Conta: 1234/56789-0 / 59.545.429 DANIELA DE FATIMA SANTOS\n"
        "02/08 PIX REC.OUTRA IF 59.545.429 0001-07 150,00 C\n"
        "03/08 PIX EMIT. 11.222.333/0001-81 50,00 D\n"
    )
    assert documento_do_titular(texto) == "59545429000107"


def test_cpf_so_digitos_do_mercado_pago():
    assert documento_do_titular("EXTRATO DE CONTA\nCPF/CNPJ: 45296524837\n") == "45296524837"


def test_conta_do_cabecalho_nubank():
    assert conta_do_cabecalho(NUBANK_PJ) == "2905360744"


def test_conta_bradesco_ag_cc():
    assert conta_do_cabecalho("Extrato de: Ag: 1234 | CC: 0012345-6\n01/08/2026 SALDO 10,00") == "123456"


def test_saldo_em_conta_nao_e_numero_de_conta():
    assert conta_do_cabecalho("Saldo em conta 1.234,56\nResumo do mês") is None


def test_conta_do_corpo_do_extrato_nao_conta():
    texto = "EXTRATO PJ\n01/08/2026 Pix recebido Conta: 39239222-1 100,00\n"
    assert conta_do_cabecalho(texto) is None


def test_csv_com_cabecalho_do_banco_traz_titular_e_conta():
    rows = [
        ["Extrato de conta corrente"],
        ["Cliente: VALTER DE OLIVEIRA JUNIOR CONFECCAO LIMITADA", "CNPJ: 12.345.678/0001-95"],
        ["Agência: 0009", "Conta: 13013717-4"],
        ["Data", "Histórico", "Valor"],
        ["01/08/2026", "PIX RECEBIDO CNPJ 11.222.333/0001-81", "100,00"],
        ["02/08/2026", "TARIFA", "-5,00"],
    ]
    r = rows_to_result(rows, "csv")
    assert len(r.transactions) == 2
    assert r.titular_doc == "12345678000195"
    assert r.account_id == "130137174"


def test_csv_sem_cabecalho_do_banco_nao_chuta_o_titular():
    rows = [
        ["Data", "Descrição", "Valor"],
        ["01/08/2026", "Pix de FORNECEDOR CNPJ 11.222.333/0001-81 Conta: 39239222-1", "100,00"],
    ]
    r = rows_to_result(rows, "csv")
    assert r.titular_doc is None
    assert r.account_id is None
