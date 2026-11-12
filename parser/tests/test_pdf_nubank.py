"""Nubank PDF: a descrição quebra em várias linhas, com ou sem linha em branco
entre os pedaços (visto em extratos reais de 06 e 07/2026). Antes a leitura
parava na 1ª linha em branco e o mesmo pagador saía inteiro num lançamento e
cortado no outro — a memória da Classificação não reconhecia um pelo outro.

Dados fictícios (o repositório é público); o formato é o do extrato real.
"""

from __future__ import annotations

from app.parsers.pdf import _nu_juntar, _parse_nubank_pdf

# Texto como o extract_text(layout=True) devolve: espaçamento e linhas em
# branco variam conforme a posição do lançamento na página.
_TEXTO = """
        Movimentações

        09 JUN 2026 Total de entradas                               + 67,60
                 Transferência recebida pelo Pix ALFA PAGAMENTOS DIGITAIS LTDA. - 11.222.333 67,60

                                    /0001-81 - BANCO FICTICIO IP LTDA. (0999) Agência: 1

                                    Conta: 1234567-8

                 Saldo do dia                                         913,11

        16 JUN 2026 Total de entradas                               + 11,92
                 Transferência recebida pelo Pix ALFA PAGAMENTOS DIGITAIS LTDA. - 11.222.333 11,92
                                    /0001-81 - BANCO FICTICIO IP LTDA. (0999) Agência: 1
                                    Conta: 1234567-8
                 Total de saídas                                    - 1.800,00
                 Transferência enviada pelo Pix Fulano de Tal - •••.111.222-•• - NU 1.800,00

                                    PAGAMENTOS - IP (0260) Agência: 1 Conta:

        Tem alguma dúvida? Mande uma mensagem para nosso time de atendimento pelo chat do app
               Extrato gerado dia 01 de julho de 2026 às 01:54        1 de 2

                                                      00.000.000 EMPRESA FICTICIA
        01 DE JUNHO DE 2026 a 30 DE JUNHO DE 2026                VALORES EM R$

                                    7654321-0

                 Saldo do dia                                          43,41

        27 JUN 2026 Total de entradas                               + 1.200,00

                 Transferência recebida pelo Pix BETA SERVICOS DE PAGAMENTO LTDA - 1.200,00
                                    22.333.444/0001-55 - BCO EXEMPLO (BRASIL) S.

                                    A. (0123) Agência: 1000 Conta: 99999-9

                 Saldo do dia                                        1.288,11
        O saldo líquido corresponde ao total de depósitos e rendimentos em conta.
"""


def test_mesmo_pagador_sai_igual_com_ou_sem_linha_em_branco():
    r = _parse_nubank_pdf(_TEXTO)
    alfa = [t.description for t in r.transactions if "ALFA" in t.description]
    assert alfa == [
        "Transferência recebida pelo Pix - ALFA PAGAMENTOS DIGITAIS LTDA. - 11.222.333/0001-81 - "
        "BANCO FICTICIO IP LTDA. (0999) Agência: 1 Conta: 1234567-8",
    ] * 2


def test_descricao_continua_depois_da_quebra_de_pagina():
    r = _parse_nubank_pdf(_TEXTO)
    fulano = next(t for t in r.transactions if "Fulano" in t.description)
    assert fulano.description == (
        "Transferência enviada pelo Pix - Fulano de Tal - •••.111.222-•• - NU PAGAMENTOS - IP (0260) "
        "Agência: 1 Conta: 7654321-0"
    )
    assert (fulano.direction, fulano.amount_cents) == ("saida", 180000)


def test_hifen_antes_do_valor_e_da_descricao_e_s_a_volta_a_grudar():
    r = _parse_nubank_pdf(_TEXTO)
    beta = next(t for t in r.transactions if "BETA" in t.description)
    # do jeito que o MEMO do OFX do Nubank escreve
    assert beta.description == (
        "Transferência recebida pelo Pix - BETA SERVICOS DE PAGAMENTO LTDA - 22.333.444/0001-55 - "
        "BCO EXEMPLO (BRASIL) S.A. (0123) Agência: 1000 Conta: 99999-9"
    )
    assert (beta.direction, beta.amount_cents) == ("entrada", 120000)
    # o texto legal do fim do extrato não entra em descrição nenhuma
    assert not [t for t in r.transactions if "saldo líquido" in t.description]
    assert len(r.transactions) == 4


def test_tipo_do_lancamento_separado_por_hifen_como_no_ofx():
    texto = """
        05 JUN 2026 Total de entradas                               + 100,00
                 Transferência Recebida GAMA COMERCIO DE TESTE - 33.444.555/0001-66 100,00
                 Total de saídas                                    - 50,00
                 Pagamento de boleto efetuado DELTA SERVICOS DE TESTE 50,00
                 Saldo do dia                                          50,00
    """
    r = _parse_nubank_pdf(texto)
    assert [t.description for t in r.transactions] == [
        "Transferência Recebida - GAMA COMERCIO DE TESTE - 33.444.555/0001-66",
        "Pagamento de boleto efetuado - DELTA SERVICOS DE TESTE",
    ]


def test_juntar_pedacos():
    assert _nu_juntar("LTDA. - 11.222.333", "/0001-81 - BANCO") == "LTDA. - 11.222.333/0001-81 - BANCO"
    assert _nu_juntar("22.333.444/0001-", "55 - BCO") == "22.333.444/0001-55 - BCO"
    assert _nu_juntar("(BRASIL) S.", "A. (0123)") == "(BRASIL) S.A. (0123)"
    assert _nu_juntar("Tal - •••.", "111.222-••") == "Tal - •••.111.222-••"
    assert _nu_juntar("LTDA -", "22.333.444") == "LTDA - 22.333.444"
    assert _nu_juntar("- NU", "PAGAMENTOS - IP") == "- NU PAGAMENTOS - IP"
    assert _nu_juntar("DIGITAIS LTDA.", "- 11.222.333") == "DIGITAIS LTDA. - 11.222.333"
