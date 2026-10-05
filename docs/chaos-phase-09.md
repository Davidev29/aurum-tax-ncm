# Chaos Phase 9 — 22 casos (oráculo fechado)

**Data:** 2026-10-05 · **Base:** `tsc 0 + 1537/1537 testes (143 arquivos)` · **Nova suíte:** `tests/cnae-nbs-chaos.test.ts` 22/22 · **Gate:** ≥85% (19/22) → **PASS 100%**

Fixtures próprios semeados via `importarBase` (padrão Phase 7/09), sem rede. NBS sem vínculo oficial cai na regra geral (`semLastro`, redução 0 — nunca inventada).

| # | Caso | Esperado | Obtido | Pass |
|---|------|----------|--------|------|
| 01 | Sorteio (seed 42) de 5 CNAEs fora-508 | regra + sem-NBS, nunca sem-regra | 5/5 `ok` (sem-mapeamento-NBS ou bens→NCM), `semRegra = 0` | ✅ |
| 02 | Fora-508 serviço `6201-5/01` | regra completa + sem-mapeamento + fallback Phase 7 | Anexo III, `sem-mapeamento-NBS`, hipóteses disponíveis, sem NBS | ✅ |
| 03 | Vereditos 2026/2027/2033 (educação, red. 60%) | 3 totais distintos | 3 distintos, 2026 < 2027 < 2033 | ✅ |
| 04 | `anoReferencia` em todo veredito | ano carimbado + selo | `anoReferencia` 2026/2027/2033 + `resumo` com `ref. <ano>` | ✅ |
| 05 | Transição 2030 | valores 2033 + flag, sem número inventado | `emTransicao: true`, total = 2033 | ✅ |
| 06 | 2ª consulta do mesmo NBS | não re-chama o resolvedor | `resolvidas = 1`, `acertos > 0` | ✅ |
| 07 | NBS compartilhado entre CNAEs | contador = nº NBS únicas | 1 + 24 = 25 (não 26) | ✅ |
| 08 | Divergência de código | `divergencia`, sem consolidar regra | `codigo-ausente-oficial`, `anexoSimples: []` | ✅ |
| 09 | Divergência de texto | consolida com a oficial (oficial>ponte>auxiliar) | descrição oficial + `descricao-divergente` | ✅ |
| 10 | Menu: store `consultarCnae(0161-0/01)` | regra + 1 NBS + ano (+ vedação do template) | Anexo III, `118032100`, ref. 2033, vedação do template | ✅ |
| 11 | CNPJ sem rede (fetch stub) | mesma regra + 1 NBS + ano | `mapeado`, 1 NBS, ano 2033, Anexo III/Permitido | ✅ |
| 12 | Chat `consultarCnaeNbs` | cita NBS + ano + regra | `118.032.100` + `ref. 2033` + `Anexo Simples` | ✅ |
| 13 | Bens `1011-2/01` | regra + `bens→NCM`, zero resolvedor | Anexo II, `bens→NCM`, 0 vereditos, `resolvidas = 0` | ✅ |
| 14 | Faixa bens `4711-3/02` | resumo + bloco citam bens→NCM, sem NBS | `bens` + `NCM` no resumo/bloco, sem `NBS \d` | ✅ |
| 15 | `4322-3/03` 98 NBS | 98 vereditos, destaque = ranking[0], ambíguo | 98/98, `maisProvavel = ranking[0]`, `ambiguo: true` | ✅ |
| 16 | Escolha funcional | `selecionarVeredito` fixa a escolhida | default = mais provável; 2ª do ranking fixada | ✅ |
| 17 | `__COMPARAR_*__` intactos | nunca viram `cnae` | ANEXOS + HIBRIDO ≠ `cnae` | ✅ |
| 18 | Rollback v12→v13 | migração aditiva, antigas intactas | `DB_VERSION 13`, stores v12+v13 povoadas, `version(12)` + `version(DB_VERSION)` no schema | ✅ |
| 19 | Base ausente degrada gracioso | nunca lança, `cnae-desconhecido` honesto | sem throw; resumo `desconhecido`; build mantém `public/base/` versionado | ✅ |
| 20 | Três badges distintos | sem-mapeamento ≠ bens→NCM ≠ sem-lastro | 3 estados/badge distintos confirmados | ✅ |
| 21 | Sem lastro sem redução | redução 0, CST 000, sem benefício | `semLastro`, 0/0, `000/000001`, sem benefício | ✅ |
| 22 | Aceite fim-a-fim `0161-0/01` | Anexo + vedação + 1 NBS + veredito com ano | Anexo Simples III, vedação, `118032100`, ref. 2033 | ✅ |

**Taxa:** 22/22 ✅ = **100% (gate ≥85% PASS). Nenhum bug real encontrado — nenhuma lógica de produção alterada** (só adições de docs exigidas pelo plano: verbete `cnae_nbs`, `VIEWS` `cnaes`, `TOOLS` `consultarCnaeNbs`).

**Precedência oficial>ponte>auxiliar:** já documentada onde o código a implementa (`src/infrastructure/base/normalizacao.ts` — cabeçalho da ponte + `escolherDescricaoConferida`; `src/domain/entities/index.ts` — `FonteDescricaoCnaeNbs`/`NbsVinculadaTemplate`/`ClassificacaoConsolidada`) e em `bases-fonte/README.md` §3.1 — verificada, sem alteração necessária.

**UAT:** roteiro + evidências em `docs/uat-phase-09.md`.
