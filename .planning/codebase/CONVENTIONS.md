# Conventions

> Mapeado em 2026-09-30; atualizado em 2026-11-13 (v1.1.0).

## Code Style (prettier/eslint config, aspas, ponto-e-vírgula, indent)

- **Sem ESLint/Prettier no repo.** Glob por `eslint*`, `prettier*`, `.editorconfig` vazio; `package.json` sem `lint`/`format`, sem `husky`. Estilo mantido por convenção.
- **Aspas simples + 2 espaços.**
- **Ponto-e-vírgula inconsistente (predominância SEM)** em módulos antigos; `src/App.tsx`/`main.tsx` usam `;` — legado se um linter for adotado.
- **Cabeçalho JSDoc por módulo** explicando responsabilidade + referência SPEC/decisão.
- **Imports com alias `@/`** (confirmado em `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`). Ordem: externos → `@/domain` → `@/infrastructure`/`@/application` → relativo. `import type` quando o tipo é só de tipo.
- **Idioma: código em inglês técnico; UI/comentários em pt-BR.**

## Naming

- **Arquivos:** kebab-case para camadas (`notas-xml.ts`, `cff-sync.ts`); PascalCase para componentes UI (`Consulta.tsx`, `NfeXml.tsx`, `Layout.tsx`); `modais/*.tsx` minúsculo (há inconsistência pontual — aceitar naquele estilo).
- **Componentes/páginas:** PascalCase, named exports (`export function App()`). Sem `default exports` na amostra.
- **Stores:** substantivo minúsculo em `src/store/` (`ui.ts`, `consulta.ts`, `sessao.ts`...) além dos stores de feature (`simples/store.ts`, `simples-projection/store.ts`, `aurum` — **removido na v1.1.0**); hook `use<Nome>` via Zustand `create<State>()`.
- **Tipos:** interfaces PascalCase; `Registro = Record<string, unknown>` nas fronteiras dinâmicas.
- **Funções:** camelCase em português (`consultar`, `montarClassificacao`, `calcularTributos`); constantes UPPER_SNAKE (`REGRA_GERAL`, `SUGGEST_LIMITS`).

## TypeScript Usage

- **`strict: true` + extras** (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes: false`).
- **Zero `any` na amostra — `unknown` é o padrão.** Fronteiras dinâmicas (JSON, docs, IPC) usam `unknown`/`Record<string, unknown>` com narrowing explícito. Supressão (`@ts-ignore`, `@ts-nocheck`) não é usada.
- **`interpretarEntradaNcm` é o intérprete único.** Telas classificam pelo mesmo código (`{kind:'ok'|'truncado'|'invalido'}`).

## State & Data Patterns

- **Zustand por tela/domínio**, sem middlewares; seletores (`useUi((s) => s.view)`), não o objeto inteiro.
- **Guards de geração** contra race conditions (`seqBuscaTexto`, `Promise.allSettled` no fan-out de `consultarUnificada`).
- **Limpeza ao trocar de view** via `registrarLimpeza(view, fn)` em `store/ui.ts`.
- **Prisma + SQLite via processo main** (não Dexie). Singleton `PrismaClient` no main (`electron/main/db.ts`); no renderer, acesso via IPC `db:op` (`DriverIpc` → `src/infrastructure/db/driver-prisma.ts`) com allowlist de operações/tabelas, tetos (lote 2000, 4 MB, transação 500 ops), `"where"` estruturado e `removerOnde` exigindo critério.
- **Tabelas (27)** + KEK/índices fora do backup; backup/restore JSON transacional e validado; `integrity_check` no boot com backend `node:sqlite` + quarentena.
- **Auditoria append-only** — `audit_log` nunca atualizado pela UI; trilha `via:grafo`/determinístico.

## Styling

- **Tailwind CSS v4** (`@import 'tailwindcss'`, tokens `@theme` em `src/index.css`; sem `tailwind.config.js`).
- **Design system próprio "marinho + ouro"** (`brand` = marinho, `aurum` = ouro; ouro nunca como texto corrido no tema claro).
- **Tema claro/escuro por classe `.dark`** no `<html>`; `--surface/--surface-2/--line/--ink/...` por tema.
- **Componentes utilitários em `index.css`** (`.btn`, `.panel`, `.tbl`, `.anexo-*`, `.modal-backdrop`, `.glass-box`...) — telas combinam Tailwind inline + essas classes; `prefers-reduced-motion` respeitado.
- **Sem CSS Modules/styled-components/Radix.** Framer Motion para animações; Chart.js para gráficos do módulo XML.

## Git & Commits

- Histórico: `feat:`/`fix:`/`chore:` em pt-BR (`2572b6b feat: Aurum Tax NCM v1.0.0…` … `4a57222 chore(grafo): …`).
- `.gitignore` cobre: `node_modules/`, `dist/`, `electron/dist/`, `release/`, `coverage/`, `.vitest/`, `logs/*`, artefatos de build/certificado, `*.db`. **`public/base/*.json` e `prisma/schema.prisma|schema.sql` são versionados por design** (base embutida determinística, verificada por `verificar-build.mjs`).
