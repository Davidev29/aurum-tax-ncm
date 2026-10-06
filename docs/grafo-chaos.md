# Chaos Phase 10 — 22 casos do grafo (base real)

**Data:** 2026-10-06 · **Base:** `tsc 0` + suíte `tests/grafo-chaos.test.ts`
**22/22** · **Gate:** ≥85% (19/22) → **PASS 100%**

Base real `public/base/grafo/` (20.559 nodos / 30.107 arestas, `grafo-v1`);
nenhum mock do resolvedor — o único overlay em `ctx` é só-na-máquina por
definição (não fiscal). Full suite ao final: ver §Taxa.

| # | Caso | Esperado | Obtido | Pass |
|---|------|----------|--------|------|
| 01 | Multi-hop "carne bovina" | `02102000` + `NCM→CCT:200003→Anexo:I→ArtigoLC214:125` + cypher MATCH | top `02102000`, caminho exato, proveniência `[por_codigo,por_codigo,curadoria]` | ✅ |
| 02 | Herança SH6/SH4 vs vínculo exato | `02102000` 2 vínculos; `01012100` só herança | 2 vínculos (`200003`+`200038`); herança `PERTENCE_A→SH6:010121→SH4:0101→Cap:01`, 1.671 com vínculo | ✅ |
| 03 | CNAE 98-NBS `4322-3/03` | 98 `MAPEIA` | 98 exatos; consulta acha `4322303` | ✅ |
| 04 | Fora-508 `0111-3/01` | nó existe, 0 `MAPEIA`, caminho unitário | nó + 0 links + caminho `[CNAE:0111301]`, sem NBS inventado | ✅ |
| 05 | Anos 2026/2027/2033 | 3 refs distintas + cypher filtra ano | `{0.1,0.1}` / `{0.1,8.8}` / `{19,9}`; cypher com `2033`, sem ano sem filtro | ✅ |
| 06 | Sem `.lbug` | `{ok:false, fallback:'lexical'}`, sem throw | ok false + lexical | ✅ |
| 07 | Embedding ausente | `fts-puro` + `embedding null`, FTS acha | `fts-puro`, null, `02102000` presente | ✅ |
| 08 | Mojibake latin1 | `ServiÃ§o…` → `Serviço…`; correto intacto | reparo exato; `NÃO-METÁLICOS`/`Âmbito` intactos | ✅ |
| 09 | Caminho errado (aresta inexistente) | proveniência `[]` + ordem do resolvedor intacta | `[]`; mesma referência/ordem, `usouGrafo:false` | ✅ |
| 10 | Rollback Dexie (apagar `grafometa`) | fiscal intacta + recarimbo = mesmo hash | `ncm` count igual; hash = MANIFEST antes/depois | ✅ |
| 11 | Grafo corrompido | fallback lexical, sem throw | ok false + lexical + motivo | ✅ |
| 12 | Overlay boost teto | peso 10 → `+0.3` | `boostValor 0.3`, `score=base+0.3`, sem overlay `null/0` | ✅ |
| 13 | Demote feedback negativo | boost 0 | `calcularBoost 0` + consulta `null/0` | ✅ |
| 14 | TTL 90d | 120d expira, 89d vale | boost 0 + `expiradas:1`; 89d `0.2`; poda remove | ✅ |
| 15 | Overlay corrompido | backup + base intacta | `recuperado:true`, backup existe, top-5 idêntico | ✅ |
| 16 | Overlay apagado | bit-idêntico à base | JSON byte-igual; boost só com overlay | ✅ |
| 17 | CNAE bens `1011-2/01` | bens, 0 `MAPEIA`, sem NBS | divisão bens true/serviço false; 0 links; caminho unitário | ✅ |
| 18 | NBS sem lastro `101011100` | sem `TEM_CLASSIFICACAO_NBS`, sem redução | caminho unitário, nenhuma CCT/Anexo citada | ✅ |
| 19 | Performance fria | `<2s`, top `02102000` | ~500ms + top correto | ✅ |
| 20 | Proveniência 100% | toda aresta `origem∈ORIGENS` + `confianca∈[0,1]` | 30.107/30.107; 3 inválidas lançam | ✅ |
| 21 | PK únicas | ids únicos, sem fantasma/revogado, hash=MANIFEST | 20.559 únicos; sem `CCT:000000`/`39139050`; hash confere | ✅ |
| 22 | `via:grafo` auditável | trilha cypher+caminho+proveniência, fusão grafo-primeiro | `MATCH`, caminho `02102000`, fusão `[02102000,…]`, "por que sugeriu" com base | ✅ |

**Taxa:** 22/22 ✅ = **100% (gate ≥85% PASS). Nenhum bug real — nenhuma
lógica de produção alterada** (só a suíte nova + 4 docs exigidos pelo plano).

**UAT:** roteiro + evidências em `docs/grafo-uat.md` (5/5).
