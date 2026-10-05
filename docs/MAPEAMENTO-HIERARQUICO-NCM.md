# Mapeamento hierárquico NCM × Reforma (LC 214/2025)

> Gerado em 05/10/2026 por `scripts/mapear-familias-ncm.mjs` contra a base
> oficial (`reforma_tributaria_por_ncm.json` × `Tabela_NCM_Vigente_20260922.json`).
> Para revalidar após cada atualização da base: `node scripts/mapear-familias-ncm.mjs`.

## 1. Por que herança por família

A Reforma nem sempre entrega o NCM completo de 8 dígitos: os anexos da
LC 214/2025 operam por **família** — capítulo (2 dígitos), posição SH4
(4 dígitos), subposição SH6 (6 dígitos). O que passar do prefixo listado,
desde que pertença à mesma família (mesmo início, capítulo e seção), pode
pertencer à regra do anexo.

Medido na base atual:

| Métrica | Valor |
|---|---|
| NCMs vigentes de 8 dígitos | 10.514 |
| Com vínculo exato (8 dígitos) | 1.671 (**15,9%**) |
| Sem vínculo exato (caíam em regra geral) | 8.843 |
| Subposições SH6 integralmente mapeadas e unânimes | 839 |
| Posições SH4 integralmente mapeadas e unânimes | 166 |
| Capítulos 100% mapeados e unânimes | 7 (07, 10, 11, 12, 15, 25, 31) |

Sem herança, 8.843 NCMs vigentes — incluindo NCMs novos da mesma família de
um anexo — perdiam o benefício e caíam em tributação integral.

## 2. Níveis hierárquicos (SH)

| Nível | Dígitos | Exemplo | Opera na lei? |
|---|---|---|---|
| Capítulo | 2 | `07` | sim |
| Posição SH4 | 4 | `0713` | sim |
| Subposição SH6 | 6 | `071333` | sim |
| Item | 7 | `0713331` | sim (desdobramento) |
| Subitem / NCM exato | 8 | `07133319` | sim |
| Recortes 3/5 dígitos | — | `071`, `07133` | **não** — arredonda para a família (2/4) |

Recortes de 3/5 dígitos (ex.: subposição abreviada da planilha) são
normalizados por `prefixoDeEntradaTruncada` para a família que os contém.

## 3. Seções SH (contexto da IA, nunca decisão)

21 seções (I–XXI) agrupando os capítulos — ver `SECOES_NCM` em
`hierarquia-fiscal.ts`. A seção é **ampla demais para decidir benefício**:
serve só de contexto para o RAG/lexical (desempate +5, trilha) e para
hipóteses. Nenhum fluxo herda por seção.

## 4. Regras cadastradas (`REGRAS_CAPITULO`)

Capítulos integralmente mapeados e unânimes na base de referência, todos em
`200/200038` (Anexo IX — insumos agropecuários e aquícolas, art. 138):

`07`, `10`, `11`, `12`, `15`, `25`, `31` (cobertura 100%).

Excluídos de propósito:

- **06** — 100% mapeado mas **misto** (`200038` + `200014`/Anexo XV):
  herança só por posição/subposição, nunca pelo capítulo;
- **23** — parcial (92%): herança só por posição/subposição;
- demais capítulos parciais/mistos: só por subposição/posição com limiares.

## 5. Limiares de herança automática (`LIMIAR_HERANCA`)

| Nível | Irmãos mínimos | Cobertura mínima |
|---|---|---|
| Subposição SH6 | 2 | 60% |
| Posição SH4 | 3 | 75% |
| Capítulo (só curados) | 5 | 95% |

Cobertura = irmãos vinculados / vigentes do prefixo. Cobertura total
(só falta o consultado) → confiança **alta**; parcial acima do limiar →
**média** com carimbo "a confirmar". Abaixo do limiar com lastro ≥1 e
cobertura ≥40% → **hipótese a confirmar** (não herda, não esconde).
Caso `2933` (1 irmão em 253) → nega (regra geral): sem benefício inventado.

## 6. Exceções que quebram a herança (`EXCECOES_FAMILIA` + `CCTS_CONDICIONAIS`)

Herança **nunca** automática quando:

1. o cct da família é **condicional** (`CCTS_CONDICIONAIS`): destinação a
   produtor rural não contribuinte (`200002`), adquirido por adm. pública
   (`200005`, `200008`, `200010`), emergência de saúde (`200006`,
   `200012`), regime automotivo/ZFM (`000003`, `000004`, `200022`,
   `200023`, `550019`, `810001`), etc. → hipótese "a confirmar" com a
   condição citada;
2. o texto traz **exceção ativa** (`EXCECOES_FAMILIA`): sal adicionado,
   produto cozido (Anexo XV exige in natura), destinação condicional
   (plantio × consumo × ração), vivo sem destinação (reprodução × abate);
3. a família **diverge** (irmãos com ccts diferentes) ou o modelo está
   **revogado** → sem herança.

## 7. Prioridade do motor (`resolverClassificacoes`)

1. manual do usuário → 2. vínculo exato (8 dígitos) → 3. herança por
   família (SH6 → SH4 → capítulo curado) → 4. regra geral `000/000001`.
   Entrada truncada (2–7 dígitos) classifica pela família via
   `resolverPorPrefixo` em vez de lista vazia.

## 8. Fine-tuning IA (RAG + lexical)

- **Etapa 1** (`classificador-descricao`): `secoesPrioritarias` (derivadas
  dos capítulos) + `excecoesFamiliaAtivas` + RGI de Notas de Seção/Capítulo
  quando há exceção; pergunta de destinação para `destinacao-condicional`.
- **Ranking** (`classificacao-inteligente`): `+40` capítulo prioritário,
  `+25` capítulo curado (lastro normativo), `+5` seção prioritária,
  `-1000` extinto.
- **Etapa 3/3b**: reaproveita herança/hipótese do resolvedor por
  candidato; trilha `Herança por família (RAG + lexical)` + `Exceções de
  família`; herdado "a confirmar" trava a confiança em **média**; hipótese
  sem vínculo entra na justificativa como "a confirmar" (regra geral +
  hipótese visível — nenhum grupo com possível benefício é ocultado).
- **Guardrails preservados**: NCM sugerido sempre existe na nomenclatura;
  exceção só com vínculo real ou herança unânime; palavra única sem
  contexto prefere o genérico; fora de escopo recusa fixa.
