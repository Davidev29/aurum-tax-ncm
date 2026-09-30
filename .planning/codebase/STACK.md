# Stack

> Gerado por mapeamento TECH do código em ``. Versões exatas de `package.json`.

## Languages & Runtimes

| Camada | Versão / alvo |
|---|---|
| Node.js (runtime de build/dev) | verificado local: v24.19.0 (sem `engines` fixado em `package.json`; esbuild mira `node20`) |
| npm | verificado local: 11.17.0 |
| TypeScript | `~5.9.3` (devDep) |
| `tsconfig.json` | `target ES2022`, `lib [ES2022, DOM, DOM.Iterable]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict: true`, `noUnusedLocals/Parameters: true`, `noFallthroughCasesInSwitch: true`, alias `@/* → src/*`, `include: [src, tests]` (pasta `electron/` **não** incluída — compilada à parte pelo esbuild) |

## Frameworks

| Framework | Versão | Uso |
|---|---|---|
| React | `^19.3.0` | UI (`src/App.tsx`, `src/pages/*`, `src/ui/*`, `src/modais/*`); entrada `src/main.tsx` com `StrictMode` |
| React DOM | `^19.3.0` | `createRoot` em `#raiz` (`index.html`) |
| Electron | `^44.4.5` | Shell desktop (`electron/main.ts` + `electron/preload.ts`); `main: electron/dist/main.js` |
| Vite | `^8.3.1` | Dev server + build renderer (`base: './'`, `outDir: dist`, alias `@`) |
| `@vitejs/plugin-react` | `^6.1.1` | Plugin React do Vite |
| Tailwind CSS | `^4.3.3` (+ `@tailwindcss/vite ^4.3.3`) | Estilos via `@import 'tailwindcss'` em `src/index.css` + tokens `@theme` (marinho `brand` / ouro `aurum`) |
| Zustand | `^5.0.15` | Estado global — 9 stores em `src/store/*` (`base`, `sessao`, `consulta`, `calculadora`, `produtos`, `lote`, `nfe`, `ui`, `dialogo`, `auxiliares`) |
| Dexie | `^4.4.6` (+ `dexie-react-hooks ^4.4.0`) | IndexedDB tipado (`src/infrastructure/db/schema.ts`, `AurumDatabase`, DB `aurum_tax_ncm_v1` v8) |
| Chart.js | `^4.5.1` (+ `react-chartjs-2 ^5.3.1`) | Gráficos (ex.: `src/pages/NfeXml.tsx`) |
| Framer Motion | `^13.4.6` | Animações (`src/ui/motion.tsx`, páginas/modais) |
| pdfmake | `^0.3.11` (+ `@types/pdfmake ^0.3.3`) | Relatórios PDF declarativos (`src/infrastructure/pdf/setup.ts`, `src/infrastructure/exporters/relatorios.ts`) |
| SheetJS (`xlsx`) | `^0.18.5` | Import lote/planilhas (`src/infrastructure/parsers/lote.ts`), export XLSX |
| `fast-xml-parser` | `^5.11.1` | Parse de NF-e (`src/infrastructure/nfe/parse.ts` via `XMLParser`/`XMLValidator`) |
| `electron-updater` | `^6.8.9` | Auto-update via GitHub Releases (ver `electron/main.ts: configurarAtualizador`) |
| Fontes | `@fontsource/inter ^5.3.0`, `@fontsource/jetbrains-mono ^5.3.0` | Tipografia texto + monoespaçada (NCM/CST/CFOP) |

## Build & Tooling

| Ferramenta | Arquivo | Notas |
|---|---|---|
| Vite | `vite.config.ts` | `base './'`, plugins `react()` + `tailwindcss()`, dev `127.0.0.1:5173` `strictPort`, `chunkSizeWarningLimit: 4096`, sem `manualChunks` (rolldown/Vite 8 agrupa `pdfmake`/`xlsx`/`Chart.js` via imports dinâmicos) |
| esbuild | `electron/esbuild.mjs` | Compila `electron/main.ts → electron/dist/main.js` e `electron/preload.ts → electron/dist/preload.cjs` (`platform node`, `format cjs`, `target node20`, `external: [electron, electron-updater]`, sourcemap sem minify); script `build:electron` |
| electron-builder | bloco `build` em `package.json` (`^26.15.3`) | `appId br.com.aurumbitlabs.aurumtaxncm`, `output: release`, `files: [dist/**, electron/dist/**, package.json]`, `asar: true`; alvos win (nsis x64 + portable), mac (dmg+zip x64/arm64), linux (AppImage) |
| tsc | `tsconfig.json` | `npm run build` = `base + tsc --noEmit + vite build + build:electron`; `typecheck: tsc --noEmit` |
| Vitest | `vitest.config.ts` (`vitest ^5.0.2`) | `environment: node`, `include: tests/**/*.test.ts`, `setupFiles: tests/setup.ts` (`fake-indexeddb/auto`), coverage v8 sobre `src/{domain,application,infrastructure}/**` |
| Testes suporte | `fake-indexeddb ^6.2.5`, `jsdom ^30.1.1` | IndexedDB em memória para o singleton Dexie; jsdom disponível |
| Dev DX | `concurrently ^10.0.5`, `cross-env ^10.0.0`, `wait-on ^9.1.0` | `dev` = `dev:renderer` (vite) + `dev:electron` (espera `tcp:127.0.0.1:5173`, injeta `VITE_DEV_SERVER_URL`); `predev` mata porta 5173 (`scripts/kill-port.mjs`) e roda `base` |
| Scripts npm | `package.json` | `base` (compila bases), `predev`, `dev`, `dev:renderer`, `dev:electron`, `dev:web` (só vite), `build:electron`, `build`, `typecheck`, `test`, `test:watch`, `start` (`electron .`), `dist`, `dist:win`, `dist:mac`, `icon` |

## Dependencies

Diretas (`dependencies` — vão para o runtime):

| Pacote | Para que serve |
|---|---|
| `react`, `react-dom` | UI |
| `zustand` | Stores globais |
| `dexie`, `dexie-react-hooks` | Persistência IndexedDB + hooks reativos |
| `xlsx` | Ler/gerar planilhas (lote, export) |
| `fast-xml-parser` | Parse/validação de XML da NF-e |
| `pdfmake` | Geração de PDFs (relatórios) |
| `chart.js`, `react-chartjs-2` | Dashboards/gráficos |
| `framer-motion` | Animações/transições |
| `@fontsource/inter`, `@fontsource/jetbrains-mono` | Fontes locais |
| `electron-updater` | Checar/baixar/instalar atualizações (bases embutidas renovadas junto com o app) |

Dev (`devDependencies`):

| Pacote | Para que serve |
|---|---|
| `electron`, `electron-builder` | Runtime desktop + empacotamento/instaladores |
| `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` | Build/dev renderer + estilos |
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `@types/pdfmake` | Tipos |
| `esbuild` | Bundle main/preload |
| `vitest`, `fake-indexeddb`, `jsdom` | Testes |
| `concurrently`, `cross-env`, `wait-on` | Orquestração dev |

## Config Files

| Arquivo | Propósito |
|---|---|
| `package.json` | Identidade (`aurum-tax-ncm` 1.0.0), scripts, deps, config `electron-builder` |
| `vite.config.ts` | Config renderer (base, alias `@`, server 5173, outDir `dist`) |
| `tsconfig.json` | Compilador (ES2022, strict, alias `@/*`) — cobre só `src` + `tests` |
| `vitest.config.ts` | Runner de testes (node env, `tests/**`, fake-indexeddb, coverage v8) |
| `electron/esbuild.mjs` | Build main/preload para `electron/dist/` |
| `index.html` | Shell HTML (`#raiz`, tema anti-flash via `localStorage['tema']`, manifest, ícones) |
| `src/main.tsx` | Bootstrap React + `useBase.iniciar()` / `useSessao.iniciar()` |
| `src/index.css` | Tailwind + design tokens (`brand`/`aurum`) |
| `src/pdfmake.d.ts` | Declarações de tipos do pdfmake |
| `scripts/build-base.mjs` | Compila JSONs raiz → `public/base/*.json` + `MANIFEST.json` |
| `scripts/kill-port.mjs` | Libera porta 5173 no `predev` |
| `scripts/gen-*.{mjs,cjs,py}` | Geração de seeds/capítulos/contratos/ícones/licença RTF |
| `.gitignore` | (verificar no repo) Ignorados padrão Node/dist/release |
| Sem `.env*` | Nenhum arquivo `.env` encontrado no projeto — configuração via `VITE_DEV_SERVER_URL` (só dev) e `AURUM_BASE_DIR` (build-base) |

## Data Assets

Raiz do workspace (`C:\Users\david\Documents\REFORMA NCM` — **fontes**, fora do app):

| Arquivo | Tamanho aprox. | Papel |
|---|---|---|
| `reforma_tributaria_por_ncm.json` | ~15,7 MB | Fonte: vínculos NCM/NBS × CST × cClassTrib + tabelas auxiliares (entrada de `build-base.mjs`) |
| `Tabela_NCM_Vigente_20260922.json` | ~3 MB | Fonte: nomenclatura NCM vigente (Res. Gecex) |
| `classificacao_tributaria.json` | ~0,4 MB | Fonte: referência CST × cClassTrib (164 registros, portal CFF/DFe) |
| `Reforma Tributaria consulta por NCM - Original.xlsx` | ~0,16 MB | Planilha original de consulta (referência legada) |
| `converter_reforma_tributaria.py` | ~0,01 MB | Script legado de conversão (substituído por `scripts/build-base.mjs`) |

Compilados embutidos (`public/base/` → copiados para `dist/base` no build):

| Arquivo | Papel |
|---|---|
| `reforma.json` | CST + cClassTrib + vínculos NCM/NBS normalizados (3FN, ~1,5 MB) |
| `classificacao-tributaria.json` | Referência normalizada por `cClassTrib` |
| `nomenclatura.json` | Nomenclatura vigente (auto-preenchimento/descrições) |
| `MANIFEST.json` | Metadados, contagens, checksums sha256, ignorados, validações cruzadas |

Docs:

| Arquivo | Papel |
|---|---|
| `docs/SPEC-LOGICA-NEGOCIO.md` | Spec de lógica de negócio (contrato de domínio, §§ citados no código) |
| `docs/CONTRATO - Aurum Tax NCM (Licenca de Uso Desktop Local).docx` | Contrato de licença desktop |
| `docs/CONTRATO - Aurum Omni (Licenca de Uso e Prestacao de Servicos).docx` | Contrato Omni/serviços |
| `estudo-relatorio-xml.md` (raiz) | Estudo de relatório XML |
