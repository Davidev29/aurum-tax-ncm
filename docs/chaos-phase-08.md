# Chaos Phase 8 — 22 casos (oráculo fechado)

**Data:** 2026-10-04 · **Base:** `tsc 0 + 985/985 testes (95 arquivos)` · **Nova suíte:** `tests/chat-simples-anexo.test.ts` 12/12

| # | Caso | Esperado | Obtido | Pass |
|---|------|----------|--------|------|
| 1 | Anexo I + RBT12 12k + receita 36k (print) | DAS R$1.440, sem Fator R/III×V | sem Fator R, DAS correto | ✅ |
| 2 | Anexo II + valores | sem Fator R | sem Fator R | ✅ |
| 3 | Anexo IV + valores | sem Fator R | sem Fator R | ✅ |
| 4 | Anexo III + valores | com Fator R | com Fator R | ✅ |
| 5 | `sou comercio/loja/revenda/mercadinho` (8) | Anexo I | 8/8 | ✅ |
| 6 | `sou industria/fabrica` (4) | Anexo II | 4/4 | ✅ |
| 7 | `salão/academia/aula/manutenção` (8) | Anexo III | 8/8 | ✅ |
| 8 | `construção/advocacia/vigilância/limpeza` (6) | Anexo IV | 6/6 | ✅ |
| 9 | `médico/engenheiro/contador/TI` (10) | V + pede folha | V + aviso | ✅ |
| 10 | `anexo 1/primeiro anexo` explícito vence | I | I | ✅ |
| 11 | `Anexo IV, sou medico` (bug regex iv→I) | IV | IV após fix `valores-chat.ts` | ✅ (fix) |
| 12 | `sou MEI` | orienta, sem DAS | orienta | ✅ |
| 13 | `comércio e serviços` (mista) | pede split/CNPJ | pede valores (limite doc) | ⚠️ parcial |
| 14 | RBT12 ausente/0 | pergunta, sem projetar | pergunta | ✅ |
| 15 | receita>RBT12 | alerta sem autocorreção | alerta | ✅ |
| 16 | RBT12>4.8M | fora do Simples | calcula (gap: validar teto no chat) | ⚠️ gap registrado |
| 17 | `o que é Fator R?` | conceito, sem cálculo | conceito | ✅ |
| 18 | `qual melhor III ou V?` sem números | regra, sem simular | regra | ✅ |
| 19 | `__COMPARAR_ANEXOS__` válido | matriz 5 + veredito | matriz + veredito | ✅ |
| 20 | `__COMPARAR_HIBRIDO__` sem despesa | duelo + aviso pessimista | duelo + aviso | ✅ |
| 21 | payload adulterado | pergunta, sem chutar | pergunta | ✅ |
| 22 | IBS R$1.000 não vira receita Simples | domínios separados | separados | ✅ |

**Taxa:** 20/22 ✅ + 2 parciais documentados = **90,9% sucesso** (≥85% gate PASS). Gaps 13/16 viram follow-up (split multi-anexo + teto 4.8M no chat).
**Correções aplicadas:** guard `USA_FATOR_R`, `inferirAnexoPorAtividade`, regex `iv|v` antes de `i`, botões `__COMPARAR_*__`, Dexie v12 `conversasEmitente`.
