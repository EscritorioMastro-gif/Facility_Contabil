# Facility Contábil

Web app para transformar **extrato bancário** (PDF/OFX/CSV/XLS/XLSX) — ou a **planilha
de controle do próprio cliente** (Excel) — em **arquivo de
importação de lançamentos contábeis em lote** no **Leiaute Domínio Sistemas**.

Depois do login cai num **hub** com três módulos:

- **Cadastros** — clientes: código no Domínio, conta contábil do banco, códigos
  de histórico padrão e o **saldo inicial da conta bancária** — digitado uma vez
  e depois atualizado sozinho a cada arquivo do Domínio gerado (ver
  [Saldo do cliente](#saldo-do-cliente)).
- **Importação** — o fluxo contábil de ponta a ponta a partir do extrato bancário
  (abaixo).
- **Classificação** — categoriza os lançamentos do extrato por tipo de despesa/
  receita (água, energia, recebimento de clientes…) **antes** de virar
  contabilidade, a partir da **lista geral** de classificações do escritório e
  com **memória** do que já foi classificado; serve pra quem quer separar "o que
  aconteceu no extrato" de "qual conta contábil isso vira".

O **cliente do escritório** também pode ter login próprio (opcional, liberado no
cadastro dele): entra só no módulo **Classificação** das empresas liberadas pra
ele — ver [Acesso do cliente](#acesso-do-cliente).

## Interface e atalhos

Visual repaginado em 2026-11 com a mesma paleta (branco + verde-petróleo):
fontes **Plus Jakarta Sans** (texto), **Sora** (títulos e números) e
**JetBrains Mono** (contas, lotes e códigos). As peças reaproveitadas ficam em
`frontend/src/components/ui.tsx` (cabeçalho de página, filtros, etapas,
progresso, barra de ações) e os estilos base em `frontend/src/index.css`.

- **Ctrl+K** (ou **/**) em qualquer tela abre a busca: digite o nome da tela
  (histórico, memória, clientes…) e Enter.
- **Ctrl+S** salva na Revisão e na Classificação (o cliente salva pelo
  "Salvar e aprovar").
- Na Classificação, **Enter** desce pro lançamento de baixo e
  **Shift+Enter** sobe.
- Importação, Revisão e Classificação mostram a **etapa** do fluxo no topo; a
  Revisão e a Classificação têm a **barra de ações presa no rodapé** (salvar,
  gerar arquivo, aprovar) e o progresso do que já está pronto.

## Fluxo — Importação

1. **Escolhe o cliente** e **sobe o extrato do mês** (PDF/OFX/CSV/XLS/XLSX) — ou
   **puxa um extrato já classificado** no módulo Classificação, sem reimportar o
   arquivo. O sistema lê os lançamentos, separa entradas/saídas e mostra o
   **saldo bancário acumulado por lançamento** com um painel de conferência —
   pra bater com o saldo do extrato no fim do mês. O saldo inicial é o
   digitado na importação, ou o do cadastro do cliente — que é o saldo final do
   último arquivo do Domínio gerado (ver [Saldo do cliente](#saldo-do-cliente)).

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
   sem erro). Gerar o arquivo também leva o **saldo final do extrato pro
   cadastro do cliente** (abaixo).

### Saldo do cliente

Migration `0029`. O saldo do cadastro é o ponto de partida do próximo extrato:

- **Digitado no cadastro** — fica fixo até o próximo arquivo do Domínio gerado.
- **Gerou o arquivo do Domínio** de um extrato (importação manual, planilha
  Excel ou extrato puxado da Classificação) — o **saldo final** dele vira o
  saldo do cadastro. Saldo final = saldo inicial + entradas − saídas de todos
  os lançamentos, inativados inclusos (o banco mexeu de qualquer jeito). Salvar
  a revisão sem gerar o arquivo não mexe no cadastro.
- **Não volta pra trás**: gerar de novo o arquivo de um mês **anterior** ao que
  já definiu o saldo (agosto depois de setembro) mantém o saldo de setembro.
  Gerar de novo o **mesmo** mês (depois de corrigir algo) atualiza.
- A importação nova e o "puxar da Classificação" vêm com o saldo do cadastro
  preenchido (editável). O extrato puxado pega o saldo **de agora**, não o de
  quando foi enviado pra Classificação.
- O cadastro e a importação mostram de onde veio o saldo ("saldo final do
  extrato até 30/09/2026, arquivo do Domínio gerado em …"); depois de gerar, a
  Revisão avisa se o saldo do cliente mudou ou ficou.

Por dentro: `avancar_saldo_cliente()` (chamada pelo `POST
/api/statements/:id/export`) e o trigger `clients_saldo_digitado` (saldo mexido
no cadastro desliga o vínculo com o extrato).

## Fluxo — Classificação

1. Escolhe o cliente e sobe o extrato (mesmo parser da Importação) — aqui não
   pede conta do banco nem código de histórico, só o essencial pra ler. Antes
   de gravar, o extrato passa pelas [travas de entrada](#travas-na-entrada-do-extrato):
   o **mesmo extrato não entra duas vezes** (em nenhuma empresa), extrato de
   **outra empresa** é recusado e extrato que **repete o período** de outro é
   barrado. O período no topo é o **do extrato** (o impresso pelo banco ou o do
   nome do arquivo; senão o mês inteiro dos lançamentos).
2. Classifica cada lançamento por categoria (não por conta contábil) usando a
   **lista própria** do cliente, escolhida da **Lista geral** do escritório
   (Classificação → Lista geral; só quem administra a equipe inclui/exclui).
   Em **Ações em massa**: "Adicionar classificações de entradas/saídas" (da
   lista geral), "Preencher pela memória" e classificar em massa. A lista
   própria é a **mesma em todas as empresas do mesmo login de cliente**.
   Classificação avulsa (fora da lista geral) só o escritório cria.
   **Memória**: descrição já classificada antes na empresa vem classificada no
   extrato novo ("memória"); se já teve classificações diferentes, vem a mais
   usada marcada como **sugestão** pra conferir. Descrição que a empresa nunca
   classificou, mas outra empresa do **mesmo cliente** (mesmo login) já, vem
   como sugestão com a classificação de mesmo nome. Classificar uma linha
   classifica junto as outras do mesmo extrato com a mesma descrição e o mesmo
   tipo (as vazias e as sugestões; dá pra desfazer). No campo da classificação,
   **Enter** desce pro lançamento de baixo (Shift+Enter sobe). Tirar uma
   categoria da lista exclui onde não está em uso e só desativa onde está.
3. O cliente confere e **aprova** pelo portal — pode ser em partes, ao longo do
   mês (ver [Aprovação do cliente](#aprovação-do-cliente) abaixo); o escritório
   vê no Histórico quais meses já foram aprovados, inteiros ou em parte.
4. Quando terminar, **puxa pra Importação** — escolhe a conta do banco, os
   códigos de histórico e o lote, e o mesmo registro segue pro fluxo normal de
   Revisão/exportação (sem duplicar o extrato).

**Dashboard** (Classificação → Dashboard): receitas por classificação de entrada
e despesas por classificação de saída, cada uma com **valor e % do total**, receitas
x despesas por mês, resultado e quantos lançamentos faltam classificar. Três blocos,
todos no período escolhido: **roscas** (as 6 maiores com cor própria, o resto em
"Demais", todas na legenda com o nome completo; o centro mostra o total),
**mapa de árvore** (todas as classificações, área proporcional ao valor) e a
**tabela** + o gráfico por mês. Filtros: a empresa (o cliente vê "todas as minhas
empresas" ou uma; o escritório escolhe a empresa e pode somar todas as do mesmo
cliente) e o período De/Até (mês a mês; pra ver um mês só, De e Até iguais). Só lançamentos
classificados e não inativados entram nos totais; a tabela copia pro Excel. A conta
é feita no banco (`dashboard_classificacao`, migration `0025`); os gráficos são
desenhados na própria tela, sem biblioteca.

As tabelas de lançamentos (Revisão, Classificação, planilha Excel, Histórico)
mostram 10, 50 ou 100 itens por página (a escolha fica guardada) e rolam por
dentro — a barra pra passar pro lado fica sempre à vista.

### Aprovação do cliente

Migrations `0026` e `0028`. O login de cliente tem um botão só, **Salvar e
aprovar**: salva o que ele classificou e, na janela, ele declara que conferiu as
classificações **já feitas** (**Conferi, salvar e aprovar**). Dá pra aprovar **em
partes**: com lançamento pendente, aprova o que está classificado e os pendentes
ficam pra próxima parte. Sem nada novo desde a última aprovação, o botão fica
parado ("Parte aprovada ✓" / "Aprovado ✓").

Cada aprovação fica registrada em `classificacao_aprovacoes` (só recebe
inclusões): login, e-mail, data e hora, **IP** (CF-Connecting-IP), quantos
lançamentos aprovou, **quantos novos** naquela parte, **quantos ainda faltavam**,
entradas/saídas, o resumo por classificação e uma assinatura (sha256). Cada
lançamento guarda a classificação que o cliente aprovou
(`transactions.aprovado_classificacao_id`): a tela mostra **✓ aprovado** em cada
um e **mudou após aprovação** quando foi trocado depois.

Situação do extrato (Histórico e topo da tela de classificação): **aprovado**,
**parcial N/T** (aprovou N de T; faltavam lançamentos), **alterado após
aprovação** (alguém mudou um lançamento que o cliente **já tinha aprovado** —
classificar um pendente não conta) ou aguardando. Na tela do extrato, **Aprovações
do cliente** lista cada parte; o escritório vê o IP, o cliente não. Só o portal
aprova (o login do escritório não consegue marcar aprovação, nem direto no banco).

### Travas na entrada do extrato

Migration `0027`, regras em `backend/src/statements/travas.ts`. Valem em toda
entrada de extrato — Importação, Importação Excel, Classificação (escritório e
portal do cliente) e Reimportar. Nasceu de um caso real: o login de um cliente
com várias empresas subia o extrato da JUNIOR CONFECÇÃO na VALTER CONFECÇÃO
sem aviso nenhum.

1. **Mesmo extrato, nunca duas vezes** — mesmos lançamentos (data, valor e tipo,
   em qualquer formato) já importados em **qualquer empresa do escritório** =
   recusado, dizendo onde está (`statements.impressao`, `0023`). Nem o
   escritório libera.
2. **Empresa certa** — o leitor tira do extrato o **CNPJ/CPF do titular** e o
   **nº da conta** do cabeçalho (`parser/app/parsers/titular.py`, regra herdada
   da rotina Extrator de Extrato Bancário: só número com o rótulo CNPJ/CPF,
   nunca o da contraparte de um Pix, do banco ou de um fundo). Medido em
   2026-11-18 em 480 PDFs reais: 423 com o titular certo, 35 sem documento (29
   com a conta) e 19 que eram **extratos de outra empresa arquivados na pasta
   errada** — o leitor acertou.
   - CNPJ da empresa escolhida (ou mesma raiz — filial —, ou o CPF do MEI que
     está na razão social) → entra.
   - CNPJ de **outra empresa cadastrada** → recusa: *"Este extrato é da JUNIOR
     CONFECÇÃO… e você está enviando na VALTER CONFECÇÃO"*. Se o login também
     tem a outra empresa, aparece **Enviar na JUNIOR CONFECÇÃO**. Pro cliente,
     empresa que ele não vê nunca tem o nome revelado.
   - CNPJ/CPF de **ninguém cadastrado** (ex.: conta no CPF do sócio) → o cliente
     não envia (fala com o escritório); o escritório **libera** e o documento
     fica ligado àquela empresa dali em diante.
   - Sem CNPJ, pela **conta**: conta que já entrou nesta empresa → entra; que é
     de outra → recusa; nunca vista → o usuário **confirma uma vez** que é desta
     empresa e as próximas entram direto.
   - Sem CNPJ e sem conta (OFX/CSV sem cabeçalho, planilha do cliente) → o
     usuário marca **"Confirmo que este extrato é da …"**.
   A ligação documento/conta → empresa sai dos próprios extratos gravados
   (`statements.titular_doc` / `conta_chave`): excluir o extrato desfaz junto.
3. **Extrato sobreposto** — 80% ou mais dos lançamentos já estão em outro
   extrato da mesma empresa (quinzena e depois o mês inteiro, mês e depois o
   trimestre) → recusa mostrando em qual (`sobreposicao_extrato`, `0027`).
   Abaixo disso entra (duas contas da mesma empresa podem ter um ou outro
   lançamento igual).

Quem resolve: a **confirmação da empresa** o próprio usuário faz; **liberar**
(outra empresa, documento desconhecido, sobreposto) só o escritório, com um
clique, e fica registrado em `statements.conferencia` quem e quando — junto com
como o extrato foi identificado (titular, conta, confirmado ou liberado).

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
- Ele vê **só o módulo Classificação**: enviar extrato, classificar e aprovar
  o mês, montar a lista própria a partir da lista geral do escritório,
  histórico e Dashboard. **Cadastros** e **Importação** aparecem com cadeado.
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
  segredo **antes** de receber o arquivo, PDF acima de 1.200 páginas e planilha
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

Hoje: **287 testes no backend** (+2 que pulam sem os arquivos locais), incluindo as
regras de acesso e as migrations num Postgres de verdade (PGlite: `src/db/*.test.ts`),
e **134 no parser**.

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
API, leitores de plano de contas/balancete e relatórios em PDF). As tabelas
dele já saíram do banco e as migrations dele (0009–0016, 0019) saíram do
repositório em 2026-11-11; a `0024` apaga o que sobrar delas em qualquer banco,
junto com `chart_accounts` (nunca usada), só se estiverem vazias. O histórico do que ele
fazia fica em [`docs/roadmap.md`](docs/roadmap.md).

**Milestone 8 (deploy)** — no ar pelo Render desde 2026-10-06; ver
[Publicar (Render)](#publicar-render).

**Acesso do cliente** (2026-10-06) — login do cliente por e-mail, com convite
e senha criada por ele, só no módulo Classificação, uma ou várias empresas por
login (migration `0020`); ver [Acesso do cliente](#acesso-do-cliente).

**Classificação — lista geral, memória e trava de duplicado** (2026-11-11, no ar
no mesmo dia; migrations `0023` e `0024`):

- **Lista geral** de classificações do escritório (só administrador da Equipe
  inclui/exclui); o cliente monta a lista própria a partir dela, e a lista vale
  pra todas as empresas do mesmo login. Avulsa, só o escritório cria.
- **Memória**: descrição já classificada antes na empresa vem classificada no
  extrato novo; se já teve classificações diferentes, vem como sugestão pra
  conferir. "Preencher pela memória" pros extratos importados antes. Desde
  2026-11-12 a memória das outras empresas do mesmo cliente também vira
  sugestão.
- **Trava de extrato duplicado** (mesmos lançamentos da mesma empresa, em
  qualquer formato ou módulo) e **período do extrato** no topo (o impresso pelo
  banco, senão o mês inteiro).
- **Extrato de até 8.000 lançamentos** (PDF até 1.200 páginas; API espera o
  leitor até 10 min; gravação em lotes) — testado com arquivos de 8.000
  lançamentos em OFX/CSV/XLSX/PDF e com toda a bateria de `C:\SEFIP\EXTRATOS`.
  Corrigido o PDF do Mercado Pago com título em "negrito falso" (a 1ª página
  sumia).
- Telas: 10/50/100 itens por página (guardado), tabelas com rolagem própria e
  cabeçalho fixo, Enter/Shift+Enter na Classificação, histórico sem teto.
- Limpeza: saíram as migrations do Contábil e a tabela `chart_accounts`.

**Descrições completas, Dashboard e aprovação do cliente** (2026-11-12 e 13, no
ar em 2026-11-13; migrations `0025` e `0026`):

- **Descrição completa do lançamento** em todos os extratos de
  `C:\SEFIP\EXTRATOS` (totais sem mudança): Nubank em PDF junta os pedaços da
  descrição mesmo com linha em branco ou quebra de página no meio; PDFs em
  colunas (Bradesco, Sicoob, BB, C6 e o leitor genérico) leem a descrição pela
  posição das palavras (`parser/app/parsers/celulas.py`), com o complemento da
  linha de baixo e da página seguinte; BB Consultas sem o nº do documento; C6
  sem o "Entrada/Saída PIX" repetido; planilhas juntam complemento, favorecido,
  CPF/CNPJ e o tipo. O PDF é lido uma vez só (texto e palavras juntos).
- **Dashboard** da Classificação (ver [Fluxo — Classificação](#fluxo--classificação)):
  roscas, mapa de árvore, tabela com valor e % e receitas x despesas por mês,
  tudo no período De/Até.
- **Aprovação do cliente** (ver [Aprovação do cliente](#aprovação-do-cliente)):
  o cliente declara que conferiu e aprova o mês; fica registrado quem, quando e
  o que foi aprovado, e mudança depois da aprovação aparece no Histórico.

**Aprovação em partes** (2026-11-18; migration `0028` já aplicada no Supabase
em 18/11 — **API e tela ainda não publicadas**): botão **Salvar e aprovar** aprova o que já está classificado
mesmo com pendentes; cada parte fica no histórico com o IP; Histórico mostra
"parcial N/T"; "alterado" só quando muda um lançamento já aprovado. Ver
[Aprovação do cliente](#aprovação-do-cliente).

**Travas na entrada do extrato** (2026-11-18; migration `0027` já aplicada no
Supabase em 18/11 — **API, tela e leitor ainda não publicados**): extrato de outra empresa recusado pelo CNPJ do titular ou pela
conta, mesmo extrato barrado em todas as empresas do escritório, extrato
sobreposto barrado, confirmação da empresa quando o extrato não diz de quem é e
liberação registrada pelo escritório. Ver
[Travas na entrada do extrato](#travas-na-entrada-do-extrato).

**Repaginação visual** (2026-11-23; só frontend, sem migration — **ainda não
publicada**): mesma paleta, fontes novas, barra lateral e barra superior novas
(caminho da tela, busca **Ctrl+K** e status dos serviços), formulários em
seções com ajuda ao lado, etapas do fluxo no topo, progresso e **barra de ações
fixa** com **Ctrl+S** na Revisão e na Classificação, avisos de confirmação no
canto da tela, busca na Memória e filtro Todos/Ativos/Inativos nos Clientes. No
menu da Classificação, "Nova importação" passou a se chamar **Classificar
extrato** (o mesmo título da tela). Ver [Interface e atalhos](#interface-e-atalhos).

## Uso no dia a dia

`iniciar.bat` sobe os 3 serviços com um clique e abre o navegador sozinho.

## Publicar (Render)

`render.yaml` (Blueprint do Render) descreve os 3 serviços no ar — o banco
continua sendo o Supabase:

| Serviço | Nome no Render | Tipo | Endereço |
|---|---|---|---|
| tela | `facility-contabil` | site estático (`frontend/dist`) | https://facility-contabil-mastro.onrender.com |
| API | `facility-contabil-api` | web, Node | https://facility-contabil-mastro-api.onrender.com |
| leitor de extratos | `facility-contabil-parser` | web, Python | https://facility-contabil-mastro-parser.onrender.com |

**Nome × endereço:** os serviços foram renomeados no painel em 2026-11-23 (sem
"mastro"), mas o endereço `*.onrender.com` nasce do nome na criação e **não
muda** — por isso os endereços continuam com "mastro". O Blueprint liga cada
serviço do painel ao do `render.yaml` **pelo nome**: renomear no painel sem
mudar o `render.yaml` (ou o contrário) faz a sincronização **criar um serviço
novo** em vez de atualizar o que está no ar. E serviço criado pelo Blueprint que
for apagado à mão volta na próxima sincronização — pra tirar de vez, tire do
`render.yaml` primeiro.

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

**Publicar uma versão nova:**

1. Mudou o banco? Rodar `npm run migrate -w backend` **antes** (na pasta do
   projeto): a API nova costuma depender das tabelas/funções novas.
2. `git push` no `main` — o Render publica sozinho (`autoDeployTrigger:
   commit`; em 2026-11-23 a tela e a API subiram ~2 min depois do push).
3. Mudou o `render.yaml` (variáveis, cabeçalhos, plano)? O Blueprint precisa
   sincronizar (automático se o *Auto Sync* dele estiver ligado; senão,
   **Manual Sync** na página do Blueprint) — as `VITE_*` entram na tela na
   hora do build.
4. Conferir no painel se cada serviço que mudou ficou *Deployed*; se algum não
   atualizou, **Manual Deploy** → *Deploy latest commit*.

Plano: API e leitor no **starter** pelo `render.yaml` (não dormem; extrato
grande em PDF lê bem mais rápido que na CPU fracionada do free). No **free**
cada serviço dorme após 15 min sem uso — a tela acorda o leitor sozinha ao
entrar e ao escolher um arquivo (`frontend/src/lib/acordarLeitor.ts`) e a API
espera ele subir até 1 min antes de dar erro (chamada de dentro do Render não
acorda serviço dormindo). Se o Render der outro endereço a
algum serviço, ajuste `PARSER_URL`, `FRONTEND_ORIGIN`, `VITE_API_URL` e
`VITE_PARSER_URL` no `render.yaml`.

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
