# RESEARCH — Phase 10: Grafo Fiscal Híbrido (LadybugDB + KGLite)

**Date:** 2026-10-06
**Source:** websearch 2026 + subagent mapeamento IA/RAG + verificação local
**Depends on:** 10-CONTEXT.md

## 1. Tecnologias — fatos verificados

### LadybugDB (runtime do app)
- **O quê:** fork revival do Kuzu (Kuzu arquivado out/2025 após aquisição Apple; fork `LadybugDB/ladybug` criado 2025-10-07, 1.7k stars, MIT, ativo set/2026). Slogan "DuckDB for graphs".
- **Modelo:** property graph + Cypher, embarcado in-process, sem servidor; storage colunar em disco + CSR adjacency, execução vetorizada, joins novel, multi-core, ACID serializável.
- **Retrieval nativo (1 arquivo `.lbug`, 1 query language, 1 transação):** HNSW vector index (cosine/L2), FTS BM25, Cypher pattern + variable-length traversal + shortest path, algoritmos (PageRank, Louvain, connected components).
- **Instalação:** `npm install @ladybugdb/core` (Node, prebuilds via prebuildify — sem download step, bom p/ Electron); `pip install ladybug` (Python); `brew install ladybug` / CLI; WASM bindings p/ browser.
- **Docs:** `docs.ladybugdb.com` (schema: `CREATE NODE TABLE City(name STRING PRIMARY KEY, ...)`, `CREATE REL TABLE Follows(FROM User TO User, ...)`, `COPY ... FROM csv`, `MATCH ... RETURN`); blog 2026-04-03 "Hybrid Graph RAG with LadybugDB" (4 modos → 4 estágios GRAG).
- **Por que não Kuzu direto:** repo `kuzudb/kuzu` arquivado, banner "no longer actively supporting", sem extension server oficial. LadybugDB é o único sucessor viável com enterprise support.

### KGLite (tooling Python/Rust p/ agentes)
- **O quê:** engine Cypher embarcada Rust (`pip install kglite`, Py≥3.10, zero deps runtime, wheels win/mac/linux, 0.18.0 set/2026, MIT). Design centre in-memory, modos mmap/disk até ~861M edges.
- **Agent surface (o diferencial):** `describe()` — schema progressive-disclosure p/ system prompt (janela LLM); MCP server bundlado no wheel (`kglite-mcp-server --graph x.kgl` → tools `cypher_query`, `graph_overview`, schema introspection, validators + `source_root` read/search); `kglite-visual` serve `.kgl` no browser E fala MCP na mesma porta (agente dirige a janela).
- **Semântica honesta:** subset openCypher documentado (NULL 3-valued), contratos locais + differential Neo4j opcional; `define_ontology` + audit scorecard + build gate (data-quality).
- **Companheiros:** `codingest` (codebase → code graph, 14 langs), `kglite-datasets` (SEC/Wikidata/Sodir), `sonagram`, `kglite-visual`. Comparativo oficial: KGLite × LadybugDB × NetworkX × rustworkx × Neo4j-embedded (KGLite vence em MCP+describe+embed Rust puro; LadybugDB vence em colunar/analítico).
- **Papel no Aurum:** curadoria/CI Python (`finetune_*`, `build_dataset.py`): construir `.kgl` fiscal, rodar `audit scorecard`, exportar `describe()` p/ `system_prompt.txt` do Qwen, servir MCP p/ agentes dev (`codingest` p/ code graph do `src/`). Nunca no runtime Electron.

### GRAG híbrido (padrão 5 passos, <300 linhas Python no artigo)
1. Ingerir docs → KG (nós + rels tipadas). 2. Indexar vetores HNSW + FTS BM25. 3. Entrada semântica (vetor acha seeds). 4. Expansão estrutural (Cypher 2-hops junta contexto). 5. Ranking importância (PageRank) + scoping comunidade (Louvain) → `build_context()` p/ LLM. Sem glue code entre sistemas.

## 2. Sistema atual — o que reutilizar (file:line)

- **Gate determinístico→IA:** `src/application/classificacao-ia.ts:424` (`classificarComIa`), `:483` Top-20 `buscarNomenclaturaPorTexto`, `:515` `bridge.ia.classificar`, `:657` validação resolvedor (alucinado morre aqui). Gêmeo NBS `classificacao-ia-servicos.ts:244`.
- **RAG lexical Dexie:** `src/infrastructure/base/classificacao-repo.ts:181` (`buscarNomenclaturaPorTexto`, Fase1 AND + Fase2 OR), `:295` `resolverClassificacoes` (única verdade), `:413` `resolverPorFamilia` (`between(prefixo…)` + unanimidade — vira arestas no grafo), `:627/:718` NBS.
- **Worker isolado:** `electron/ia/ia-worker.cjs:602` (`selecionarReal`, GBNF, `temperature:0`), `:288` BM25-lite, `:946` `buscar`, `:970` `classificar=buscar+selecionar`; `ia-service.cjs:269` (`classificarViaIa`, nunca mock silencioso); `caminhos-ia.cjs:70` (prod vs dev); `preload.ts:116` (`ia:{classificar,buscar,status,conversar}` — estender com `grafoConsultar`).
- **Índice lexical vivo:** `recursos-ia/indice-ncm/indice-lexical.json` (`lexical-v2`, 2335 docs) via `scripts/gerar-indice-ia.mjs:278` (`pesos dicionario4>nomenclatura3>cap2>vinculo1`, BM25-lite `:312`); fonte `dados-brutos/ncm-para-ia.json` via `preparar-dados-ia.mjs:64` (join 3NF, `EXPECTED_NCM=2335`); curadoria `recursos-ia/conhecimento/*` (sinônimos, marcas, erros-comuns, dicionário, PT-EN, lc214-artigos, catálogo 13 fontes).
- **Embeddings ausente:** `recursos-ia/embedding/` vazio; `gerar-indice-ia.mjs:387` `tentarIndiceVetorial` (Xenova/all-MiniLM-L6-v2, NÃO TESTADO OFFLINE).
- **Limitações que o grafo mata:** herança por prefix-string (`regras-hierarquicas.ts:114`, limiares SH6 0.6/SH4 0.75/cap 0.95, só 15.9% vínculo exato, 7 caps curados); CNAE→NBS ponte não-oficial (`normalizacao.ts:604` 508 + `:675` triangulação que NÃO vira link); anexos sem nó (regex `extrairAnexoDoNome`, `ROTULO_CURTO_CCT` hardcode, hipótese Art.135/137 por flag capítulo); 3 lookups desconexos (ncm/nbs/cnae).

## 3. Desenho de integração (melhor maneira)

**Schema fiscal (nós + rels, PK explícita — exigência LadybugDB):**
`NCM(codigo PK8, descricao, vigente) -[:PERTENCE_A]-> SH6(6) -> SH4(4) -> Capitulo(2) -> Secao`
`NCM -[:TEM_CLASSIFICACAO {origem, confianca}]-> CCT(codigo PK) -[:REDUZ {redIBS,redCBS}]-> Anexo(nome PK) -[:FUNDAMENTA_EM]-> ArtigoLC214(numero PK)`
`CNAE(codigo PK7) -[:MAPEIA {origem: por_codigo|triangulado, confianca}]-> NBS(codigo PK9) -[:TEM]-> CCT`
`Termo(termo PK) -[:SINONIMO_DE {peso}]-> NCM|NBS` (derivado de `sinonimos.json`, `dicionario.json`, `pesos.json`).

**Build:** `npm run base` estendido → `scripts/build-grafo.mjs` lê `public/base/*.json` + `recursos-ia/conhecimento/*` → emite `schema.cypher` + CSVs + `grafo.lbug` (via `@ladybugdb/core` em Node) + `MANIFEST.grafo {nodos, arestas, hash, embedding: all-MiniLM-L6-v2|ausente}`. Vetores: `all-MiniLM-L6-v2` (Xenova, 384-d) gravado como `FLOAT[384]` + `CREATE VECTOR INDEX`. Fallback sem embedding: FTS+traversal puro.

**Runtime:** `electron/ia/grafo-service.cjs` (novo, ao lado de `ia-service.cjs`): abre `.lbug` read-only, expõe `grafoConsultar({texto, k, anoReferencia})` → (a) FTS BM25 seeds, (b) vetor HNSW seeds (se índice presente), (c) Cypher expansão 2-hops + PageRank rerank, (d) retorna `{candidatos[], caminhos[], cypher, tempoMs}`. `ia-service.cjs` orquestra `grafo→fichas→LLM→resolvedor`; `main.ts` registra `ia:grafo`; `preload.ts` + `bridge.ts` tipam; renderer (`classificacao-ia.ts`, `aurum-ai-chat.ts`, stores) consome com fallback lexical se `ok:false`.

**KGLite (Python):** `scripts/grafo/build-grafo-kglite.py` espelha o mesmo schema em `.kgl` → `audit scorecard` → `describe()` injeta `finetune_*/system_prompt.txt` + `recursos-ia/conhecimento/catalogo-rag.json`; `kglite-mcp-server --graph grafo.kgl` p/ agentes dev; `codingest` gera `code.kgl` do `src/` p/ navegação arquitetural.

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Nativo `@ladybugdb/core` no `utilityProcess` (Electron 44) não carregar | Tracer 10-00 GO/NO-GO; fallback WASM documentado; `asarUnpack` + `after-pack-ia.cjs`; trava build se falhar |
| Instalador +90MB (embedding) | `CHECKSUMS.txt`, download 1× no build, `extraResources`, modo FTS-puro se ausente; medir em 10-00 |
| Schema drift (base muda, grafo velho) | Rebuild por hash `MANIFEST.json` (mesmo gatilho do índice lexical); `grafometa` em Dexie + DebugIA |
| Alucinação via caminho (LLM cita aresta errada) | Resolvedor revalida tudo; `cypher` + `graphPaths` auditados; `sanitizarLivre` já barra NCM/R$/art inventado |
| Licença fonte ponte | Aresta `origem` explícita + badge não-oficial preservado |
| Vício de feedback (escolha errada reforçada) | Overlay só reordena (boost com teto), `ia_feedback` negativado demoteia, TTL 90d + teto de tamanho, resolvedor com veto — ver §5 |
| Overlay corrompido/inchado | Checksum + rollback (apagar overlay → base bit-idêntica); job incremental <1s ao abrir + ocioso, nunca rebuild diário |

## 5. Overlay de aprendizado local (GRAFO-08)

**Arquivo:** `%APPDATA%/Aurum Tax NCM/grafo/aprendizado.lbug` (ou `.jsonl` minificado se o volume não justificar 2º banco; decisão em 10-03). Nasce vazio no instalador — custo zero de build. Só `grafo-service.cjs` lê/escreve.

**Arestas `origem: uso_local`** (sempre com `emitente`, `peso`, `atualizadoEm`):
- `Termo-[:PREFERIDO_POR]->NCM|NBS` (sinônimo do escritório, ex. "miojo" → 19023000);
- `NCM-[:ESCOLHIDO_COMO]->CCT` (escolha do usuário nas multi-opções);
- `CNAE-[:CARTEIRA_DE]->Emitente` (CNAEs recorrentes; refina Fator R/ponte sem rede).

**Escrita:** eventos já existentes alimentam sem UI nova — escolha em `<select>` do lote/consulta, `ia_feedback` positivo/negativo, CNAE consultado via CNPJ. **Leitura:** `score_final = score_base + min(boost_uso, TETO)`; trilha marca `boost: uso_local` para a UI "por que sugeriu".

**Base que já existe para reaproveitar:** `ia_feedback` (demote, `selecionarAurumAILocal:156`), `conversasEmitente` Dexie v12 (TTL 90d/teto 30 — mesmo padrão de expiração), `logs/consultas-ia.jsonl` (mineração inicial do overlay).
