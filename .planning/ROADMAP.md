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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Data Layer | 0/4 | Not started | - |
| 2. Classification Engine | 0/4 | Not started | - |
| 3. Search & UI | 0/5 | Not started | - |
| 4. Reporting & Export | 0/4 | Not started | - |