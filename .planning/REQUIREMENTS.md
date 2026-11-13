# Requirements: Aurum Tax NCM

**Defined:** 2026-09-29 · **Atualizado:** 2026-11-13 (v1.1.0) — todas as entregas v1.0.0 marcadas
**Core Value:** Classificação tributária precisa e automatizada que garante conformidade com a LC 214/2025, eliminando risco de multas e retrabalho fiscal.

> Nota de interpretação: o projeto nasceu mirando Dexie/IndexedDB; na reconstrução para a v1.0.0 (2026-10) a persistência passou a **Prisma + SQLite** e a IA passou a ser **100% determinística local** (o LLM local foi removido do runtime). As marcações de requisitos refletem o sistema atual.

## v1 Requirements — Entregues (v1.0.0, 2026-10-12)

### Data Import (IMP)

- [x] **IMP-01**: Base NCM oficial — nomenclatura vigente (~15 mil itens) ingerida de `bases-fonte/` via `npm run base` → `public/base/nomenclatura.json`
- [x] **IMP-02**: Validação de integridade do build — contagens exatas + hash do MANIFEST no `scripts/verificar-build.mjs` (porta de release)
- [x] **IMP-03**: Persistência local — **Prisma 6 + SQLite** (`aurum.db` em `%APPDATA%`), 27 tabelas, acesso exclusivamente pelo processo main via IPC `db:op` validado; `integrity_check` + quarantine no boot
- [x] **IMP-04**: Reimportação/atualização sem perda — bases embutidas versionadas a cada release; atualização do programa renova as bases; backup/restore transacional (snapshot pré-restore) preserva dados

### Classification (CLS)

- [x] **CLS-01**: Classificação por NCM → CST · cClassTrib · % redução · anexo oficial (resolvedor oficial como única verdade)
- [x] **CLS-02**: Regras da LC 214/2025 (redução por anexo, diferimento Anexo IX condicional, regra geral `000/000001`, tributação integral como última opção)
- [x] **CLS-03**: Override manual (CST × cClassTrib) com justificativa — "escolha de tributação" nos cards/lote/XML, propaga como reclassificação
- [x] **CLS-04**: Rastreabilidade — `audit_log` (append-only) + `via` (grafo/determinístico) + trilha por NCM
- [x] **CLS-05**: Consistência — react-check no boot (`db-protocolo`), uniques no schema, revisão determinística (Lote/XML mostram as N opções antes de salvar)

### Search & Filter (SRCH)

- [x] **SRCH-01**: Busca NCM por prefixo/exato (com/sem ponto), número/nome (fan-out local)
- [x] **SRCH-02**: Busca textual na nomenclatura (léxico + sinônimos) — case-insensitive
- [x] **SRCH-03**: Filtros por vínculo (NCM × Classificação), CFOP, CST, anexo, ano (2026/2027/2033 no módulo CNAEs)
- [x] **SRCH-04**: Origem da classificação (oficial/manual/regra geral) exibida em todos os módulos
- [x] **SRCH-05**: Performance local — busca lexical/grafo <50ms; bases renderizadas por seção (code-splitting por tela)

### Reporting (RPT)

- [x] **RPT-01**: Relatórios CSV/XLSX/PDF com emitente timbrado (razão social, CNPJ, logo, cor, rodapé)
- [x] **RPT-02**: Relatório PDF resumido/executivo (XML NFe, Simples Analítico, produtos)
- [x] **RPT-03**: CSV padronizado (`;`, UTF-8) para ERP
- [x] **RPT-04**: Alertas de pendência/quarentena (XML órfãos, itens sem classificação, divergência crédito estimado × efetivo)

### User Interface (UI)

- [x] **UI-01**: Visões de lista/tabela + paginação e filtro rápido (Produtos, Tabelas auxiliares)
- [x] **UI-02**: Detalhe em camadas (Consulta NCM com N cards, Produtos em abas, Empresas em modal 3 etapas)
- [x] **UI-03**: Modais de edição com validação de domínio (auxiliares, empresa, emitente)
- [x] **UI-04**: Dashboards por módulo (Comparação Antigo × Novo no XML, ranking fornecedores/NCM/CFOP)
- [x] **UI-05**: Tema claro/escuro persistido (anti-flash em `index.html` + `localStorage`)
- [x] **UI-06**: Atalhos — ex.: Ctrl+E (exportar PDF do menu nativo), Ctrl+Shift+D (debug IA), menu nativo Arquivo/Exibir

### Consulta NCM & Validação (CALC) — Calculadora removida na v1.2.0

- [x] **CALC-01**: Redução explícita por item (badge com % redução + base legal no Simulador/Consulta)
- [x] **CALC-02**: Múltiplas classificações → N cards com comparação (Consulta) e `<select>` por linha (Lote), o usuário escolhe
- [x] **CALC-03**: Validação contra anexos (art. 127/128/135/137/158/261/275–289/308) com badges e simulador editável
- [x] **CALC-04**: Bases atualizadas pela **atualização do programa** (não fetch avulso — decisão registrada; o critério original foi revisto)
- [x] **CALC-05**: Badges de anexo/redução + carga efetiva + % (carregamento via `public/base/parametros.json`, editável)

### IA Assistida (IA) — determinística local; LLM removido do runtime

- [x] **IA-00**: Spike viabilidade (`docs/spike-eletron-llama.md`) — NO-GO para LLM embutido; Aurum AI ficou determinística (tool-calling rotulado, P(anexo), memória)
- [ ] **IA-01**: `recursos-ia/`, `.gitignore` da IA, CHECKSUMS — feito no Phase 6; artefatos de modelo **não versionados** por decisão
- [x] **IA-02**: Base `ncm-para-ia.json` (2.335 NCMs) com paridade a `montarClassificacao`
- [x] **IA-03**: Índice vetorial/lexical local + grafo fiscal (LadybugDB FTS + HNSW 384-d + PageRank); rebuild por hash do MANIFEST
- [x] **IA-04**: ~~Modelo AILO-152M-v2~~ **superseded** — sem LLM em runtime; Aurum AI = orquestrador determinístico (`aurum-ai-chat.ts`) com tools auditáveis
- [x] **IA-05**: Worker IPC + `DebugIA` — implementado como `via:grafo`/`ia:*` no grafo (`electron/ia/grafo-service.cjs`); Ctrl+Shift+D mantido
- [x] **IA-06**: Resolução — determinístico primeiro; sem lastro → regra geral honesta (nunca código inventado)
- [x] **IA-07**: Instaladores com bases embutidas (`extraResources` + `asarUnpack`)
- [x] **IA-08**: Ofuscação (`scripts/ofuscar-build.cjs`) + hashes de integridade (CHECKSUMS.txt); modelo cifrado **não embarcado**
- [x] **IA-09**: Testes de massa (chaos 22/22, suites IA) + 1.946 casos verdes
- [x] **IA-10**: Docs de arquitetura/manual (`docs/grafo-*`, `docs/arquitetura-ia.md`, manual-atualizacao-ia)

### Serviços — NBS + CNAE + CNPJ (SER) — IMPLEMENTADA (Phase 7, 2026-10-03)

- [x] **SER-01..SER-05**: base viva CNAE×Anexo (1.090), ponte CNAE→NBS, CNPJ via BrasilAPI, Consulta NBS manual + por CNPJ, paridade UX com a Consulta NCM

### Consulta de CNAEs (CNAE) — IMPLEMENTADA (Phase 9, 2026-10-05)

- [x] **CNAE-01..CNAE-07** — duas camadas (regra sempre + NBS condicional), veredito por ano 2026/2027/2033, chaos 22/22

### Grafo Fiscal (GRAFO) — IMPLEMENTADA (Phase 10, 2026-10-06)

- [x] **GRAFO-01..GRAFO-08** — LadybugDB FTS+2hops+PageRank, overlay de aprendizado local com teto, modo FTS-puro de fallback

### Persistence & Settings (PER)

- [x] **PER-01**: Persistência local (Prisma/SQLite; empresas, produtos, auxiliares, notas, anexos)
- [x] **PER-02**: Tema claro/escuro persistido; emitente timbrado; configurações por empresa
- [x] **PER-03**: Backup/exportar banco (JSON, 27 tabelas + emitente, KEK e resumos fora por construção)
- [x] **PER-04**: Restaurar com validação tudo-ou-nada + snapshot rotativo pré-restore (`pre-restore-*.bak`)

## v2 Requirements — BACKLOG (não programado)

- **ADV-01**: Diff entre versões de base NCM (código/descrição/vínculo)
- **ADV-02**: Regras de classificação personalizadas (por setor/empresa)
- **ADV-03**: Auditoria avançada (relatório por usuário/período)
- **INT-01**: API local para ERPs; export/import layouts adicionais

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cálculo completo de apuração (créditos/débitos) como substituto do módulo fiscal | Não é classificação; o app simula e assiste, não assume a apuração |
| Classificação de bens importados por país de origem | Escopo de classificação por NCM/NBS, não de comércio exterior |
| SaaS multi-tenant | Desktop-first; modalidade coberta pelo "Aurum Omni" |
| Assinatura digital de relatórios | Exige certificado/PKI — não justifica o risco no escopo atual |

## Traceability

| Requirement | Status | Note |
|-------------|--------|------|
| IMP-01..04 | Implemented | v1.0.0 |
| CLS-01..05 | Implemented | v1.0.0 |
| SRCH-01..05 | Implemented | v1.0.0 |
| RPT-01..04 | Implemented | v1.0.0 |
| UI-01..06 | Implemented | v1.0.0 |
| CALC-01..05 | Implemented | v1.0.0 (CALC-04 com critério revisto — update do app) |
| IA-00..10 | Implemented / superseded | v1.0.0 (sem LLM em runtime) |
| SER-01..05 | Implemented | 2026-10-03 |
| CNAE-01..07 | Implemented | 2026-10-05 |
| GRAFO-01..08 | Implemented | 2026-10-06 |
| PER-01..04 | Implemented | v1.0.0 |
| v2 / ADV / INT | Backlog | não programado |

---
*Requirements updated: 2026-11-13 — v1.1.0 (venda avulsa)*
