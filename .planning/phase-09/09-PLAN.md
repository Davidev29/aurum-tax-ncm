# PLAN — Phase 9: Consulta de CNAEs (CNAE → NBS → Reforma)

**Phase:** 9
**Project:** Aurum Tax NCM (Aurum Bit Labs v1.0.0)
**Date:** 2026-10-05 (rev. 2 — correções consolidadas A–J)
**Status:** Planned (gsd-plan-phase)
**Source:** Pedido usuário (5 itens) + RESEARCH.md + prompt de correções A–J
**Mode:** tracer-first (default)
**Depends on:** Phase 7 (Serviços implementada 2026-10-03) + Phase 8 (planejada)

---

## 1. Goal

Dar ao usuário um **menu "Consulta de CNAEs" que cobre os 1.090 CNAEs da `db.cnae`**: todo CNAE retorna regra (Anexo do Simples, Situação, Fator R, texto de vedação) — NBS é **enriquecimento condicional** (links em 508), nunca pré-requisito. Para cada NBS vinculada, o sistema confronta com o resolvedor oficial e mostra benefício/tributação especial da Reforma **no ano de referência correto** (2026/2027/2033). O mesmo enriquecimento aparece no fluxo CNPJ (Serviços e Simples) e na Aurum AI do chat. O arquivo `qualclasstrib_completo.json` vira tabela versionada com descrições **conferidas entre fontes e consolidadas em template reutilizável**.

## 2. Non-negotiable Principles

1. **Resolvedor única verdade:** benefício/alíquota só de `resolverClassificacoesNbs` + `calcularTributos` + referência por ano. Link CNAE→NBS é candidato; sem lastro → `sem-lastro-reforma`, nunca redução inventada.
2. **Cobertura total — todo CNAE tem regra (A):** invariante testável — nenhum CNAE consultável sem regra. `regrasDoCnae(cnae7)` sempre disponível para os 1.090 (anexo, situação, Fator R, vedação textual). NBS é enriquecimento; `sem-mapeamento-NBS` (enriquecimento ausente) ≠ `sem regra` (não pode existir).
3. **Merge, não replace:** `db.cnae` (1.090) intacta; links cobrem 508; sem `clear()`.
4. **Rótulos separados:** "Anexo Simples" (I–V) vs "Anexo LC 214" (I/II/IX…) — nunca misturar. E `sem-mapeamento-NBS` vs `sem NBS aplicável — atividade de bens (ver NCM)` vs `sem-lastro-reforma` — três badges distintos (A + D).
5. **Vedação = Situação:** `Permitido / Permitido com ressalvas / Depende da atividade` (+ `anexos[]`, `fatorR`); não criar flag `vedado` nova.
6. **Teto de confiança Phase 7 reaproveitado:** `Permitido 1 / ressalvas 0.6 / Depende 0`.
7. **Ano de referência explícito (C):** todo `VereditoNbs` carrega `anoReferencia`; `REF_DEFAULT` fixo segue como fallback 2033; nova função `refPorAno(ano)` parametriza (2026 teste 0,1%+0,1%; 2027 CBS plena; 2033 final). Precificação muda conforme o ano — exibir o ano no badge.
8. **Bens ≠ serviços (D):** NBS é só serviços. CNAE industrial/comercial sem NBS aplicável → caminho explícito bens→NCM, nunca silêncio.
9. **Precedência de descrição documentada (E):** oficial > qualclasstrib > auxiliar. Divergência de código → `divergencia`, não consolida.
10. **Offline-first + proveniência auditável (G):** tudo em Dexie após `npm run base`; CNPJ segue único ponto de rede; MANIFEST registra origem/licença/captura/cadência da fonte ponte.

## 3. Requirements (CNAE-01..CNAE-07, rev. 2)

| ID | Requirement | Origem | Arquivo-alvo |
|----|-------------|--------|--------------|
| CNAE-01 | Ingerir `qualclasstrib_completo.json` via `npm run base` (merge 1.090+508, `fixLatin1`, descarta tracking Google, **conferência de descrições entre fontes + template consolidado em `classificacoesConsolidadas`**, MANIFEST com `fontesVivas{origem,licenca,capturaEm,cadencia}` + `estatisticas{cnaesComRegras:1090, cnaesComNbs:508, descricoesConferidas, descricoesDivergentes}`), Dexie v13 aditiva | pedido §2 + E + G | `scripts/build-base.mjs`, `src/infrastructure/base/*`, `src/infrastructure/db/schema.ts`, `bases-fonte/` |
| CNAE-02 | Motor em **duas camadas**: (1) `regrasDoCnae(cnae7)` — sempre, 1.090 (anexo/situação/Fator R/vedação, + caminho bens→NCM); (2) enriquecimento NBS só nos 508 × `resolverClassificacoesNbs` → `VereditoNbs{…, anoReferencia}` com **cache por NBS (~588 únicas)** + ranking/plausível p/ 98-NBS | pedido §1 + B + C + D + F | novo `src/domain/services/cnae-nbs.ts` (+ `regras-cnae.ts` ou mesma unidade) + `src/application/consultar-por-cnae.ts` |
| CNAE-03 | Menu "Consulta de CNAEs": **busca nos 1.090**; tabela estilo SISCOMEX (coluna NBS = contagem ou badge `sem-NBS`); Anexo/Situação sempre preenchidos; painel = bloco Regras (sempre) + bloco NBS/Reforma (condicional: ranking + NBS mais provável + UX de escolha) + template consolidado | pedido §4 + A + F | `src/pages/ConsultaCnaes.tsx`, `src/store/consulta-cnaes.ts`, `src/ui/cnaes.tsx`, `src/App.tsx`, `src/store/ui.ts`, `src/ui/Layout.tsx` |
| CNAE-04 | CNPJ enriquecido: Serviços + Simples listam NBS com flags/ano; **CNAE de bens → regras + `sem NBS aplicável (bens → NCM)`**; fora dos 508 → regra completa + `sem-mapeamento-NBS` + fallback Phase 7. DAS intocado | pedido §1 + D + H.3 | `src/application/consultar-por-cnpj.ts`, `src/ui/servicos.tsx`, `src/simples/store.ts`, `src/simples/page.tsx` |
| CNAE-05 | Chat IA: anexo/situação/vedação valem p/ **qualquer dos 1.090**; NBS/benefício só onde há link (+ ano); sem lastro = honesto. Tool `consultarCnaeNbs` | pedido §3 + H.4 | `detector-chat.ts`, `aurum-ai-tools.ts`, `aurum-ai-registro-ferramentas.ts`, `aurum-ai-chat.ts` |
| CNAE-06 | Chaos expandido (sorteio fora-508, 3 anos, cache, divergência, template; preserva `__COMPARAR`, rollback, degradação) + gate `tsc 0 + npm test` ≥85% | padrão + I | `tests/cnae-nbs*.test.ts`, `docs/chaos-phase-09.md` |
| CNAE-07 | Docs + UAT: MANIFEST (`cnaesComRegras/cnaesComNbs` + conferência), verbetes, aceite por CNAE (incl. bens e 98-NBS) | pedido + H.5 | `docs/*`, `ROADMAP.md`, `REQUIREMENTS.md` |

## 4. Tracer Slice (verify first — executar antes de tudo, 1 dia)

**09-00 Tracer (duplo, cobre as duas camadas):**
- (a) `0161-0/01` (1 NBS, serviço): `npm run base` → `db.cnaeNbs` tem `0161-0/01 → 1.1803.21.00` → `regrasDoCnae` retorna Anexo/Situação/Fator R → enriquecimento retorna 1 `VereditoNbs` com `anoReferencia` → view `cnaes` renderiza bloco Regras + 1 NBS + badge Reforma com ano.
- (b) 1 CNAE de bens fora dos 508 (sorteio, ex. indústria/comércio): `regrasDoCnae` retorna regra completa + caminho `sem NBS aplicável — atividade de bens (ver NCM)`; painel mostra bloco Regras e **omite** bloco NBS sem erro.
- Pass criteria: `tsc 0`, 2 testes tracer verdes, `MANIFEST` com `cnaesComRegras/cnaesComNbs`, 1.090 + 122 intactos.

Só após tracer verde, expandir 09-01..09-06.

## 5. Plans

### 09-01 — Base viva + conferência + template + Dexie v13 [CNAE-01, E, G]
**Goal:** `npm run base` ingere o anexo com descrições conferidas e proveniência.
**Tasks:**
1. Copiar anexo para `bases-fonte/CNAE X NBS.qualclasstrib.json`; `build-base.mjs:main` localiza 6º arquivo; novo `normalizarCnaeNbs()`: parse `por_codigo` + `fallback-cnae-links` (677) + `fallback-relations` (1.739), `fixLatin1()`, descarta `respostas_de_rede[2]` (url com `google`), valida NBS 9 díg. + CNAE `XXXX-X/XX`, dedupe `cnae7|nbs`.
2. **Conferência entre tabelas (E):** para cada código CNAE, comparar presença nas fontes (qualclasstrib × base oficial NBS × auxiliares). Códigos batem → consolida descrições em **TEMPLATE** `{codigo, descricao, anexoSimples, situacao, fatorR, vedacoes, nbsVinculadas[], beneficiosReforma[]}` → store **`classificacoesConsolidadas`**. Divergência de código → `divergencia`/`sem-mapeamento`, NÃO consolida. Mesmo código, descrição diferente → precedência **oficial > qualclasstrib > auxiliar** (documentar escolha no código + docs). Descrições das ~588 NBS vêm das outras tabelas; nenhuma tem → `nbsSemDescricao`.
3. Emite `public/base/cnae-nbs.json` (+ `classificacoes-consolidadas.json`) + `MANIFEST.{fontesVivas:{qualclasstrib:{origem, licenca, capturaEm, cadencia, notaRede}}, estatisticas:{cnaesComRegras:1090, cnaesComNbs:508, cnaeNbsLinks:~6641, nbsUnicas:~588, lcLinks:677, lcNbs:1739, descricoesConferidas, descricoesDivergentes}}`.
4. Dexie v13 (`DB_VERSION 12→13`, demais intactas): `cnaeNbs: '++id, cnae7, nbs, [cnae7+nbs]'`, `lcNbs: '++id, lc, nbs, cct, [lc+nbs]'`, **`classificacoesConsolidadas: 'cnae7'`**. `STORES` em `domain/constants/index.ts`. `base-service.ts` importa sem `clear`; `statusBase` mostra `1.090 regras · 508 com NBS`.
**Verify:** `npm run base` verde; MANIFEST com os 8 stats; `db.cnaeNbs` conta links; template de `0161-0/01` íntegro; divergência simulada marca sem consolidar; `cnae-nbs-base.test.ts` (mojibake, descarte Google, dedupe, precedência, `nbsSemDescricao`).
**Checkpoint:** migração Dexie v13 (one-way) — backup/rollback obrigatório.
**Prohibition:** MUST NOT `clear()` em `db.cnae`/`db.nbs`; MUST NOT embutir JSON bruto no bundle; MUST NOT consolidar com código divergente.

### 09-02 — Motor duas camadas + ano + cache por NBS [CNAE-02, B, C, D, F]
**Goal:** todo CNAE responde regra; 508 enriquecem com veredito anual econômico.
**Tasks:**
1. Camada 1 — `regrasDoCnae(cnae7)`: lê `db.cnae`/`classificacoesConsolidadas` → `{anexoSimples, situacao, fatorR, vedacaoTextual, ehBens}`. `ehBens` = divisão CNAE industrial/comercial sem NBS aplicável (lista de divisões, ex. C/10–33 indústria, G/45–47 comércio — refinar no tracer). Sempre retorna; CNAE inexistente → `cnae-desconhecido` (manual), nunca `sem regra`.
2. Camada 2 — enriquecimento (só 508): candidatos `db.cnaeNbs` → **`cache de veredito POR NBS`** (`Map`/Dexie `vereditosNbs`, chave `nbs+anoReferencia`, ~588 entradas) → miss chama `resolverClassificacoesNbs` + `calcularTributos(base, red, refPorAno(ano))` → `VereditoNbs{nbs, descricao, cst, cClassTrib, reducaoIBS/CBS, aliquotas, baseLegal, anexoLC214, anoReferencia, temBeneficio, semLastro}`. Fora dos 508 → `{sem-mapeamento-NBS}` + fallback Phase 7; `ehBens` → `{semNbsAplicavelBens: 'ver NCM'}` (D.1 — badge distinto, não `sem-mapeamento`).
3. `refPorAno(anoReferencia)` (novo, `domain/services/calculo.ts` ou `referencia-service.ts`): `2026 → {IBS: 0.1, CBS: 0.1}` (ano-teste LC 214); `2027 → CBS plena (≈8.8, `CBS_REF_PADRAO`) + IBS teste`; `2033 → REF_DEFAULT {19, 9}` (final); anos intermediários documentados (2029–2032 transição IBS×ICMS/ISS — regra: interpolar/declarar `em-transicao`, nunca número inventado; default = 2033 + aviso). `REF_DEFAULT` fixo mantido como fallback.
4. **98-NBS (F):** ranking por plausibilidade — score = `divisão CNAE↔grupo NBS` (reuso `PALAVRAS_CHAVE_NBS_POR_DIVISAO` + `pinsHipotesesPorCnae`) + `tetoConfiancaCnae` + `temBeneficio`; retorna `{maisProvavel, ranking[], ambiguo: n>threshold}`; UI escolhe (09-03). Teto + `verificarCoerenciaServico` reaproveitados.
5. `consultar-por-cnae.ts`: `consultarPorCnae(cnae7, {anoReferencia=2033})` orquestra camada1 + camada2 + `resumirCnae()` + auditoria.
**Verify:** `0161-0/01`→1 veredito com ano; `0162-8/99`→25 ranqueados; `4322-3/03`→98 com `maisProvavel` destacado; CNAE bens → regra + badge bens→NCM; fora-508 → regra + `sem-mapeamento`; cache: 2ª consulta do mesmo NBS não re-chama resolvedor (contador em teste); anos 2026/2027/2033 precificam diferente; suíte ≥18 casos.
**Prohibition:** MUST NOT exibir redução sem resolvedor; MUST NOT cachear por CNAE (chave é `nbs+ano`); MUST NOT precificar ano de transição sem marcar `em-transicao`.

### 09-03 — UI Consulta de CNAEs nos 1.090 [CNAE-03, A, F]
**Goal:** busca total, regra sempre, NBS condicional com UX de escolha.
**Tasks:**
1. `src/store/consulta-cnaes.ts`: `busca, consultarCnae, sugerirCnae` sobre 1.090 + `registrarLimpeza('cnaes')`; seletor de `anoReferencia` (2026/2027/2033, default 2033).
2. `src/pages/ConsultaCnaes.tsx`: tabela `TabelaGenerica`-style (`Código | Descrição | Anexo Simples | Situação | NBS | Benefício`) paginada `PAGE_SIZE=10`, debounce 150ms; coluna NBS = contagem (`98 NBS`) ou badge `sem-NBS` (bens) / `s/mapeamento` (serviço fora-508); Anexo/Situação **sempre** preenchidos (invariante A.2 — célula nunca vazia).
3. Painel = **bloco Regras (sempre)**: anexo, situação, Fator R, vedação textual, template consolidado + **bloco NBS/Reforma (condicional)**: (i) NBS mais provável em destaque, (ii) ranking com plausibilidade, (iii) UX de escolha quando `ambiguo` (radio/select → fixa `nbsEscolhida` + recalcula veredito), (iv) badge do ano; bens → bloco bens→NCM com link `trocarView('consulta')`.
4. Shell: `ViewId += 'cnaes'`, `VIEW_META.cnaes`, `App.tsx` case, `Layout NAV`, `registrarExportador('cnaes')`.
5. `src/ui/cnaes.tsx`: `CartaoCnaeNbs`, `FaixaCnae` reutilizada, `LinhaNbsBeneficio`, `SeletorNbsAmbigua`, `BlocoRegrasCnae`.
**Verify:** busca `0161` acha; sorteio de 5 CNAEs fora-508 todos com regra; `4322-3/03` mostra destaque + ranking + escolha funcional; filtro/paginação ok; `tsc 0`; `consulta-cnaes.test.ts` (invariante: 1.090 com regra, zero `sem regra`).
**Checkpoint:** `ViewId`/rótulo "Consulta de CNAEs" (one-way visual).

### 09-04 — CNPJ enriquecido com bens e sem-link [CNAE-04, D, H.3]
**Goal:** CNPJ traz regra sempre + NBS quando couber.
**Tasks:**
1. `classificarAtividade`: camada1 `regrasDoCnae` sempre + camada2 best-effort (cache por NBS; no CNPJ com 98 NBS o cache evita 98× `calcularTributos` — B.3); `AtividadeCnae += {regras, nbsLista, nbsComBeneficio, maisProvavel, estadoNbs: 'mapeado'|'sem-mapeamento'|'bens→NCM', anoReferencia}`.
2. `CartaoCnae`: bloco Regras compacto sempre + seção NBS colapsável (destaque + ranking resumido + scroll `max-h`); bens → faixa `sem NBS aplicável — atividade de bens (ver NCM)` + botão ir à Consulta NCM.
3. Simples `buscarPorCnpj`/`page.tsx`: mesma regra; NBS informativo antes do cálculo. **DAS intocado.**
**Verify:** CNPJ `0161-0/01`→1 NBS; `4322-3/03`→98 com 1 chamada resolvedor/NBS (cache); bens→faixa NCM; fora-508→regra + `sem-mapeamento` + fallback; `servicos-cnpj.test.ts` estendido, Simples sem regressão.
**Prohibition:** MUST NOT alterar `src/simples/calculo.ts`.

### 09-05 — IA: regra p/ 1.090, NBS só com link [CNAE-05, H.4]
**Goal:** chat nunca deixa CNAE sem resposta; NBS só com lastro + ano.
**Tasks:**
1. `detector-chat.ts`: sinais `cnae + (nbs|beneficio|reforma|anexo|vedado|fatorR)`; `extrairCnae` com lastro `nbs|beneficio`; ordem antes de `generico`.
2. `PLANO_TOOL_CALLING`: `consultarCnaeNbs` (inputs `cnae, anoReferencia?`; guardrails: regra sempre dos 1.090; NBS/benefício só com link; bens→NCM; sem lastro→`sem-mapeamento` honesto).
3. `REGISTRO_FERRAMENTAS` + `executarFerramenta` (dynamic import, sem rede).
4. `responderCnae` expandido: bloco Regras (todo CNAE) + bloco NBS (condicional: destaque+ranking resumido+ano) + botão `Abrir Consulta de CNAEs`; `responderCnpj`/`responderSimples` anexam `NBS: N (M com benefício, ref. <ano>)` ou faixa bens.
**Verify:** `responderChat('CNAE 0161-0/01 quais NBS e benefícios?')` cita NBS + ano; CNAE bens → regra + NCM; fora-508 → regra + honesto; suíte ≥14 casos.

### 09-06 — Chaos expandido, docs, UAT [CNAE-06, CNAE-07, I]
**Goal:** provar ≥85% com os novos casos.
**Tasks:**
1. Chaos 22 casos (16 anteriores + 6 novos): (a) sorteio fora-508 → regra + sem-NBS, nunca sem-regra; (b–d) veredito 2026/2027/2033 difere; (e) cache por NBS (contador resolvedor = nº NBS únicas); (f) conferência divergente → `divergencia` sem consolidar; (g) template consolidado reutilizado em menu+CNPJ+chat; (h) CNAE bens → faixa NCM; (i) 98-NBS destaque+escolha. Preserva: `__COMPARAR` intacto, rollback v12→v13, base sem 5 arquivos degrada.
2. Suítes + gate `≥85% (19/22)` + `tsc 0 + npm test` verde; `docs/chaos-phase-09.md`.
3. Docs: verbete `CNAE→NBS (regra sempre; NBS condicional; ano ref.)`; `TOOLS`/`VIEWS`; `bases-fonte/README.md`; precedência de descrição documentada.
4. UAT: buscar `0161-0/01`, abrir `4322-3/03` (escolher NBS), CNAE bens, CNPJ real, chat — aceite assinado.
**Verify:** tabela caso→esperado→obtido→pass/fail + taxa; <85% → refinar (máx 3 iterações).

## 6. File Map (create / patch)

**Create:** `src/domain/services/cnae-nbs.ts` (camadas 1+2, cache, ranking, `refPorAno`), `src/application/consultar-por-cnae.ts`, `src/pages/ConsultaCnaes.tsx`, `src/store/consulta-cnaes.ts`, `src/ui/cnaes.tsx`, `bases-fonte/CNAE X NBS.qualclasstrib.json`, `public/base/cnae-nbs.json` + `classificacoes-consolidadas.json` (gerados), `tests/cnae-nbs-base.test.ts`, `tests/cnae-nbs-motor.test.ts` (+ano/cache/bens), `tests/consulta-cnaes.test.ts` (invariante 1.090), `tests/chat-cnae-nbs.test.ts`, `tests/cnae-nbs-chaos.test.ts`, `docs/chaos-phase-09.md`, `09-PLAN.md` (este), `09-RESEARCH.md`.
**Patch:** `scripts/build-base.mjs` (6º arquivo + conferência + MANIFEST proveniência/stats), `src/infrastructure/db/schema.ts` (v13 + `classificacoesConsolidadas`), `src/domain/constants/index.ts` (`DB_VERSION`, `STORES.*`), `src/domain/services/calculo.ts` ou `referencia-service.ts` (`refPorAno`), `src/infrastructure/base/normalizacao.ts` (`fixLatin1` + precedência), `src/infrastructure/base/base-service.ts`, `src/infrastructure/base/classificacao-repo.ts` (se preciso), `src/application/consultar-por-cnpj.ts`, `src/ui/servicos.tsx`, `src/simples/store.ts` + `page.tsx`, `detector-chat.ts`, `aurum-ai-tools.ts`, `aurum-ai-registro-ferramentas.ts`, `aurum-ai-chat.ts`, `aurum-ai-conhecimento.ts`, `aurum-ai-recursos.ts`, `src/store/ui.ts`, `src/App.tsx`, `src/ui/Layout.tsx`, `menu-exportacao.ts`, `bases-fonte/README.md`, `MANIFEST.json` (gerado), `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md`.

## 7. Success Criteria (all TRUE — rev. 2, item J)

1. `npm run base`: MANIFEST com `cnaesComRegras: 1090`, `cnaesComNbs: 508`, `descricoesConferidas`/`descricoesDivergentes`, links ~6,6k, sem regredir 1.090 + 122.
2. `0161-0/01` exibe Anexo, vedação, 1 NBS e veredito do resolvedor com `anoReferencia`.
3. CNPJ (Serviços e Simples) lista NBS por CNAE com flags de benefício; CNAE de bens aponta NCM; fora dos 508 mostra regra + sem-NBS + fallback.
4. Chat responde CNAE→NBS→benefício e cita NBS no CNPJ do Simples; sem lastro = sem-mapeamento honesto.
5. `tsc 0 + npm test` verde; chaos ≥85% com os novos casos documentado; UAT assinado.
