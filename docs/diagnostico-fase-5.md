# Diagnóstico Fase 5 — Fluxo Consulta Completo (06-06 / IA-06)

**Data:** 2026-09-30 · **Branch:** `spike/electron-llama` (working tree, sem commit)
**Escopo:** IA como camada superior na Consulta — determinístico primeiro
(`classificarPorDescricao` → confiança `alta` devolve direto), fallback IA
(Top-5 RAG → seletor → `resolverClassificacoes` → `calcularTributos`) só no
`null`/baixa, trilha `audit_log` + `logs/consultas-ia.jsonl`, seção "Sugestão IA".

## 1. Como foi executado (resultados reais, não estimados)

Bateria executada de verdade via `classificarComIA()`
(`src/infrastructure/ia/classificacao-ia-repo.ts`) sobre o seed mínimo de
`tests/classificacao-inteligente.test.ts` (12 nomenclaturas, vínculos
10051000×2 / 23091000 / 23099090, CST 200 + refs VII/IX), com gancho `aoWorker`
provando se o worker foi acordado. Sondas scratch (`tests/ia-sonda*-06-06.test.ts`)
rodadas em vitest e **apagadas** após a coleta — os JSONs abaixo são saída literal.

Ambiente: fora do Electron → `bridge.ia` ausente → seletor **mock local**
(`mock: true`, motivo `mock-overlap` / `similaridade-insuficiente`). No Electron
com worker vivo, `mock` passa a `false` sem mudar o gate.

## 2. Fáceis — determinístico vence, worker NEM acorda (5/5)

`via: deterministico` · `worker: false` · `mock: false` · motivo
`deterministico-alta-confianca` · `nCands: 0` (sem RAG) em todos.

| # | Descrição | conf. det | NCM | cClassTrib | Cálculo base R$ 1.000 |
|---|-----------|-----------|-----|------------|------------------------|
| F1 | Semente de milho híbrido para plantio | alta | 1005.10.00 | 200034 (Anexo VII) | 76 / 36 / 112 |
| F2 | milho para semeadura | alta | 1005.10.00 | 200034 (Anexo VII) | 76 / 36 / 112 |
| F3 | Milho em grão para consumo | alta | 1005.90.10 | regra geral 000/000001 | 190 / 90 / 280 |
| F4 | Alimentos para cães ou gatos acondicionados para venda a retalho | alta | 2309.10.00 | 200038 (Anexo IX) | 76 / 36 / 112 |
| F5 | Boi vivo da raça Nelore para reprodução | alta | 0102.29.19 | regra geral 000/000001 | 190 / 90 / 280 |

Cálculo: `REF_DEFAULT` IBS 19 / CBS 9; redução 60% → 76/36/112; integral → 190/90/280.
F5 confirma a correção da base vigente (0102.10.00 do prompt é extinto — nunca sugerido).

## 3. Difíceis — fallback IA com carimbo do resolvedor (5/5)

`via: ia` · `worker: true` · `mock: true` · `confIa: 1` · motivo `mock-overlap`
em todos. Decisão **sempre** validada por `resolverClassificacoes` (única verdade);
`decisao`/`calculo` nunca vêm do seletor cru.

| # | Descrição | conf. det | Top-5 (código:score) | Decisão validada | Cálculo |
|---|-----------|-----------|----------------------|------------------|---------|
| D1 | reprodução | baixa/null | 01022919:110.0 | 0102.29.19 regra geral | 190 / 90 / 280 |
| D2 | gatos | baixa/null | 23091000:110.0 | 2309.10.00 × 200038 | 76 / 36 / 112 |
| D3 | grão | baixa/null | 10059010:110.0 | 1005.90.10 regra geral | 190 / 90 / 280 |
| D4 | semeadura | baixa/null | 10051000:110.0 | 1005.10.00 × 200034 | 76 / 36 / 112 |
| D5 | retalho | baixa/null | 23091000:110.0 | 2309.10.00 × 200038 | 76 / 36 / 112 |

## 4. Incoerente — falha segura (1/1)

| # | Descrição | conf. det | via/worker | Candidatos | Resultado |
|---|-----------|-----------|------------|------------|-----------|
| I1 | asdfgh qwerty zzz | baixa/null | ia / true | 0 (`sem-candidatos`) | **NÃO SEI** — sem código, sem decisão, sem cálculo |

## 5. Comportamentos-limite observados (honestos, viram nota de UI)

- `milho` e `bovina`: `via: ia` com candidatos (ex.: 10051000:70.0 + 10059010:70.0)
  mas seletor mock retorna `similaridade-insuficiente` → **NÃO SEI**. O overlap do
  mock enxerga só a descrição do item (não o caminho hierárquico) e o corte 0,2
  barrou — falha segura correta, não alucinação.
- `Ração para cães com adição de sal`: determinístico `media` (risco do sal) →
  fallback `via: ia`, mas o RAG cru (`buscarNomenclaturaPorTexto` AND sobre o
  texto literal) acha **0 candidatos** (`sal`/`adição` não constam da nomenclatura)
  → **NÃO SEI**. Documenta por que a seção IA exibe lista vazia + motivo.
- `coisa` e `nave espacial alienígena interestelar`: `via: ia`, 0 candidatos → NÃO SEI.
- Trilha `.jsonl` verificada ao vivo: a sonda em Node anexou
  `logs/consultas-ia.jsonl` (6,8 KB, 19 linhas — decisões + feedbacks); arquivo
  removido após a coleta, mantido só `logs/.gitkeep`. No renderer o append é
  no-op e o `audit_log` continua valendo.

## 6. Vereditos 06-06

- Bypass determinístico: **5/5** fáceis sem worker (prova do gate, base do 06-09).
- Resolver como única verdade: **5/5** decisões IA com `ncmValidado` + cálculo; **4/4**
  incoerentes/limite com NÃO SEI e zero código fictício.
- UI: seção "Sugestão IA" só quando `via === 'ia'` (`src/pages/Consulta.tsx` —
  `SecaoSugestaoIa`): badge `via IA` × `determinístico · sem worker` no cabeçalho
  da predição, Top-5 auditável (código/score/usar), painel de cálculo existente
  reutilizado (`CartaoClassificacao`/`CartaoTributacaoIntegral` + leitura IBS/CBS
  sobre `VALOR_BASE_IA`), "Não é esse" → `feedbackIaNegativo()` (Dexie `ia_feedback`).
- DB: v9 com `ia_feedback`; `backup.ts` cobre `iaFeedback`; `public/base/*` intactos.
- `taxa_uso_ia` nesta amostra adversa: 6/11 — a meta <30% será medida no lote de
  20 consultas do 06-09, não aqui.

## 7. Pendências → 06-07

Empacotamento (`extraResources`, `asarUnpack`, `process.resourcesPath`, 3
instaladores ≤300MB, teste offline em VM limpa) — nada do 06-06 bloqueia.
