# UAT Phase 10 — aceite do Grafo Fiscal

**Data:** 2026-10-06 · **Como:** roteiro executado programaticamente sobre a
base real (`public/base/grafo/`, 20.559 nodos / 30.107 arestas) — cada passo é
um caso da suíte `tests/grafo-chaos.test.ts` (22/22 verde) + suítes
`grafo-{tracer,base,ipc,hibrido,kglite}` e `ia-grafo` (full `1621/1621` verde,
`tsc 0`). Sem Electron/navegador neste ambiente; UI (badge `via:grafo`, modal
trilha, "por que sugeriu") consome a mesma `TrilhaGrafo` verificada aqui
(`src/application/grafo-consumo.ts`).

| Passo do roteiro | Evidência obtida | Caso | Aceite |
|---|---|---|---|
| Consulta NCM difícil via grafo ("carne bovina") | top `02102000` + caminho `NCM:02102000 → CCT:200003 → Anexo:I → ArtigoLC214:125`, proveniência `[por_codigo,por_codigo,curadoria]`, cypher com `MATCH` | chaos 01 | ✅ |
| CNAE→NBS com ano (`4322-3/03`, ref. 2033) | 98 `MAPEIA` reais; consulta acha `4322303`; `refPorAno` 2026/2027/2033 = 3 refs distintas; cypher carimba `2033` | chaos 03 + 05 | ✅ |
| CNPJ enriquecido | `consultarPorCnpj` com fetch stub: atividade `0161001` `mapeado`, 1 NBS `118032100`, ano 2033, regra Anexo III (regressão Phase 9 intacta) | phase-09 chaos 11 (suíte `cnae-nbs-chaos` 22/22 verde no full) | ✅ |
| Chat com caminho | `responderChat` cita NBS + ano + regra (regressão Phase 9 intacta); com gate `via:grafo` o chat anexa `**Trilha do grafo (via:grafo):** caminho (proveniência: …)` — trilha real com cypher+caminho+proveniência provada | phase-09 chat suite 30/30 + chaos 22 (`aurum-ai-chat.ts` blocoGrafo) | ✅ |
| Overlay "por que sugeriu" | boost `uso_local +0.3` com teto; texto `base: NCM:02102000 → CCT:200003 → Anexo:I → …`; demote/TTL zeram; apagar overlay = ranking base byte-igual | chaos 12, 13, 14, 16, 22 (+ `ia-grafo` boost) | ✅ |

**Aceite assinado:** 5/5 passos ✅ — grafo propõe com caminho auditável,
resolvedor precifica (`via:grafo` em trilha), fallback lexical bit-idêntico
sem `.lbug`, overlay só reordena com travas. Gate chaos 100% + `tsc 0` +
full `1621/1621`.
