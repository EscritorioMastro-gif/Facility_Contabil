"""Limites de recurso contra arquivo "bomba".

Um .xlsx é um zip de XML: 5 MB compactados podem abrir em gigabytes e a
openpyxl (modo completo, ver excel.py) carrega tudo na memória — derruba o
serviço inteiro, não só aquela leitura. PDF com milhares de páginas prende a
CPU por minutos. Os dois casos são recusados ANTES de abrir o arquivo de verdade.
"""

from __future__ import annotations

import io
import zipfile

# Extrato real mais pesado visto: Mercado Pago, 86 páginas / 1.211 lançamentos.
MAX_PAGINAS_PDF = 500
# XML total descompactado de uma planilha (o arquivo enviado tem até 25 MB).
MAX_XLSX_DESCOMPACTADO = 300 * 1024 * 1024
# Compressão acima disso, num membro grande, é sinal de zip bomb.
MAX_RAZAO_COMPRESSAO = 200
_MEMBRO_GRANDE = 20 * 1024 * 1024


class ArquivoPesadoError(Exception):
    """O arquivo passa dos limites de leitura (páginas / tamanho aberto)."""


def conferir_paginas_pdf(total: int) -> None:
    if total > MAX_PAGINAS_PDF:
        raise ArquivoPesadoError(
            f"o PDF tem {total} páginas — o limite é {MAX_PAGINAS_PDF}. "
            "Divida o extrato em períodos menores."
        )


def conferir_xlsx_seguro(content: bytes) -> None:
    """Recusa .xlsx que abriria grande demais. Zip inválido passa adiante: quem
    dá o erro de arquivo corrompido é a própria openpyxl, com a mensagem de sempre."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            total = 0
            for info in z.infolist():
                total += info.file_size
                comprimido = max(info.compress_size, 1)
                if info.file_size > _MEMBRO_GRANDE and info.file_size / comprimido > MAX_RAZAO_COMPRESSAO:
                    raise ArquivoPesadoError(
                        "a planilha tem conteúdo compactado de forma anormal e não pode ser lida"
                    )
    except zipfile.BadZipFile:
        return
    if total > MAX_XLSX_DESCOMPACTADO:
        raise ArquivoPesadoError(
            "a planilha é grande demais para ler (mais de "
            f"{MAX_XLSX_DESCOMPACTADO // (1024 * 1024)} MB de dados) — "
            "exporte só o período/aba do extrato"
        )
