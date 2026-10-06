# Grafo fiscal — arquitetura (Phase 10, GRAFO-01…08)

Base: `public/base/grafo/grafo.lbug` (20.559 nodos / 30.107 arestas, `grafo-v1`,
hash `63ddf71c…` em `MANIFEST.grafo.json`) + espelho portátil `grafo.lbug.json`
+ `vetores.json`. O resolvedor determinístico continua sendo a única verdade:
o grafo **propõe candidatos + caminhos, nunca precifica** (`via:grafo` em trilha).

## 1. Schema (`scripts/grafo/schema.cypher`)

Nós (PRIMARY KEY): `NCM(codigo)` 10.514 · `SH6` 5.612 · `SH4` 1.228 ·
`Capitulo` 96 · `Secao` 1 · `CCT(codigo)` 164 · `Anexo(nome)` 36 ·
`ArtigoLC214(numero)` 33 · `CNAE(codigo)` 1.090 · `NBS(codigo)` 624 ·
`Termo(termo)` 1.161.

Relações (toda fiscal carrega `origem|confianca|anoReferencia`):
`PERTENCE_A` NCM→SH6 (10.514, `por_codigo`) · `SH6_EM`/`SH4_EM`/`CAP_EM`
hierarquia por prefixo · `TEM_CLASSIFICACAO` NCM→CCT (2.329, só 1.671 NCMs
têm vínculo exato ≈15,9% — o resto posiciona por herança SH6/SH4) ·
`TEM_CLASSIFICACAO_NBS` NBS→CCT (122) · `REDUZ_PARA` CCT→Anexo (42) ·
`FUNDAMENTA_EM` Anexo→Artigo (4, `curadoria`) · `MAPEIA` CNAE→NBS (6.270,
453 CNAEs; top `4322303` = 98) · `SINONIMO_DE` Termo→NCM (3.890, curadoria).

Caminhos canônicos: `NCM→CCT→Anexo(→Artigo)` e `CNAE→NBS→CCT(→Anexo)`.
NBS da ponte sem lastro oficial vira nó `oficial:false` sem
`TEM_CLASSIFICACAO_NBS` — caminho unitário, sem redução inventada.

## 2. Build (`scripts/build-grafo.mjs` via `npm run base`)

Lê `public/base/*.json` + `recursos-ia/conhecimento/*` → núcleo puro
`construirGrafo()` (dedupe determinístico, revogado com `dataFim` filtrado,
sem `CCT:000000` fantasma, `comProveniencia` fail-closed) → CSVs
(`scripts/grafo/.tmp/`) → LadybugDB quando `@ladybugdb/core` instalado,
senão JSON portátil com os mesmos bytes → `grafo.lbug` + `grafo.lbug.json`
+ `MANIFEST.grafo.json` (versão, hash, contadores, `embedding`).
Rebuild só quando o hash semântico da base muda (`skipped` caso contrário);
Dexie ganha só `grafometa` (hash/versão/contadores) — nenhuma store fiscal
removida. `npm run base` nunca falha o build (sem base → grafo vazio
versionado, exit 0).

## 3. Runtime (`electron/ia/grafo-service.cjs` no worker, `ia:grafo` IPC)

`abrirGrafo()` resolve userData → extraResources → dev; tenta o nativo
`@ladybugdb/core` (lazy, `external` no esbuild) e cai no JSON em memória
(modo `json-fallback`, bit-idêntico). Sem arquivo/versão divergente →
`{ok:false, fallback:'lexical'}` — o chamador segue bit-idêntico ao pré-grafo.
`require('@ladybugdb/core')` nunca no renderer/main quente. Consulta quente
<50ms (<500ms em CI); fria <2s (chaos 19).

## 4. Retrieval em 4 estágios (`grafoConsultar`)

(a) **FTS seeds**: tokens lowercase sem acento + stem, overlap
(exato 1 / stem 0,9 / substring 0,7) + bônus `SINONIMO_DE` (+0,25).
(b) **HNSW/vetor seeds**: cosine sobre `vetores.json` (384-d,
`all-MiniLM-L6-v2` 1× no build, `CHECKSUMS.txt`, nunca baixado em runtime;
pré-filtro por overlap token-expandido incl. ponte semântica curada
`aula/inglês→educação/ensino/idioma`); ausente → estágio pulado,
`modoVetor:'fts-puro'`. (c) **Expansão 2-hops** determinística (primeira
aresta por tipo) → caminho + `provenienciaDoCaminho` + `cypher` auditável
(vai para `via:grafo`). (d) **Rerank**: `scoreBase` (blend FTS 0,6 + vetor
0,4 normalizados + PageRank por grau + bônus Anexo + scoping por comunidade
Louvain-lite) + `min(boost_uso, 0.3)`. `scores:{fts,vetor,pagerank}` é
ranking interno — nunca confiança fiscal. `taxa_uso_grafo` no DebugIA
(`Ctrl+Shift+D` mostra `graphPaths` + `cypher`).

## 5. Overlay de aprendizado local (GRAFO-08)

`%APPDATA%/Aurum Tax NCM/grafo/aprendizado.json` (`{versao:1, arestas:[]}`,
checksum sha256; corrompido → backup + recria vazio, base intacta). Arestas
`origem:uso_local` (`Termo-PREFERIDO`, `NCM-ESCOLHIDO`, `CNAE-CARTEIRA`).
`score_final = score_base + min(boost, 0.3)` (TETO_BOOST). Travas: demote por
`ia_feedback` negativo (boost 0), TTL 90 dias, teto 5.000 arestas, resolvedor
com veto (só reordena — `desempatarPorGrafo` sem CCT citado mantém a ordem;
`provenienciaDoCaminho` sem aresta = `[]`, sem citação). Escritores:
escolha em `<select>` lote/consulta, `ia_feedback` ±, CNAE via CNPJ; job
incremental ao abrir + ocioso (<1s, só poda — nunca rebuild). Rollback =
apagar o overlay → base bit-idêntica (chaos 16). UI "por que sugeriu":
`base: A → B → C + seu uso (boost: uso_local +X)`.
