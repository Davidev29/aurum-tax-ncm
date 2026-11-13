# Testing

> Atualizado em 2026-11-13 (v1.1.0).

## Frameworks

- **Vitest 5** como único runner (`environment: 'node'`; `include: ['tests/**/*.test.ts']`).
- Coverage v8 restrito a `src/domain/**`, `src/application/**`, `src/infrastructure/**` — `simples/`, `pages/`, `ui/`, `store/`, `electron/` ficam fora. **Threshold de `simples/calculo.ts` existe mas é letra morta** (fora do `include`).
- **Sem Testing Library / sem testes `.tsx` / sem e2e.** React e stores não têm cobertura. `jsdom` instalado, sem uso.
- Bancos de teste: **SQLite real em `%TEMP%`** — `tests/setup.ts` cria/valida um **banco-template** (schema via `prisma db push --skip-generate`), valida magic bytes + `PRAGMA integrity_check` (via `node:sqlite` com `--experimental-sqlite`, opcional se ausente) e cada arquivo copia o template (isolamento total). Sem `fake-indexeddb` (o app usa Prisma/SQLite, não Dexie).
- `tests/ia/` — 9 suítes de IA/grafo (cobertura, escopo, dicionário, expansão, validação determinística).

## Números (2026-11-13)

- **172 suítes · 1.946 casos** — `npm test` → tudo passando (1 skip).
- `npm run typecheck` limpo (app + `tsconfig.electron.json`).

## Test Layout

- Pasta única `tests/` na raiz (sem co-location). Convenção de nome = módulo alvo. Fixtures em `tests/fixtures/` (`simples-finetuning-*.jsonl`). Helper `tests/ia/ajuda-ia.ts`.
- Cabeçalho JSDoc obrigatório por arquivo; `tests/setup.ts` cuida de template + `driver-prisma`.
- Padrão: `describe`/`it` + fixtures + `beforeEach`; nenhuma chamada de rede real (fixtures ou `fetch` mockado).

## Distribuição por tema (contada em 2026-11-13)

| Tema | Suítes |
|---|---|
| IA/grafo/RAG/chat | ~70 |
| Cálculo fiscal / Simples / NF-e / SPED | ~46 |
| Serviços/domínio NCM + CNAE/NBS | ~19 |
| DB/Prisma/SQLite | 6 |
| PDF/relatório/exportação | 9 |
| App/boot/infra | 7 |
| Aurum/gate (removido na v1.1.0) | 0 (5 suítes deletadas; sobrevive `guards-seguranca`) |
| Segurança/guards | 1 |
| UI estrita (`.tsx`) | **0** |

## Como rodar

- `npm test` → `node --experimental-sqlite node_modules/vitest/vitest.mjs run` (corrigido na v1.1.0 — o shim `.bin/vitest` quebrava no Windows)
- `npm run test:watch` → idem em watch
- `npm run typecheck` → `tsc --noEmit` + `tsc --noEmit -p tsconfig.electron.json`
- `npm run build` → db:generate → base:completa → typecheck → vite build → build:electron → ofuscar → verificar
- CI: `.github/workflows/ci.yml` — Node 22, `npm ci` + `prisma generate` + typecheck + `vitest --coverage` (`NODE_OPTIONS=--experimental-sqlite`)

## Gaps

1. **UI/stores sem testes** (`pages/`, `ui/`, `modais/`, `src/store/*`) — `jsdom` disponível, sem `@testing-library/react`.
2. **Electron não exercitado** (main/preload/IPC) — só `electron/main/db.ts` indiretamente via `db-sqlite-prisma.test.ts`.
3. **Coverage cego**: `simples/`, `pages/`, `ui/`, `store/` não aparecem no relatório v8 mesmo se forem testados — ampliar `coverage.include` com a v1.1.0.
4. **Flakiness potencial em CI**: suítes medem tempos em milissegundos (`<2000` em grafo-chaos/hibrido com tolerância `CI`); seeds de ~28 mil linhas SQLite por arquivo.
5. **Contracts externos**: BrasilAPI/Siscomex/CFF dependem de rede — mocks consistentes via fixtures; **fixture `tests/fixtures/simples-finetuning-100-S31-S130.jsonl`** usado por chat-probabilistico.
