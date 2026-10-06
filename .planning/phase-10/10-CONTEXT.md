# CONTEXT — Phase 10: Grafo Fiscal Híbrido (LadybugDB + KGLite)

**Date:** 2026-10-05
**Flow:** gsd-discuss-phase → decisão usuário 4/4
**Depends on:** Phase 6 (IA offline), Phase 7 (NBS/CNAE), Phase 8 (dispatcher/memória), Phase 9 (CNAE→NBS 508)

## Decisões travadas (não re-discutir)

| # | Decisão | Rationale |
|---|---------|-----------|
| 1 | **LadybugDB no runtime + KGLite no tooling** | LadybugDB = sucessor ativo do Kuzu (fork revival 2025-10-07, MIT, mesma API Cypher, npm `@ladybugdb/core` com prebuilds, FTS BM25 + HNSW + PageRank/Louvain num `.lbug` só). KGLite = engine Python/Rust p/ agentes (`pip install kglite`, `describe()` p/ system prompt, MCP server bundlado, `.kgl` portátil). Electron = Node, não Python — KGLite como sidecar quebraria offline-first/latência. |
| 2 | **Grafo no `utilityProcess` + IPC** | IA já roda isolada em `electron/ia/ia-worker.cjs` (Qwen3.5-2B, pin em `modelo.json`, hot-swap, nunca no renderer — `node-llama-cpp` crasha em renderer). Grafo no mesmo worker: Cypher sem travar UI, `.lbug` em `%APPDATA%/Aurum Tax NCM/grafo/` + fallback `extraResources/recursos-ia/grafo/`, consulta via `bridge.ia.grafoConsultar` → `ipcRenderer.invoke('ia:grafo')`. Rejeitado: WASM no renderer (compete com UI, infla bundle) e main process (trava janela). |
| 3 | **Escopo Full GraphRAG** | Não só tracer fiscal: schema completo NCM→família→CCT→Anexo→Artigo + CNAE→NBS, retrieval híbrido (FTS+vetor+traversal+PageRank), chat+lote+XML, trilha `via:grafo`. 7 plans (10-00…10-06). |
| 4 | **Vetor já nesta fase** | `recursos-ia/embedding/` hoje vazio (Vectra nunca executado offline). Fase 10 embarca `all-MiniLM-L6-v2` uma vez (~90MB, instalador ~120MB→~210MB) + HNSW nativo LadybugDB. Mitigação: download uma vez no build, `CHECKSUMS.txt`, fallback FTS-puro se embedding ausente (tracer prova os dois modos). |
| 5 | **Overlay de aprendizado local (GRAFO-08)** | Arquivo só na máquina do usuário (`%APPDATA%/Aurum Tax NCM/grafo/aprendizado.*`, minificado, só worker IA + grafo leem). Camada mutável separada da base congelada: arestas `origem: uso_local` (termo preferido, classificação escolhida, CNAEs da carteira). Score = base + boost pessoal. Job incremental ao abrir + ocioso (<1s), nunca rebuild diário do grafo inteiro. Travas: `ia_feedback` negativado demoteia, teto de peso, TTL 90d, teto de tamanho, resolvedor com veto (aprendizado reordena, nunca cria redução). Rollback = apagar overlay → base bit-idêntica. |

## Princípios não-negociáveis

1. **Resolvedor única verdade:** grafo propõe candidatos + caminhos; alíquota/benefício só de `resolverClassificacoes`/`resolverClassificacoesNbs` + `calcularTributos`. Sem lastro → `sem-lastro-reforma` / NÃO SEI, nunca redução inventada.
2. **Grafo como referência, não substituto:** pipeline vira `determinístico → grafo (FTS+Cypher+vetor) → LLM local → resolvedor → audit`. `taxa_uso_ia` + nova métrica `taxa_uso_grafo` no DebugIA. Fallback total se `.lbug` ausente/corrompido.
3. **Offline-first + Dexie intacta:** grafo é índice derivado, não fonte primária. `npm run base` gera `.lbug`; Dexie v13+ só ganha `grafometa` (hash/versão), nenhuma store fiscal removida.
4. **Proveniência por aresta:** toda relação carrega `{origem: por_codigo|triangulado|heranca|curadoria, confianca, anoReferencia}`. Ponte `qualclasstrib` segue marcada não-oficial.
5. **Fail-closed + audit:** `via: grafo|deterministico|ia|grafo+ia`, `graphPaths[]` + `cypher` executado em `audit_log` + `logs/consultas-ia.jsonl`. `Ctrl+Shift+D` mostra caminhos.
6. **Aprendizado local com travas:** overlay `uso_local` só reordena candidatos (boost), nunca precifica; demote por `ia_feedback`, teto de peso, TTL 90d, teto de tamanho; PII fiscal nunca sai da máquina.

## Fora de escopo (defer)

- Neo4j/servidor externo, SaaS, multi-tenancy.
- Modelo oficial Qwen3.5-2B fixado (pin `modelo.json`); grafo alimenta o novo modelo com ctx 4096.
- SPED ganha tela (segue sem UI dedicada).

## Métricas de aceite

- `tsc 0 + npm test` verde (incl. 22 chaos grafo ≥85%).
- Tracer 10-00 GO: Cypher multi-hop <50ms CPU, FTS+traversal sem rede, fallback sem `.lbug` = comportamento atual.
- Consulta difícil hoje-lexical resolve via grafo com caminho auditável; `via:grafo` em trilha.
