import hmac
import json

from fastapi import Header, HTTPException, status

from . import config


def _segredo_confere(recebido: str | None) -> bool:
    """Confere o segredo compartilhado com o backend (tempo constante).

    Sem PARSER_SHARED_SECRET (só no dev local) não exige nada — em produção o
    config.py nem deixa o serviço subir assim.
    """
    esperado = config.PARSER_SHARED_SECRET
    if not esperado:
        return True
    return bool(recebido) and hmac.compare_digest(recebido.encode(), esperado.encode())


async def require_shared_secret(x_parser_secret: str | None = Header(default=None)) -> None:
    """Segunda barreira, por rota. A primeira é a GuardaDeEntrada."""
    if not _segredo_confere(x_parser_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="segredo inválido")


class _CorpoGrandeDemais(Exception):
    pass


async def _responder(send, codigo: int, msg: str) -> None:
    corpo = json.dumps({"detail": msg}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": codigo,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(corpo)).encode())],
        }
    )
    await send({"type": "http.response.body", "body": corpo})


class GuardaDeEntrada:
    """Middleware ASGI: confere o segredo e o tamanho ANTES de ler o corpo.

    O FastAPI lê (e grava em disco) o upload inteiro antes de rodar as
    dependências da rota — sem esta guarda, qualquer um na internet podia mandar
    arquivos gigantes pro leitor e só depois levar o 401. Usa scope["path"] (o
    caminho cru do ASGI), nunca request.url, que o cabeçalho Host pode envenenar.
    """

    LIVRES = frozenset({"/health"})

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") in self.LIVRES:
            await self.app(scope, receive, send)
            return

        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        recebido = headers.get(b"x-parser-secret", b"").decode("latin-1")
        if not _segredo_confere(recebido or None):
            await _responder(send, 401, "segredo inválido")
            return

        limite = config.MAX_UPLOAD_BYTES + 1024 * 1024  # o arquivo + os campos do formulário
        declarado = headers.get(b"content-length")
        if declarado is not None:
            try:
                tamanho = int(declarado)
            except ValueError:
                await _responder(send, 400, "content-length inválido")
                return
            if tamanho < 0 or tamanho > limite:
                await _responder(send, 413, "arquivo muito grande")
                return

        lido = 0
        comecou = False

        async def receive_limitado():
            nonlocal lido
            msg = await receive()
            if msg["type"] == "http.request":
                lido += len(msg.get("body", b""))
                if lido > limite:  # corpo sem content-length (chunked) passando do limite
                    raise _CorpoGrandeDemais()
            return msg

        async def send_marcando(msg):
            nonlocal comecou
            if msg["type"] == "http.response.start":
                comecou = True
            await send(msg)

        try:
            await self.app(scope, receive_limitado, send_marcando)
        except _CorpoGrandeDemais:
            if not comecou:
                await _responder(send, 413, "arquivo muito grande")
