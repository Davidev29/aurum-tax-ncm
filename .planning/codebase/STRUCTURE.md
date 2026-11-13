# Structure

## Directory Tree

Top 3 níveis (`node_modules/`, `build/`, `dist/`, `release/`, `electron/dist/` não expandidos):

```
./                                     ← repo aurum-tax-ncm (raiz git)
├── .planning/                            ← GSD (PROJECT/REQUIREMENTS/ROADMAP/STATE + codebase/*.md)
├── .github/workflows/ci.yml              ← typecheck + vitest (Node 22)
├── index.html                            ← shell (#raiz, tema anti-flash)
├── package.json · vite.config.ts · vitest.config.ts · tsconfig.json · tsconfig.electron.json
├── src/ (271 arquivos)
│   ├── main.tsx · App.tsx · index.css · pdfmake.d.ts
│   ├── pages/        ← Calculadora, Consultas (NCM/NBS/CNAEs/Simples via simples/), Lote,
│   │                    NfeXml/NfeXmlPolida (+ NfeNatureza, NfeConferenciaProdutos, NfePendentes,
│   │                     NfeCalendarioAnual, ModalRelatorioNfe), Produtos, Auxiliares, Legislacao
│   ├── simples/      ← módulo Simples isolado (tabelas, calculo, store, DasModal, InsightsModal,
│   │                    relatorio-analitico, ia-insights, exports)
│   ├── simples-projection/ ← projeção dividida v2 (camada aditiva sobre `simples/`)
│   ├── ui/           ← Layout, kit, cartoes, detalhes, dialogos, motion, skeleton, Marca,
│   │                    ModalLegislacao, TourGuiado, ErroFatal  ← (TermoAceite/banner de licença removidos na v1.1.0)
│   ├── modais/       ← globais (Empresas/Config/Backup/Atualização/Aparência), pagina, reclassificacao,
│   │                     escolha-tributacao, produto-manual
│   ├── store/        ← 17 stores (ui, sessao, consulta(+servicos,+cnaes), calculadora, lote, nfe,
│   │                    produtos, auxiliares, base, ia, fundo, novidades, conferencia-xml, novidades,
│   │                    tutorial, dialogo)
│   ├── domain/       ← entities, legislacao, capitulos, services/ (calculo, classificacao(+ia), busca-texto,
│   │                    detector-*, cnae(+nbs), referencia-service, format, hierarquia-fiscal, revogacao, vigencia…)
│   ├── application/  ← base, atualizacao, backup, auditoria, reclassificacao, revalidacao, produtos,
│   │                    empresas, emitente, notas-xml, ncm-sync, cff-sync, classificacao-inteligente…,
│   │                    aurum-ai-* (orquestrador RAG+tools determinístico), grafo-consumo, auxiliares, aux-meta
│   ├── infrastructure/ ← db/ (schema=types, db-protocolo, driver-prisma, validacao…), base/, ia/,
│   │                     nfe/, sped/, siscomex/, cff/, receita/brasilapi, parsers/lote, arquivos/xml-storage,
│   │                     exporters/relatorios, pdf/, bridge, fundo/pexels, legislacao-texto
│   ├── ai/           ← guards de segurança (injection, PII) — os únicos guards sobreviventes da era Aurum AI
│   ├── aurum/        ← (removido na v1.1.0 — era o módulo de licença/conta Aurumbit)
│   └── domain/constants/  ← seeds, capitulos, cst, cnae-nbs… (dados embutidos)
├── electron/
│   ├── main.ts · preload.ts · esbuild.mjs
│   ├── main/db.ts                       ← IPC `db:op`/`db:transaction`/`db:snapshot` (Prisma no main)
│   └── ia/ (grafo fiscal: grafo-service.cjs, caminhos-ia.cjs)
├── public/
│   └── base/             ← bases embutidas (reforma.json, nomenclatura.json, MANIFEST.json, grafo/grafo.lbug…)
├── scripts/            ← build-base.mjs, build-grafo.mjs, gerar-indice-ia.mjs, ofuscar-build.cjs,
│                          validar-conhecimento.mjs, verificar-build.mjs… (ver npm scripts)
│   └── grafo/
├── recursos-ia/        ← conhecimento curado + índice léxico + grafo + embeddings (12 MB) + dados-brutos
├── tests/ (176→172 arquivos após limpeza v1.1.0)
├── docs/               ← SPEC-LOGICA-NEGOCIO.md + diagnósticos/manuais (.docx fora do installer)
├── build/              ← icon.ico/png/icns, LICENCA.txt/.rtf (NSIS PT-BR)
├── dist/ · release/    ← saída de build/empacotamento (git-ignored)
└── prisma/             ← schema.prisma (27 tabelas) + dev.db (git-ignored)
```

## Key Files

| Path | Responsabilidade |
|---|---|
| `index.html` | Shell web: `#raiz`, anti-flash de tema, ícones |
| `src/main.tsx` | Bootstrap React; `useBase.iniciar()` + `useSessao.iniciar()` não-bloqueantes |
| `src/App.tsx` | Shell de views por `store/ui` (10 views lazy-load + ErroFatal por tela) |
| `electron/main.ts` | Janela, menu nativo, IPC, auto-update, sandboxes (base/xml) |
| `electron/main/db.ts` | `db:op`/`db:transaction`/`db:snapshot` — acesso Prisma no main |
| `electron/preload.ts` | `window.aurum` via `contextBridge` (`sandbox:false` — hardening pendente) |
| `src/infrastructure/bridge.ts` | `AurumBridge` + fallback web |
| `src/infrastructure/db/driver-prisma.ts` | `DriverIpc` — o renderer só fala `db:op` com o main |
| `src/domain/services/classificacao.ts` | Motor: join 3FN, manual, regra geral, vigência/extinção |
| `src/domain/services/calculo.ts` | `calcularTributos` (redução na alíquota), anexos, diferimento |
| `src/application/backup.ts` | Backup/restore transacional (valida tudo antes de apagar) |
| `scripts/build-base.mjs` | Normaliza JSONs brutos → `public/base` + MANIFEST |
| `package.json` | Versão, scripts, dependências, `electron-builder` (NSIS/DMG/AppImage) |
| `docs/SPEC-LOGICA-NEGOCIO.md` | Spec da lógica de negócio |

## Entry Points

| Entrada | Cadeia |
|---|---|
| Produção desktop | `package.json:main` (`electron/dist/main.js`) → janela → `dist/index.html` → `src/main.tsx` → `App` |
| Dev desktop | `npm run dev`: `predev` (kill-port + `base`) + `build:electron` → Vite `:5173` + Electron |
| Web/navegador | `npm run dev:web` (sem Electron; bases via `fetch('base/...')`) |
| Renderer | `index.html` → `/src/main.tsx` → `App` → `Layout` + página ativa |
| Main→renderer | Preload `window.aurum`; canais `menu:acao` / `atualizacao:evento` |
| Dados | `main.tsx` → `useBase.iniciar()` → IPC `db:op` + arquivos em `resources/app/dist/base` |
| Testes | `npm test` → Vitest (`tests/setup.ts`, banco-template SQLite em `%TEMP%`) |

## Data & Assets

| Arquivo | Onde | Tamanho aprox. | Papel |
|---|---|---|---|
| `public/base/nomenclatura.json` | versionado | ~2,8 MB | Nomenclatura NCM vigente |
| `public/base/reforma.json` | versionado | ~1,5 MB | CST × cClassTrib + vínculos NCM 2.335 |
| `public/base/classificacoes-consolidadas.json` | versionado | ~1,7 MB | Vínculos consolidados |
| `public/base/grafo/grafo.lbug` | versionado | ~6,1 MB | Grafo fiscal (FTS + 2-hops + PageRank) |
| `public/base/grafo/vetores.json` | versionado | ~12 MB | Vetores 384-d (não embarcados no instalador) |
| `public/base/parametros.json` | versionado | ~0,5 KB | IBS/CBS de referência (editável na UI) |
| XMLs de usuário | `<userData>/xml/<cnpj>/<chave>.xml` | — | Runtime |
| `aurum.db` | `<userData>` | — | SQLite (empresas/produtos/notas/…) |

Fluxo de build de dados: `npm run base` lê as fontes em `bases-fonte/` → normaliza/valida → `public/base/` → `vite build` copia para `dist/base` (consumido pelo main via `diretorioBase()`).

## Generated/Build Output

| Diretório | Conteúdo | Versionado? |
|---|---|---|
| `dist/` | Saída do `vite build` | Não (build) |
| `electron/dist/` | `main.js`, `preload.cjs` (+ `.map`? nunca — ofuscado) | Não (build) |
| `build/` | Recursos do instalador (`icon.ico`, `LICENCA.txt/.rtf`) | Parcial |
| `release/` | Instaladores (`AurumTaxNCM-Setup-*-win-x64.exe`, `-Portatil-`, dmg…). `publish: github` | Não (artefatos) |
| `public/base/` | Gerado, mas **embutido e versionado** (com `MANIFEST.json` + `verificar-build.mjs`) | Sim |
| `coverage/` | Relatórios v8 locais | Não |
