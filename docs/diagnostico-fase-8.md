# Diagnóstico Fase 8 — Testes e Observabilidade (06-09 / IA-09)

**Data:** 2026-09-30 · **Working tree, sem commit**
**Escopo:** regressão do gate IA + telemetria, sem quebrar as 37 legadas.
Sementes reais de `tests/classificacao-inteligente.test.ts` + F1-F5/D1-D5/I1
de `docs/diagnostico-fase-5.md`. Fora do Electron o gate usa o seletor mock
local (`mock: true`); com worker vivo o mesmo gate passa por
`window.aurum.ia.classificar` + `resolverClassificacoes`.

## 1. Resultados (bateria executada de verdade, não estimada)

| Suite | Casos | Resultado |
|-------|-------|-----------|
| `tests/ia/classificacao-ia.test.ts` — 30 conhecidos | 30 | **30/30 (100% ≥ meta 85%)** — código esperado + via correta |
| ··· dos quais `via: deterministico` | 23 | 23/23, worker 0 chamadas, `mock: false`, 0 candidatos |
| ··· dos quais `via: ia` (D1-D5 + 2) | 7 | 7/7, decisão validada + `calculo` sobre R$ 1.000 |
| `tests/ia/classificacao-ia.test.ts` — 10 ambíguos | 10 | **10/10 NÃO SEI** (sem código/decisão/cálculo) |
| `tests/ia/classificacao-ia.test.ts` — 5 inválidos (vazio, 1 letra, só números, emoji, gibberish) | 5 | **5/5 NÃO SEI**, sem throw |
| `tests/ia/validacao-deterministica.test.ts` — worker alucinando `99999999` | 3 | **3/3 bloqueados, 0 alucinação** na UI |
| `tests/ia/bypass-deterministico.test.ts` — F1-F5 | 5 | **5/5 com 0 chamadas** ao worker |
| `tests/ia/bypass-deterministico.test.ts` — D1-D5 | 5 | **5/5 com ≥1 chamada**, decisão validada |
| `tests/ia/performance.test.ts` — p95 < 5s / RSS < 500MB / índice < 200MB | 3 | **3/3 verdes** (p95 na casa de ms; índice lexical **1.102.017 bytes ≈ 1,05 MB**) |
| **Total `tests/ia/`** | **53** | **53/53** |
| **Legadas** | 37 arquivos | **todas verdes** |
| **`npm test` completo** | **41 arquivos / 433 testes** | **433/433 verdes** |
| `tsc --noEmit` | — | **exit 0** |

`taxa_uso_ia` na bateria de 30 conhecidos: **7/30 = 23,3% (< 30% ✓)** —
a IA atua como camada superior, não como caminho padrão. (A sonda adversa de
55 descrições — 1 token, gibberish, raças sem correspondente oficial — deu
56,6%, o que é esperado: entrada ruim deve falhar segura, não chutar.)

## 2. Achado load-bearing + correção (gate)

Durante a prova de alucinação, o gate aceitava qualquer código com
`lista.length > 0`: `resolverClassificacoes('99999999')` devolve regra geral
(`nomenclatura: null`), e o alucinado passaria como "válido". **Corrigido em
`src/application/classificacao-ia.ts`**: o gate agora exige código
**homologado na nomenclatura vigente** (`validacao.nomenclatura != null`).
Regra geral legítima (NCM real sem vínculo, ex. D1 `01022919`) continua
passando — só código fora da base é recusado. As 37 legadas seguem verdes.

## 3. Observabilidade (`src/pages/DebugIA.tsx`, Ctrl+Shift+D)

Completado o faltante do tracer 06-05:

- Totais explícitos: total consultas, via determinístico, via IA.
- `taxa_uso_ia` (meta <30%), **aceitação IA** (via:ia no histórico sem
  feedback "Não é esse" — Dexie `ia_feedback`, best-effort),
  **taxa NÃO SEI** (últimas 20 do histórico).
- Histórico exibe desde a 1ª decisão (antes: só com >1).
- `logs/metricas-ia.jsonl`: snapshot por inferência (quando/via/decisão/
  totais/taxas/ms) via `anexarMetricaIaJsonl` — append best-effort só em
  Node; no renderer é no-op. Git-ignorado (`logs/*.jsonl`).
- Trilha `logs/consultas-ia.jsonl` verificada ao vivo durante o `npm test`
  (68 KB anexados pelo repo em Node; resíduo removido, mantido `.gitkeep`).

## 4. Cobertura 06-09 × plano

| Item 06-PLAN §5 (06-09) | Status |
|--------------------------|--------|
| 30 conhecidos + 10 ambíguos + 5 inválidos | ✅ 45 asserts |
| mock LLM `99999999` bloqueado | ✅ + fix no gate |
| bypass determinístico (novo) | ✅ 0 vs ≥1 chamadas |
| perf p95 <5s, RSS <500MB (+ índice <200MB) | ✅ |
| DebugIA: totais, taxa_uso_ia, aceitação, NÃO SEI, 20 logs, metricas jsonl | ✅ |
| `diagnostico-fase-8.md` + `npm test` 37+4 verdes | ✅ (41 arquivos: 37+4) |

## 5. Pendências → 06-10

Documentação e entrega (IA-10): `arquitetura-ia.md`,
`manual-atualizacao-ia.md`, `troubleshooting-ia.md`,
`diagnostico-final-ia.md` + encerramento de REQUIREMENTS/ROADMAP/STATE.
Nada do 06-09 bloqueia.
