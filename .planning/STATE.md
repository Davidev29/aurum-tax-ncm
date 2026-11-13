---
gsd_state_version: '1.0'
status: shipped
progress:
  total_phases: 10
  completed_phases: 10
  total_plans: 33
  completed_plans: 32
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-11-13)

**Core value:** Classificação tributária precisa e automatizada que garante conformidade com a LC 214/2025, eliminando risco de multas e retrabalho fiscal.
**Current focus:** Distribuição da v1.1.0 (venda avulsa) e manutenção. Nenhum capítulo de feature aberto.

## Current Position

Release: **v1.1.0** — 13/11/2026 (construída e verificada localmente; publicação no GitHub pendente)
Release anterior: **v1.0.0** — 12/10/2026 (instalação local em `release/`)
Status: v1.0.0 entregue (10 módulos) + v1.1.0 (remoção da camada de licenciamento/onboarding; app entra direto)
Last activity: 2026-11-13 — v1.1.0: remoção do assistente de instalação e do portão de licença Aurumbit, `npm test` corrigido no Windows, docs e `.planning` atualizados, contrato/licença reescritos para venda avulsa

## Performance Metrics

- Velocity: 2 releases desde setembro/2026; 56+ commits em `main`
- Qualidade dinâmica (13/11/2026): `npm run typecheck` limpo (app+electron) · `npm test` **172 suítes / 1.946 casos (1.945 pass + 1 skip)** verde · `npx vite build` verde · `node electron/esbuild.mjs` verde
- v1.0.0 UAT: Electron audit (CSP/updater), 176 suítes verdes, typecheck limpo

## Accumulated Context

### Decisions (vigentes)

- Electron sobre Tauri — maduro, equipe conhece
- **SQLite + Prisma sobre Dexie/IndexedDB** (superseded, decidido na reconstrução p/ v1.0.0): 27 tabelas, IPC `db:op` validado no main, `aurum.db` em userData, snapshots rotativos e quarantine no boot
- Zustand sobre Redux — slices mínimos por tela
- Classificação 100% client-side; classificação determinística local (léxico + grafo fiscal + resolvedor oficial), sem LLM em runtime
- Tailwind CSS 4 + tokens `brand`/`aurum`
- Atualização de dados acoplada ao update do programa (GitHub Releases), não sync avulso da NCM
- **Venda avulsa (v1.1.0)**: sem conta, sem chave, sem ativação — licença perpétua da versão no Pedido; atualização opcional via GitHub Releases

### Pendências (não bloqueantes para venda)

- Auto-update sem verificação de assinatura (Windows/mac/Linux) — assinar antes de distribuir amplamente
- CSP inexistente — endurecimento pendente
- `.planning` do GSD antigo substituído por este registro enxuto; fases 1–10 concluídas
- Otimização estrutural pendente: monstros de código (`aurum-ai-chat.ts`, `NfeXml.tsx`), Clean Architecture nominal, ~195 catches engolidos, CI mínimo

## Session Continuity

Last session: 2026-11-13 — v1.1.0 (remoção do onboarding/licença, docs, build)
Stopped at: instalação 1.1.0 gerada em `release/` (não comitada); publicação no GitHub pendente
Resume file: None
