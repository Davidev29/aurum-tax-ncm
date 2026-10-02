# PLAN — Phase 6: Módulo IA Offline para Classificação NCM

**Phase:** 6
**Project:** Aurum Tax NCM (Aurum Bit Labs v1.0.0)
**Date:** 2026-09-30
**Status:** Planned
**Source:** Dossiê PLANO DE IMPLEMENTAÇÃO — MÓDULO DE IA (30/09/2026, Fases 0-9)
**Mode:** tracer-first (default)
**Depends on:** Phase 5 (Calculadora Tributária & Validação Avançada)

---

## 1. Goal

Dotar o Aurum Tax NCM de assistência semântica 100% offline (CPU x86_64/ARM64, sem GPU) que sugere NCM a partir de texto livre ruidoso, **como camada superior ao motor determinístico existente**, com:

* `classificarPorDescricao()` (`src/application/classificacao-inteligente.ts:141`) como caminho primário (tokenização + RGI + `buscarNomenclaturaPorTexto`); IA só aciona quando retorna `null` ou confiança `baixa` (meta `taxa_uso_ia < 30%`).
* LLM local (`AILO-152M-v2 GGUF q4_k_m` via `node-llama-cpp`) atuando **exclusivamente** como seletor probabilístico sobre Top-5 RAG.
* `resolverClassificacoes()` como única fonte de verdade tributária (`src/infrastructure/base/classificacao-repo.ts:223`).
* Falha segura `NÃO SEI` sob baixa similaridade/confiança.
* Artefatos (`modelo/`, `embedding/`, `indice-ncm/`) embutidos em NSIS/DMG/AppImage ≤300MB, protegidos por ofuscação + cifragem.
* Atualização legal sem retreino (reindex Vectra).
* Auditabilidade total (Dexie `audit_log` + `logs/*.jsonl`).

## 2. Non-negotiable Principles

1. RAG fechada: nunca sintetizar código; só escolher entre candidatos homologados de `public/base/`.
2. Validação determinística absoluta: nenhuma saída IA chega à UI sem `resolverClassificacoes`.
3. Falha segura: confiança insuficiente → `NÃO SEI`, sem código fictício.
4. Desacoplamento modelo-base: mudança legal = regenerar índice, não fine-tuning.
5. Auditabilidade: snapshot imutável por inferência (descrição, candidatos, decisão, hash temporal).
6. Segregação de rede: worker IA incapaz de abrir sockets externos.
7. Reaproveitamento: consumir `classificarPorDescricao` (`src/application/classificacao-inteligente.ts:141`), `montarClassificacao` (`src/domain/services/classificacao.ts:61`), `calcularTributos` (`src/domain/services/calculo.ts:45`), 7 telas, 37 suítes.
8. IA como camada superior: nunca substituir o caminho determinístico; só aciona quando confiança baixa/nula.

## 3. Requirements (IA-00..IA-10)

| ID | Requirement | Maps to dossiê |
|----|-------------|----------------|
| IA-00 | Spike viabilidade `node-llama-cpp` + `utilityProcess` no Electron 44 (GO/NO-GO), branch isolada, 3 OS | Fase 0.5 (nova) |
| IA-01 | Ambiente diagnosticado, `recursos-ia/` criado, `.gitignore` bloqueia `.gguf`/índice, `CHECKSUMS.txt` | Fase 0 |
| IA-02 | Base unificada `ncm-para-ia.json` com 2335 NCMs (somente NCM, sem NBS), paridade com `montarClassificacao` | Fase 1 |
| IA-03 | Índice Vectra <200MB, queries Frango vivo→cap.01 top-3, Notebook→84/85 top-5, rebuild por hash MANIFEST | Fase 2 |
| IA-04 | Modelo `ailo-152m-v2-q4_k_m.gguf` ~97MB íntegro, prompt restrito, <3s CPU, ~300MB RAM | Fase 3 |
| IA-05 | Worker `utilityProcess` isolado, IPC `ia:classificar`/`ia:status`, store `ia.ts`, `DebugIA.tsx` Ctrl+Shift+D, sem freeze UI | Fase 4 |
| IA-06 | Fluxo Consulta: determinístico primeiro → se `null`/baixa, Top5 → LLM → resolver → `calculo.ts` → Dexie + `.jsonl`, aba Sugestão IA com feedback | Fase 5 |
| IA-07 | `extraResources` + `asarUnpack`, `process.resourcesPath`, `afterPack`, 3 instaladores offline ≤300MB | Fase 6 |
| IA-08 | Ofuscação worker + cifragem GGUF em repouso + rename `aux.dat`/`idx/`, `seguranca-ia.md` | Fase 7 |
| IA-09 | Suites `tests/ia/*` 30 conhecidos +10 ambíguos +5 inválidos + bypass determinístico, ≥85%, zero alucinação, perf <5s/<500MB, 37 legadas verdes | Fase 8 |
| IA-10 | `arquitetura-ia.md`, `manual-atualizacao-ia.md`, `troubleshooting-ia.md`, `diagnostico-final-ia.md` + métrica `taxa_uso_ia`, ROADMAP/REQUIREMENTS encerrados | Fase 9 |

## 4. Tracer Slice (verify first)

**06-00 Spike GO/NO-GO (executar antes de tudo):** branch `spike/electron-llama`, `ia-spike-worker.cjs` + GGUF pequeno, round-trip via `utilityProcess` nas 3 VMs. Critérios: load <10s, IPC <50ms, sem órfãos. Doc `docs/spike-eletron-llama.md`. Se NO-GO → pivotar (CLI `llama.cpp` ou modelo menor), não seguir 06-01..06-10.

**06-05 Worker mínimo + resolver real (tracer funcional):**

`Consulta.tsx` → `classificarPorDescricao("frango vivo")` → se `null`/baixa → `window.aurum.ia.classificar()` → `ia-worker.cjs` (RAG mock Top-5 fixo numa 1ª iteração, depois Vectra real) → `classificacao-ia.ts` → `resolverClassificacoes()` → `DebugIA.tsx` (Ctrl+Shift+D) exibe candidatos + decisão validada + `taxa_uso_ia`.

Pass criteria: UI renderiza antes do modelo carregar; candidato válido exibido; worker morre em `before-quit`; nenhuma chamada de rede.

Só após tracer verde, expandir 06-06/06-07/06-08.

## 5. Plans

### 06-00 — Spike Viabilidade Técnica [IA-00] — GO/NO-GO antes de tudo
**Goal:** validar `node-llama-cpp` + `utilityProcess` no Electron 44 antes de comprometer o plano.
**Tasks:**
1. Branch isolada `spike/electron-llama` (descartável).
2. Instalar `node-llama-cpp`; `electron/spike/ia-spike-worker.cjs` mínimo carrega GGUF pequeno (ex. tinyllama-1b).
3. `electron/spike/ia-spike-main.ts`: spawn via `utilityProcess` pós-`whenReady()`, round-trip IPC `init`/`classificar`/`encerrar`.
4. Testar Win10, macOS, Ubuntu; medir load, RAM, latência IPC; `docs/spike-eletron-llama.md` com decisão GO/NO-GO + alternativa (CLI `llama.cpp` ou modelo menor).
**Verify:** load <10s; IPC <50ms; sem órfãos pós-quit; 3 OS OK. Se NO-GO → pivotar, não seguir 06-01.

### 06-01 — Diagnóstico e Preparação [IA-01]
**Goal:** fundação sem quebrar scripts de ciclo de vida.
**Tasks:**
1. Auditar `package.json`: electron@44, electron-builder@26, react@19, ts@5.9, vite@8, dexie@4, zustand@5, vitest@5 (`npm ls`).
2. Confirmar `utilityProcess` no Electron 44 (docs + spike `app.whenReady()`).
3. Criar `recursos-ia/{modelo,embedding,indice-ncm,dados-brutos}/` + `recursos-ia/README.md` (como recriar artefatos).
4. `.gitignore`: `*.gguf`, `recursos-ia/indice-ncm/`, `recursos-ia/embedding/*`, `logs/*.jsonl`.
5. `recursos-ia/CHECKSUMS.txt` inicial + `docs/diagnostico-fase-0.md`; atualizar `.planning/STATE.md`.
**Verify:** `npm ls` versões exatas; `git check-ignore` bloqueia `.gguf`; dir tree OK.
**Checkpoint:** decision `recursos-ia/` fora de `public/` (one-way: afeta `extraResources`) — requer confirmação.

### 06-02 — Curadoria de Dados [IA-02]
**Goal:** fonte única offline sem ingestão externa, somente NCM.
**Tasks:**
1. `scripts/preparar-dados-ia.mjs`: ler `public/base/reforma.json`, `nomenclatura.json`, `classificacao-tributaria.json`, `MANIFEST.json`; join por código; reutilizar `montarClassificacao` para paridade; expandir descrição (descrição + capítulo + sinônimos comerciais); filtrar somente NCM de 8 dígitos (excluir NBS e os 10 códigos de 9 dígitos ignorados no MANIFEST); cruzar 6 NCM sem nomenclatura em `notas`.
2. `scripts/validar-dados-ia.mjs`: unicidade código, completude `codigo,descricao,capitulo`, integridade `cClassTrib`, contagem = 2335 NCMs válidos, amostragem 5 vs tabela vigente.
3. Emitir `recursos-ia/dados-brutos/ncm-para-ia.json` + `docs/diagnostico-fase-1.md`.
**Verify:** exit 0; contagem; amostragem manual documentada.

### 06-03 — Índice Vetorial RAG [IA-03]
**Goal:** busca semântica <ms.
**Tasks:**
1. `npm i --save-dev @xenova/transformers vectra` (depois `npm i` prod na 06-05).
2. Baixar `all-MiniLM-L6-v2` (fallback `multilingual-e5-small`) em `recursos-ia/embedding/`.
3. `scripts/gerar-indice-ia.mjs`: descrições expandidas → embeddings → Vectra em `recursos-ia/indice-ncm/`.
4. `scripts/testar-indice-ia.mjs`: Frango vivo→01, Arroz branco→10, Notebook→84/85 (somente capítulos NCM, sem casos NBS).
5. Gatilho em `scripts/build-base.mjs`: se hash MANIFEST mudou → rebuild índice.
**Verify:** top-k asserts; `du` <200MB; gatilho testado com MANIFEST tocado.
**Prohibition:** MUST NOT versionar índice/embedding (test: `git status --porcelain` limpo após generate).

### 06-04 — Modelo de Linguagem [IA-04]
**Goal:** raciocínio restrito leve.
**Tasks:**
1. Adquirir `ailo-152m-v2-q4_k_m.gguf` (~97MB) em `recursos-ia/modelo/`; SHA256 → `CHECKSUMS.txt`.
2. `scripts/testar-modelo-ia.mjs` via `node-llama-cpp`: prompt rígido "escolha 1 entre [candidatos] ou NÃO SEI; nunca invente código".
3. Medir latência <3s CPU moderna (teto 5s x86_64 básico), RAM ~300MB.
4. `docs/diagnostico-fase-3.md`.
**Verify:** restrição 100% (só candidato ou NÃO SEI); tempo/RAM logados.

### 06-05 — Integração Electron [IA-05] — TRACER
**Goal:** isolamento sem freeze UI.
**Tasks:**
1. `npm i node-llama-cpp @xenova/transformers vectra` (prod).
2. `electron/ia/ia-worker.cjs` (esbuild-compat): handlers `init`, `buscar`, `selecionar`, `encerrar`.
3. `electron/ia/ia-service.cjs`: spawn `utilityProcess` pós-`whenReady()`.
4. `electron/main.ts`: `ia:classificar`, `ia:status`, kill em `before-quit`.
5. `electron/preload.ts`: `window.aurum.ia.classificar` via `contextBridge`.
6. `src/store/ia.ts` (Zustand): `status, ultimaSugestao, candidatos, confianca`.
7. `src/application/classificacao-ia.ts`: gate determinístico primeiro (`classificarPorDescricao` → se `ncm_provavel` + confiança alta, retorna direto) → senão RAG → LLM → `resolverClassificacoes`.
8. `src/pages/DebugIA.tsx` em `Ctrl+Shift+D` + `docs/diagnostico-fase-4.md`.
**Verify:** console `modelo carregado`; UI interativa <500ms; worker ausente pós-quit (`ps`); teste rede bloqueada.
**Prohibition:** MUST NOT `fetch`/`net.connect` no worker (grep + test).

### 06-06 — Fluxo Consulta Completo [IA-06]
**Goal:** IA como camada superior na tela Consulta (determinístico primeiro).
**Tasks:**
1. `src/infrastructure/ia/classificacao-ia-repo.ts`: `classificarPorDescricao` → se alta confiança, usa direto; senão Top5 → LLM → `resolverClassificacoes` → `calcularTributos` (IBS/CBS/cClassTrib); registra `via: deterministico|ia` no audit.
2. `src/pages/Consulta.tsx`: aba “Sugestão IA” só aparece quando IA foi acionada (badge `via IA` vs `determinístico`), lista candidatos auditável, reuso painel cálculo, feedback “Não é esse”.
3. `src/store/consulta.ts`: worker IA em paralelo a exato/descritivo/preditivo, mas só invocado no fallback (guards `seq*` existentes).
4. Dexie v8→v9: tabela `ia_feedback` (`via`, `confiancaDet`, `taxa_uso_ia`) + `logs/consultas-ia.jsonl` append.
5. `docs/diagnostico-fase-5.md` com 10 testes negócio (5 resolvidos no determinístico sem IA + 5 fallback IA).
**Verify:** descrição fácil → `via: deterministico`, sem chamada worker (mock prova); difícil → `via: ia` + carimbo resolver; incoerente → sem código; `audit_log` cronológico com `via`.
**Checkpoint:** migration Dexie v8→v9 (one-way) — backup/rollback test obrigatório.

### 06-07 — Empacotamento [IA-07]
**Goal:** instalador autosuficiente offline.
**Tasks:**
1. `package.json` build: `asar:true`, `extraResources` `recursos-ia/**`, `asarUnpack` `node-llama-cpp`, `@xenova/transformers`.
2. Resolver paths via `process.resourcesPath` (dev `public/base` vs prod `resources/`).
3. `scripts/build-base.mjs`: reindex se base mudou; `afterPack`: `validar-dados-ia.mjs`.
4. `npm run dist:win|dist:mac` + AppImage; teste VM limpa Win10/macOS/Ubuntu sem internet.
**Verify:** 3 OS boot + consulta offline; `≤300MB`; sniff zero rede no boot.

### 06-08 — Proteção [IA-08]
**Goal:** anti-cópia trivial.
**Tasks:**
1. `scripts/ofuscar-ia.cjs` (`javascript-obfuscator`) no `ia-worker.cjs` no pack.
2. `scripts/criptografar-modelo-ia.mjs`: cifrar `.gguf` (`crypto`/`safeStorage`); worker descriptografa em stream memória, nunca em disco.
3. Rename: `modelo.gguf→assets/aux.dat`, `indice-ncm/→assets/idx/`.
4. `docs/seguranca-ia.md` (threat model + limites desktop).
**Verify:** `strings aux.dat` sem header GGUF; IA responde cifrada; doc lista limites.

### 06-09 — Testes e Observabilidade [IA-09]
**Goal:** regressão + telemetria com bypass provado.
**Tasks:**
1. `tests/ia/classificacao-ia.test.ts`: 30 conhecidos +10 ambíguos (espera NÃO SEI) +5 inválidos.
2. `tests/ia/validacao-deterministica.test.ts`: mock LLM alucinando `99999999` → bloqueado por resolver.
3. `tests/ia/bypass-deterministico.test.ts` (novo): descrições que `classificarPorDescricao` resolve com alta confiança → worker IA NÃO é chamado (mock `ia:classificar` conta 0 chamadas).
4. `tests/ia/performance.test.ts`: p95 <5s, RSS <500MB.
5. `DebugIA.tsx` (Ctrl+Shift+D): totais, `taxa_uso_ia = consultas_ia / consultas_total` (meta <30%), aceitação, taxa nula, últimos 20 logs; `logs/metricas-ia.jsonl`.
6. `docs/diagnostico-fase-8.md`; `npm test` 37+4 verdes.
**Verify:** ≥85% acerto; zero código fora base; bypass 100% nos casos fáceis; dashboard persiste após 20 consultas lote com `taxa_uso_ia` calculada.

### 06-10 — Documentação e Entrega [IA-10]
**Goal:** manutenibilidade por terceiro.
**Tasks:**
1. `docs/arquitetura-ia.md` (Determinístico → fallback IA → Worker → Domínio → UI; diagrama camada superior).
2. `docs/manual-atualizacao-ia.md` (reindex sem retreino, build, updater).
3. `docs/troubleshooting-ia.md` (tensores, índice corrupto, paths).
4. `docs/diagnostico-final-ia.md` (evidências 10 plans + spike GO/NO-GO + `taxa_uso_ia`); encerrar `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`.
**Verify:** terceiro gera instalador só pelo manual (UAT); checklist final §12 do dossiê 12/12.

## 6. File Map (create / patch)

**Create:** `recursos-ia/`, `scripts/preparar-dados-ia.mjs`, `validar-dados-ia.mjs`, `gerar-indice-ia.mjs`, `testar-indice-ia.mjs`, `testar-modelo-ia.mjs`, `ofuscar-ia.cjs`, `criptografar-modelo-ia.mjs`, `electron/ia/*`, `electron/spike/*`, `src/store/ia.ts`, `src/application/classificacao-ia.ts`, `src/infrastructure/ia/classificacao-ia-repo.ts`, `src/pages/DebugIA.tsx`, `tests/ia/*` (incl. `bypass-deterministico.test.ts`), `docs/spike-eletron-llama.md`, `docs/diagnostico-fase-*.md`, `arquitetura-ia.md`, `seguranca-ia.md`.
**Patch:** `package.json` (deps + builder), `electron/main.ts`, `preload.ts`, `esbuild.mjs`, `scripts/build-base.mjs`, `src/pages/Consulta.tsx`, `src/store/consulta.ts`, `src/infrastructure/db/schema.ts` (v9), `.gitignore`, `.planning/*`.

## 7. Verification Loop

Per-plan: unit/integration asserts acima + `tsc --noEmit` + `vitest run <suite>` + `npm test` final.
Gates: spike 06-00 GO antes de 06-01; tracer 06-05 verde antes de 06-06; bypass determinístico verde em 06-09; migration v9 com rollback test; pack ≤300MB; `taxa_uso_ia` <30% em lote de 20; sniff rede; UAT terceiro no 06-10.
Nyquist/security: segredo nenhum em repo; GGUF nunca commitado; worker sem rede; PII fiscal só local.

## 8. Risks

* `node-llama-cpp` nativo × Electron 44 / esbuild — mitigar com spike 06-00 + `asarUnpack` + teste 3 OS cedo (06-05).
* Tamanho >300MB — monitorar `embedding/` + índice desde 06-03.
* RAM >500MB / >5s em CPU fraca — fallback Top-1 RAG sem LLM + `NÃO SEI` agressivo.
* NBS permanece explicitamente fora de escopo — nenhum dado, teste ou UI para NBS neste módulo.

## 9. Acceptance (dossiê §12)

12/12: 3 instaladores offline; zero rede; 100% via resolver; NÃO SEI sem alucinação; trilha Dexie+jsonl com `via`; ≥85%; bypass determinístico; `taxa_uso_ia` <30%; update sem retreino; ofuscação+cifra; worker extinto; ≤300MB; 37 suítes verdes; resolver única verdade.

---

*Next: `/gsd-execute-phase 6` onda 1 (06-01→06-04), depois tracer 06-05.*
