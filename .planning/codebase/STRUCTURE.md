# Structure

## Directory Tree

Top 3 níveis (gerado por glob; `node_modules/`, `build/`, `dist/`, `release/`, `electron/dist/` não expandidos):

```
./                                     ← repo aurum-tax-ncm (raiz git, Electron + React + Vite + TS)
├── .planning/                            ← GSD (PROJECT.md, ROADMAP.md, STATE.md, codebase/)
├── index.html                            ← shell (#raiz, tema anti-flash, /src/main.tsx)
├── package.json · vite.config.ts · vitest.config.ts · tsconfig.json
├── src/ (96 arquivos)
│   ├── main.tsx · App.tsx · index.css · pdfmake.d.ts
│   ├── pages/        ← Calculadora, Consulta, Lote, NfeXml, Produtos, Auxiliares, Legislacao
│   ├── ui/           ← Layout, kit, cartoes, detalhes, dialogos, divergencia, opcoes, motion,
│   │                     skeleton, Marca, ModalLegislacao, TermoAceite
│   ├── modais/       ← pagina, globais, reclassificacao
│   ├── store/        ← base, sessao, ui, consulta, calculadora, lote, nfe, produtos, auxiliares, dialogo
│   ├── domain/       ← entities, contrato, legislacao, capitulos.json,
│   │                     services/ (classificacao, calculo, busca-texto, classificador-descricao,
│   │                     detector-consulta, referencia-service, revogacao, format),
│   │                     constants/ (index, tributarios, capitulos, seeds, aliases, cff-apis, siscomex-apis)
│   ├── application/  ← base, atualizacao, auditoria, backup, reclassificacao, revalidacao,
│   │                     produtos, empresas, emitente, notas-xml, nfe-insights, ncm-sync, cff-sync,
│   │                     classificacao-inteligente, auxiliares, aux-meta
│   └── infrastructure/← db/schema, base/ (base-service, classificacao-repo, reclassificacao-repo, normalizacao),
│                         nfe/ (parse, analisar, apuracao, regime, credito, tipos),
│                         sped/ (leitura, parse, analisar, tipos), siscomex/ncm-sync, cff/cff-sync,
│                         receita/brasilapi, parsers/lote, arquivos/xml-storage,
│                         exporters/relatorios, pdf/ (setup, menu-exportacao),
│                         bridge, legislacao-texto
├── electron/
│   ├── main.ts · preload.ts · esbuild.mjs
│   └── dist/ (gerado: main.js, preload.cjs + maps)
├── public/
│   ├── icone.png · icon.ico · escudo.png · logomarca*.png · manifest.webmanifest
│   └── base/             ← bases NORMALIZADAS embutidas (saída do build-base)
│       ├── reforma.json · classificacao-tributaria.json · nomenclatura.json · MANIFEST.json
├── scripts/        ← build-base.mjs, gen-seeds.cjs, gen-capitulos.cjs, gen-contrato.py,
│                       gen-licenca-rtf.py, kill-port.mjs, reparar-encoding.mjs, refazer-icone.py
├── tests/ (~38 arquivos) ← calculo, classificacao-inteligente, busca-texto, nfe-*, sped-*, lote, csv,
│                       consulta-*, cff-*, brasilapi, siscomex-ncm, vigencia-ncm, reclassificacao-*,
│                       revalidacao, revogacao, diferimento, mapeamento-legal, motor-unico,
│                       legislacao-*, formato, aux-*, produtos, empresas-idempotentes, db-migracao,
│                       base-embutida, pdf-exportacao + setup.ts
├── docs/           ← SPEC-LOGICA-NEGOCIO.md + 2 contratos .docx
├── build/ · dist/ · release/  ← saída de empacotamento (ver § Generated)
└── node_modules/ (não inspecionado)
```

## Key Files

| Path | Responsabilidade |
|---|---|
| `index.html` | Shell web: `#raiz`, metadados pt-BR, anti-flash de tema, `src/main.tsx`. |
| `src/main.tsx` | Bootstrap React; dispara `useBase.iniciar()` + `useSessao.iniciar()` não-bloqueante. |
| `src/App.tsx` | Shell de views por `store/ui` (7 páginas) + portão de aceite (`domain/contrato`). |
| `electron/main.ts` | Janela, IPC, menu nativo, auto-update, sandboxes `diretorioBase`/`diretorioXml`. |
| `electron/preload.ts` | `window.aurum` via `contextBridge` (implementa `AurumBridge`). |
| `electron/esbuild.mjs` | Compila main+preload (o `tsc` raiz não inclui `electron/`). |
| `src/infrastructure/bridge.ts` | Contrato `AurumBridge` + fallback `fetch` fora do Electron. |
| `src/infrastructure/db/schema.ts` | `AurumDatabase` Dexie v8 + migrações + `bulkPut`/`contarTodos`. |
| `src/domain/services/classificacao.ts` | Motor: join 3NF, manual, regra geral, vigência/extinção. |
| `src/domain/services/calculo.ts` | `calcularTributos` (redução sobre alíquota), anexos, observações/diferimento. |
| `src/application/base.ts` + `src/store/base.ts` | Seed/import/status da base + estado de progresso. |
| `src/application/atualizacao.ts` | Update do programa (renovação das bases) via `electron-updater`. |
| `src/infrastructure/exporters/relatorios.ts` | Geração Excel/CSV/PDF de relatórios. |
| `src/infrastructure/nfe/parse.ts` + `sped/parse.ts` + `parsers/lote.ts` | Ingestão: NF-e XML, SPED, lote CSV/XLSX. |
| `scripts/build-base.mjs` | Normaliza JSONs brutos → `public/base` (3NF) + `MANIFEST.json`. |
| `src/domain/constants/index.ts` | `DB_NAME/VERSION`, `STORES`, `REGRA_GERAL`, `REF_DEFAULT`, links oficiais. |
| `package.json` | Scripts (`base`, `dev`, `build`, `dist`), deps, config `electron-builder`. |
| `vite.config.ts` / `vitest.config.ts` | Alias `@→src`, base `./`, server `:5173`; ambiente de testes. |
| `docs/SPEC-LOGICA-NEGOCIO.md` | Spec da lógica de negócio (referência do domínio). |

## Entry Points

| Entrada | Cadeia |
|---|---|
| Produção desktop | `package.json:main` (`electron/dist/main.js`) → `electron/main.ts:criarJanela` → `dist/index.html` → `src/main.tsx` → `App`. |
| Dev desktop | `npm run dev`: `predev` (kill-port + `base` + `build:electron`) → `dev:renderer` (Vite `:5173`) + `dev:electron` (`VITE_DEV_SERVER_URL` → `loadURL`). |
| Web/navegador | `npm run dev:web` (Vite) — `bridge=null`, bases via `fetch('base/...')`. |
| Renderer | `index.html` → `/src/main.tsx` (`#raiz`) → `App` → `Layout` + página ativa (`store/ui.view`). |
| Main→renderer | Preload `window.aurum`; canais `menu:acao` / `atualizacao:evento`; versão via `--aurum-versao`. |
| Dados iniciais | `main.tsx` → `store/base.iniciar()` → `application/base.inicializarBase()` → Dexie seed a partir de `public/base` (dev) / `dist/base` (prod). |
| Testes | `npm test` → Vitest (`vitest.config.ts`, `tests/setup.ts` com fake-indexeddb). |

## Data & Assets

| Arquivo | Onde | Tamanho aprox. | Papel |
|---|---|---|---|
| `public/base/nomenclatura.json` | `public/base/` | ~2,9 MB | Nomenclatura NCM vigente normalizada (15.156 itens; autocompletar + vigência/extinção). |
| `public/base/reforma.json` | idem | ~1,6 MB | CST + cClassTrib + vínculos NCM (2.335) / NBS. |
| `public/base/classificacao-tributaria.json` | idem | ~307 KB | Referência CST×cClassTrib (164 registros, docs fiscais). |
| `public/base/MANIFEST.json` | idem | ~2 KB | schema, `geradoEm`, contagens, checksums, `codigosIgnorados` (10). |
| `reforma_tributaria_por_ncm.json` | raiz `REFORMA NCM/` | ~16 MB | Fonte bruta (repete referência por NCM — motivo da normalização 3NF). |
| `Tabela_NCM_Vigente_20260922.json` | raiz | ~3 MB | Fonte bruta da nomenclatura. |
| `classificacao_tributaria.json` | raiz | ~420 KB | Fonte bruta da referência. |
| `Reforma Tributaria consulta por NCM - Original.xlsx` | raiz | ~162 KB | Planilha original de consulta. |
| `src/domain/capitulos.json` + `constants/seeds.ts`, `capitulos.ts` | `src/domain/` | pequeno | Capítulos NCM e seeds embutidos no bundle. |
| `public/*.png/.ico` | `public/` | — | Ícones/logo (`icone.png`, `icon.ico`, `escudo.png`, `logomarca*.png`). |
| XMLs de NF-e do usuário | `<userData>/xml/<cnpj>/<chave>.xml` (runtime, fora do repo) | variável | Notas importadas (`xml:salvar/ler/remover`). |

Fluxo de build de dados: `npm run base` (`scripts/build-base.mjs`, `AURUM_BASE_DIR` default = pasta pai) lê os 3 JSONs brutos da raiz → normaliza/valida → escreve `public/base/` (dev) → `vite build` copia para `dist/base` (prod, lido via `diretorioBase()`).

## Generated/Build Output

| Diretório | Conteúdo | Versionado? |
|---|---|---|
| `dist/` | Saída do `vite build` (renderer + `dist/base` copiado do `public/base`). Lido por `main.ts:INDEX_PRODUCAO` em prod. | Não (build). |
| `electron/dist/` | `main.js` + `preload.cjs` (+ maps) gerados por `electron/esbuild.mjs`. `main` do package e `preload` da janela apontam para cá. | Não (build). |
| `build/` | Recursos do instalador (`icon.ico`, `LICENCA.rtf` — ver `gen-licenca-rtf.py`, `refazer-icone.py`; `directories.buildResources`). | Parcial (ícones/licença). |
| `release/` | Instaladores `electron-builder` (`AurumTaxNCM-Setup-*-win-x64.exe`, `-Portatil-`, dmg/zip mac, AppImage). `output: release`, `publish: github privado`. | Não (artefatos). |
| `public/base/` | Tecnicamente gerado por `scripts/build-base.mjs`, mas **embutido no pacote** — tratar como artefato versionado de dados. | Sim (dados embutidos). |
