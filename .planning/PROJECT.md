# Aurum Tax NCM

## What This Is

Sistema de classificação tributária para a Reforma Tributária Brasileira (LC 214/2025). Uma aplicação desktop construída com Electron que permite importar, classificar e validar códigos NCM (Nomenclatura Comum do Mercosul) segundo as novas regras da reforma tributária, gerando relatórios de adequação fiscal para empresas brasileiras.

## Core Value

Classificação tributária precisa e automatizada que garante conformidade com a LC 214/2025, eliminando risco de multas e retrabalho fiscal.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Importar base de códigos NCM oficial (tabela completa)
- [ ] Classificar NCMs por regime tributário (CBS, IBS, IS, Imune, Isento)
- [ ] Validar classificação contra regras da LC 214/2025
- [ ] Gerar relatório de adequação fiscal (Excel/PDF)
- [ ] Interface de busca e filtro por código NCM, descrição, regime
- [ ] Persistência local de dados (Dexie/IndexedDB)
- [ ] Exportar classificação para integração com ERPs
- [ ] Calculadora Tributária: Resumo lateral com reduções explícitas por item/produto
- [ ] Calculadora Tributária: Análise comparativa quando múltiplas classificações existem para um NCM
- [ ] Calculadora Tributária: Validação contra anexos da LC 214/2025 (vetos, tributação correta)
- [ ] Calculadora Tributária: Atualização automática de bases oficiais na inicialização

### Out of Scope

- Integração direta com ERPs (SAP, Totvs, etc.) — complexidade de APIs proprietárias, fazer via exportação padrão
- Cálculo de crédito tributário — fora do escopo de classificação, pertence a módulo fiscal separado
- Versão web/SaaS — arquitetura Electron desktop-first, web requer autenticação e multi-tenancy
- Classificação de serviços (LC 214 foca em bens) — NCM é apenas para mercadorias

## Context

- **Reforma Tributária Brasileira**: LC 214/2025 institui CBS (Contribuição sobre Bens e Serviços), IBS (Imposto sobre Bens e Serviços) e IS (Imposto Seletivo), substituindo PIS, Cofins, IPI, ICMS, ISS
- **NCM**: Nomenclatura Comum do Mercosul — código de 8 dígitos usado no Brasil para classificar mercadorias
- **Stack**: React + TypeScript + Vite (frontend), Electron (desktop), Dexie.js (IndexedDB wrapper), Zustand (state), Tailwind CSS (UI)
- **Dados oficiais**: Tabelas NCM disponíveis no portal Comex Stat / Receita Federal
- **Usuários-alvo**: Contadores, analistas fiscais, consultorias tributárias, departamentos fiscais de empresas

## Constraints

- **Tech stack**: React/TypeScript/Vite/Electron/Dexie/Zustand/Tailwind — definido pelo arquiteto, não renegociável
- **Performance**: Deve processar ~10k códigos NCM em <2s (busca, filtro, classificação)
- **Offline-first**: Funcionamento 100% offline após setup inicial (dados locais via Dexie)
- **Compatibilidade**: Windows 10/11 (alvo principal), macOS/Linux (secundário)
- **Regulatório**: Classificação deve seguir estritamente LC 214/2025 e atos normativos da Receita Federal

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron sobre Tauri | Ecossistema React maduro, equipe conhece, WebView2 no Windows | ✓ Good |
| Dexie (IndexedDB) sobre SQLite | Zero config nativo no Electron, sincronização offline simples | ✓ Good |
| Zustand sobre Redux | Menos boilerplate, TypeScript-first, suficiente para estado global | ✓ Good |
| Classificação client-side | Dados sensíveis (NCMs da empresa) não saem da máquina | ✓ Good |
| Tailwind CSS | Design system consistente, build otimizado, team familiar | ✓ Good |

---

*Last updated: 2026-09-29 after project initialization*