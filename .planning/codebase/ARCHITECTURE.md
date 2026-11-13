# Architecture

## Overview

- **Tipo:** desktop **offline-first**, sem backend nem conta. Toda lógica roda na máquina.
- **Split renderer/main:** `electron/main.ts` (janela, menu nativo, IPC, auto-update) + `electron/preload.ts` (`window.aurum` via `contextBridge`; `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`) + renderer React 19 + Vite 8 + TS (`src/`, montado em `#raiz`).
- **v1.1.0 (2026-11-13):** onboarding e portão de licença **removidos**. O app abre direto na tela inicial; não há conta, chave, servidor de ativação nem "Conta" nas Configurações.
- **Persistência real:** **Prisma 6 + SQLite** (`aurum.db` em `<userData>`, 27 tabelas via IPC `db:op` validado no main; `integrity_check` + quarentena no boot; transações `db:transaction`; backups rotativos pré-restore). Não é mais Dexie/IndexedDB.
- **Fallback web:** `src/infrastructure/bridge.ts` — sem `window.aurum`, leitura de base cai para `fetch('base/...')`, permitindo rodar no navegador para desenvolvimento.
- **Estado:** Zustand 5 (~19 stores); **classificação 100% determinística local** (léxico + grafo fiscal LadybugDB FTS/2-hops/PageRank + resolvedor oficial) — não há LLM em runtime.

## Layers

| Camada | Onde | Responsabilidade |
|---|---|---|
| Main process | `electron/main.ts` | Cria `BrowserWindow` (1440×900, `show:false` → `ready-to-show`); menu nativo; auto-update (`electron-updater`, 30s após abrir + 6h); IPC mínimo; sandboxes `resolverNoBase`/`resolverNoXml` anti-traversão; `will-navigate` travado; `setWindowOpenHandler` deny |
| Main DB | `electron/main/db.ts` | Singleton Prisma no main; IPC `db:op` (allowlist de 11 ops/tabelas + `where` estruturado + tetos lote 2000/4 MB/500 ops), `db:transaction` (tudo-ou-nada), `db:snapshot` rotativo (`pre-restore-*.bak`) |
| Preload / IPC | `electron/preload.ts` + `src/infrastructure/bridge.ts` | Contrato `AurumBridge`: `base:ler[-base64]`, `arquivo:*`, `xml:*`, `rede:buscar-texto`, `ia:grafo[-uso]`, `atualizacao:*`, `menu:acao` |
| Renderer React | `src/App.tsx`, `src/pages/`, `src/ui/`, `src/modais/` | 9 views lazy-loaded com `ErroFatal` por tela; code-splitting; Suspense+skeleton |
| Estado (Zustand) | `src/store/` + `simples/store.ts` + `simples-projection/store.ts` | Um store por domínio de tela; limpeza ao trocar view (`registrarLimpeza`) |
| Persistência | `src/infrastructure/db/*` (+ `electron/main/db.ts`) | `driver-prisma.ts` (`DriverIpc`) é a única porta do renderer para o SQLite |
| Domínio puro | `src/domain/` | `entities`, `services/calculo`, `services/classificacao`, `services/busca-texto`, `constants/` (`REGRA_GERAL`, `REF_DEFAULT IBS 19 / CBS 9`, links oficiais). Sem I/O — testável |
| Aplicação / Infra | `src/application/`, `src/infrastructure/` | Orquestração (`backup`, `auditoria`, `reclassificacao`, `revalidacao`, `atualizacao`, `aurum-ai-*` determinísticos) sobre repos, parsers (lote/NF-e/SPED), exporters, PDF |

## Data Flow

```
JSONs brutos (bases-fonte/)
  → scripts/build-base.mjs (normalização 3FN, validações cruzadas, MANIFEST.json com sha256)
  → public/base/*.json (versionado, embutido)
  → vite build → dist/base (produção)
  → main.ts diretorioBase() + IPC base:ler (ou fetch no navegador)
  → application/base.inicializarBase() (seed + imports, progresso)
  → SQLite (via IPC db:op)
  → engine de classificação (resolvedor único: vínculo NCM + CST + cClassTrib + referência + nomenclatura)
  → stores Zustand → páginas UI
  → export: xlsx / pdfmake / CSV-ERP · backup/restore JSON · XMLs em userData/xml
```

- **Classificação (`domain/services/classificacao.ts`):** `montarClassificacao` (vínculo oficial), `montarRegraGeral` (fallback `000/000001`), vigência de NCM/cClassTrib, herança por família (SH6/SH4/capítulo) com confiança.
- **Cálculo (`domain/services/calculo.ts`):** redução incide sobre a **alíquota** (`aliq = ref × (1 − red/100)`, base cheia, clamp 0–100, `round2` por parcela); anexo oficial nunca inferido; fallback `anexoDeReducao` só na derivação de badges.
- **Atualização das bases:** acoplada ao update do programa (electron-updater + GitHub Releases) — não há fetch avulso de NCM; checagem a cada 6h e no boot.

## Key Modules

- `src/domain/services/classificacao.ts` — motor único de classificação
- `src/domain/services/calculo.ts` — `calcularTributos` (LC 214)
- `src/simples/calculo.ts` + `src/domain/simples/nucleo.ts` — motor DAS (LC 123) isolado de propósito
- `src/application/aurum-ai-chat.ts` — orquestrador Aurum AI (determinístico, tool-calling auditável) — **monstro de 253 KB; refatorar pendente**
- `src/application/backup.ts` + `electron/main/db.ts` — backup/restore transacional validado
- `src/infrastructure/nfe/*` — parse/análise NF-e (apuração IBS/CBS, crédito efetivo do XML)
- `src/store/*` — ~17 stores por tela/domínio
- `scripts/build-base.mjs` — compila as bases (3FN)
- `electron/ia/grafo-service.cjs` — grafo fiscal (LadybugDB) no processo main

## Design Decisions

| Decisão (PROJECT.md) | Reflexo no código |
|---|---|
| Electron sobre Tauri | `electron/main.ts` + `preload.ts`; single-instance; menu nativo |
| Prisma+SQLite sobre Dexie | `electron/main/db.ts`; IPC `db:op` validado; backup transacional |
| Classificação client-side | Domínio puro sem I/O; `rede:buscar-texto` só busca norma pública |
| Determinismo sobre IA | Grafo + resolvedor; IA só roteia/sugere com trilha `via` |
| Venda avulsa (v1.1.0) | Sem conta, sem chave, sem servidor; licença perpétua por Pedido |
| Tailwind CSS 4 | `index.css` + `@theme` (`brand`/`aurum`) |

## Gaps vs Roadmap

> Todas as fases 1–10 concluídas (v1.0.0). O que permanece é manutenção estrutural (assessment 2026-11-13): CSP ausente, updater sem assinatura, arquivos monstros, Clean Architecture nominal, catches engolidos, CI mínimo.
