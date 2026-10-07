# Facility Contábil

Web app para transformar **extrato bancário** (PDF/OFX/CSV/XLS/XLSX) — ou a **planilha
de controle do próprio cliente** (Excel) — em **arquivo de
importação de lançamentos contábeis em lote** no **Leiaute Domínio Sistemas**.

Depois do login cai num **hub** com três módulos:

- **Cadastros** — clientes: código no Domínio, conta contábil do banco, códigos
  de histórico padrão e o **saldo inicial da conta bancária**.
- **Importação** — o fluxo contábil de ponta a ponta a partir do extrato bancário
  (abaixo).
- **Classificação** — categoriza os lançamentos do extrato por tipo de despesa/
  receita (água, energia, recebimento de clientes…) **antes** de virar
  contabilidade; serve pra quem quer separar "o que aconteceu no extrato" de
  "qual conta contábil isso vira".

O **cliente do escritório** também pode ter login próprio (opcional, liberado no
cadastro dele): entra só no módulo **Classificação** das empresas liberadas pra
ele — ver [Acesso do cliente](#acesso-do-cliente).

## Fluxo — Importação

1. **Escolhe o cliente** e **sobe o extrato do mês** (PDF/OFX/CSV/XLS/XLSX) — ou
   **puxa um extrato já classificado** no módulo Classificação, sem reimportar o
   arquivo. O sistema lê os lançamentos, separa entradas/saídas e mostra o
   **saldo bancário acumulado por lançamento** com um painel de conferência —
   pra bater com o saldo do extrato no fim do mês. O saldo inicial é o
   digitado na importação, ou o do cadastro do cliente.

   **Planilha de controle do próprio cliente** (Excel) tem submenu próprio —
   **Nova importação Excel** — separado do extrato de banco: a planilha aparece
   como está, você escolhe qual coluna é a **data**, o **valor** e o
   **histórico** (dá pra juntar mais de uma coluna no histórico) e vê na hora o
   que entra e o que fica de fora. **Valor negativo = saída, positivo =
   entrada.** Linhas sem data ou sem valor (cabeçalho, títulos, totais) ficam
   de fora sozinhas; linha de "saldo"/"total" nasce desmarcada; qualquer linha
   pode ser tirada. Dali segue o mesmo fluxo (Revisão → arquivo do Domínio), e
   a escolha de colunas volta pronta na próxima planilha do cliente.
2. **Revisa** — por linha: conta contábil da contrapartida, código de histórico e
   complemento (texto livre). Ações em massa por entrada/saída, e dá pra **inativar**
   lançamentos que não devem ir pro arquivo. Ao salvar, cada classificação vira
   **memória do cliente** (`descrição do extrato → conta`) e volta pré-preenchida
   no mês seguinte; descrição já usada com contas diferentes vem marcada
   "conferir". Quando o extrato veio do módulo Classificação, a categoria de
   cada lançamento aparece como contexto e pode entrar no complemento do
   arquivo junto com (ou no lugar do) texto digitado.
3. **Gera o `.txt`** no Leiaute Domínio e baixa — pronto pra importar em
   Utilitários → Importação → Lançamentos contábeis em lote (testado, importa
   sem erro).

## Fluxo — Classificação

1. Escolhe o cliente e sobe o extrato (mesmo parser da Importação) — aqui não
   pede conta do banco nem código de histórico, só o essencial pra ler.
2. Classifica cada lançamento por categoria (não por conta contábil) usando um
   catálogo próprio do cliente — cria categoria nova direto na tela ("+ nova
   classificação…"), em massa por entrada/saída. As categorias e as
   classificações de cada lançamento ficam salvas e valem pra qualquer mês.
   Uma categoria **em uso não pode ser excluída** (só desativada).
3. Quando terminar, **puxa pra Importação** — escolhe a conta do banco, os
   códigos de histórico e o lote, e o mesmo registro segue pro fluxo normal de
   Revisão/exportação (sem duplicar o extrato).

## Acesso do cliente

Opcional, por empresa. No **Cadastro** do cliente: campo **E-mail de acesso do
cliente** (no cadastro novo) e bloco **Acesso do cliente ao sistema** (na
edição) — liberar outro e-mail, reenviar o convite, mandar link de nova senha,
remover.

- O cliente recebe um **convite por e-mail** e **cria a própria senha** pelo
  link (`/definir-senha`). O escritório nunca vê a senha — o Supabase Auth
  guarda só o hash. Esqueceu? **Esqueci minha senha** na tela de entrada.
- O login é o **e-mail** do cliente. O mesmo e-mail pode ser liberado em
  **várias empresas** (mesmo login, escolhe a empresa dentro do módulo).
- Ele vê **só o módulo Classificação**: enviar extrato, classificar, criar
  categorias, histórico. **Cadastros** e **Importação** aparecem com cadeado.
- Depois que o escritório **puxa** o extrato pra Importação, ele fica **só pra
  consulta** pro cliente (e ele não pode mais excluí-lo).
- Nada da parte contábil aparece pro cliente (código no Domínio, conta do
  banco, lote, códigos de histórico).

Por dentro: o login do cliente leva `app_metadata.papel = 'cliente'` (só a
*secret key* grava isso). A API manda esse login pras rotas do portal
(`backend/src/portal/`), que conferem a empresa em `cliente_acessos` antes de
qualquer leitura/gravação; políticas RLS **restritivas** (migration `0020`)
barram qualquer acesso direto dele ao banco e ao Storage. Os logins do
escritório seguem exatamente como antes.

**Pra funcionar precisa de:**

1. **Secret key** do Supabase (*Project Settings → API Keys → Secret keys*,
   `sb_secret_...`) em `SUPABASE_SERVICE_ROLE_KEY` — no `backend/.env` e no
   Render (serviço da API → *Environment*). Sem ela, liberar acesso responde
   "Acesso de clientes indisponível".
2. **SMTP próprio** no Supabase (*Authentication → Emails → SMTP Settings*). O
   envio padrão do Supabase só entrega pra quem é da equipe do projeto, no
   máximo 2 e-mails por hora — sem SMTP o convite não chega no cliente.
3. *Authentication → URL Configuration*: **Site URL**
   `https://facility-contabil-mastro.onrender.com`; em **Redirect URLs**,
   `https://facility-contabil-mastro.onrender.com/**` e
   `http://localhost:5173/**`.
4. (Opcional) *Authentication → Emails → Templates → Invite user*: texto do
   convite em português.

## Equipe do escritório

Todos os logins do escritório trabalham no **mesmo espaço**: veem e gravam os
mesmos clientes, extratos, classificações e memórias, cada pessoa com o próprio
login e a própria senha. Em **Cadastros → Equipe**, quem administra convida
(e-mail com link pra pessoa criar a senha), reenvia o convite e tira da equipe —
o acesso acaba na hora e o login fica bloqueado; o que a pessoa cadastrou fica.

Por dentro (migration `0022`): `escritorio_membros` liga cada login ao
escritório, identificado pelo id da **conta principal** (o 1º login criado — dona
dos dados, não sai da equipe). As regras de acesso do banco usam
`public.escritorio_atual()` em vez do login; `criado_por` (clientes e extratos)
guarda quem cadastrou. Login fora da equipe não vê nada; apagar a conta principal
no painel do Supabase fica **bloqueado** enquanto houver dados (antes, apagava
tudo em cascata). As regras são testadas num Postgres de verdade
(`backend/src/db/rls.test.ts`, PGlite).

## Segurança

Auditoria de 2026-10-06. O que o sistema faz sozinho:

- **Isolamento dos dados**: RLS por escritório em todas as tabelas e no
  Storage (`0022`); login de cliente barrado do banco direto (regras
  restritivas, `0020`) e atendido só pelas rotas do portal, que conferem a
  empresa liberada. `_migrations` também fora da API (`0021`).
- **Login**: token ES256 conferido localmente pela JWKS do Supabase (emissor,
  público e validade); se a JWKS não confirmar, o Supabase decide — e IP que
  erra 30 vezes em 5 min leva 429 (IP real via `CF-Connecting-IP`). Logout por
  **1 hora sem uso** (`frontend/src/auth/inatividade.ts`). Volta pós-login só
  para caminho interno.
- **Abuso**: limite de requisições por IP, de envio de arquivo e de convites
  por login (`backend/src/middleware/limite.ts`); corpo JSON só lido depois do
  login (1 MB; 10 MB na revisão); upload até 25 MB; o leitor recusa sem o
  segredo **antes** de receber o arquivo, PDF acima de 500 páginas e planilha
  "bomba" (zip que abre gigante).
- **Cabeçalhos**: CSP na tela (só script do próprio site; só conversa com a API
  e o Supabase), anti-iframe, `no-store` nas respostas da API, sem
  `X-Powered-By`; documentação do leitor (`/docs`) fechada.
- **Log**: sem token de login, sem query string, sem senha de PDF.
- **Dependências**: revisadas contra o banco de vulnerabilidades (npm audit e
  OSV); `react-router` v6 tem um aviso moderado (redirecionamento com barra
  invertida) — mitigado no único ponto que recebe caminho de fora.

O que depende de configuração (fora do código):

1. Rodar `npm run migrate -w backend` **antes** de publicar a API (a API nova
   usa as funções das migrations).
2. Ativar **verificação em duas etapas** nas contas que administram o sistema:
   Supabase, Render, GitHub e o Google Workspace do SMTP.
3. **Backup**: o plano free do Supabase não tem backup — o projeto já foi perdido
   uma vez. Plano Pro (backup diário) ou uma rotina própria de `pg_dump`.
4. Repositório do GitHub **privado** (hoje é público: não tem dado de cliente,
   mas mapeia o sistema para quem quiser atacá-lo).

## Serviços

| Pasta       | Stack                       | Porta | Papel |
|-------------|-----------------------------|-------|-------|
| `frontend/` | React + Vite + TS + Tailwind | 5173 | SPA |
| `backend/`  | Node + Express + TS          | 8080 | API, memória de classificação, geração do arquivo Domínio |
| `parser/`   | Python + FastAPI             | 8100 | leitura dos extratos (PDF/OFX/CSV/planilhas) → JSON normalizado |
| `supabase/` | migrations SQL + RLS         | —    | Postgres, Auth, Storage (projeto cloud) |

O frontend só fala com o `backend`. O `backend` chama o `parser` (protegido por
segredo compartilhado) e o Supabase (no contexto do usuário, com RLS).

## Pré-requisitos

- **Node.js 20+** e npm
- **Python 3.12+**
- Uma conta no **[Supabase](https://app.supabase.com)** (plano free serve)
- (opcional) Docker, se quiser rodar via `docker compose`

## Setup

### 1. Supabase

Siga [`docs/supabase-setup.md`](docs/supabase-setup.md) até a parte das chaves. No
fim você terá: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` e `SUPABASE_DB_URL`. As tabelas/buckets entram no passo 4.

### 2. Variáveis de ambiente

```bash
cp .env.example .env                    # referência central
cp backend/.env.example  backend/.env   # preencha com os dados do Supabase
cp frontend/.env.example frontend/.env  # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
cp parser/.env.example   parser/.env    # PARSER_SHARED_SECRET (invente um)
```

`PARSER_SHARED_SECRET` deve ser **o mesmo** em `backend/.env` e `parser/.env`.

### 3. Instalar dependências

```bash
npm install                              # frontend + backend (workspaces)
cd parser && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && cd ..
```

### 4. Aplicar as migrations

Com `SUPABASE_DB_URL` preenchido em `backend/.env` (ver `docs/supabase-setup.md`):

```bash
npm run migrate -w backend               # idempotente; roda supabase/migrations/*.sql
```

### 5. Rodar (dev)

```bash
# 3 terminais, ou:
npm run dev            # sobe frontend + backend + parser juntos
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:8080/api/health
- Parser:   http://localhost:8100/health

Crie um usuário em **Supabase → Authentication → Users → Add user** e faça login.

### Com Docker (alternativa)

```bash
docker compose up --build   # sobe backend + parser; rode o frontend com `npm run dev -w frontend`
```

## Testes

```bash
npm test                    # backend (vitest) + parser (pytest)
npm run test -w backend
cd parser && .venv\Scripts\pytest
```

Hoje: **228 testes no backend** (incluindo as regras de acesso num Postgres de verdade), **100 no parser**.

`backend/src/dominio/exporter.test.ts` tem um **golden test** que compara o
arquivo gerado com um export real do Domínio (roda se `C:\SEFIP\lancto.txt`
existir). Os testes do parser comparam PDF/CSV vs OFX pra cada pasta em
`C:\SEFIP\EXTRATOS`. Tudo que depende de arquivo de cliente é pulado quando o
caminho não existe (não quebra em outra máquina).

## Documentação

- [`docs/supabase-setup.md`](docs/supabase-setup.md) — criar o projeto Supabase
- [`docs/leiaute-dominio.md`](docs/leiaute-dominio.md) — o formato do arquivo gerado
- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral
- [`docs/roadmap.md`](docs/roadmap.md) — milestones (M1-M8) e o histórico do módulo Contábil (C1-C11, retirado em 2026-10-06)

## Estado atual

**Milestones 1–9 entregues** (ver [`docs/roadmap.md`](docs/roadmap.md)) — o
**8 (deploy)** em 2026-10-06:

- **1** — scaffold, Supabase Auth (ES256/JWKS), schema + RLS por `owner_id`, health checks.
- **2** — CRUD de clientes isolado por usuário, validação de CNPJ/CPF.
- **3** — upload + parser (OFX/CSV/XLS/XLSX/PDF) + tela de importação. Leitura
  verificada contra extratos reais de **Nubank, BB, Itaú, Inter, Bradesco,
  Santander, C6, Sicoob, PagBank e Mercado Pago** (PDF/CSV batendo com o OFX, ou
  com o resumo impresso no próprio extrato quando o banco só dá PDF).
- **4** — tela de Revisão: edição inline, ações em massa, **inativar** lançamentos,
  modo do complemento, conferência do **saldo bancário** encadeado entre extratos.
- **5** — **memória de classificação automática**: ao salvar a revisão, cada
  `descrição do extrato → conta/histórico/complemento` fica memorizada por
  cliente e volta pré-preenchida no mês seguinte; descrição já usada com contas
  diferentes vem marcada "conferir". Menu **Memória** pra ver/editar/apagar.
- **6** — **exportador do arquivo Domínio** (Leiaute Domínio Sistemas) + download.
  **Testado ponta a ponta: importa no Domínio Contábil sem erro.** Formato
  decodificado de um export real do Domínio; golden test byte-a-byte.
- **7** — **reimportar** um extrato (troca o arquivo sem recadastrar), histórico
  com filtro por cliente/status e exclusão em massa, polimento de UX
  (responsivo, aviso antes de sair da revisão sem salvar).
- **9** — rebrand pra **Facility Contábil** + tela de **hub** com os módulos.
  Módulo **Classificação** novo: importa o extrato e categoriza cada
  lançamento por tipo de despesa/receita (catálogo por cliente, criado na
  hora), independente da conta contábil; extrato classificado é **puxado** pra
  Importação (mesmo registro, sem duplicar) pra virar contabilidade e gerar o
  arquivo do Domínio. Complemento do arquivo ganha os modos "extrato +
  classificação" e "extrato + complemento + classificação". Classificação em
  uso não pode ser excluída (só desativada).
- **Nova importação Excel** (2026-09-25) — planilha de controle do cliente com
  as colunas escolhidas na mão (Data/Valor/Histórico; negativo = saída,
  positivo = entrada), prévia linha a linha do que entra, escolha gravada por
  cliente (migration 0018). Segue o fluxo normal da Importação.

**Módulo Contábil (C1–C11)** — **retirado do sistema em 2026-10-06** (tela,
API, leitores de plano de contas/balancete e relatórios em PDF); a migration
`0019` apaga as tabelas dele, só se estiverem vazias. O histórico do que ele
fazia fica em [`docs/roadmap.md`](docs/roadmap.md).

**Milestone 8 (deploy)** — no ar pelo Render desde 2026-10-06; ver
[Publicar (Render)](#publicar-render).

**Acesso do cliente** (2026-10-06) — login do cliente por e-mail, com convite
e senha criada por ele, só no módulo Classificação, uma ou várias empresas por
login (migration `0020`); ver [Acesso do cliente](#acesso-do-cliente).

## Uso no dia a dia

`iniciar.bat` sobe os 3 serviços com um clique e abre o navegador sozinho.

## Publicar (Render)

`render.yaml` (Blueprint do Render) descreve os 3 serviços no ar — o banco
continua sendo o Supabase:

| Serviço | Tipo | Endereço |
|---|---|---|
| tela | site estático (`frontend/dist`) | https://facility-contabil-mastro.onrender.com |
| API | web, Node | https://facility-contabil-mastro-api.onrender.com |
| leitor de extratos | web, Python | https://facility-contabil-mastro-parser.onrender.com |

1. Render → **New → Blueprint** → este repositório (branch `main`).
2. O Render pede só os valores do Supabase: `SUPABASE_URL` / `SUPABASE_ANON_KEY`
   / `SUPABASE_SERVICE_ROLE_KEY` (API) e `VITE_SUPABASE_URL` /
   `VITE_SUPABASE_ANON_KEY` (tela) — a URL do projeto, a *publishable key* e a
   *secret key*. O segredo API↔leitor é gerado pelo Render. Em serviço que já
   existe, o Render **não** pede variável nova do `render.yaml` com
   `sync: false` — cadastrar na mão em *Environment*.
3. No Supabase: Authentication → desligar o cadastro público (*Allow new users
   to sign up*) — com o sistema na internet, só entra quem for criado no painel
   (ou convidado pelo escritório — ver [Acesso do cliente](#acesso-do-cliente)).

Todo `git push` no `main` publica de novo. Plano **free**: cada serviço dorme
após 15 min sem uso (~1 min pra acordar; a 1ª importação depois disso pode
precisar de nova tentativa). Pra uso diário, troque `plan: free` por
`plan: starter` na API e no leitor. Se o Render der outro endereço a algum
serviço, ajuste `PARSER_URL`, `FRONTEND_ORIGIN` e `VITE_API_URL` no
`render.yaml`.

## Rodar em outra máquina

Leva o sistema (com os `.env` já preenchidos) pra outro computador sem repetir
o setup do Supabase do zero — só funciona pro **mesmo projeto Supabase**
(as chaves nos `.env` viajam junto com o `.zip`).

**Na máquina atual:**

1. `powershell -ExecutionPolicy Bypass -File empacotar.ps1` — gera
   `extrato-dominio.zip` na Área de trabalho, com o código e os `.env` (sem
   `node_modules`/`.venv`/`.git`/`dist`).

**Na máquina nova** (precisa ter **Node.js 20+** e **Python 3.12+** instalados):

2. Descompacta o `.zip` em qualquer pasta.
3. Roda `configurar.bat` (clique duplo) — instala as dependências do npm e
   cria o ambiente Python do parser. Só precisa rodar **uma vez**.
4. Roda `iniciar.bat` sempre que for usar — sobe os 3 serviços e abre
   `http://localhost:5173` sozinho.

Se faltar algum `.env` (não veio no `.zip`, ou é uma instalação nova sem
Supabase configurado ainda), `configurar.bat` avisa quais faltam — copie de
`.env.example` e siga o [Setup](#setup) acima.
