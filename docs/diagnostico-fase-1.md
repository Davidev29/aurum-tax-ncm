# Diagnóstico Fase 1 — Curadoria de Dados NCM-only (06-02 / IA-02)

**Data:** 2026-09-30
**Scripts:** `scripts/preparar-dados-ia.mjs` → `scripts/validar-dados-ia.mjs`
**Saída:** `recursos-ia/dados-brutos/ncm-para-ia.json` (3.239.325 bytes)
**Status:** ✅ validador exit 0

## 1. Contagens

| Métrica | Valor |
|---|---|
| Vínculos NCM na base IA | 2335 (exato, = esperado) |
| Códigos distintos | 1675 |
| NBS na base IA | 0 (137 vínculos NBS de `reforma.json` excluídos pelo filtro 8-dígitos) |
| Códigos 9-dígitos no MANIFEST | 10 (já descartados pelo build-base; 0 remanescentes — defesa em profundidade OK) |
| Vínculos sem nomenclatura vigente | 6, preservados e marcados em `notas: ["sem-nomenclatura-vigente"]` |
| Códigos sem nomenclatura (distintos) | 4 → `02071400`, `07129010`, `28273998`, `30024993` |
| Chaves de vínculo duplicadas | 0 (`codigo\|cst\|cClassTrib` únicas) |
| Pares CST×cClassTrib órfãos | 0 (todos existem em `reforma.json`) |

Paridade MANIFEST: `ncm: 2335`, `ncmSemNomenclatura: 6`, `codigosIgnorados: 10` — confere.

## 2. Resultado do validador

```
✔ contagem exata: 2335 vínculos NCM
✔ unicidade: 2335 chaves (codigo|cst|cClassTrib) sem duplicata
✔ filtro NCM-only: nenhum código fora de 8 dígitos
✔ completude: codigo/descricao/capitulo/descricaoExpandida preenchidos
✔ cClassTrib: formato 6 dígitos em todos os itens
✔ cClassTrib: todos os pares CST×cClassTrib existem em reforma.json
✔ sem-nomenclatura: 6 vínculos marcados em `notas` (paridade MANIFEST)
✔ amostragem: 5/5 códigos conferidos
✔ Base IA válida (exit 0).
```

Nota: unicidade é sobre o **vínculo** (`codigo|cst|cClassTrib`), não sobre o código
isolado — 660 códigos têm 2 vínculos (ex. cereais cap. 10 com enquadramentos
distintos). Checar unicidade só por `codigo` seria falso-positivo.

## 3. Amostra auditada (5 códigos vs tabela vigente)

| Código | CST × cClassTrib | Capítulo | Nomenclatura vigente |
|---|---|---|---|
| 02011000 | 200 × 200003 | 02 Carnes e miudezas, comestíveis. | "- Carcaças e meias-carcaças" |
| 10063021 | 200 × 200003 | 10 Cereais. | "Polido ou brunido" |
| 22029900 | 200 × 200011 | 22 Bebidas, líquidos alcoólicos e vinagres. | "-- Outras" |
| 85171490 | 200 × 200008 | 85 Máquinas (…) elétricos (…) | "Outros" |
| 02071400 | 200 × 200003 | 02 Carnes e miudezas, comestíveis. | *(sem nomenclatura — usa descrição do vínculo + `notas`)* |

## 4. Paridade com `montarClassificacao`

- `descricao` = `vinculo.descricao || nomenclatura.descricao` (classificacao.ts:90).
- `descricaoCClassTrib` = `cct.nome || cct.descricao || ref.descricao || vinculo.baseLegal` (classificacao.ts:70-76).
- `pRedIBS/pRedCBS` = `cct ?? ref ?? 0` (classificacao.ts:66-67).
- Ordem determinística código → CST → cClassTrib (mesma do `resolverClassificacoes`).
- `descricaoExpandida` = dedup(descricao do vínculo + nomenclatura + "Capítulo XX — …" + descrição cClassTrib), pronta para embedding na 06-03.

## 5. Pendências para 06-03 (Índice Vetorial RAG)

1. `npm i --save-dev @xenova/transformers vectra` + baixar `all-MiniLM-L6-v2`
   (fallback `multilingual-e5-small`) em `recursos-ia/embedding/`.
2. `scripts/gerar-indice-ia.mjs`: ler `descricaoExpandida` dos 2335 itens → embeddings → Vectra em `recursos-ia/indice-ncm/`.
3. `scripts/testar-indice-ia.mjs`: asserts Frango vivo→cap.01 top-3, Arroz branco→cap.10, Notebook→84/85 top-5 (somente capítulos NCM, sem casos NBS).
4. Gatilho em `scripts/build-base.mjs`: se hash do MANIFEST mudou → rebuild do índice.
5. Proibição: NÃO versionar índice/embedding (`git status --porcelain` limpo após generate).
