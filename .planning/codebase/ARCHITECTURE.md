# Architecture

## Overview

- **Tipo:** desktop app **offline-first** com Electron (janela única, `requestSingleInstanceLock`), sem backend: toda a lógica roda no cliente.
- **Split renderer/main:** `electron/main.ts` (Node: janela, menu, IPC, auto-update) + `electron/preload.ts` (expõe `window.aurum` via `contextBridge`, `contextIsolation: true`, `nodeIntegration: false`) + renderer React 19 + Vite 8 + TypeScript (`src/`, montado em `#raiz` via `index.html` → `src/main.tsx` → `src/App.tsx`).
- **Fallback web:** `src/infrastructure/bridge.ts` — sem `window.aurum`, a leitura de base cai para `fetch('base/...')`, permitindo rodar no navegador.
- **Stack efetivo:** React + Zustand (10 stores) + Dexie (IndexedDB, `AurumDatabase` v8, 17 object stores) + Tailwind CSS v4 (`@tailwindcss/vite`) + xlsx + pdfmake + Chart.js + fast-xml-parser. Testes: Vitest + fake-indexeddb + jsdom (`tests/`, ~38 arquivos).

## Layers

| Camada | Onde | Responsabilidade |
|---|---|---|
| Main process | `electron/main.ts` | Cria `BrowserWindow` (1440×900, dev via Vite `:5173`, prod via `dist/index.html`); registra IPC; menu nativo (Arquivo/Editar/Exibir/Janela/Ajuda); `electron-updater` (check 30s + 6h, eventos `atualizacao:evento`); sandbox de FS (`resolverNoBase`, `resolverNoXml` anti-traversão); bloqueia navegação/`window.open` externo. |
| Preload / IPC | `electron/preload.ts` + `src/infrastructure/bridge.ts` (`AurumBridge`) | Contrato IPC: `base:ler`, `base:ler-base64`, `arquivo:escolher/escolher-pasta/salvar`, `xml:salvar/ler/remover` (gravável em `userData/xml/<cnpj>/<chave>.xml`), `rede:buscar-texto` (fetch sem CORS, só HTTPS em hosts Planalto/CGIBS, teto 15 MB), `atualizacao:*`, `menu:acao` / `atualizacao:evento`. |
| Renderer React | `src/App.tsx`, `src/pages/` (7 views), `src/ui/`, `src/modais/` | Shell: `Layout` + troca de view por `store/ui` (`calculadora` default, `consulta`, `lote`, `nfe`, `produtos`, `auxiliares`, `legislacao`) + portão de aceite (`domain/contrato`, `ui/TermoAceite`). Páginas são apresentação fina sobre stores. |
| Estado (Zustand) | `src/store/` (10 stores) | `base` (status/seed/import), `sessao` (empresa ativa), `ui` (view/tema/toast), `consulta`, `calculadora`, `lote`, `nfe`, `produtos`, `auxiliares`, `dialogo`. `main.tsx` dispara `useBase.iniciar()` + `useSessao.iniciar()` sem bloquear primeira dobra. |
| Persistência (Dexie) | `src/infrastructure/db/schema.ts` | `AurumDatabase` (`aurum_tax_ncm_v1`, v8): `ncm`, `nbs`, `cst`, `cstClassTrib`, `referencia`, `ncmNomenclatura`, `empresas`, `produtos`, `meta`, `cfop`, `cstIcms`, `cstPisCofins`, `nfeNotas` (`&[empresaId+chave]`), `reclassificacoesManuais` (keyPath `ncm`), `classificacaoProduto`, `audit_log` (append-only), `cest`. `bulkPut` em lotes de 500 com progresso; migração legada v2→v3 (`migrarBancoLegado`) + cadeia v6→v8. |
| Domínio puro | `src/domain/` | `entities` (tipos), `services/` (`classificacao`, `calculo`, `busca-texto`, `classificador-descricao`, `revogacao`, `referencia-service`, `detector-consulta`, `format`), `constants/` (stores, `REGRA_GERAL 000/000001`, `REF_DEFAULT IBS 19 / CBS 9`, links LC 214/227, EC 132). Sem I/O — testável. |
| Aplicação / Infra | `src/application/`, `src/infrastructure/` | Orquestração (`base`, `reclassificacao`, `revalidacao`, `auditoria`, `backup`, `produtos`, `empresas`, `notas-xml`, `ncm-sync`, `cff-sync`, `atualizacao`, `classificacao-inteligente`) sobre repos/parsers (`base/*`, `nfe/*`, `sped/*`, `siscomex/`, `cff/`, `receita/brasilapi`, `parsers/lote`, `arquivos/xml-storage`, `exporters/relatorios`, `pdf/*`, `legislacao-texto`). |

## Data Flow

```
JSONs brutos (raiz do projeto)
  → scripts/build-base.mjs (normalização 3NF, validação cruzada, MANIFEST)
  → public/base/*.json  (embutido; vai para dist/base no pacote)
  → main.ts diretorioBase() + IPC base:ler[-base64]  (ou fetch no navegador)
  → application/base.inicializarBase()  (seed + import, progresso, store/meta)
  → Dexie (AurumDatabase)
  → engine de classificação (join 3NF em memória: vínculo NCM + CST + cClassTrib + referência + nomenclatura)
  → stores Zustand → páginas UI
  → export: xlsx / pdfmake / CSV-ERP (infrastructure/exporters, pdf/)
       backup/restore JSON (application/backup) · XMLs em userData/xml
```

- **Classificação (`domain/services/classificacao.ts`):** `montarClassificacao` (vínculo oficial), `montarClassificacaoManual` (override com `manual`), `montarRegraGeral` (fallback CST 000 × 000001), `interpretarEntradaNcm` ("um motor": Consulta/Lote/XML/SPED usam o mesmo resolvedor), vigência NCM (`isNcmExtinto`) e de cClassTrib (`statusVigenciaCct`).
- **Cálculo (`domain/services/calculo.ts`):** redução incide sobre a **alíquota** (`aliq = ref × (1 − red/100)`, BC cheia preservada, clamp 0–100, `round2` por parcela, `total = vIBS + vCBS`); anexos oficiais nunca inferidos (`anexoOficial` vs fallback `anexoDeReducao`); observações com blindagem (artigos por faixa só na regra geral; com enquadramento oficial, só base oficial); diferimento Anexo IX/art. 138 condicional à operação.
- **Atualização de bases:** não há sync avulso de NCM — bases viajam embutidas e são renovadas pela **atualização do programa** (`application/atualizacao.ts` + `electron-updater` + GitHub Releases).

## Key Modules

- `src/domain/services/classificacao.ts` — motor de classificação (join 3NF, manual, regra geral, vigência/extinção).
- `src/domain/services/calculo.ts` — `calcularTributos`, anexos, badges, observações legais/diferimento.
- `src/infrastructure/db/schema.ts` — schema Dexie v8 + migrações + `bulkPut`/`contarTodos`.
- `src/application/base.ts` + `src/infrastructure/base/*` — seed/import/status da base (`base-service`, `classificacao-repo`, `reclassificacao-repo`, `normalizacao`).
- `src/application/reclassificacao.ts`, `revalidacao.ts`, `auditoria.ts` — override manual, revalidação, log imutável.
- `src/infrastructure/nfe/*`, `sped/*`, `parsers/lote.ts` — parse/análise de NF-e XML, SPED e lote (CSV/XLSX).
- `src/infrastructure/exporters/relatorios.ts`, `pdf/*` — Excel/CSV/PDF e menu de exportação.
- `src/infrastructure/siscomex/ncm-sync.ts`, `cff/cff-sync.ts`, `receita/brasilapi.ts` — syncs e lookups externos (CFF por DFe, BrasilAPI CNPJ).
- `src/application/atualizacao.ts` + `electron/main.ts` (autoUpdater) — update do programa = renovação das bases.
- `src/store/*` (10 stores) — estado por domínio de tela; `src/pages/*` (7 páginas) + `src/ui/*` + `src/modais/*` — apresentação.
- `electron/*` — main, preload, `esbuild.mjs` (compila main+preload; `tsc` não inclui `electron/`).
- `scripts/build-base.mjs` — compilador das bases (3NF: 16 MB → ~1,5 MB úteis); `gen-seeds.cjs`, `gen-capitulos.cjs`, `gen-contrato.py`, `gen-licenca-rtf.py`, `reparar-encoding.mjs`, `kill-port.mjs`, `refazer-icone.py`.

## Design Decisions

| Decisão (PROJECT.md) | Reflexo no código |
|---|---|
| Electron sobre Tauri | `electron/main.ts` + `preload.ts` + `esbuild.mjs`; `electron-builder` (NSIS/portable win, dmg/zip mac, AppImage linux); menu nativo; single-instance. |
| Dexie sobre SQLite | `AurumDatabase` IndexedDB zero-config, índices por store, `bulkPut` 500, migrações preservando backups (`migrarBancoLegado`). |
| Zustand sobre Redux | 10 slices mínimos (`create<State>`), sem actions/reducers cerimoniais; acesso fora de componente via `getState()` (`main.tsx`, `store/base`). |
| Classificação client-side | Motores puros em `domain/services` (sem fetch de dados sensíveis); `rede:buscar-texto` só busca norma pública oficial. |
| Tailwind CSS | `@tailwindcss/vite` + `src/index.css`; tema claro/escuro com anti-flash inline em `index.html` + `TEMA_KEY='tema'` em localStorage. |
| Offline-first | Seed de `public/base` → Dexie no `iniciar()`; XMLs em `userData`; update de dados acoplado ao update do app (sem dependência de rede em runtime). |

## Gaps vs Roadmap

> Nota: `STATE.md` marca 0/22 plans (status `planning`), mas o código já implementa — na prática — grande parte das fases 1–4 e da calculadora. Abaixo, o que falta **relativo ao texto do ROADMAP**.

- **Fase 1 — Foundation & Data Layer:** base funcional (seed/import/Dexie/dashboard). Verificar explicitamente: importador CSV/XLSX oficial da Receita <5s (hoje o fluxo é JSON normalizado via `build-base`, não CSV/XLSX direto); persistência de tema/settings entre sessões (tema ok via localStorage; "último arquivo/configurações" confirmar).
- **Fase 2 — Classification Engine:** motor + override com justificativa + auditoria + validação de conflito implementados (`reclassificacao`, `audit_log`, `revalidacao`). Falta checagem formal: batch <2s em 100% da base; cobertura Anexo I (IS) × Anexo II (Imune/Isento) × fallback CBS+IBS conforme `02-01`.
- **Fase 3 — Search & UI:** busca por código/descrição/regime, filtros combinados, painel de detalhes e modal de edição existem. Confirmar pendências do plano: tabela **virtualizada** (react-window/virtuoso não está nas deps — checar implementação própria/limites `ROWS_LIMIT`/`RENDER_LIMITS`) e **atalhos de teclado** (Ctrl+K/Enter/Setas/Esc) + índices Dexie <100ms.
- **Fase 4 — Reporting & Export:** Excel/PDF/CSV + backup/restore existem (`exporters/relatorios`, `pdf/`, `backup`). Falta UAT dos critérios: layout Excel 3 abas (Detalhe/Resumo/Pendências), PDF com totais/alertas/rodapé data-versão, CSV-ERP (`;`, UTF-8, cabeçalho fixo), seção "Pendências" e portabilidade do backup.
- **Fase 5 — Calculadora Tributária:** calculadora, reduções, comparações, validações de anexos/vigência/revogação e update via app existem. Gaps prováveis: (a) resumo lateral com **cada redução explícita por item** (percentual + base legal + artigo); (b) **análise comparativa** quando há múltiplas classificações para o mesmo NCM (hoje o motor resolve um vínculo + fallback, sem tela de escolha); (c) validação de **vetos** dos anexos; (d) **atualização automática das bases na inicialização** — hoje é via update do programa, não fetch avulso (decisão arquitetural contrária ao critério 5.4; ROADMAP exige rever ou reescrever o critério); (e) testes de integração/UAT do fluxo completo.
