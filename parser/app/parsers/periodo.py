"""Período do extrato — o que aparece no topo da importação e no lote do Domínio.

Pedido do user (2026-11-11): o período é o do EXTRATO (ex.: 01/10/2026 a
31/10/2026), não do 1º ao último dia que teve lançamento. Ordem:

1. o período impresso pelo banco (OFX DTSTART/DTEND, "Período: ... a ..." no
   PDF) — se contiver todos os lançamentos;
2. o período no nome do arquivo ("Extrato-01-07-2026-a-31-07-2026.csv",
   "2026-07-01_2026-07-31.ofx") — idem;
3. senão, os meses inteiros dos lançamentos (1º dia do mês do primeiro, último
   dia do mês do último).

A conferência "contém todos os lançamentos" existe porque o banco nem sempre
acerta: o OFX do C6 põe em DTSTART/DTEND a hora em que o arquivo foi gerado.
"""

from __future__ import annotations

import calendar
import re
from datetime import date

from ..schemas import ParseResult

# período declarado maior que isso é lixo (data de geração, "desde a abertura"...)
_MAX_DIAS = 400

_DMY = r"(\d{2})[-_.](\d{2})[-_.](\d{4})"
_YMD = r"(\d{4})[-_.](\d{2})[-_.](\d{2})"
_DATA_NO_NOME = re.compile(rf"(?<!\d){_DMY}(?!\d)|(?<!\d){_YMD}(?!\d)")

Periodo = tuple[date | None, date | None]


def _fim_do_mes(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _data(iso: str | None) -> date | None:
    try:
        return date.fromisoformat(iso[:10]) if iso else None
    except ValueError:
        return None


def periodo_no_nome(nome: str) -> Periodo:
    """As duas primeiras datas do nome do arquivo, se forem um início e um fim."""
    datas: list[date] = []
    for m in _DATA_NO_NOME.finditer(nome or ""):
        g = m.groups()
        try:
            d = date(int(g[2]), int(g[1]), int(g[0])) if g[0] else date(int(g[3]), int(g[4]), int(g[5]))
        except ValueError:
            continue
        datas.append(d)
        if len(datas) == 2:
            break
    if len(datas) == 2 and datas[0] <= datas[1]:
        return datas[0], datas[1]
    return None, None


def _serve(p: Periodo, primeiro: date, ultimo: date) -> bool:
    ini, fim = p
    return bool(ini and fim and ini <= primeiro and ultimo <= fim and (fim - ini).days <= _MAX_DIAS)


def periodo_do_extrato(candidatos: list[Periodo], datas: list[date]) -> Periodo:
    """O 1º candidato que contém todos os lançamentos, sem passar dos meses
    deles; senão os meses inteiros dos lançamentos."""
    if not datas:
        for ini, fim in candidatos:
            if ini and fim and ini <= fim and (fim - ini).days <= _MAX_DIAS:
                return ini, fim
        return None, None
    primeiro, ultimo = min(datas), max(datas)
    mes_ini, mes_fim = primeiro.replace(day=1), _fim_do_mes(ultimo)
    for p in candidatos:
        if _serve(p, primeiro, ultimo):
            # OFX que declara "30/06 a 31/07" num extrato de julho (o banco põe o
            # dia anterior) fica 01/07 a 31/07; período parcial (05/10 a 20/10) fica como está
            return max(p[0], mes_ini), min(p[1], mes_fim)  # type: ignore[type-var]
    return mes_ini, mes_fim


def com_periodo_do_extrato(r: ParseResult, nome_arquivo: str) -> ParseResult:
    """Troca o período lido (1º/último lançamento) pelo período do extrato."""
    datas = [d for d in (_data(t.date) for t in r.transactions) if d]
    ini, fim = periodo_do_extrato(
        [(_data(r.declared_start), _data(r.declared_end)), periodo_no_nome(nome_arquivo)],
        datas,
    )
    r.period_start = ini.isoformat() if ini else None
    r.period_end = fim.isoformat() if fim else None
    return r
