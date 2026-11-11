from __future__ import annotations

from ..schemas import FileFormat, ParseResult
from .detect import detect_format
from .excel import EncryptedFileError, parse_xls, parse_xlsx
from .limites import ArquivoPesadoError
from .ofx import parse_ofx
from .pdf import EncryptedPdfError, UnreadablePdfError, parse_pdf
from .periodo import com_periodo_do_extrato
from .planilha import PlanilhaInvalidaError, ler_planilha, parse_planilha
from .tabular import NotAStatementError, parse_csv

__all__ = [
    "ArquivoPesadoError",
    "com_periodo_do_extrato",
    "detect_format",
    "parse_statement",
    "ler_planilha",
    "parse_planilha",
    "PlanilhaInvalidaError",
    "UnsupportedFormatError",
    "EncryptedFileError",
    "EncryptedPdfError",
    "NotAStatementError",
    "UnreadablePdfError",
]


class UnsupportedFormatError(Exception):
    def __init__(self, fmt: str, hint: str | None = None):
        super().__init__(f"formato não suportado: {fmt}")
        self.fmt = fmt
        self.hint = hint


def parse_statement(
    filename: str,
    content: bytes,
    hint_format: str | None = None,
    pdf_password: str | None = None,
) -> ParseResult:
    """Lê o extrato e devolve o período DO EXTRATO (ver periodo.py), não o do
    1º ao último lançamento — os leitores de cada formato continuam devolvendo
    o lido; quem decide o período é aqui."""
    return com_periodo_do_extrato(_ler(filename, content, hint_format, pdf_password), filename)


def _ler(filename: str, content: bytes, hint_format: str | None, pdf_password: str | None) -> ParseResult:
    fmt: FileFormat = hint_format or detect_format(filename, content)  # type: ignore[assignment]

    if fmt == "ofx":
        return parse_ofx(content)
    if fmt == "csv":
        return parse_csv(content)
    if fmt == "xlsx":
        return parse_xlsx(content)
    if fmt == "xls":
        return parse_xls(content)
    if fmt == "pdf":
        return parse_pdf(content, pdf_password)

    raise UnsupportedFormatError(fmt or "desconhecido")
