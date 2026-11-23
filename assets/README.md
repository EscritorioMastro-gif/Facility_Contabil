# assets

Cópias standalone dos SVGs usados na interface, na paleta Facility Contábil.

| Arquivo | Onde é usado no app |
|---|---|
| `ilustracao-hub.svg` | hero da tela inicial e do login (`frontend/src/components/FinanceIllustration.tsx`) |
| `icones/cadastros.svg` | módulo Cadastros na barra lateral |
| `icones/importacao.svg` | módulo Importação na barra lateral |
| `icones/classificacao.svg` | módulo Classificação na barra lateral |
| `icones/sair.svg` | botão "Sair" |
| `icones/inicio.svg` | item "Início" da barra lateral e da busca (Ctrl+K) |

**Fonte de verdade é o código** (`frontend/src/components/`). Estes arquivos são
exportações para reuso fora do app (documentos, apresentações, etc.) — se mexer
no componente, reexporte aqui.

Paleta (branco + verde-petróleo, a mesma do InteliSac — fonte de verdade em
`frontend/tailwind.config.js`): fundo `#EEF4F3`, texto `#17282B`, principal
`#0F5E66`, barra lateral `#0C464C`, links `#13707A`, destaque `#7FD1D6`,
bordas `#D9E3E4`.
Ícones: linha de 1,75, traço `#1E293B` (troque por `currentColor` se quiser
recolorir via CSS).
