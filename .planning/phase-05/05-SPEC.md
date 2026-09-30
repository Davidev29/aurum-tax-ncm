# SPEC — Phase 5: Calculadora Tributária & Validação Avançada

**Phase:** 5  
**Project:** Aurum Tax NCM  
**Date:** 2026-09-29  
**Status:** Draft  
**Requirements locked:** 5 (CALC-01 through CALC-05)

---

## Context

### Current State (Codebase Analysis)

The codebase already has a **Calculadora Tributária** implemented in:
- `src/pages/Calculadora.tsx` — Main calculator UI with two-column layout (items list + right sidebar summary)
- `src/store/calculadora.ts` — Zustand store managing items, rates, and calculations
- `src/domain/services/calculo.ts` — Core calculation logic (LC 214/2025: reduction via base de cálculo)
- `src/modais/pagina.tsx` — `ModalCalculadora` for adding items with quantity/value preview
- `src/domain/entities/index.ts` — Entities: `ItemCalc`, `ResumoCalc`, `ResultadoCalculo`, `Classificacao`, `Observacao`

**Key existing behaviors:**
- Items added from products or classifications have reductions **frozen at addition** (SPEC D10)
- Right sidebar (`Resumo do cálculo`) shows: Operação, BC (reduzida), IBS, CBS, Total tributos, Total geral, Carga efetiva
- Reduction badges shown in item lines: `−{redIBS}% / −{redCBS}%` or "alíquota cheia"
- `observacoesLegais()` returns legal observations based on reduction thresholds (Art. 137, 135, 128)
- `anexoDeReducao()` derives anexo from redIBS: `0` (≥100%), `60` (≥60%), `30` (≥30%), `isento` (else)
- `ehAnexoIX()` detects Anexo IX products (insumos agropecuários/aquícolas, Art. 138)
- `observacoesDiferimento()` returns deferral observations for Anexo IX and CST 510/515

**Gaps identified:**
1. **Resumo lateral** doesn't explicitly show *which* reduction was applied per item (percentual, base legal, artigo)
2. When **multiple classifications** exist for an NCM (N > 1), no comparative analysis is shown for user to choose
3. No **validation against anexos** to check if product was vetoed or if taxation is correct
4. No **auto-update of official bases** on startup (NCM, nomenclatura, classificação tributária)
5. Visual indicators of reduction could be more explicit (badge/pill with tooltip showing base legal completa)

### Target State

A Calculadora Tributária that:
1. **Explicitly displays each reduction** applied per item in the right sidebar summary (percentual, base legal, artigo da LC 214/2025)
2. **Shows comparative analysis** when multiple classifications exist for the same NCM, allowing user to select the correct one per product
3. **Validates against anexos** of LC 214/2025 to detect vetos and confirm correct taxation
4. **Auto-checks and updates official bases** on application startup (NCM vigente, nomenclatura, classificação tributária)
5. **Clear visual indicators** of reductions in both item lines and summary (badges with tooltips showing full legal basis)

---

## Requirements

### CALC-01: Resumo do Cálculo — Exibição Explícita de Reduções por Item

**Current state:** Right sidebar shows aggregated totals (BC reduzida, IBS, CBS, Total). Item lines show `−{redIBS}% / −{redCBS}%` but no legal basis or article reference.

**Target state:** 
- Resumo lateral expands to show a **breakdown per item** with explicit reduction details:
  - Item name/NCM
  - Redução IBS (%)
  - Redução CBS (%)
  - Base legal (ex: "Art. 128, LC 214/2025 — Redução 60% para medicamentos")
  - Artigo/inciso específico
  - Anexo (se aplicável: I, IX, etc.)
  - Indicador visual (badge color-coded: emerald=60%, amber=30%, red=100%, slate=sem redução)

**Acceptance criterion:**
- [ ] When calculating with items that have reductions, the right sidebar shows a collapsible/expandable section "Detalhamento das Reduções" listing each item with its reduction %, legal basis, article, and anexo
- [ ] Clicking an item in the breakdown scrolls/highlights the corresponding item in the left list
- [ ] Tooltip on reduction badge shows full legal text (baseLegal from Classificacao.resumo.baseLegal or referencia.urlLegislacao)

---

### CALC-02: Análise Comparativa para Múltiplas Classificações

**Current state:** `resolverClassificacoes()` returns `lista: Classificacao[]` (0, 1, or N items). When N > 1, `escolhida` remains `null` and user must pick via radio buttons in Classificar screen. In Calculadora, adding via "NCM manual" opens `ModalCalculadora` which receives a single `Classificacao`.

**Target state:**
- When user adds an NCM that resolves to **multiple classifications (N > 1)**, show a **comparative analysis modal** before adding to calculator:
  - Side-by-side comparison table: CST, cClassTrib, Red. IBS, Red. CBS, Base Legal, Anexo, Artigo, Regra Geral?
  - Highlight differences (color-coded cells)
  - User selects one → that classification is used for the calculator item
  - Selection persists for this session (can be changed per item)

**Acceptance criterion:**
- [ ] Adding an NCM with >1 classification triggers "Análise Comparativa" modal
- [ ] Modal shows table with all classifications, differences highlighted
- [ ] User must select one before item is added to calculator
- [ ] Selected classification's reductions are frozen in the item (per existing D10 behavior)

---

### CALC-03: Validação Contra Anexos da LC 214/2025

**Current state:** `ehAnexoIX()` detects Anexo IX. `observacoesLegais()` returns observations by reduction threshold. No validation of "veto" or "tributação correta".

**Target state:**
- **Validation engine** that checks each item/classification against LC 214/2025 anexos:
  - **Veto detection:** Products in anexos that prohibit certain regimes (ex: Anexo I = IS only, cannot be CBS/IBS)
  - **Correct taxation confirmation:** For each classification, verify CST/cClassTrib combination is valid per `referencia` table
  - **Alert system:** Visual warnings in item line and summary:
    - 🔴 **Vetado**: "Produto no Anexo X — regime Y não permitido"
    - 🟡 **Atenção**: "Classificação incomum para este NCM — verificar enquadramento"
    - 🟢 **OK**: "Tributação confirmada conforme Anexo X"

**Acceptance criterion:**
- [ ] Function `validarTributacao(cl: Classificacao): { valido: boolean; alertas: AlertaValidacao[] }` implemented
- [ ] Item lines show alert badge (red/yellow/green) with tooltip explaining the validation result
- [ ] Summary sidebar includes "Validação da Tributação" section with count of OK/Atenção/Vetado
- [ ] Vetado items are still calculable but flagged prominently

---

### CALC-04: Atualização Automática de Bases Oficiais na Inicialização

**Current state:** `semearBaseEmbutida()` seeds embedded base on first run. `importarBase()` allows manual import. No automatic check for updates on startup.

**Target state:**
- On app startup, **background check** for updates to official bases:
  - NCM vigente (Tabela_NCM_Vigente_*.json from Receita Federal)
  - Nomenclatura NCM/SH
  - Classificação tributária (classificacao_tributaria.json)
- **Mechanism:** 
  - Store last-check timestamp in `meta` store
  - Check remote source (configured URL or GitHub releases) for newer version/hash
  - If newer: show non-blocking toast "Nova base oficial disponível — clique para atualizar"
  - One-click update downloads and re-seeds (preserving user classifications per IMP-04)
  - Option to disable auto-check in settings

**Acceptance criterion:**
- [ ] On app load, async check runs (non-blocking UI)
- [ ] If updates available, toast notification with "Atualizar agora" action
- [ ] Update process shows progress, preserves user manual classifications
- [ ] Settings toggle: "Verificar bases oficiais na inicialização" (default: true)
- [ ] Last check timestamp visible in settings/about

---

### CALC-05: Indicadores Visuais Claros de Redução

**Current state:** Item lines show `−{redIBS}% / −{redCBS}%` text. `badgeReducao()` returns pill with label "−XX.XX%" (amber) or "Sem redução" (emerald) or "⚡ Alíquota zero" (red).

**Target state:**
- **Enhanced badges/pills** in both item lines and summary breakdown:
  - Pill shows: `−60%` (emerald), `−30%` (amber), `⚡ Zero` (red), `Cheia` (slate)
  - **Hover tooltip** shows: "Redução de 60% — Art. 128, LC 214/2025 — Alimentos para consumo humano (Art. 135)"
  - **Summary breakdown** (CALC-01) uses same badge system
  - **Color legend** in summary footer: 🟢 60% | 🟡 30% | 🔴 Zero | ⚪ Cheia

**Acceptance criterion:**
- [ ] `badgeReducao()` enhanced to return { rotulo, cor, tooltip, artigo, anexo }
- [ ] Item line pills show enhanced badge with tooltip
- [ ] Summary breakdown uses same badge component
- [ ] Color legend visible in summary panel

---

## Boundaries

### In Scope

| Item | Description |
|------|-------------|
| CALC-01 | Resumo lateral com detalhamento explícito de reduções por item |
| CALC-02 | Modal de análise comparativa quando N > 1 classificações para um NCM |
| CALC-03 | Engine de validação contra anexos (vetos, tributação correta) com alertas visuais |
| CALC-04 | Verificação automática de atualização de bases oficiais no startup |
| CALC-05 | Badges/pills de redução aprimorados com tooltip legal completo |

### Out of Scope

| Item | Reason |
|------|--------|
| Cálculo de crédito tributário (CBS/IBS) | Escopo de apuração, não classificação; pertence a módulo fiscal separado |
| Integração direta com ERPs | APIs proprietárias; exportação CSV/Excel resolve v1 |
| Versão web/SaaS | Arquitetura Electron desktop-first |
| IA/ML para sugestão de classificação | Dados de treino limitados, risco regulatório; regra determinística v1 |
| Assinatura digital de relatórios | Requer certificado digital, infra PKI; v2+ |
| Sincronização em nuvem | Multi-tenancy, auth, infra; offline-first MVP |

---

## Acceptance Criteria (Pass/Fail)

| # | Criterion | Requirement |
|---|-----------|-------------|
| AC-01 | Right sidebar shows "Detalhamento das Reduções" with per-item breakdown | CALC-01 |
| AC-02 | Breakdown shows: item, redIBS%, redCBS%, base legal, artigo, anexo, badge | CALC-01 |
| AC-03 | Clicking breakdown item highlights corresponding left-list item | CALC-01 |
| AC-04 | Tooltip on badge shows full legal text (baseLegal/urlLegislacao) | CALC-01 |
| AC-05 | Adding NCM with N>1 classifications triggers comparative analysis modal | CALC-02 |
| AC-06 | Modal shows side-by-side table with all classifications, differences highlighted | CALC-02 |
| AC-07 | User must select one classification before item is added | CALC-02 |
| AC-08 | `validarTributacao()` function returns { valido, alertas[] } | CALC-03 |
| AC-09 | Item lines show validation badge (red/yellow/green) with tooltip | CALC-03 |
| AC-10 | Summary includes "Validação da Tributação" section with counts | CALC-03 |
| AC-11 | Startup runs async check for official base updates (non-blocking) | CALC-04 |
| AC-12 | Toast notification if updates available with one-click update action | CALC-04 |
| AC-13 | Update preserves user manual classifications (IMP-04) | CALC-04 |
| AC-14 | Settings toggle for auto-check (default on) | CALC-04 |
| AC-15 | Enhanced `badgeReducao()` returns { rotulo, cor, tooltip, artigo, anexo } | CALC-05 |
| AC-16 | Item line pills use enhanced badge with tooltip | CALC-05 |
| AC-17 | Summary breakdown uses same badge component | CALC-05 |
| AC-18 | Color legend visible in summary panel | CALC-05 |

---

## Edge Coverage

| Requirement | Edge Category | Candidate Edge | Resolution |
|-------------|---------------|----------------|------------|
| CALC-01 | Empty state | No items with reductions → breakdown section hidden | **Specify**: Section only renders when ≥1 item has red>0 |
| CALC-01 | Boundary | Item with redIBS ≠ redCBS → show both separately | **Specify**: Breakdown shows two rows per item if reductions differ |
| CALC-02 | Empty state | NCM has 0 classifications (regra geral only) | **Dismiss**: Handled by existing flow (single regra geral) |
| CALC-02 | Boundary | User cancels comparative modal | **Specify**: Item not added; toast "Adição cancelada" |
| CALC-03 | Invalid input | Classificacao null/undefined | **Specify**: Return { valido: false, alertas: [{tipo: 'erro', msg: 'Classificação ausente'}] } |
| CALC-03 | Boundary | Produto em múltiplos anexos | **Specify**: Aggregate all applicable anexo validations |
| CALC-04 | Network | Offline / remote check fails | **Specify**: Silent fail; log to console; retry next startup |
| CALC-04 | Data integrity | Update fails mid-write | **Specify**: Transactional seed; rollback on error; show error toast |
| CALC-05 | Accessibility | Badge color-only info | **Specify**: Tooltip + aria-label with full text; pattern for colorblind |

---

## Prohibitions

| # | Prohibition | Tier | Verification |
|---|-------------|------|--------------|
| PROH-01 | MUST NOT mutate original Classificacao object when freezing reductions in ItemCalc | test | Unit test: `calculoDoItem` receives cloned reductions |
| PROH-02 | MUST NOT block UI during startup base update check | test | E2E test: UI interactive within 500ms of load |
| PROH-03 | MUST NOT overwrite user manual classifications during base update | test | Integration test: manual reclassificacoes survive `semearBaseEmbutida(forcar=true)` |
| PROH-04 | MUST NOT show comparative modal for regra geral (single fallback) | judgment | Code review: modal only triggers when `lista.length > 1 && !regraGeral` |

---

## Ambiguity Report

| Dimension | Score | Minimum | Status |
|-----------|-------|---------|--------|
| Goal Clarity | 0.90 | 0.75 | ✓ |
| Boundary Clarity | 0.85 | 0.70 | ✓ |
| Constraint Clarity | 0.80 | 0.65 | ✓ |
| Acceptance Criteria | 0.95 | 0.70 | ✓ |
| **Weighted Ambiguity** | **0.12** | **≤ 0.20** | **✓ PASS** |

All dimensions meet minimums. Ambiguity = 0.12 ≤ 0.20 gate passed.

---

## Next Steps

Run `/gsd-discuss-phase 5` to discuss implementation approach, then `/gsd-plan-phase 5` to create detailed plans.