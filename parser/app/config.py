import os

from dotenv import load_dotenv

load_dotenv()

PARSER_PORT = int(os.getenv("PARSER_PORT", "8100"))
PARSER_SHARED_SECRET = os.getenv("PARSER_SHARED_SECRET", "").strip()

# Limite de tamanho do upload aceito (bytes). Extratos são pequenos.
MAX_UPLOAD_BYTES = int(os.getenv("PARSER_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))

# No Render (que sempre define RENDER=true) o leitor NUNCA sobe aberto: sem o
# segredo, qualquer um na internet mandaria arquivos pra ele ler.
EM_PRODUCAO = os.getenv("RENDER", "").strip().lower() == "true" or os.getenv("PARSER_ENV", "").strip().lower() == "production"
if EM_PRODUCAO and not PARSER_SHARED_SECRET:
    raise RuntimeError("PARSER_SHARED_SECRET é obrigatório em produção — o leitor não sobe sem ele.")

# /docs e /openapi.json mapeiam a API interna: só ligados de propósito, no dev.
PARSER_DOCS = os.getenv("PARSER_DOCS", "").strip() == "1"
