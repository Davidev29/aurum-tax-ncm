# Diagnóstico Fase 2 — Índice Vetorial RAG (06-03 / IA-03)

**Data:** 2026-09-30
**Scripts:** `scripts/gerar-indice-ia.mjs` → `scripts/testar-indice-ia.mjs`
(`npm run ia:indice`, `npm run ia:testar-indice`)
**Patch:** `scripts/build-base.mjs` (gatilho por hash) + `package.json` + `.gitignore`
**Status:** ✅ tester exit 0 · `npm run base` íntegro (gatilho nos 2 ramos provado)

## 1. Decisão: fallback lexical (offline, documentado)

Rede indisponível para `npm i @xenova/transformers vectra` e para baixar
`all-MiniLM-L6-v2`; nenhuma dependência nova foi instalada. `gerar-indice-ia.mjs`
tenta o caminho vetorial por import dinâmico (`try/catch`) e, ao falhar, gera o
**índice lexical fallback** `recursos-ia/indice-ncm/indice-lexical.json`
(TF-IDF/BM25-lite em JSON puro, zero deps). A troca pelo Vectra real é só
regenerar quando houver rede — mesma interface `buscarIndice()`, mesmos asserts.

Por que o fallback precisa de sinônimos: a base 06-02 descreve vínculos em
linguagem tributária e **não contém os literais** `frango` (0 docs) nem
`notebook` (0 docs). O índice usa normalização PT (minúsculas, sem diacríticos,
singular aproximado, stopwords, strip de `<i>`), pesos por campo
(nomenclatura ×3 > capítulo ×2 > descrição ×1 > cClassTrib ×0.5) e tabela
semente de sinônimos comerciais (`frango→galo/galinha/peru/pato/ganso…`,
`notebook→processamento/dados/portátil/máquina…`,
`arroz→polido/brunido/integral…`). Tabela a ampliar em 06-05/06-09.

## 2. Resultado do tester (top-k real)

```
"Frango vivo" (top-3):   01051200 cap.01 13.468 · 02109911 cap.02 9.519 ×2  → ✔ cap.01
"Arroz branco" (top-3):  10064000 cap.10 13.428 ×2 · 10063011 cap.10 10.940 → ✔ top-1 cap.10
"Notebook" (top-5):      84718000 cap.84 16.792 ×2 · 85171431 cap.85 6.984 ×2 · 85176234 cap.85 → ✔ 84/85
```

`01051200` = perus/peruas cap.01 (via sinônimo); `84718000` = "máquinas
automáticas para processamento de dados" cap.84; `85171431` = "Portáteis" cap.85.

## 3. Tamanho e versionamento

| Arquivo | Tamanho | Versionado? |
|---|---|---|
| `indice-ncm/indice-lexical.json` (2335 docs, 2770 tokens) | 1076 KB | SIM (`!` no `.gitignore`, pequeno) |
| `indice-ncm/.manifest-hash` (gatilho rebuild) | 65 B | SIM |
| `indice-ncm/.gitkeep` | 0 | SIM |
| `embedding/*`, `*.gguf`, futuros `index.*` Vectra | — | NÃO (`git check-ignore` provado: pesos/gguf exit 0, lexical/hash exit 1) |

`indice-ncm/` total: **1076 KB** (teto 200 MB, folga >99%).

## 4. Gatilho em `build-base.mjs` (provado, build preservado)

`gatilhoIndiceIA()`: compara hash **semântico** com `.manifest-hash`; divergente/
ausente → `node scripts/gerar-indice-ia.mjs` (spawn), igual → ignora; tudo em
`try/catch` que nunca falha o build. Achado 06-03: `meta.geradoEm` está embutido
nos 3 artefatos, então sha256 de arquivo **nunca** estabiliza — o hash cobre o
conteúdo com `meta.geradoEm` removido + `estatisticas`/`codigosIgnorados`.

Provas: 2× `npm run base` seguidos → `índice IA: em dia… rebuild ignorado`;
com `.manifest-hash` removido → `MANIFEST mudou — regenerando… rebuild OK`;
contagens inalteradas (`ncm: 2335`, mesmos avisos pré-existentes de 6 sem
nomenclatura + 10 descartados).

## 5. Pendências para 06-05 (trocar fallback por Vectra real, com rede)

1. `npm i @xenova/transformers vectra` (dev agora, prod na 06-05) + baixar
   `all-MiniLM-L6-v2` (`multilingual-e5-small` de fallback) em `recursos-ia/embedding/`.
2. `node scripts/gerar-indice-ia.mjs` (sem `--lexical`) → valida caminho vetorial
   (**não testado offline** — código presente, marcado no cabeçalho).
3. `node scripts/testar-indice-ia.mjs` deve continuar exit 0 contra o backend
   vetorial; adaptar o loader do teste se o formato divergir.
4. Ampliar tabela de sinônimos (ou aposentar, se o vetorial cobrir) e reavaliar
   `du` <200 MB com pesos + índice real.
5. `electron/ia/ia-worker.cjs` pode importar `buscarIndice`/`tokenizar` de
   `gerar-indice-ia.mjs` como RAG funcional até o Vectra entrar.
