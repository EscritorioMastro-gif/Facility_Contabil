from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Direction = Literal["entrada", "saida"]
FileFormat = Literal["pdf", "ofx", "csv", "xls", "xlsx"]


class NormalizedTransaction(BaseModel):
    date: str = Field(description="Data do lançamento, ISO YYYY-MM-DD")
    description: str = Field(default="", description="Histórico do extrato (texto livre)")
    amount_cents: int = Field(ge=0, description="Valor absoluto em centavos")
    direction: Direction
    raw: dict[str, Any] = Field(default_factory=dict)


class ParseResult(BaseModel):
    format: FileFormat
    bank_id: str | None = None
    account_id: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    transactions: list[NormalizedTransaction] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ParseError(BaseModel):
    error: str
    format: FileFormat | None = None
    hint: str | None = None


# --------------------------------------------------------------------------- #
# Nova importação Excel — planilha própria do cliente, colunas escolhidas na mão
# --------------------------------------------------------------------------- #
class PlanilhaCelula(BaseModel):
    t: str = Field(description="Texto como aparece na célula")
    d: str | None = Field(default=None, description="A célula lida como data (ISO), se der")
    v: int | None = Field(default=None, description="A célula lida como valor, em centavos com sinal")


class PlanilhaLinha(BaseModel):
    n: int = Field(description="Número da linha na planilha (1 = primeira, como no Excel)")
    c: list[PlanilhaCelula | None] = Field(description="Células da linha; null = vazia")


class PlanilhaAba(BaseModel):
    nome: str
    oculta: bool = False


class PlanilhaSugestao(BaseModel):
    data: int | None = None
    valor: int | None = None
    historico: list[int] = Field(default_factory=list)


class PlanilhaResult(BaseModel):
    formato: Literal["xls", "xlsx"]
    abas: list[PlanilhaAba]
    aba: int = Field(description="Índice (0 = primeira) da aba lida")
    colunas: int
    linhas: list[PlanilhaLinha] = Field(description="Só as linhas com alguma célula preenchida")
    total_linhas: int = Field(description="Linhas preenchidas na aba (pode passar de `linhas` se truncado)")
    truncado: bool = False
    sugestao: PlanilhaSugestao | None = Field(
        default=None, description="Colunas de data/valor/histórico achadas pelo cabeçalho"
    )


class ExcelMapeamento(BaseModel):
    """Função de cada coluna (índice 0 = coluna A) escolhida pelo operador."""

    aba: int = Field(default=0, ge=0)
    data: int = Field(ge=0)
    valor: int = Field(ge=0)
    historico: list[int] = Field(min_length=1)
    excluir: list[int] = Field(
        default_factory=list, description="Linhas da planilha que o operador tirou da importação"
    )
