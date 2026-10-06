# Roadmap: Aurum Tax NCM

## Overview

Da fundação técnica (Electron + React + Dexie) até um classificador tributário completo: importação de base NCM oficial, engine de classificação pela LC 214/2025, interface de busca/filtro/edição, e geração de relatórios de adequação fiscal para contadores e departamentos fiscais.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Data Layer** - Setup Electron/React/Dexie, import NCM base, persistência local
- [ ] **Phase 2: Classification Engine** - Regras LC 214/2025, classificação automática, override manual
- [ ] **Phase 3: Search & UI** - Busca/filtro performática, tabela virtualizada, dashboard, atalhos
- [ ] **Phase 4: Reporting & Export** - Excel/PDF/CSV, backup/restore, validação final
- [x] **Phase 7: Menu Serviços (NBS + CNAE + CNPJ)** - Consulta NBS manual + automática por CNPJ com a Aurum AI — **IMPLEMENTADA** (ver Phase Details)
- [ ] **Phase 9: Consulta de CNAEs (CNAE → NBS → Reforma)** - Menu novo + tabela CNAE×NBS (508 links qualclasstrib) + confronto Reforma por NBS + CNPJ e chat enriquecidos (ver Phase Details, `.planning/phase-09/09-PLAN.md`)

## Phase Details

### Phase 1: Foundation & Data Layer
**Goal**: Aplicação Electron funcional com base NCM importada e persistida localmente
**Depends on**: Nothing (first phase)
**Requirements**: [IMP-01, IMP-02, IMP-03, IMP-04, PER-01, PER-02, UI-04, UI-05]
**Success Criteria** (what must be TRUE):
  1. App Electron inicia e carrega interface React sem erros
  2. Importa arquivo CSV/XLSX oficial da Receita Federal (~10k códigos) em <5s
  3. Dados persistem em IndexedDB via Dexie e sobrevivem a reinício do app
  4. Dashboard mostra contadores por regime (inicialmente "Não classificado")
  5. Tema claro/escuro alterna e persiste preferência
  6. Configurações (último arquivo, tema) persistem entre sessões
**Plans**: 4 plans

Plans:
- [ ] 01-01: Scaffold Electron + Vite + React + TypeScript + Tailwind + Dexie + Zustand
- [ ] 01-02: Schema Dexie (NCM, Classification, Settings), migrações, índices de busca
- [ ] 01-03: Importador NCM (parser CSV/XLSX, validação, bulk insert otimizado, progresso)
- [ ] 01-04: Dashboard inicial, persistência de tema/settings, barra de status

### Phase 2: Classification Engine
**Goal**: Classificação automática por LC 214/2025 + edição manual com auditoria
**Depends on**: Phase 1
**Requirements**: [CLS-01, CLS-02, CLS-03, CLS-04, CLS-05]
**Success Criteria** (what must be TRUE):
  1. Engine classifica 100% da base NCM em <2s usando regras determinísticas
  2. Regras implementadas: Anexo I (IS), Anexo II (Imune/Isento), demais CBS+IBS
  3. Usuário pode sobrescrever classificação com justificativa obrigatória
  4. Histórico de alterações: mostra classificação anterior, nova, usuário, timestamp
  5. Validação impede regimes conflitantes para mesmo NCM
**Plans**: 4 plans

Plans:
- [ ] 02-01: Motor de regras LC 214 (Anexo I IS, Anexo II Imune/Isento, fallback CBS+IBS)
- [ ] 02-02: Classificação em lote (batch) com relatório de conflitos/não classificados
- [ ] 02-03: UI de override manual (modal, seletor regime, campo observação, validação)
- [ ] 02-04: Auditoria de classificação (log imutável, visualização por NCM)

### Phase 3: Search & UI
**Goal**: Interface completa de busca, navegação e edição eficiente para 10k+ registros
**Depends on**: Phase 2
**Requirements**: [SRCH-01, SRCH-02, SRCH-03, SRCH-04, SRCH-05, UI-01, UI-02, UI-03, UI-06]
**Success Criteria** (what must be TRUE):
  1. Busca por código/descrição retorna resultados em <100ms (índices Dexie)
  2. Tabela virtualizada renderiza 10k linhas sem travamento (react-window/virtuoso)
  3. Filtros combinados (regime + origem + texto) aplicados instantaneamente
  4. Painel de detalhes mostra info completa do NCM selecionado
  5. Atalhos de teclado: Ctrl+K (buscar), Enter (editar), Setas (navegar), Esc (fechar)
**Plans**: 5 plans

Plans:
- [ ] 03-01: Índices Dexie otimizados (código, descrição, regime, origem) + hooks de busca
- [ ] 03-02: Tabela virtualizada (colunas: NCM, Descrição, Regime, Alíquotas, Origem, Ações)
- [ ] 03-03: Painel lateral de detalhes + modal de edição inline
- [ ] 03-04: Barra de filtros combinados + contador de resultados
- [ ] 03-05: Atalhos de teclado, navegação acessível, foco management

### Phase 4: Reporting & Export
**Goal**: Relatórios de adequação fiscal prontos para entrega a clientes/auditoria
**Depends on**: Phase 3
**Requirements**: [RPT-01, RPT-02, RPT-03, RPT-04, PER-03, PER-04]
**Success Criteria** (what must be TRUE):
  1. Exporta Excel completo com todas as colunas requeridas, formatação profissional
  2. Exporta PDF resumido (totais por regime, alertas, rodapé com data/versão)
  3. Exporta CSV layout ERP (cabeçalho fixo, encoding UTF-8, separador ;)
  4. Relatório inclui seção "Pendências": NCMs não classificados + manuais sem revisão
  5. Backup/restore do banco funcional (arquivo portável entre máquinas)
**Plans**: 4 plans

Plans:
- [ ] 04-01: Gerador Excel (SheetJS/xlsx) com abas: Detalhe, Resumo, Pendências
- [ ] 04-02: Gerador PDF (pdfmake/jsPDF) resumo executivo + anexo detalhado opcional
- [ ] 04-03: Exportador CSV layout ERP + validador de schema
- [ ] 04-04: Backup/restore banco (export/import JSON), validação de integridade

### Phase 5: Calculadora Tributária & Validação Avançada
**Goal**: Melhorias na Calculadora Tributária (resumo lateral, reduções explícitas, análise de múltiplas classificações, validação contra anexos, atualização automática de bases oficiais)
**Depends on**: Phase 4
**Requirements**: [CALC-01, CALC-02, CALC-03, CALC-04, CALC-05]
**Success Criteria** (what must be TRUE):
  1. Resumo do cálculo (lateral direita) mostra explicitamente cada redução de alíquota aplicada por item/produto
  2. Quando houver múltiplas classificações para um NCM, o sistema apresenta análise comparativa para o usuário escolher
  3. Sistema valida se produto não foi vetado pelos anexos da LC 214/2025 e confirma tributação correta
  4. Ao iniciar, o sistema verifica e atualiza automaticamente as bases oficiais (NCM, nomenclatura, classificação tributária)
  5. Indicadores visuais claros de redução (percentual, base legal, artigo da lei) no resumo e nos itens
**Plans**: 5 plans

Plans:
- [ ] 05-01: Resumo do cálculo - exibição explícita de reduções por item (percentual, base legal, artigo)
- [ ] 05-02: Análise comparativa quando múltiplas classificações existem para mesmo NCM
- [ ] 05-03: Validação contra anexos da LC 214/2025 (vetos, tributação correta, alertas)
- [ ] 05-04: Atualização automática de bases oficiais na inicialização (NCM, nomenclatura, classificação)
- [ ] 05-05: Testes de integração e UAT para validação completa do fluxo

### Phase 6: Módulo IA Offline para Classificação NCM
**Goal**: IA como camada superior ao `classificarPorDescricao` existente — sugere NCM (somente 8 dígitos, sem NBS) só quando o determinístico retorna null/baixa; LLM local como seletor Top-5 RAG e `resolverClassificacoes` como única verdade, falha segura NÃO SEI
**Depends on**: Phase 5
**Requirements**: [IA-00, IA-01, IA-02, IA-03, IA-04, IA-05, IA-06, IA-07, IA-08, IA-09, IA-10]
**Success Criteria** (what must be TRUE):
  1. Consulta fácil resolve no determinístico sem acionar worker IA (`via: deterministico`)
  2. Consulta difícil aciona IA com candidatos auditáveis e validação determinística 100% (`via: ia`)
  3. Baixa confiança retorna NÃO SEI sem alucinar código; `taxa_uso_ia` <30%
  4. Funciona 100% offline (CPU, sem GPU) nos 3 instaladores ≤300MB; spike 06-00 GO
  5. Trilha completa em Dexie `audit_log` + `logs/*.jsonl` com campo `via`
  6. ≥85% acerto em massa de controle + 37 suítes legadas verdes
**Plans**: 11 plans

Plans:
- [ ] 06-00: Spike viabilidade (`node-llama-cpp` + `utilityProcess`, GO/NO-GO 3 OS)
- [ ] 06-01: Diagnóstico e Preparação (`recursos-ia/`, CHECKSUMS, .gitignore)
- [ ] 06-02: Curadoria NCM-only (`ncm-para-ia.json` 2335 NCMs, validador)
- [ ] 06-03: Índice Vectra RAG (<200MB, rebuild por MANIFEST)
- [ ] 06-04: Modelo AILO-152M-v2 q4_k_m (prompt restrito, <5s)
- [ ] 06-05: Worker Electron tracer (`utilityProcess`, IPC, DebugIA Ctrl+Shift+D)
- [ ] 06-06: Fluxo Consulta fallback (determinístico→IA→resolver→cálculo→audit com `via`)
- [ ] 06-07: Empacotamento offline (NSIS/DMG/AppImage)
- [ ] 06-08: Proteção (ofuscação + cifragem GGUF)
- [ ] 06-09: Testes e observabilidade (30+10+5 + bypass, perf, dashboard `taxa_uso_ia`)
- [ ] 06-10: Docs e entrega (arquitetura, manual, troubleshooting, dossiê)

**Scope note**: Somente NCM. NBS explicitamente fora de escopo neste módulo.

### Phase 7: Menu Serviços (NBS + CNAE + CNPJ) — IMPLEMENTADA
**Goal**: Tela Serviços com 2 modos (manual NBS + automático por CNPJ), mesma experiência da Consulta NCM, 100% ancorada nas bases oficiais + 2 arquivos vivos versionados, usando a mesma Aurum AI (GATE determinístico → fallback, mesma trilha)
**Depends on**: Phase 6 (reusa GATE, worker por índice, `taxa_uso_ia`, trilha `audit_log` + `.jsonl`)
**Requirements**: [SER-01, SER-02, SER-03, SER-04, SER-05]
**Success Criteria** (all TRUE, verificado em 2026-10-03: `tsc` 0 + 648/648 testes):
  1. `npm run base` ingere `CNAE X ANEXO.json` (1090) + `NBS SERVIÇOS.json` (137→112 dedupe) com `MANIFEST.fontesVivas`
  2. `122011100 → 200/200028 Anexo II 60%` pelo resolvedor NBS; regra geral `000/000001` fora da base
  3. Descrição livre ("aula de inglês online") ancora no NBS via determinístico/IA; sem lastro = NÃO SEI
  4. CNPJ via BrasilAPI (DV local + CNAE + cache 30d) rende 1 cartão elegante por CNAE (teto matriz por Situação)
  5. Alíquotas sempre de `calcularTributos` + `REF_DEFAULT`; rótulos "Anexo Simples" vs "Anexo LC 214" separados
**Plans**: 6 plans (todos executados)
- [x] 07-01: Base viva + tracer Serviços (cnae.json, Dexie v11, `resolverClassificacoesNbs`, view `servicos`)
- [x] 07-02: Busca textual NBS + IA de serviços (vocabulário/sinais próprios, GATE `dominio nbs`, ficha absoluta NBS)
- [x] 07-03: Ponte CNAE→NBS (matriz Situação→teto, palavras-chave por divisão, Fator R como refino)
- [x] 07-04: Consulta por CNPJ (BrasilAPI estendida com CNAE, `consultasCnpj` TTL, veredito por atividade)
- [x] 07-05: UI Serviços completa (2 abas/modos, `CartaoCnae`/`FaixaCnae`, modais glass reutilizados, Ctrl+E via registro)
- [x] 07-06: Testes (4 suítes novas, 41 testes) + versionamento vivo + docs

### Phase 8: Refinos de Interação Aurum AI (Simples, Tools, Probabilístico, Memória) — PLANNED
**Goal**: Eliminar contradição Fator R em Anexo I/II/IV, inferir anexo por atividade, comparar anexos e Conv×Híb no chat, dispatcher determinístico RAG+lexical, P(anexo) calibrado, memória por emitente, chaos ≥85% + FineTuning
**Depends on**: Phase 7
**Requirements**: [REF-01..REF-12]
**Success Criteria** (all TRUE):
  1. Print Anexo I refeito sem `Fator R` nem `III × V`, DAS correto + 2 botões comparativos
  2. 36 expressões de atividade inferem anexo certo ou perguntam (nunca chute confiante)
  3. `__COMPARAR_ANEXOS/HIBRIDO__` rodam matriz real com valores da conversa + veredito
  4. Roteador cobre 15 tools com trilha; P(anexo) com limiares 0.75/0.40; memória por emitente (troca empresa mantém)
  5. 22 chaos ≥85% documentados + `tsc 0 + npm test` verde + UAT aprovado
**Plans**: 7 plans (tracer 08-00 + 08-01..08-06)
- [x] 08-00: Tracer Anexo I sem Fator R + matriz via botão (verify first)
- [x] 08-01: Inferência de anexo por atividade + guard Fator R (+fix regex iv)
- [x] 08-02: Botões comparativos (matriz I–V + híbrido) com payload serializado
- [x] 08-03: Dispatcher central + roteamento dinâmico RAG+lexical (intercept __COMPARAR_*__ + sinais atividade)
- [x] 08-04: Motor probabilístico P(anexo) + ia_feedback (confiança + precisaConfirmar; FT dataset pronto)
- [x] 08-05: Memória curto + longo prazo por emitente (Dexie v12 conversasEmitente + TTL 90d/teto 30)
- [x] 08-06: Chaos 22 casos + FineTuning + eval ≥85% + docs/UAT (90,9% — docs/chaos-phase-08.md)
  (ver `.planning/phase-08/08-PLAN.md`)

### Phase 9: Consulta de CNAEs (CNAE → NBS → Reforma) — IMPLEMENTADA (2026-10-05)
**Goal**: Menu "Consulta de CNAEs" nos 1.090 (regra sempre; NBS condicional em 508) + template consolidado + veredito com ano de referência + CNPJ e chat enriquecidos
**Depends on**: Phase 7 (ponte CNAE→NBS heurística) + Phase 8 (dispatcher/tools)
**Requirements**: [CNAE-01..CNAE-07]
**Success Criteria** (all TRUE, ver `.planning/phase-09/09-PLAN.md §7 rev. 2):
  1. `npm run base`: `cnaesComRegras: 1090`, `cnaesComNbs: 508`, `descricoesConferidas/Divergentes`, ~6,6k links, sem regredir
  2. `0161-0/01` com Anexo, vedação, 1 NBS e veredito + `anoReferencia`
  3. CNPJ lista NBS com flags; bens→NCM; fora-508 = regra + sem-NBS + fallback
  4. Chat: regra p/ 1.090, NBS só com link; sem lastro honesto
  5. `tsc 0 + npm test` verde + chaos 22 casos ≥85% + UAT
**Plans**: 7 plans (tracer 09-00 + 09-01..09-06)
- [ ] 09-00: Tracer duplo `0161-0/01` (regra+NBS+ano) + CNAE bens fora-508 (regra→NCM) — verify first
- [x] 09-01: Base viva + conferência + template + Dexie v13 (proveniência, `cnaesComRegras/cnaesComNbs`, `descricoes*`)
- [x] 09-02: Motor duas camadas (`regrasDoCnae` + enriquecimento c/ cache por NBS, `refPorAno`, ranking 98-NBS)
- [x] 09-03: UI Consulta de CNAEs nos 1.090 (invariante zero-sem-regra, destaque + escolha)
- [x] 09-04: CNPJ enriquecido (regra sempre; bens→NCM; DAS intocado)
- [x] 09-05: IA chat (regra p/ 1.090, NBS só com link + ano)
- [x] 09-06: Chaos 22 + docs/UAT (rev. 2) — 22/22 100% (`docs/chaos-phase-09.md`, `docs/uat-phase-09.md` 5/5)
  (ver `.planning/phase-09/09-PLAN.md` + `09-RESEARCH.md`)

### Phase 10: Grafo Fiscal Híbrido (LadybugDB + KGLite) — IMPLEMENTADA (2026-10-06)
**Goal**: Aurum AI consulta grafo fiscal local como base/referência (multi-hop NCM→família→CCT→Anexo→Artigo + CNAE→NBS, FTS BM25 + HNSW all-MiniLM + PageRank, `via:grafo` auditável, 100% offline, fallback total) + overlay de aprendizado só-na-máquina (base congelada + `uso_local` mutável, boost com teto e travas). KGLite espelha schema em Python p/ curadoria/describe()/MCP dev.
**Depends on**: Phase 6/7/8/9
**Requirements**: [GRAFO-01..GRAFO-08]
**Success Criteria** (all TRUE, verificado em 2026-10-06: `tsc` 0 + 1621/1621 testes, chaos grafo 22/22, UAT 5/5 — ver `docs/grafo-chaos.md`, `docs/grafo-uat.md`):
  1. `npm run base` gera `grafo.lbug` versionado (MANIFEST.grafo + Dexie `grafometa`)
  2. `ia:grafo` no worker responde Cypher 2-hops <50ms; sem `.lbug` → fallback lexical bit-idêntico
  3. HNSW embarcado (1× download, CHECKSUMS) + modo FTS-puro se ausente; `taxa_uso_grafo` no DebugIA
  4. KGLite `.kgl` + audit scorecard + `describe()` no system prompt + MCP dev documentado
  5. `tsc 0 + npm test` verde + chaos 22 ≥85% (22/22 100%) + UAT
  6. Overlay `uso_local`: boost com teto no "por que sugeriu", demote/TTL/teto ativos, apagar overlay restaura base bit-idêntica
**Plans**: 7 plans (tracer 10-00 + 10-01..10-06; GRAFO-08 overlay folded em 10-02/10-03/10-05/10-06)
- [x] 10-00: Tracer GO parcial (schema OK, base 10515 NCM8 / 1671 vínculo exato ≈15,9% / 6641 links CNAE→NBS, fallback `{ok:false,fallback:'lexical'}`; nativo `@ladybugdb/core` + `kglite` instalam em 10-02/10-04) — `scripts/grafo/{schema.cypher,spike-grafo.mjs,build-grafo-kglite.py}`, `tests/grafo-tracer.test.ts` 4/4, `tsc 0`
- [x] 10-01: Schema + build do grafo [GRAFO-01] — `tests/grafo-base.test.ts` verde, MANIFEST + `grafometa`
- [x] 10-02: Runtime no worker + IPC [GRAFO-02] — `tests/grafo-ipc.test.ts` verde
- [x] 10-03: Retrieval híbrido + vetores [GRAFO-03, GRAFO-06] — `tests/grafo-hibrido.test.ts` verde
- [x] 10-04: KGLite tooling + MCP [GRAFO-04] — `tests/grafo-kglite.test.ts` verde, `docs/grafo-mcp.md`
- [x] 10-05: Consumo pela IA + UI [GRAFO-05] — `tests/ia-grafo.test.ts` verde
- [x] 10-06: Chaos + docs + UAT [GRAFO-07] — 22/22 100% (`docs/grafo-chaos.md`, `docs/grafo-uat.md` 5/5)
  (ver `.planning/phase-10/10-CONTEXT.md` + `10-RESEARCH.md` + `10-PLAN.md`)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Data Layer | 0/4 | Not started | - |
| 2. Classification Engine | 0/4 | Not started | - |
| 3. Search & UI | 0/5 | Not started | - |
| 4. Reporting & Export | 0/4 | Not started | - |
| 5. Calculadora Tributária & Validação Avançada | 0/5 | Not started | - |
| 6. Módulo IA Offline NCM | 0/11 | Not started | - |
| 7. Menu Serviços (NBS + CNAE + CNPJ) | 6/6 | **Implementada** | 2026-10-03 |