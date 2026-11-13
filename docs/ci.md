# CI — pipeline e como mantê-la garantidamente verde

Última auditoria: 2026-11-13. Jobs: `test` (typecheck + vitest) e `release-build` (release completa sem empacotar).

## O que roda

| Job | Runner | O que faz | Tempo típico |
|---|---|---|---|
| `test` | `ubuntu-latest`, Node 22 | checkout → `npm ci` → `npx prisma generate` → `npm run typecheck` (app+electron) → `npx vitest run --coverage` (172 suítes) | 5–8 min |
| `release-build` (needs: test) | `ubuntu-latest`, Node 22 | checkout → `npm ci` → prisma generate → **espelha vetores do grafo** → `npm run build` (`db:generate → base:completa → typecheck → vite build → build:electron → ofuscar → verificar-build`) | 5–8 min |

A `CI` roda em `push` e `pull_request`. `NODE_OPTIONS=--experimental-sqlite` é global (obrigatório no Node 22 para o `node:sqlite` usado por `tests/setup.ts`).

Não empacotamos na CI de propósito: o empacotamento (`electron-builder`, assinatura) é manual por release (`npm run dist:win`).

## Decisões / guardas

- **Node 22 fixo** — `node:sqlite` estável a partir daí; `package.json` exige `node >= 22` (`engines`) e `.nvmrc` marca `22`.
- **`npm ci`** (lockfile congelado) — instalação determinística, sem resolução de ranges flutuante.
- **`NODE_OPTIONS` global** — sem a flag, o `tests/setup.ts` degradaria em silêncio (template sem `integrity_check`).
- **Tempos sensíveis tolerados sob CI** (`process.env.CI` → 5000 ms) — `grafo-chaos` / `grafo-hibrido` medem latência real do grafo; sem a tolerância são flaky.
- **Sem matriz OS/Node** — menos combinações = menos modos de falha transitória. O alvo real (Windows) é coberto pelo `win` no build local; se quiser macOS/Linux no gate, adicione conscientemente.
- **Sem `npm audit` como gate** — a auditoria hoje acusa 27 vulnerabilidades (2 críticas), quase tudo em devDeps (vitest/electron-builder/xlsx); bloquear o CI por advisory de transitiva upstream que a equipe não controla é a forma clássica de CI permanentemente vermelha.
- **Branch protection** — `main` **não** está protegida. Para "verde garantido", exija este workflow em Settings → Branches → `main` → Require status checks (test, release-build). Só os mantenedores com push em `main` são afetados.

## Gargalos conhecidos e o que não fazer

- **Espelho dos vetores é obrigatório no build limpo** — `recursos-ia/embedding/vetores-ncm.json` é git-ignored (12,6 MB) e o `verificar-build` [3/5] **exige** o arquivo byte-idêntico à cópia commitada `public/base/grafo/vetores.json`. Sem o passo "Espelha vetores" o build falha em todo checkout limpo (fail-closed, como projetado — mas sem o passo, o CI fica permanentemente vermelho). Já foi adicionado ao job; não remova.
- **Nunca** regenere a base (`public/base/`) dentro de um PR de feature — `npm run base` é lento e gera diffs de timestamp; ele já roda na `release-build`.
- **Não** rode `vitest` sem `--experimental-sqlite` em Node < 24 — o template de banco de testes quebra (ou fica sem verificação de integridade).
- **Não** adicione `npm ci` com `--force`/`--legacy-peer-deps` — se o lockfile estiver dessincronizado, corrija o lock (`npm install --package-lock-only`) em vez de ignorar.
- Se um teste flakear por tempo (raro; ver seção acima), ajuste a tolerância — **nunca** aumente de 5000 para o infinito.

## Status atual do upstream (2026-11-13)

- `npm ci` limpo; typecheck limpo; vitest verde local; `npm run build` verificado com instalador 1.2.0 (`PACOTE ÍNTEGRO`).
- `npm audit`: 27 vulnerabilidades (1 low, 10 moderate, 14 high, 2 critical) — em `xlsx` (SheetJS, fix exige migração para a distribuição oficial do SheetJS), `vitest`/`@vitest/coverage-v8`, `electron-builder` chain, `shell-quote` (transitiva dev). Nenhuma bloqueia o uso atual do app (desktop local, base embutida). Plano: abrir issue de manutenção e avaliar `npm audit fix` junto com o próximo release.
