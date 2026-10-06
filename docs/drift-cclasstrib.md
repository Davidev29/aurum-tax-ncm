# C-024 — Drift `tabelasAuxiliares.cstClassTrib` × `classificacao_tributaria.json`

Verdade congelada: `classificacao_tributaria.json` (164 registros / 18 CSTs).
Gerado por diff mecânico em 2026-10-06 (verificado, não estimado).

## Fantasmas (5) — estão no Excel antigo, NÃO existem na base atual. Remover de qualquer geração de dados.
- `200450`, `210001`, `210002`, `210003`, `510002`
- CST `210` ("redutor de BC") só existe na versão antiga.

## Ausentes (37) — existem na base atual, FALTAM no Excel antigo. Incluir antes de gerar fichas P1–P3.
- `000005`
- `200050`, `200053`, `200054`
- `221002`, `221003`, `221004`
- `400002`
- `410022`–`410037` (16 códigos)
- `515001` (diferimento — P0, ver C-025)
- `550021`–`550025`
- `620007`
- `811001`, `811002`, `811003`
- `820007`, `820008`, `820009`

## Anexo XIV
`Número do Anexo` distintos na base: `1–13, 15` + 22 códigos `9xxxx` + `''` (122/164 sem anexo).
Anexo XIV sem nenhum cClassTrib = órfão estrutural a esclarecer (existe na LC 214/2025?).

## Regra
Toda geração de dados (datasets, fichas, builders) usa `classificacao_tributaria.json` como verdade.
`reforma_tributaria_por_ncm.json :: tabelasAuxiliares` (132) é legado — não usar como universo.
