# Testing

> Mapeado em 2026-09-30 a partir de `` (`vitest.config.ts`, `tests/`, `package.json`).

## Frameworks (vitest config, testing-library?, e2e?)

- **Vitest 5 como único framework** (`devDependencies`: `vitest@^5.0.2`, `jsdom@^30.1.1` instalado mas NÃO usado). `vitest.config.ts:10-18`: `environment: 'node'`, `include: ['tests/**/*.test.ts']`, `setupFiles: ['tests/setup.ts']`, alias `@ → ./src`, coverage provider `v8` restrito a `src/domain/**`, `src/application/**`, `src/infrastructure/**`.
- **Sem Testing Library / sem testes de componente.** Nenhuma dependência `@testing-library/*`; nenhum `*.test.tsx`; `environment: 'node'` (não `jsdom`/`happy-dom`). React (`pages/`, `ui/`, `modais/`) e stores Zustand não têm cobertura.
- **Sem e2e.** Nenhuma dependência `playwright`/`cypress`/`electron-test`; nenhum diretório `e2e/`. O Electron (`electron/`, `electron-builder`) não é exercitado por testes.
- **Suporte a IndexedDB real em memória.** `tests/setup.ts:12` importa `fake-indexeddb/auto` antes de qualquer módulo `src/`, de modo que o singleton Dexie (`src/infrastructure/db/schema.ts`) abre um banco por worker — cada arquivo de teste roda isolado, sem reset global.

## Test Layout (tests/ estrutura, co-locados?)

- **Não co-locados: pasta única `tests/` na raiz (37 arquivos `*.test.ts` + `setup.ts`).** Convenção: um arquivo por módulo/tema, nome espelhando o alvo (`calculo.test.ts`, `lote.test.ts`, `nfe-parse.test.ts`, `sped-parse.test.ts`, `motor-unico.test.ts`). Sem `__tests__/` nem testes ao lado de `src/`.
- **Cabeçalho JSDoc obrigatório por arquivo.** Todo teste amostrado (`calculo.test.ts:1-8`, `motor-unico.test.ts:1-11`, `db-migracao.test.ts:1-15`) abre com bloco explicando o que cobre + referência SPEC/issue (ex.: "LC 214/2025 (redução de ALÍQUOTA) / R2.18–R2.22").
- **Padrão de escrita: `describe`/`it` + fixtures locais + limpeza por teste.** Imports de `vitest` + `@/...`; constantes de NCM fictícios (`motor-unico.test.ts:28-32`: `'11111111'`…); factories locais (`vinculo()`, `cct()`); `beforeEach` limpando as stores Dexie usadas (isolamento intra-arquivo manual).
- **Cobertura de config exclui UI de propósito.** `vitest.config.ts:14-17` inclui só `domain/application/infrastructure` — `pages/`, `store/`, `ui/`, `modais/`, `electron/` estão fora do radar mesmo que um dia sejam testados.

## Coverage (o que é testado hoje: engine LC214? import? UI?)

37 arquivos, todos em lógica/import — **zero UI/Electron**:

| Área | Arquivos |
|---|---|
| Engine LC 214/2025 (cálculo, classificação, motor único, diferimento, revogação, revalidação, vigência) | `calculo`, `motor-unico`, `diferimento`, `revogacao`, `revalidacao`, `vigencia-ncm`, `mapeamento-legal` |
| Consulta (sugestões, busca texto, unificada, inteligente) | `consulta-sugestoes`, `consulta-unificada`, `busca-texto`, `classificacao-inteligente` |
| NF-e XML (parse, notas, crédito, apuração, regime, IBS/CBS, insights, confronto) | `nfe-parse`, `nfe-notas`, `nfe-credito`, `nfe-apuracao`, `nfe-regime`, `nfe-ibscbs`, `nfe-insights`, `nfe-confronto-xml` |
| SPED (leitura, parse) | `sped-leitura`, `sped-parse` |
| Lote/CSV | `lote`, `csv` |
| Produtos/empresas/reclassificação | `produtos`, `empresas-idempotentes`, `reclassificacao-manual`, `reclassificacao-propagacao` |
| Base/dados (embutida, migração v2→atual, formato, CFF, Siscomex, BrasilAPI) | `base-embutida`, `db-migracao`, `formato`, `cff-classprod`, `siscomex-ncm`, `brasilapi` |
| Legislação/relatórios | `legislacao-catalogo`, `legislacao-texto`, `mapeamento-legal`, `pdf-exportacao` |

- **Motor fiscal é o mais blindado.** `calculo.test.ts` fixa a fórmula `aliq = ref × (1−red/100)` e `tributo = base × aliq/100` (faixas 100/80/70/60/50/40/30 + assimétrico IBS≠CBS); `motor-unico.test.ts` garante paridade Consulta/Lote/XML/SPED/Produtos/Calculadora para o mesmo NCM (regressão de 4 divergências históricas documentadas no cabeçalho).
- **Imports com I/O real isolado.** NFe/SPED/lote parseiam XML/txt/CSV de fixture; rede é mockada ou blindada (`brasilapi.test.ts`, `siscomex-ncm.test.ts`, commit `e4c8ffa`).
- **Nada de UI.** Nenhum teste renderiza componente, exercita store Zustand, navegação (`trocarView`), tema, modal, ou exportação visual; `pdf-exportacao.test.ts` cobre a geração, não o layout.

## How to Run (comandos npm test/build/lint do package.json)

- `npm test` → `vitest run` (única passada, CI-friendly). `npm run test:watch` → `vitest` (watch local).
- `npm run typecheck` → `tsc --noEmit` (portão `strict` + `noUnusedLocals/Parameters`).
- `npm run build` → `base` + `tsc --noEmit` + `vite build` + `build:electron` (falha em erro de tipo).
- `npm run dev` → `concurrently` renderer (Vite :5173) + Electron; `dev:web` só Vite.
- **Sem comando lint/format/test:e2e/coverage.** Para cobertura explícita seria `npx vitest run --coverage` (provider v8 já configurado), mas não há script.

## Gaps (o que falta testar para fases 1-5)

1. **Stores Zustand e navegação sem nenhum teste.** `src/store/*` (consulta fan-out com guards de geração, `trocarView` + `registrarLimpeza`, toasts, modais, calculadora) só são exercitados indiretamente. Risco direto para fases que mexam em Consulta/Lote/Produtos/Calculadora — adotar `vitest` + Testing Library com `environment: jsdom` (já instalado) para ao menos os stores.
2. **Componentes/páginas e temas sem teste de render.** `pages/`, `ui/`, `modais/` (incl. dark mode, badges de anexo, tabelas `.tbl`, glassmorphism) dependem de inspeção manual. Qualquer fase com mudança visual precisa de baseline manual ou introduzir testes de componente + snapshots.
3. **Fluxos ponta-a-ponta (import → classificar → salvar → exportar) e Electron sem cobertura.** Não há teste que atravesse `parsers → repo → store → exporters`, nem empacotamento (`electron-builder`), auto-update (`electron-updater`) ou IPC (`bridge.ts`). Fases de distribuição/integração precisam de checklist manual ou harness e2e (inexistente hoje).
4. **Cobertura invisível por config.** Mesmo se testes de `store/`/`pages/` forem criados, `vitest.config.ts:14-17` os exclui do relatório — ampliar `coverage.include` ao adicionar testes UI.
5. **Contratos externos frágeis.** BrasilAPI/Siscomex/CFF dependem de rede e fixtures; sem VCR/gravação de respostas, fases que tocam sync (`ncm-sync`, `cff-sync`) podem flakear — padronizar mocks de `fetch`.
