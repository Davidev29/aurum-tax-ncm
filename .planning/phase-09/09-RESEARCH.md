# RESEARCH — Phase 9: Consulta de CNAEs (CNAE → NBS → Reforma)

**Date:** 2026-10-05
**Source:** 4 subagents em paralelo + verificação local (`python3` no JSON)
**Depends on:** Phase 7 (Serviços NBS+CNAE+CNPJ, implementada 2026-10-03) + Phase 8 (refinos Aurum AI, planejada)

## 1. Pedido do usuário (5 itens)

1. Novo fluxo CNAE → NBS: ao consultar CNPJ, puxar código CNAE, comparar com lista e trazer NBS relacionadas àquele CNAE, confrontar cada NBS com as bases da Reforma (benefício / tributação especial).
2. Arquivo anexado (`qualclasstrib_completo.json`) vira tabela (CNAEs + NBS), exibição semelhante às tabelas NCM da SISCOMEX (`Auxiliares.tsx`).
3. Mapear novo fluxo para a IA no chat, ao consultar CNPJ na calculadora do Simples Nacional (cálculo por CNPJ).
4. Aba nova "Consulta de CNAEs" (menu novo): pesquisa direta por CNAE → Anexo do Simples, vedado?, NBS disponíveis, benefício/tributação Reforma por NBS.
5. Mapear com subagentes especialistas e entregar via fluxo `gsd plan-phase` uma nova fase.

## 2. Arquivo anexado — fatos verificados

- `C:\Users\david\Downloads\CNAE X NBS\qualclasstrib_completo.json` — 1,67 MB, `fonte: qualclasstrib.com.br`, `total_cards: 508`.
- `por_codigo`: 508 CNAEs (`XXXX-X/XX`), todos `tipo: CNAE`, `vinculos: {CTN[], NBS[], CST[], cClassTrib[]}`. Links NBS totais 6.641, 588 NBS únicos, média 13,07/CNAE (dist: 1→83 … 25–26→55, máx 98 em `4322-3/03`). CST só 5 valores (`000,200,011,400,820`); cClassTrib 41 únicos (top `000001` em 371 CNAEs).
- `respostas_de_rede[0]`: `fallback-cnae-links.json` — 677 registros `{cnae,cnaed,lc,lcd,page}`, 507 CNAEs distintos (triangulação CNAE×LC116).
- `respostas_de_rede[1]`: `fallback-relations.json` — 1.739 registros `{lc,lcd,nbs,nbsd,onerosa,exterior,indop,local,cct,cctd}`, 201 LCs, 676 NBS distintos (triangulação fina LC×NBS×cClassTrib + descrições `nbsd/cctd/lcd`).
- `respostas_de_rede[2]`: tracking Google (`adtrafficquality`) — **descartar no import**.
- Qualidade: zero CNAEs sem NBS; zero dup interno; dup entre CNAEs massiva e esperada; **mojibake latin1** (`Servi�o`) — aplicar `fixLatin1()` no import; descrições NBS/CTN/cClassTrib só existem no `fallback-relations` (juntar no import).
- **Cobertura parcial:** 508 CNAEs de serviço vs 1.090 da base viva `CNAE X ANEXO.json`. Estratégia: **merge, não replace** — 508 ganham links NBS; ~582 restantes mantêm fallback atual (divisão→keyword + regra geral).

## 3. Estado atual (o que reutilizar — file:line)

- **Ponte CNAE→NBS hoje (heurística, sem lista):** `src/domain/services/cnae.ts:40-63` (`PALAVRAS_CHAVE_NBS_POR_DIVISAO`), `:78-87` (`tetoConfiancaCnae`), `src/application/consultar-por-cnpj.ts:120-265` (`classificarAtividade`, 2 tentativas GATE + `cnaeOrigem`), `src/domain/services/verificacao-servicos.ts:41-70` (pins por divisão). Novo arquivo **complementa**, nunca remove este fallback.
- **Resolvedor única verdade:** `src/infrastructure/base/classificacao-repo.ts:718-754` (`resolverClassificacoesNbs`, 9 díg., filtro revogação, senão regra geral `000/000001`); `src/domain/services/calculo.ts:46` (`calcularTributos`), `:105-123` (`anexoReal/anexoOficial`). Todo NBS candidato do novo link **passa pelo resolvedor** antes de exibir benefício.
- **Tabela estilo SISCOMEX (padrão a espelhar):** `src/pages/Auxiliares.tsx:374` (`PainelTabela` genérico), `:395` (filtro debounce 150ms), `:444` (paginação `PAGE_SIZE=10`), `:678` (`TabelaGenerica`), `:926` (`LinhaNcm`), `:1130` (`PainelNbs` somente-leitura `limit(2000)`), `src/application/aux-meta.ts:45` (`AUX_META`), `:230` (`COLUNAS_AUX`). Nova aba copia este padrão, não virtualização.
- **Menu/navegação (receita p/ view nova):** `src/App.tsx:23-40` (switch), `src/store/ui.ts:18-29` (`ViewId`), `:31-47` (`VIEW_META`), `src/ui/Layout.tsx:25` (`NAV`), `:199` (`trocarView`), `src/store/consulta-servicos.ts:451` (`registrarLimpeza`), `src/infrastructure/pdf/menu-exportacao.ts:20` (`registrarExportador`, Ctrl+E).
- **Chat IA (receita p/ novo fluxo):** `src/domain/services/detector-chat.ts:31` (`IntencaoChat`), `:880` (`detectarIntencaoChat`), `src/application/aurum-ai-tools.ts:70` (`PLANO_TOOL_CALLING`), `:510` (`toolParaIntencao`), `src/application/aurum-ai-registro-ferramentas.ts:60` (`REGISTRO_FERRAMENTAS`), `:392` (`executarFerramenta`), `src/application/aurum-ai-chat.ts:1333` (`responderCnae`), `:2039` (`responderCnpj`), `:2705` (`responderSimples`).
- **CNPJ→cálculo Simples:** `src/simples/store.ts:255` (`buscarPorCnpj`), `:313` (`escolherCnae`), `src/infrastructure/receita/brasilapi.ts:122` (`buscarCnpj`), `src/simples/relatorio-analitico.ts:322` (`orquestrarRelatorio`), `src/domain/entities/index.ts:117-129` (`CnaeAnexo`: `situacao|anexos|fatorR` — vedação é Situação, não flag).
- **Bases/build:** `scripts/build-base.mjs:570` (`main`, localiza 5 arquivos), `:333` (`normalizarCnaeAnexo`), `:362` (`normalizarNbsServicos`), `:661` (`escrever public/base/`), `src/infrastructure/base/base-service.ts:254-283` (carga + `bulkPut`), `:461` (`statusBase`), `src/infrastructure/db/schema.ts:334-385` (v11/v12), `src/domain/constants/index.ts:7-9` (`DB_VERSION=12`), `public/base/MANIFEST.json` (stats).
- **Bases-fonte vivas:** `bases-fonte/NBS SERVIÇOS.json` (137→112 +10 overflow =122), `bases-fonte/CNAE X ANEXO.json` (1.090), `bases-fonte/README.md:48` (`npm run base:completa`).

## 4. Decisões de desenho (constraints da fase)

1. **Fonte não-oficial como ponte, nunca como verdade:** `qualclasstrib` alimenta candidatos CNAE→NBS; alíquota/benefício sempre de `resolverClassificacoesNbs` + `referencia` oficial. Sem lastro no resolvedor → marca `sem-lastro-reforma`, nunca inventa redução.
2. **Merge 1090 + 508:** `db.cnae` existente intacta; nova store de links cobre os 508; CNAE fora dos 508 cai no fallback Phase 7 (keyword/divisão + regra geral) com badge `sem-mapeamento-NBS`.
3. **Dexie v13 aditiva:** novas stores `cnaeNbs` (+ opcional `lcNbs`), demais intactas; migração com rollback testado (precedente v11→v12 em 08-05).
4. **Arquivo entra em `bases-fonte/`:** copiar JSON para `bases-fonte/CNAE X NBS.qualclasstrib.json` (nome com `X` segue padrão `CNAE X ANEXO`); `build-base.mjs` passa a localizar 6 arquivos; `MANIFEST.fontesVivas` + `estatisticas.cnaeNbs` versionam.
5. **Rotulagem herdada Phase 7:** "Anexo Simples" vs "Anexo LC 214" sempre separados; teto Situação→confiança (`Permitido 1 / ressalvas 0.6 / Depende 0`) reaproveitado no novo cartão CNAE.
6. **Offline-first + PII local:** links e descrições em IndexedDB; CNPJ continua só via BrasilAPI com cache 30d; nada de CNAE/NBS sai da máquina.

## 5. Riscos

| Risco | Mitigação |
|---|---|
| Licença/fonte qualclasstrib (scraping, sem ato oficial) | Exibir `fonte ponte: qualclasstrib (não-oficial)` + link; verdade fiscal só do resolvedor; docs avisam |
| Mojibake latin1 | `fixLatin1()` no normalizador + teste com `Serviço/Análise/não` |
| 508 ≠ universo; usuário espera todo CNAE | Badge `sem-mapeamento` + fallback Phase 7 + contador `508/1090 com NBS` no status |
| NBS do link fora da base oficial (9 díg. inválido) | Validar 9 díg. + `resolverClassificacoesNbs`; inválido → `sem-lastro`, não quebra lista |
| Estouro Dexie/peso bundle | JSON fica em `bases-fonte/` (gitignored ou não?), compilado em `public/base/cnae-nbs.json`; nunca embutir bruto no bundle JS |

## 6. Addendum rev. 2 — correções consolidadas A–J (2026-10-05)

- **A. Cobertura total:** invariante `todo CNAE tem regra` vira teste (1.090 com Anexo+Situação+Fator R+vedação). `sem-mapeamento-NBS` ≠ `sem regra`. MANIFEST: `cnaesComRegras: 1090` + `cnaesComNbs: 508`.
- **B. Duas camadas + cache por NBS:** `regrasDoCnae` (sempre) / enriquecimento (508). Cache chave `nbs+ano` (~588 entradas, ~11× menos resolvedor; CNPJ 98-NBS evita 98× `calcularTributos`).
- **C. Ano de referência:** LC 214 — 2026 teste (0,1%+0,1%), 2027 CBS plena, 2029–2032 transição, 2033 final. `REF_DEFAULT {IBS: 19, CBS: 9}` (`domain/constants/index.ts:24`) mantido como fallback 2033; novo `refPorAno(ano)`; anos de transição marcados `em-transicao`, nunca número inventado. Verificado: `CBS_REF_PADRAO = 0.088` (`simples/tabelas.ts:48`).
- **D. Bens→NCM:** badge próprio `sem NBS aplicável — atividade de bens (ver NCM)` com link `trocarView('consulta')`; vale em menu, CNPJ e chat.
- **E. Template consolidado:** conferência por código entre fontes; match → TEMPLATE em `classificacoesConsolidadas` (Dexie v13, key `cnae7`); divergência → sem consolidar; precedência oficial > qualclasstrib > auxiliar; `nbsSemDescricao` como fallback; MANIFEST `descricoesConferidas/Divergentes`.
- **F. 98-NBS:** destaque mais provável + ranking + UX de escolha (`ambiguo`).
- **G. Proveniência:** `MANIFEST.fontesVivas.qualclasstrib{origem, licenca, capturaEm, cadencia, notaRede}`; captura de rede é a origem.
- **H–J:** deltas por requisito, chaos 22 casos e aceite rev. 2 aplicados no PLAN §3/§5/§7.
