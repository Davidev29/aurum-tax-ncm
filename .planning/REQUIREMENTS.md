# Requirements: Aurum Tax NCM

**Defined:** 2026-09-29
**Core Value:** Classificação tributária precisa e automatizada que garante conformidade com a LC 214/2025, eliminando risco de multas e retrabalho fiscal.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Data Import (IMP)

- [ ] **IMP-01**: Importar tabela NCM oficial (CSV/XLSX da Receita Federal) com ~10k códigos
- [ ] **IMP-02**: Validar integridade dos dados importados (códigos únicos, descrições não vazias)
- [ ] **IMP-03**: Armazenar dados em IndexedDB via Dexie com índices para busca rápida
- [ ] **IMP-04**: Permitir reimportação/atualização da base sem perda de classificações do usuário

### Classification (CLS)

- [ ] **CLS-01**: Classificar cada NCM em regime: CBS, IBS, IS, Imune, Isento, Não Incidente
- [ ] **CLS-02**: Aplicar regras da LC 214/2025 (Anexo I - IS, Anexo II - Imunes/Isentos, demais CBS+IBS)
- [ ] **CLS-03**: Permitir classificação manual/override pelo usuário com justificativa
- [ ] **CLS-04**: Rastrear origem da classificação (automática vs manual) e data
- [ ] **CLS-05**: Validar consistência: mesmo NCM não pode ter regimes conflitantes

### Search & Filter (SRCH)

- [ ] **SRCH-01**: Buscar por código NCM (prefixo ou exato, ex: "8471" ou "84713012")
- [ ] **SRCH-02**: Buscar por descrição (texto parcial, case-insensitive)
- [ ] **SRCH-03**: Filtrar por regime tributário (múltipla seleção)
- [ ] **SRCH-04**: Filtrar por origem da classificação (automática/manual/todas)
- [ ] **SRCH-05**: Paginação/virtualização para performance com 10k+ registros

### Reporting (RPT)

- [ ] **RPT-01**: Gerar relatório Excel com colunas: NCM, Descrição, Regime, Alíquota CBS, Alíquota IBS, Alíquota IS, Origem, Data, Observação
- [ ] **RPT-02**: Gerar relatório PDF resumido (total por regime, alertas de classificação manual)
- [ ] **RPT-03**: Exportar CSV padronizado para integração com ERPs (layout definido)
- [ ] **RPT-04**: Incluir no relatório: NCMs sem classificação, classificações manuais pendentes de revisão

### User Interface (UI)

- [ ] **UI-01**: Tela principal com tabela de NCMs (virtualizada, ordenável, redimensionável)
- [ ] **UI-02**: Painel lateral de detalhes do NCM selecionado (descrição completa, regime, alíquotas, histórico)
- [ ] **UI-03**: Modal de classificação manual com seletor de regime e campo observação
- [ ] **UI-04**: Dashboard com contadores por regime e indicadores de saúde (ex: % classificado, conflitos)
- [ ] **UI-05**: Tema claro/escuro com persistência de preferência
- [ ] **UI-06**: Atalhos de teclado para navegação e ações comuns (buscar, classificar, próximo)

### Calculadora Tributária & Validação (CALC)

- [ ] **CALC-01**: Resumo do cálculo (lateral direita) exibe explicitamente cada redução de alíquota aplicada por item/produto (percentual, base legal, artigo da LC 214/2025)
- [ ] **CALC-02**: Quando existirem múltiplas classificações para um mesmo NCM, apresentar análise comparativa (tabela/lado a lado) para o usuário escolher a correta conforme o produto
- [ ] **CALC-03**: Validar se produto não foi vetado pelos anexos da LC 214/2025 e confirmar se tributação está correta (alertas visuais para inconsistências)
- [ ] **CALC-04**: Ao iniciar o sistema, verificar e atualizar automaticamente as bases oficiais (NCM vigente, nomenclatura, classificação tributária da Receita Federal)
- [ ] **CALC-05**: Indicadores visuais claros de redução nos itens da calculadora e no resumo (badge/pill com percentual, tooltip com base legal completa)

### IA Assistida Offline — NCM only, camada superior (IA)

- [ ] **IA-00**: Spike viabilidade `node-llama-cpp` + `utilityProcess` Electron 44, GO/NO-GO em Win/macOS/Linux (`docs/spike-eletron-llama.md`)
- [ ] **IA-01**: Ambiente diagnosticado, `recursos-ia/` criado, `.gguf`/índice bloqueados no git, `CHECKSUMS.txt`
- [ ] **IA-02**: Base `ncm-para-ia.json` com 2335 NCMs (8 dígitos, sem NBS), paridade com `montarClassificacao`
- [ ] **IA-03**: Índice Vectra <200MB, Frango vivo→cap.01 top-3, Notebook→84/85 top-5, rebuild por hash MANIFEST
- [ ] **IA-04**: Modelo AILO-152M-v2 q4_k_m íntegro, prompt restrito (candidato ou NÃO SEI), <5s CPU, ~300MB RAM
- [ ] **IA-05**: Worker `utilityProcess` isolado, IPC `ia:classificar`/`ia:status`, store `ia.ts`, `DebugIA.tsx` (Ctrl+Shift+D)
- [ ] **IA-06**: Fallback IA: determinístico primeiro; se null/baixa → Top5→LLM→`resolverClassificacoes`→`calcularTributos`, audit com `via`
- [ ] **IA-07**: Instaladores NSIS/DMG/AppImage offline ≤300MB, `extraResources` + `asarUnpack`, zero rede
- [ ] **IA-08**: Ofuscação worker + cifragem GGUF em repouso + rename `aux.dat`/`idx/`
- [ ] **IA-09**: Testes 30 conhecidos +10 ambíguos +5 inválidos + bypass determinístico, ≥85%, zero alucinação, perf <5s/<500MB, 37 legadas verdes
- [ ] **IA-10**: Docs arquitetura/manual/troubleshooting/dossiê + `taxa_uso_ia` (<30%), ROADMAP/REQUIREMENTS encerrados

**Scope note**: Somente NCM de 8 dígitos. NBS e códigos de 9 dígitos excluídos (os 10 ignorados do MANIFEST permanecem ignorados).

### Serviços — NBS + CNAE + CNPJ, com Aurum AI (SER) — IMPLEMENTADA (2026-10-03)

- [x] **SER-01**: Ingerir e versionar `CNAE X ANEXO.json` (1090) + `NBS SERVIÇOS.json` (137→112 dedupe) via `npm run base`, com `MANIFEST.fontesVivas` e artefato `cnae.json`
- [x] **SER-02**: Consulta manual NBS (código 9 dígitos + nome + IA por descrição), painel oficial 0/1/N, regra geral `000/000001`
- [x] **SER-03**: Ponte CNAE→NBS (matriz Situação→teto de confiança, palavras-chave por divisão, Fator R como refino; "Anexo Simples" vs "Anexo LC 214" sempre rotulados)
- [x] **SER-04**: Consulta por CNPJ via BrasilAPI (DV local, CNAE principal+secundários, cache Dexie 30d, 1 cartão elegante por atividade)
- [x] **SER-05**: Paridade UX/Aurum AI (mesmo GATE determinístico→fallback, ficha absoluta NBS, trilha `audit_log`+`.jsonl`, alíquotas de `calcularTributos`+`REF_DEFAULT`)

### Consulta de CNAEs — CNAE → NBS → Reforma (CNAE) — IMPLEMENTADA (Phase 9, 2026-10-05)

- [x] **CNAE-01**: Ingerir `qualclasstrib_completo.json` (508 CNAEs, ~6,6k links, +677 LC +1.739 LC×NBS) via `npm run base` com `fixLatin1`, descarte do tracking Google, **conferência de descrições entre fontes + template consolidado (`classificacoesConsolidadas`)**, MANIFEST com proveniência (origem/licença/captura/cadência) + `cnaesComRegras:1090, cnaesComNbs:508, descricoesConferidas/Divergentes`, Dexie v13 aditiva
- [x] **CNAE-02**: Motor em **duas camadas**: (1) `regrasDoCnae` sempre nos 1.090 (+ caminho bens→NCM); (2) enriquecimento NBS nos 508 × resolvedor → `VereditoNbs{…, anoReferencia}` (2026/2027/2033 via `refPorAno`), **cache por NBS**, ranking + destaque p/ 98-NBS
- [x] **CNAE-03**: Menu novo "Consulta de CNAEs" (**busca nos 1.090**, invariante: zero CNAE sem regra); coluna NBS = contagem ou badge `sem-NBS`; painel = bloco Regras (sempre) + bloco NBS/Reforma (condicional, destaque + ranking + escolha) + template
- [x] **CNAE-04**: CNPJ enriquecido — Serviços + Simples: regra sempre; NBS com flags/ano onde há link; **bens → faixa NCM**; fora-508 → regra + `sem-mapeamento-NBS` + fallback (DAS intocado)
- [x] **CNAE-05**: Chat IA — regra (anexo/situação/vedação) p/ qualquer dos 1.090; NBS/benefício (+ano) só com link; sem lastro honesto
- [x] **CNAE-06**: Chaos 22 casos (sorteio fora-508, 3 anos, cache, divergência, template, bens, 98-NBS; preserva `__COMPARAR`/rollback/degradação), gate `tsc 0 + npm test` ≥85%
- [x] **CNAE-07**: Docs + UAT (MANIFEST completo, precedência oficial>ponte>auxiliar documentada, aceite incl. bens e 98-NBS)

### Persistence & Settings (PER)
- [ ] **PER-01**: Persistir classificações do usuário em IndexedDB (sobrevivem a reinícios)
- [ ] **PER-02**: Persistir configurações: tema, caminho último arquivo importado, preferências de exportação
- [ ] **PER-03**: Backup/exportar banco local (arquivo .json ou .sqlite) para portabilidade
- [ ] **PER-04**: Restaurar banco a partir de backup

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features (ADV)

- **ADV-01**: Comparar duas versões de base NCM (diff de códigos/descrições)
- **ADV-02**: Regras de classificação personalizadas (DSL para lógicas complexas por setor)
- **ADV-03**: Auditoria completa (log de todas as alterações com usuário/timestamp)
- **ADV-04**: Múltiplas empresas/bases NCM isoladas no mesmo app

### Integration (INT)

- **INT-01**: API REST local para integração com sistemas internos
- **INT-02**: Conectores pré-definidos (Totvs Protheus, SAP B1, Domínio, ContaAzul)
- **INT-03**: Sincronização em nuvem (opcional, multi-tenant)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cálculo de crédito tributário (CBS/IBS) | Escopo de apuração, não classificação; regras complexas por operação |
| Classificação de serviços (Código de Serviço) | LC 214/2025 foca em bens; serviços têm legislação distinta |
| Versão web/SaaS com multi-tenancy | Requer autenticação, billing, infra; desktop-first MVP |
| Integração direta com ERPs via API | APIs proprietárias, suporte contínuo; exportação CSV resolve v1 |
| Assinatura digital de relatórios | Requer certificado digital, infra PKI; PDF assinado v2+ |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| IMP-01 | Phase 1 | Pending |
| IMP-02 | Phase 1 | Pending |
| IMP-03 | Phase 1 | Pending |
| IMP-04 | Phase 1 | Pending |
| CLS-01 | Phase 2 | Pending |
| CLS-02 | Phase 2 | Pending |
| CLS-03 | Phase 2 | Pending |
| CLS-04 | Phase 2 | Pending |
| CLS-05 | Phase 2 | Pending |
| SRCH-01 | Phase 3 | Pending |
| SRCH-02 | Phase 3 | Pending |
| SRCH-03 | Phase 3 | Pending |
| SRCH-04 | Phase 3 | Pending |
| SRCH-05 | Phase 3 | Pending |
| RPT-01 | Phase 4 | Pending |
| RPT-02 | Phase 4 | Pending |
| RPT-03 | Phase 4 | Pending |
| RPT-04 | Phase 4 | Pending |
| UI-01 | Phase 3 | Pending |
| UI-02 | Phase 3 | Pending |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 1 | Pending |
| UI-05 | Phase 1 | Pending |
| UI-06 | Phase 3 | Pending |
| PER-01 | Phase 1 | Pending |
| PER-02 | Phase 1 | Pending |
| PER-03 | Phase 4 | Pending |
| PER-04 | Phase 4 | Pending |
| CALC-01 | Phase 5 | Pending |
| CALC-02 | Phase 5 | Pending |
| CALC-03 | Phase 5 | Pending |
| CALC-04 | Phase 5 | Pending |
| CALC-05 | Phase 5 | Pending |
| IA-00 | Phase 6 | Pending |
| IA-01 | Phase 6 | Pending |
| IA-02 | Phase 6 | Pending |
| IA-03 | Phase 6 | Pending |
| IA-04 | Phase 6 | Pending |
| IA-05 | Phase 6 | Pending |
| IA-06 | Phase 6 | Pending |
| IA-07 | Phase 6 | Pending |
| IA-08 | Phase 6 | Pending |
| IA-09 | Phase 6 | Pending |
| IA-10 | Phase 6 | Pending |
| CNAE-01 | Phase 9 | Implemented |
| CNAE-02 | Phase 9 | Implemented |
| CNAE-03 | Phase 9 | Implemented |
| CNAE-04 | Phase 9 | Implemented |
| CNAE-05 | Phase 9 | Implemented |
| CNAE-06 | Phase 9 | Implemented |
| CNAE-07 | Phase 9 | Implemented |

**Coverage:**
- v1 requirements: 42 total (31 + 11 IA NCM-only com spike 06-00)
- Mapped to phases: 42
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-29*
*Last updated: 2026-09-30 — Phase 6 IA NCM-only camada superior + spike 06-00, atalho Ctrl+Shift+D, 37 suítes*