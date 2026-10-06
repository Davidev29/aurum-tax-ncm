# Grafo fiscal — manual operacional (Phase 10)

## Atualizar a base

```bash
npm run base          # rebuilda TUDO incl. grafo (pula se hash inalterado: "skipped")
```

O que ele faz com o grafo (`scripts/build-grafo.mjs`): lê
`public/base/{nomenclatura,reforma,classificacao-tributaria,cnae,cnae-nbs}.json`
+ `recursos-ia/conhecimento/{sinonimos,dicionario,pesos,lc214-artigos}.json` e
regrava `public/base/grafo/{grafo.lbug,grafo.lbug.json,MANIFEST.grafo.json}`
+ carimba Dexie `grafometa` no próximo boot (`completarGrafoMeta`, merge por
`put` — nunca `clear()`).

## Forçar rebuild

Apague `public/base/grafo/MANIFEST.grafo.json` (ou mude qualquer byte
tributário das fontes) e rode `npm run base`. Conferência:

```bash
node -e "const m=require('./public/base/grafo/MANIFEST.grafo.json');console.log(m.versao,m.nodos,m.arestas,m.hash,m.embedding)"
# esperado: grafo-v1 20559 30107 <sha256> ausente|hash-fallback
```

`statusBase()` (Dexie) deve expor `grafo: X nodos/Y arestas` com o mesmo hash
do MANIFEST (`tests/grafo-base.test.ts` trava isso).

## Vetores (`scripts/gerar-embeddings.mjs`)

```bash
npm run ia:embeddings   # 1× no build (transformers.js, all-MiniLM-L6-v2, 384-d)
```

Gera `public/base/grafo/vetores.json` (`formato: vetores-grafo-v1`) com
`CHECKSUMS.txt`. Sem o arquivo, o runtime cai em `modoVetor:'fts-puro'`
(lexical intacto — chaos 07). Nunca baixar embedding em runtime.

## Overlay de aprendizado (só-na-máquina)

Arquivo: `%APPDATA%/Aurum Tax NCM/grafo/aprendizado.json`.
Nasce vazio; o job poda TTL 90d + teto 5.000 ao abrir + ocioso (<1s).

**Rollback (base bit-idêntica):** apague `aprendizado.json` (ou a pasta
`grafo/` inteira do userData) — o grafo fiscal não é tocado (só lido) e a
próxima consulta volta ao ranking base (chaos 16 prova byte-igualdade).
Corrompido → backup automático `aprendizado.corrompido-<ts>.json` + recria
vazio (chaos 15).

## Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| `via` nunca é `grafo`, fallback sempre | `grafo.lbug` ausente/versão divergente | `npm run base`; conferir MANIFEST + `grafometa` |
| `modoVetor` sempre `fts-puro` | `vetores.json` ausente | `npm run ia:embeddings`; conferir CHECKSUMS |
| Sugestão pessoal sumiu | overlay apagado/expirado (TTL 90d) ou demote por feedback − | reescolher no `<select>`; ver "por que sugeriu" |
| `tsc`/`npm test` quebram após mexer nas fontes | hash mudou, artefatos desatualizados | `npm run base` + `npx tsc --noEmit` + `npx vitest run` |
