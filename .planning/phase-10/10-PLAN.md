# PLAN — Phase 10: Grafo Fiscal Híbrido (LadybugDB + KGLite)

**Phase:** 10 · **Project:** Aurum Tax NCM 1.0.0 · **Date:** 2026-10-06
**Status:** Planned (gsd-plan-phase) · **Mode:** tracer-first
**Source:** pedido usuário + 10-CONTEXT.md + 10-RESEARCH.md
**Depends on:** Phase 6/7/8/9

---

## 1. Goal

A Aurum AI passa a consultar um **grafo fiscal local como base e referência**: cada resposta difícil traz candidatos + caminho multi-hop auditável (`NCM→SH6→SH4→Cap→CCT→Anexo→Artigo`, `CNAE→NBS→CCT`), ranqueado por FTS BM25 + vetor HNSW + PageRank, **sempre revalidado pelo resolvedor** (`via:grafo` em trilha). KGLite espelha o mesmo schema em Python p/ curadoria, `describe()` e MCP de agentes dev. Tudo 100% offline, com fallback total ao comportamento atual.

## 2. Non-negotiable Principles

1. Resolvedor única verdade; grafo propõe, nunca precifica.
2. `via:grafo` auditável (`cypher` + `graphPaths[]` em `audit_log` + `.jsonl` + DebugIA).
3. Offline-first; Dexie fiscal intacta; grafo é índice derivado rebuildado por hash do `MANIFEST.json`.
4. Proveniência por aresta (`por_codigo|triangulado|heranca|curadoria` + `confianca` + `anoReferencia`).
5. Fail-closed: sem `.lbug`/sem embedding → FTS-puro → lexical atual → NÃO SEI. Nunca mock silencioso.
6. Build blindado: `asarUnpack` do nativo + `after-pack-ia.cjs` + `verificar-build.mjs` estendido.

## 3. Requirements (GRAFO-01..07)

| ID | Requirement | Arquivo-alvo |
|---|---|---|
| GRAFO-01 | Schema + build: `schema.cypher` + `scripts/build-grafo.mjs` gerando `grafo.lbug` via `npm run base`, MANIFEST.grafo, Dexie `grafometa` | `scripts/build-grafo.mjs`, `scripts/grafo/schema.cypher`, `base-service.ts`, `schema.ts`, `MANIFEST` |
| GRAFO-02 | Runtime no worker: `electron/ia/grafo-service.cjs` + `ia:grafo` IPC + `bridge.ia.grafoConsultar`, FTS+traversal (<50ms), fallback sem `.lbug` | `electron/ia/*`, `electron/main.ts`, `preload.ts`, `src/infrastructure/bridge.ts` |
| GRAFO-03 | Retrieval híbrido: FTS seeds + HNSW (all-MiniLM-L6-v2, 384-d) + expansão 2-hops + PageRank/Louvain rerank + `taxa_uso_grafo` | `grafo-service.cjs`, `scripts/gerar-embeddings.mjs`, `store/ia.ts`, `pages/DebugIA` |
| GRAFO-04 | KGLite tooling: `build-grafo-kglite.py` (mesmo schema → `.kgl`), audit scorecard, `describe()` → `system_prompt.txt` + catálogo, MCP dev, `codingest` code graph | `scripts/grafo/*`, `finetune_*/system_prompt.txt`, `recursos-ia/conhecimento/catalogo-rag.json` |
| GRAFO-05 | Consumo: `classificarComIa` + chat + lote + XML usam grafo primeiro (`via:grafo`), fichas absolutas enriquecidas com caminho, UI exibe trilha | `classificacao-ia*.ts`, `aurum-ai-chat.ts`, `classificacao-repo.ts`, `ui/*`, `Consulta*.tsx` |
| GRAFO-06 | Vetores offline: `recursos-ia/embedding/` versionado por hash, `CHECKSUMS.txt`, `extraResources`, modo FTS-puro se ausente | `scripts/*`, `recursos-ia/`, `package.json` (build), `after-pack-ia.cjs` |
| GRAFO-07 | Chaos 22 + docs + UAT: multi-hop, proveniência, ano 2026/27/33, degradação, `tsc 0 + npm test` ≥85% | `tests/grafo-*.test.ts`, `docs/grafo-*.md`, `ROADMAP/REQUIREMENTS` |
| GRAFO-08 | Overlay de aprendizado local: arquivo só-na-máquina (`aprendizado.*`), arestas `uso_local`, score base+boost com teto, travas (demote/TTL/teto/resolvedor-veto), job ao abrir+ocioso, rollback por apagamento | `electron/ia/grafo-service.cjs`, `%APPDATA%/grafo/`, `ia_feedback`, `ui/*` ("por que sugeriu") |

## 4. Tracer Slice (10-00 — executar antes de tudo, GO/NO-GO)

- **10-00:** `@ladybugdb/core` abre no Node 20 (proxy do `utilityProcess`); schema mínimo (`NCM→SH6→CCT→Anexo` + `CNAE→NBS`, ~20 nós de `0201.10.00`/`122011100`/`0161-0/01`); FTS BM25 acha seed por texto livre ("carne bovina"); Cypher 2-hops retorna caminho + `resolverClassificacoes` confirma `000001`; sem `.lbug` → `ok:false` → fallback lexical (teste prova).
- **Pass criteria:** `node spike OK`, Cypher <50ms, `tsc 0`, 3 testes tracer verdes, decisão GO/NO-GO do nativo registrada. Só após verde, 10-01…10-06.

## 5. Plans

### 10-01 — Schema + build do grafo [GRAFO-01]
**Goal:** `npm run base` gera `grafo.lbug` versionado.
**Tasks:** 1. `scripts/grafo/schema.cypher` (nós/rels §3 RESEARCH + índices FTS). 2. `scripts/build-grafo.mjs`: lê `public/base/*.json` + `conhecimento/*` → CSVs → LadybugDB → `public/base/grafo/grafo.lbug` + `MANIFEST.grafo`. 3. Dexie `grafometa` (hash/versão/contadores) + `statusBase` exibe `grafo: X nodos/Y arestas`. 4. `build-base.mjs` chama build-grafo; `verificar-build` confere hash.
**Verify:** `npm run base` verde; MANIFEST.grafo com stats; rebuild só quando hash muda; `grafo-base.test.ts` (dedupe, PK, proveniência, revogado filtrado).
**Prohibition:** MUST NOT `clear()` stores fiscais; MUST NOT embutir `.lbug` no bundle JS (só `extraResources` + userData).

### 10-02 — Runtime no worker + IPC [GRAFO-02]
**Goal:** Cypher no `utilityProcess` via novo canal.
**Tasks:** 1. `electron/ia/grafo-service.cjs`: open read-only, `grafoConsultar({texto,k,ano})` (FTS+2-hops nesta plan; vetor entra em 10-03). 2. `ia-service.cjs` orquestra + `main.ts` registra `ia:grafo` + `caminhos-ia.cjs` resolve userData vs extraResources. 3. `preload.ts` + `bridge.ts`: `ia.grafoConsultar`. 4. `asarUnpack` + `after-pack-ia.cjs` + `verificar-build.mjs`. 5. [GRAFO-08] Abre/cria `aprendizado.*` em `%APPDATA%/grafo/` (nasce vazio; checksum + rollback por apagamento).
**Verify:** instalador abre sem `.lbug` (fallback), com `.lbug` responde <50ms; `tsc 0`; `grafo-ipc.test.ts`.
**Prohibition:** MUST NOT `require('@ladybugdb/core')` no renderer/main quente; MUST NOT falhar aberto.

### 10-03 — Retrieval híbrido + vetores [GRAFO-03, GRAFO-06]
**Goal:** FTS + HNSW + PageRank; embedding embarcado.
**Tasks:** 1. `scripts/gerar-embeddings.mjs` (Xenova all-MiniLM-L6-v2 1×, 384-d, `CHECKSUMS.txt`) → `COPY` p/ LadybugDB + `CREATE VECTOR INDEX`. 2. `grafoConsultar` vira 4 estágios (FTS seeds + HNSW seeds + expansão + PageRank rerank + Louvain scoping). 3. `store/ia.ts` + DebugIA: `taxa_uso_grafo`, `graphPaths`, `cypher`. 4. Modo FTS-puro se embedding ausente. 5. [GRAFO-08] Scoring `score_final = score_base + min(boost_uso, TETO)` (overlay `uso_local`; TTL 90d + teto de tamanho + demote por `ia_feedback`; formato `.lbug` ou `.jsonl` minificado — decidir pelo volume).
**Verify:** consulta "aula de inglês online" acha NBS via vetor onde lexical falha; benchmark <2s CPU; `grafo-hibrido.test.ts`.
**Prohibition:** MUST NOT baixar embedding em runtime; MUST NOT exibir score vetorial como confiança fiscal (só ranking).

### 10-04 — KGLite tooling + MCP [GRAFO-04]
**Goal:** mesmo schema em Python p/ agentes.
**Tasks:** 1. `scripts/grafo/build-grafo-kglite.py` (`pip install kglite`) → `grafo.kgl` + audit scorecard + gate. 2. `describe()` → atualiza `finetune_*/system_prompt.txt` + `catalogo-rag.json`. 3. `kglite-mcp-server --graph grafo.kgl` documentado p/ dev; `codingest .` → `code.kgl` do `src/`.
**Verify:** `python build-grafo-kglite.py --check` verde; `describe()` contém nós fiscais; MCP responde `graph_overview`.
**Prohibition:** MUST NOT importar `.kgl` no app; MUST NOT vazar PII p/ MCP remoto (só stdio local).

### 10-05 — Consumo pela IA + UI [GRAFO-05]
**Goal:** `via:grafo` de ponta a ponta.
**Tasks:** 1. `classificarComIa`/`classificarComIaServicos`: grafo antes do Top-20 lexical; fichas com `caminho[]`. 2. Chat tools `grafoConsultar` + dispatcher; lote/XML usam caminho p/ desempate multi-opção. 3. UI: badge `via:grafo`, modal trilha (cypher+caminho+proveniência), relatório IA cita caminho. 4. [GRAFO-08] Escritores do overlay (escolha em `<select>` lote/consulta, `ia_feedback` ±, CNAE via CNPJ) + job incremental ao abrir + ocioso (<1s) + UI "por que sugeriu" (`base + seu uso`, com `boost: uso_local`).
**Verify:** NCM multi-opção escolhe via caminho; trilha contém cypher; `ia-grafo.test.ts` + suites legadas verdes.
**Prohibition:** MUST NOT trocar `resolverClassificacoes`; MUST NOT exibir caminho sem proveniência; MUST NOT overlay criar redução (só reordena).

### 10-06 — Chaos + docs + UAT [GRAFO-07]
**Goal:** ≥85% + aceite.
**Tasks:** 22 chaos (multi-hop, herança vs vínculo, CNAE 98-NBS, anos, sem-.lbug, embedding ausente, mojibake, caminho errado, rollback Dexie, degradação + overlay: boost com teto, demote por feedback negativo, TTL/expiração, overlay corrompido → base intacta, overlay apagado → bit-idêntico). Docs `docs/grafo-*.md` + UAT 5/5 + ROADMAP/REQUIREMENTS.
**Verify:** `tsc 0 + npm test` verde, chaos ≥85% documentado, UAT assinado.

## 6. Checkpoint & Rollback

- Migração Dexie só aditiva (`grafometa`); `.lbug` apagável sem perda (rebuild).
- Rollback: apagar `grafo.lbug` + flag `grafo:false` → comportamento pré-grafo bit-identico (teste 10-00 trava isso).
