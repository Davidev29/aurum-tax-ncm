# Roadmap: Aurum Tax NCM

## Overview

Do fundação até um classificador tributário completo e **entregue**: base NCM oficial embutida, classificação determinística pela LC 214/2025, lote, Simples Nacional, NBS/CNAE e busca local determinística. Histórico de execução abaixo — mantido como registro das fases; **todo o v1 está IMPLEMENTADO e VERIFICADO**.

## Phases

- [x] **Phase 1: Foundation & Data Layer** — base NCM, seed/import, persistência local — implementada (v1.0.0)
- [x] **Phase 2: Classification Engine** — regras LC 214/2025, override manual, auditoria — implementada
- [x] **Phase 3: Search & UI** — busca/filtro, telas, rotas — implementada
- [x] **Phase 4: Reporting & Export** — PDF/CSV/JSON, backup/restore — implementada
- [x] **Phase 5: Calculadora Tributária & Validação Avançada** — implementada
- [x] **Phase 6: Busca determinística local (8 dígitos)** — implementada (2026-10)
- [x] **Phase 7: Menu Serviços (NBS + CNAE + CNPJ)** — IMPLEMENTADA (2026-10-03)
- [x] **Phase 8: Refinos do Simples Nacional (Fator R obrigatório)** — IMPLEMENTADA (2026-10)
- [x] **Phase 9: Consulta de CNAEs** — IMPLEMENTADA (2026-10-05; chaos 20/20)
- [x] **Phase 10: Fase de indexação avançada — REMOVIDA** (substituída pela busca determinística local)
- [x] **Release v1.0.0** — 2026-10-12 (instalador Windows; tag `1.0` no origin)
- [x] **v1.1.0 — Venda avulsa** — 2026-11-13: remoção do assistente de instalação e do portão de licença (Aurumbit); app entra direto; `npm test` corrigido; docs/`.planning`/contrato atualizados; instalador 1.1.0 gerado

## Phase Details

### Phase 1: Foundation & Data Layer — CONCLUÍDA (v1.0.0)

Meta retroativa: sinapse base + persistência + dashboard. O que foi entregue na prática: base embutida versionada (`public/base/`, manifest com hash), persistência **SQLite via Prisma no processo main** (27 tabelas; IPC `db:op` validado; `integrity_check` no boot; snapshot pré-restore), backup/restore transacional com validação tudo-ou-nada, tema claro/escuro com anti-flash, multi-empresa.

### Phase 2: Classification Engine — CONCLUÍDA

Resolvedor oficial único (`montarClassificacao` / `montarRegraGeral`), manual override ("escolha de tributação") com justificativa, auditoria append-only (`audit_log`), enforcement de unicidade no schema + validação de domínio na escrita (`db:op`/backup), opção 2ª de diferimento Anexo IX, tributação integral como última opção de segurança.

### Phase 3: Search & UI — CONCLUÍDA

8 views (Consulta NCM, Simples Nacional, Serviços NBS, Consulta de CNAEs, Lote, Produtos, Tabelas auxiliares, Legislação), code-splitting por tela, busca local determinística (léxico + resolvedor), telas multi-entidade com paginação/filtro.

### Phase 4: Reporting & Export — CONCLUÍDA

Relatórios PDF/CSV/JSON timbrados (pdfmake/SheetJS), emitente configurável, exportação em lote, backup/restauração do banco, ações de atualização do programa (auto-update opcional via GitHub Releases).

### Phase 5: Calculadora Tributária & Validação Avançada — CONCLUÍDA (tela removida na v1.2.0; simulação vive nos cartões da Consulta NCM)

Redução explícita por item (% com base legal), N cards/análise comparativa (via Consulta), selo/ST por item (1.010 registros CEST), simulador editável, atualização automática das bases pelo release do programa (decisão arquitetural documentada).

### Phase 6: Busca determinística local — CONCLUÍDA

Busca por descrição baseada em tokenização, dicionário comercial, sinônimos e resolvedor oficial como única verdade. Sem lastro, aplica a regra geral honesta; nenhum modelo externo é consultado.

### Phase 7 — Serviços (NBS + CNAE + CNPJ) — CONCLUÍDA (2026-10-03)

Base viva CNAE×Anexo (1.090) + NBS serviços + ponte heurística (teto por Situação) + CNPJ via BrasilAPI; consulta NBS manual ou por CNPJ; paridade UX com a Consulta NCM.

### Phase 8 — Refinos do Simples Nacional (Fator R obrigatório) — CONCLUÍDA

Fator R correto por anexo, coleta obrigatória da folha 12m, veredito imediato na entrada e resultado reorganizado. Regras determinísticas, sem modelos externos.

### Phase 9 — Consulta de CNAEs (CNAE → NBS → Reforma) — CONCLUÍDA (2026-10-05)

Duas camadas (regra sempre nos 1.090; NBS condicional nos 508 × qualclasstrib), veredito por ano 2026/2027/2033, chaos 20/20, consulta por CNPJ enriquecida.

### Phase 10 — Fase de indexação avançada — REMOVIDA

Fase descontinuada: suas responsabilidades de ranking foram absorvidas pela busca determinística local (índice lexical + resolvedor oficial). Nenhum artefato desta fase permanece no produto.

### v1.1.0 — Venda avulsa — CONCLUÍDA (2026-11-13)

- Removidos: assistente de instalação (`TermoAceite`), portão de licença (`src/aurum/*`), cofre do main (`aurum-licenca.ts`), aba Conta, banners de graça/offline, guards de exportação/troca de titular/exclusão de empresa, proxy dev `/v1`+`/api`, `VITE_AURUM_*` no build
- App abre direto na Consulta NCM (desde a v1.2.0); licença MIT (código) + termos do instalador reescritos como venda avulsa (`build/LICENCA.txt|rtf`, contrato .docx atualizado para a v1.2)
- `npm test` corrigido (shim `.bin` quebrava no Windows → `node node_modules/vitest/vitest.mjs`)
- Docs e `.planning` atualizados para a realidade pós-1.0

## Progress (estado real)

| Marco | Release | Estado | Data |
|-------|---------|--------|------|
| Fases 1–9 | v1.0.0 | Implementado e verificado | 2026-10-12 |
| Venda avulsa + limpeza release + docs | v1.1.0 | Concluído; instalador gerado; publicação pendente | 2026-11-13 |
| Menu enxuto — Calculadora removida; Consulta NCM inicial | v1.2.0 | Concluído | 2026-11-13 |

**Execution order:** Fases 1 → 9 concluídas; releases 1.0.0 → 1.1.0.

## Próximas etapas (backlog de manutenção, sem fase aberta)

1. Publicar a release 1.1.0 (GitHub Releases) — necessário para a auto-atualização das máquinas instaladas verem a 1.1.0
2. Assinar instalador (Authenticode/notarização) + CSP no renderer
3. Refatoração estrutural (grandes arquivos, camada de aplicação)
4. Decisão de distribuição: release pública oficial assinada vs. distribuição interna
5. Avaliar calculadora standalone do Simples (`docs/PROMPT_TECNICO_CALCULADORA_SIMPLES_NACIONAL.md`)
