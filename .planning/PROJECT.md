# Aurum Tax NCM

## What This Is

Sistema de classificação tributária para a Reforma Tributária Brasileira (LC 214/2025), distribuído como aplicativo desktop **Windows/macOS/Linux** (Electron) e web (Vite). Analisa XML de NF-e/NFC-e, classifica por NCM/NBS/CNAE (LC 214/2025), simula IBS/CBS e Simples Nacional, e gera relatórios PDF/CSV/JSON timbrados. Persistência e cálculo 100% local (SQLite no processo main via Prisma; IPC validado; bases embutidas no instalador).

## Core Value

Classificação tributária precisa e automatizada que garante conformidade com a LC 214/2025, eliminando risco de multas e retrabalho fiscal.

## Requirements

### Validated (entregues e verificadas na v1.0.0 — 2026-10-12 — e na v1.1.0 — 2026-11-13)

- [x] Base oficial embutida versionada (NCM, CST × cClassTrib, nomenclatura, NBS, CNAE, vínculo NCM×Classificação) — gerada por `npm run base`, validada por `scripts/verificar-build.mjs`
- [x] Classificação determinística local (CST · cClassTrib · % redução · anexo oficial · base legal · herança por família) com resolvedor oficial como única verdade
- [x] Parsing lote CSV/XLSX + classificação em lote; XML NF-e/NFC-e com 2 layouts (Polida/Clássica) e conferência por produto
- [x] Calculadora IBS/CBS + Simples Nacional (DAS, Fator R, sublimite, híbrido, projeção dividida v2)
- [x] Simulação: anexos derivados de redução (0/30/…/100), diferimento Anexo IX condicional, tributação integral como última opção de segurança
- [x] Consulta NCM / Serviços NBS / CNAEs (busca local, fan-out número/nome)
- [x] Backup/restore JSON transacional (27 tabelas), snapshot pré-restore, integridade no boot
- [x] Relatórios PDF/CSV/JSON timbrados (emitente configurável)
- [x] Atualização via GitHub Releases (auto-update opcional, download só sob comando)
- [x] Licença MIT no código-fonte (`LICENSE`); termos do instalador em `build/LICENCA.txt`/`.rtf` (venda avulsa a partir da v1.1.0)
- [x] Tour guiado sob demanda; empresas multi-CNPJ; produtos; tabelas auxiliares; legislação in-app
- [x] **v1.1.0**: app entra direto (sem assistente de instalação e sem portão de licença) — venda avulsa

### Active (próximos passos conhecidos)

- [ ] Publicar a release 1.1.0 no GitHub Releases (a atualização em máquinas instaladas depende disso)
- [ ] Assinar o instalador (Windows Authenticode / mac notarização) antes de distribuir amplamente
- [ ] Endurecer o renderer (CSP) e revisar o IPC do processo main — ver assessment 2026-11-13 (sandbox, `openExternal`, allowlist, redirects do `rede:buscar-texto`)
- [ ] Refatorar monstros de código (`aurum-ai-chat.ts`, `NfeXml.tsx`) e reduzir dívidas da avaliação 2026-11-13 (catches engolidos, Clean Architecture nominal, CI mínimo)
- [ ] Avaliar a extração do módulo Simples como calculadora standalone (`docs/PROMPT_TECNICO_CALCULADORA_SIMPLES_NACIONAL.md`)
- [ ] Decidir publicação do pacote no npm/GitHub Releases vs. interno (LICENSE-MIT vs `private`/`UNLICENSED`)

### Out of Scope

- Integração direta com ERPs (SAP, Totvs, ContaAzul) — fazer via exportação padrão
- Cálculo de crédito tributário completo como módulo próprio (escopo de apuração) — o app simula IBS/CBS e assiste a apuração no XML, não substitui o módulo fiscal
- Versão SaaS multi-tenant — desktop-first (a modalidade SaaS é coberta pelo "Aurum Omni", produto à parte)
- Serviços para atividades prestadas exclusivamente sob LC 116 com lista própria externa (NCM é bens; NBS/servidores cobertas na base embutida)

## Context

- **Reforma Tributária**: LC 214/2025 institui CBS, IBS e IS, substituindo PIS, Cofins, IPI, ICMS, ISS (EC 132/2023; Decreto 12.955/2026; Res. CGIBS 6/2026; NT 2025.002). Base em transição — o software é ferramenta de apoio; vale o texto oficial.
- **NCM**: 8 dígitos, Mercosul. **NBS**: 9 dígitos (serviços). **CNAE**: 7 dígitos.
- **Stack real**: React 19 + TypeScript 5.9 strict · Vite 8 · Electron 44 · TailwindCSS 4 · Zustand 5 · Prisma 6 + SQLite (`aurum.db` em `userData`) · xlsx · fast-xml-parser · pdfmake · Chart.js · Framer Motion · Vitest 5 (environment node) — **não** é mais Dexie/IndexedDB (decisão revisitada na reconstrução para a v1.0.0).
- **Dados oficiais**: portal CFF/DFe (classificação tributária), Siscomex (nomenclatura), planilhas vivas do projeto (CNAE×Anexo, NBS serviços).
- **Usuários-alvo**: contadores, analistas fiscais, consultorias tributárias, departamentos fiscais.

## Constraints

- **Tech stack**: React/TypeScript/Vite/Electron/Zustand/Tailwind/Prisma+SQLite — definido; mudanças relevantes exigem ADR
- **Offline-first**: uso diário sem internet (bases embutidas; atualização de dados acoplada ao update do programa)
- **Performance**: busca local <100ms; seed da base em segundos; `tsc` limpo e suíte verde como gate
- **Compatibilidade**: Windows 10/11 (alvo principal), macOS 12+, Linux
- **Regulatório**: classificação segue estritamente LC 214/2025 e atos normativos; base embutida versionada a cada release

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron sobre Tauri | Ecossistema React maduro, WebView2 | ✓ Good |
| ~~Dexie (IndexedDB) sobre SQLite~~ → **Prisma + SQLite** | Banco robusto, transações reais (`db:transaction`), migração legada com backup, backup JSON 27 tabelas | ✓ Good (rework v1.0.0) |
| Classificação client-side | Dados sensíveis nunca saem da máquina; cálculo 100% local | ✓ Good |
| Tailwind CSS 4 | Design system enxuto | ✓ Good |
| Determinismo acima de IA | Classificador oficial = resolvedor; Aurum AI apenas roteamento/contexto | ✓ Good |
| Venda avulsa (sem conta/chave) | Simplicidade para o cliente; menos superfície de ataque e suporte | ✓ Good (v1.1.0) |
| Bases embutidas renovadas só via update do app | Cadeia de fornecimento controlada; sem drift de tabelas | ✓ Good |
| Electron + NSIS PT-BR por usuário | Sem admin; atalhos padrão | ✓ Good |

---

*Last updated: 2026-11-13 — v1.1.0: venda avulsa, onboarding/licença removidos; v1.0.0 (2026-10-12) = marco da entrega dos 10 módulos*
