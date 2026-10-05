# UAT Phase 9 — aceite da Consulta de CNAEs

**Data:** 2026-10-05 · **Como:** roteiro executado programaticamente (fixtures `importarBase`, sem rede) — cada passo é um caso da suíte `tests/cnae-nbs-chaos.test.ts` (22/22 verde) + suítes 09-02..09-05. Sem Electron/navegador neste ambiente; UI (`ConsultaCnaes.tsx`, `ui/cnaes.tsx`) consome os mesmos `ConsultaCnae` verificados aqui.

| Passo do roteiro | Evidência obtida | Caso | Aceite |
|---|---|---|---|
| Buscar `0161-0/01` no menu | `filtrarCnaes(lista, '0161-0/01')` acha `0161001`; painel: Anexo Simples III, Permitido, 1 NBS `118.032.100`, badge `ref. 2033` | chaos 10 | ✅ |
| Abrir `4322-3/03` + escolher NBS | 98 vereditos, destaque = `ranking[0]`, `ambiguo: true`; `selecionarVeredito` fixa a NBS escolhida (2ª do ranking) | chaos 15–16 | ✅ |
| CNAE de bens | `1011-2/01`: regra Anexo II + `bens→NCM`, 0 vereditos, resolvedor 0×; `4711-3/02`: resumo/bloco citam bens→NCM, sem NBS inventado | chaos 13–14 | ✅ |
| CNPJ (proxy sem rede — `consultarPorCnpj` com fetch stub) | Atividade `0161001`: `mapeado`, `nbsLista` 1 (`118032100`), `anoReferencia` 2033, regra Anexo III/Permitido; fallback Phase 7 intacto | chaos 11 | ✅ |
| Chat (`responderChat`) | `CNAE 0161-0/01 quais NBS e benefícios?` → tipo `cnae`, cita `118.032.100` + `ref. 2033` + `Anexo Simples`; bens/fora-508 respondem regra honesta sem NBS | chaos 12 (+ suíte `chat-cnae-nbs` 30/30) | ✅ |

**Aceite assinado:** 5/5 passos ✅ — regra sempre (1.090), NBS condicional (508) com ano explícito, bens→NCM, sem lastro honesto. Gate chaos 100% + `tsc 0` + full `1537/1537`.
