from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .config import MAX_UPLOAD_BYTES
from .parsers import (
    EncryptedFileError,
    EncryptedPdfError,
    NotAStatementError,
    PlanilhaInvalidaError,
    UnsupportedFormatError,
    ler_planilha,
    parse_planilha,
    parse_statement,
)
from .parsers.pdf import UnreadablePdfError
from .schemas import ExcelMapeamento, ParseResult, PlanilhaResult
from .security import require_shared_secret

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("parser")

app = FastAPI(title="Parser de Extratos", version="0.2.0")


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "parser"}


@app.post("/parse", response_model=ParseResult, dependencies=[Depends(require_shared_secret)])
async def parse(
    file: UploadFile = File(...),
    hint_format: str | None = Form(default=None),
    pdf_password: str | None = Form(default=None),
) -> ParseResult:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="arquivo muito grande")
    if not content:
        raise HTTPException(status_code=400, detail="arquivo vazio")

    filename = file.filename or "extrato"
    try:
        result = parse_statement(filename, content, hint_format, pdf_password)
    except UnsupportedFormatError as exc:
        return JSONResponse(
            status_code=422, content={"error": str(exc), "format": exc.fmt, "hint": exc.hint}
        )
    except (EncryptedFileError, EncryptedPdfError) as exc:
        return JSONResponse(
            status_code=422, content={"error": str(exc), "code": "encrypted"}
        )
    except NotAStatementError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "not_statement"})
    except UnreadablePdfError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "unreadable"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao parsear %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler o extrato: {exc}") from exc

    logger.info(
        "parse ok: %s formato=%s txns=%d", filename, result.format, len(result.transactions)
    )
    return result


async def _ler_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="arquivo muito grande")
    if not content:
        raise HTTPException(status_code=400, detail="arquivo vazio")
    return content


def _erro_planilha(exc: Exception) -> JSONResponse:
    code = "encrypted" if isinstance(exc, EncryptedFileError) else "planilha"
    return JSONResponse(status_code=422, content={"error": str(exc), "code": code})


@app.post(
    "/excel/planilha",
    response_model=PlanilhaResult,
    response_model_exclude_none=True,
    dependencies=[Depends(require_shared_secret)],
)
async def excel_planilha(
    file: UploadFile = File(...),
    aba: int | None = Form(default=None),
) -> PlanilhaResult:
    """Nova importação Excel, etapa 1: a aba como grade, pro operador escolher as colunas."""
    content = await _ler_upload(file)
    filename = file.filename or "planilha"
    try:
        result = ler_planilha(content, aba)
    except (EncryptedFileError, PlanilhaInvalidaError) as exc:
        return _erro_planilha(exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao ler planilha %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler a planilha: {exc}") from exc

    logger.info(
        "planilha ok: %s aba=%d linhas=%d colunas=%d", filename, result.aba, result.total_linhas, result.colunas
    )
    return result


@app.post("/parse/excel", response_model=ParseResult, dependencies=[Depends(require_shared_secret)])
async def parse_excel(
    file: UploadFile = File(...),
    mapeamento: str = Form(...),
) -> ParseResult:
    """Nova importação Excel, etapa 2: lê os lançamentos pelas colunas escolhidas."""
    try:
        mapa = ExcelMapeamento.model_validate_json(mapeamento)
    except ValidationError as exc:
        return JSONResponse(
            status_code=422,
            content={"error": f"escolha de colunas inválida: {exc.errors()[0]['msg']}", "code": "planilha"},
        )
    content = await _ler_upload(file)
    filename = file.filename or "planilha"
    try:
        result = parse_planilha(content, mapa)
    except (EncryptedFileError, PlanilhaInvalidaError) as exc:
        return _erro_planilha(exc)
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao ler planilha %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler a planilha: {exc}") from exc

    logger.info("parse excel ok: %s txns=%d", filename, len(result.transactions))
    return result
