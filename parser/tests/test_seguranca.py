"""Barreiras do leitor: segredo antes do corpo, tamanho, docs fechadas e
arquivo "bomba" (PDF com páginas demais / .xlsx que abre gigante)."""

from __future__ import annotations

import importlib
import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import app
from app.parsers import limites

client = TestClient(app)


def test_docs_fechadas_por_padrao():
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_sem_segredo_recusa_antes_de_ler_o_arquivo(monkeypatch):
    monkeypatch.setattr(config, "PARSER_SHARED_SECRET", "segredo-de-teste")
    arq = {"file": ("x.csv", b"Data,Valor\n01/07/2026,10\n", "text/csv")}

    assert client.post("/parse", files=arq).status_code == 401
    assert client.post("/parse", files=arq, headers={"X-Parser-Secret": "errado"}).status_code == 401
    # rota que nem existe também pede o segredo (não dá pra mapear o serviço de fora)
    assert client.get("/qualquer-coisa").status_code == 401
    # health continua aberto (o Render usa pra saber se o serviço está de pé)
    assert client.get("/health").status_code == 200
    # com o segredo certo passa
    ok = client.post("/parse", files=arq, headers={"X-Parser-Secret": "segredo-de-teste"})
    assert ok.status_code in (200, 422)


def test_corpo_grande_demais_e_barrado_pelo_tamanho_declarado(monkeypatch):
    monkeypatch.setattr(config, "MAX_UPLOAD_BYTES", 0)  # limite efetivo: 1 MB de folga do formulário
    grande = b"0" * (1024 * 1024 + 50_000)
    r = client.post("/parse", files={"file": ("x.csv", grande, "text/csv")})
    assert r.status_code == 413


def _xlsx_bomba(tamanho: int) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/worksheets/sheet1.xml", b"0" * tamanho)
    return buf.getvalue()


def test_xlsx_que_abre_gigante_e_recusado(monkeypatch):
    monkeypatch.setattr(limites, "MAX_XLSX_DESCOMPACTADO", 1024 * 1024)
    bomba = _xlsx_bomba(2 * 1024 * 1024)
    assert len(bomba) < 50_000  # pequeno no envio...

    for rota, extra in (("/parse", {}), ("/excel/planilha", {})):
        r = client.post(rota, files={"file": ("bomba.xlsx", bomba, "application/octet-stream")}, data=extra)
        assert r.status_code == 422, rota
        assert r.json()["code"] == "too_large", rota


def test_xlsx_com_compressao_anormal_e_recusado(monkeypatch):
    monkeypatch.setattr(limites, "_MEMBRO_GRANDE", 1024 * 1024)
    r = client.post(
        "/parse", files={"file": ("bomba.xlsx", _xlsx_bomba(3 * 1024 * 1024), "application/octet-stream")}
    )
    assert r.status_code == 422
    assert r.json()["code"] == "too_large"


def test_pdf_com_paginas_demais_e_recusado(monkeypatch):
    from reportlab.pdfgen import canvas

    monkeypatch.setattr(limites, "MAX_PAGINAS_PDF", 2)
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i in range(3):
        c.drawString(72, 720, f"pagina {i + 1}")
        c.showPage()
    c.save()

    r = client.post("/parse", files={"file": ("x.pdf", buf.getvalue(), "application/pdf")})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "too_large"
    assert "3 páginas" in body["error"]


def test_em_producao_nao_sobe_sem_segredo(monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("PARSER_SHARED_SECRET", "")
    with pytest.raises(RuntimeError, match="obrigatório em produção"):
        importlib.reload(config)
    monkeypatch.delenv("RENDER")
    importlib.reload(config)  # volta ao estado dos outros testes
    assert config.PARSER_SHARED_SECRET == ""
