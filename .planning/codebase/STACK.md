# Stack

> Mapeamento do código na v1.1.0 (2026-11-13). Versões exatas de `package.json`.

## Languages & Runtimes

| Camada | Versão / alvo |
|---|---|
| Node.js (build/dev/test) | verificado local: v26.13.0; CI: Node 22 (`engines` não fixado; esbuild mira `node20`) |
| npm | v10+ |
| TypeScript | `~5.9.3` |
| `tsconfig.json` | `target ES2022`, `lib [ES2022, DOM, DOM.Iterable]`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `strict: true`, `noUnusedLocals/Parameters`, alias `@/* → src/*`, `include: [src, tests]` |
| `tsconfig.electron.json` | CommonJS, `noEmit`, tipos `node`, `lib ES2022+DOM`; cobre `electron/` + 4 módulos src consumidos pelo main |

## Frameworks

| Framework | Versão | Uso |
|---|---|---|
| React | `^19.3.0` | UI (`src/App.tsx`, `src/pages/*`, `src/ui/*`, `src/modais/*`) |
| React DOM | `^19.3.0` | `createRoot` em `#raiz` |
| Electron | `^44.4.5` | Desktop (`electron/main.ts` + `electron/preload.ts`); `main: electron/dist/main.js` |
| Vite | `^8.3.1` | Dev server + build renderer (`base: './'`, `outDir: dist`) |
| Tailwind CSS | `^4.3.3` (`@tailwindcss/vite`) | Estilos (`src/index.css`, tokens `brand`/`aurum`) |
| Zustand | `^5.0.15` | Estado global — 17 stores em `src/store/*` + stores em `simples/` e `simples-projection/` |
| Prisma ORM | `^6.19.3` | Banco SQLite no **main** (`electron/main/db.ts`); IPC `db:op` — o renderer nunca importa o client |
| Chart.js | `^4.5.1` (`react-chartjs-2 ^5.3.1`) | Gráficos (módulo XML + Simples) |
| Framer Motion | `^13.4.6` | Animações |
| pdfmake | `^0.3.11` | Relatórios PDF |
| SheetJS (`xlsx`) | `^0.18.5` | Import/export lote |
| `fast-xml-parser` | `^5.11.1` | Parse NF-e |
| `electron-updater` | `^6.8.9` | Auto-update via GitHub Releases |

## Build & Tooling

| Ferramenta | Arquivo | Notas |
|---|---|---|
| Vite | `vite.config.ts` | `base './'`, plugins `react()` + `tailwindcss()`, dev `127.0.0.1:5173` `strictPort`, sem `manualChunks` (rolldown/Vite 8) |
| esbuild | `electron/esbuild.mjs` | Compila `main.ts → electron/dist/main.js` + `preload.ts → preload.cjs` (target `node20`, CJS, minify) |
| electron-builder | bloco `build` em `package.json` (`^26.15.3`) | `appId br.com.aurumbitlabs.aurumtaxncm`, NSIS por usuário (sem admin), portable, dmg/zip mac, AppImage; `asar: true`; `publish: github` como fonte de update |
| tsc | `tsconfig.json` | `npm run typecheck` — portão strict |
| Vitest | `vitest.config.ts` | `environment: 'node'`; coverage v8 (parcial — ver TESTING.md) |
| `tests/setup.ts` | template SQLite em `%TEMP%` | `prisma db push --skip-generate` + `node:sqlite` |
| Scripts npm | `package.json` | `base` (+`base:completa`), `dev`, `build`, `dist`, `dist:win`, `ofuscar`/`verificar`, `grafo:*`, `ia:*` |

## Dependencies (diretas, runtime)

`react`, `react-dom`, `zustand`, `@prisma/client`, `xlsx`, `fast-xml-parser`, `pdfmake`, `chart.js` + `react-chartjs-2`, `framer-motion`, `electron-updater`.

Dev: electron, electron-builder, vite, @vitejs/plugin-react, tailwindcss, typescript, vitest, esbuild, @vitest/coverage-v8.

## Config Files

| Arquivo | Propósito |
|---|---|
| `package.json` | Versão (`1.1.0`), scripts, deps, config `electron-builder` (NSIS PT-BR, `nsis.license` → `build/LICENCA.rtf`) |
| `vite.config.ts` | Renderer (base, alias `@`, outDir `dist`) |
| `tsconfig.json` | ES2022 + strict (src/tests) |
| `tsconfig.electron.json` | Main/preload (CommonJS, semEmit) |
| `vitest.config.ts` | Testes + coverage v8 |
| `electron/esbuild.mjs` | Build main/preload |
| `prisma/schema.prisma` | 27 tabelas (fonte do `schema.sql` embutido) |
| `index.html` | Shell (tema anti-flash, `#raiz`) |
| `src/main.tsx` | Bootstrap Não-Opcional: inicia `useBase`/`useSessao` |
| `src/index.css` | Tailwind + tokens |

## Data Assets

`public/base/` (embutido, versionado): `reforma.json` 1,5 MB · `classificacoes-consolidadas.json` 1,7 MB · `nomenclatura.json` 2,8 MB · `cnae-nbs.json` 1,3 MB · `classificacao-tributaria.json` 0,3 MB · `parametros.json` · `grafo/grafo.lbug` 6,1 MB · `grafo/vetores.json` 12 MB (não embarcado) · `MANIFEST.json` (hashes).

Fontes brutas: `bases-fonte/` (JSONs oficiais + vivos). Bases consumidas pelo main e pelo renderer; nenhuma via rede em runtime.

Docs:

| Arquivo | Papel |
|---|---|
| `docs/SPEC-LOGICA-NEGOCIO.md` | Spec do domínio (regras R1.x–R10.x) |
| `docs/CONTRATO - Aurum Tax NCM (Licenca de Uso Desktop Local).docx` | Contrato de uso (v1.2, venda avulsa) |
| `docs/CONTRATO - Aurum Omni (…).docx` | Contrato da modalidade SaaS (produto à parte) |
| `build/LICENCA.txt` / `build/LICENCA.rtf` | Licença exibida pelo instalador NSIS |
| `LICENSE` | MIT (código-fonte) |
