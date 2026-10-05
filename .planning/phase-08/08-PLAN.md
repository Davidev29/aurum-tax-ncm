# PLAN — Phase 8: Refinos de Interação Aurum AI (Simples, Tools, Probabilístico, Memória)

**Phase:** 8
**Project:** Aurum Tax NCM (Aurum Bit Labs v1.0.0)
**Date:** 2026-10-04
**Status:** Planned (gsd-plan-phase)
**Source:** Correção multiagente do print Anexo I + requisitos de refinamento de interação (28 itens verificados)
**Mode:** tracer-first (default)
**Depends on:** Phase 7 (Serviços NBS+CNAE+CNPJ implementada 2026-10-03)

---

## 1. Goal

Eliminar a contradição do print (`Anexo I` respondendo `Fator R 0.00% sugere Anexo V`) e elevar a conversa do Simples a **≥85% de sucesso**: inferir anexo por atividade em linguagem natural, suprimir Fator R fora de III/V, comparar anexos e Conv×Híb dentro do chat com os mesmos valores da conversa, rotear deterministicamente para a tool certa (RAG+lexical), calibrar probabilisticamente `P(anexo|texto)`, memorizar curto + longo prazo por emitente, e fechar o loop com FineTuning (pesos/limiares, sem retreinar base legal).

Correção multiagente executada nesta fase de planejamento (3 subagentes em paralelo + verificação local):
- **Anexo/Fator R:** regra fiscal + 36 exemplos + pseudocódigo `inferirAnexoPorAtividade` + 10 chaos.
- **Tools/Comparativos:** roteador atual auditado + spec 2 botões `__COMPARAR_*__` + dispatcher + 7 chaos.
- **Probabilístico/Memória/FT:** motor atual auditado + fórmula `P(anexo)` + schema Dexie por emitente + pipeline FT + 5 chaos.
- **Verificação local:** `tests/chat-valores + chat-detector + chat-aurum-ai` 42/42 verdes; `chat-finetuning-v2 + simples-calculo + relatorio-analitico` 46/46 verdes. Bug confirmado por leitura: `src/application/aurum-ai-chat.ts:1096,1112` imprime Fator R incondicional.

## 2. Non-negotiable Principles

1. **Determinismo fiscal:** todo número vem de `src/simples/calculo.ts` (`calcularConvencional`, `fatorR`, `calcularHibrido`) ou `src/domain/services/calculo.ts`. IA formata, nunca recalcula (P1 herdado de `src/application/aurum-ai-tools.ts:10`).
2. **Explícito vence inferência:** `Anexo I` digitado sempre vence `sou médico` inferido. Empate/confiança <0.40 → PERGUNTA, nunca chuta (espelha NÃO SEI).
3. **Fator R só em III/V:** `USA_FATOR_R = anexo==='III'||anexo==='V'||anexo==null`. I/II/IV nunca exibem linha Fator R, fonte Fator R, nem pedem folha para III×V.
4. **Sem projeção de DAS:** sem anexo+RBT12+receita não há cálculo honesto — PERGUNTA (`responderSimples` padrão atual `aurum-ai-chat.ts:1062` mantido).
5. **Anti-poluição preservada:** Simples herda SÓ de falas Simples; IBS herda SÓ de falas cálculo (`aurum-ai-tools.ts:195-201`). Payload `__COMPARAR_*__` é parseado literal, nunca via `extrairTodosValores(historico)`.
6. **Read-only + ato assistido:** allowlist `PLANO_TOOL_CALLING` mantida; única escrita assistida continua sendo `salvarEmpresa` idempotente.
7. **Resolvedor única verdade:** NCM/NBS continuam validados por `resolverClassificacoes`; anexo inferido probabilisticamente nunca vira fato sem confirmação ou vínculo CNAE.
8. **Offline-first + PII local:** conversas por emitente em IndexedDB, nunca no GGUF nem em log exportado; entra em `backup.ts`.

## 3. Requirements (REF-01..REF-12)

| ID | Requirement | Origem | Arquivo-alvo |
|----|-------------|--------|--------------|
| REF-01 | Inferência `sou comércio→I, indústria→II, serviços gerais→III, construção/advocacia→IV, médico/engenheiro/contador/TI→V provisório` + explícito sempre vence | pedido §1 | `valores-chat.ts` + novo `anexo-inferencia.ts` |
| REF-02 | Guard Fator R: suprimir linha/fonte/pedido de folha para I/II/IV; mensagem neutra quando sem folha em III/V | print contraditório | `aurum-ai-chat.ts:1096,1112` |
| REF-03 | Botão `Comparar com outros anexos` roda matriz I–V real com mesmos RBT12/receita/folha + veredito menor carga | pedido §2 | `aurum-ai-chat.ts:responderSimples` + novo `responderComparativoMatriz` |
| REF-04 | Botão `Comparar com regime híbrido` roda Conv×Híb real + avisa sem despesas/créditos + pede DESPESA | pedido §2 | novo `responderComparativoHibrido` |
| REF-05 | Dispatcher central `executarTool(nome,args,ctx)` + intercept `__COMPARAR_*__` antes do detector + trilha pensamento | pedido §3 | `aurum-ai-tools.ts` |
| REF-06 | Roteamento dinâmico determinístico RAG+lexical documentado (detector→vocabulário→indice-lexical→pesos→resolvedor→template §6) | pedido §3 | `aurum-ai-tools.ts`, `detector-chat.ts` |
| REF-07 | Motor probabilístico `P(anexo\|texto,folha,rbt12)` calibrado por `calibrarConfiancaFinal`, limiares 0.75/0.40, margem ≥0.20 | pedido §4 | novo `anexo-probabilistico.ts`, `aurum-ai.ts` |
| REF-08 | Memória curto prazo 2 camadas (slots só user + discursivo 6 msgs user+assistant com confirmação) | pedido §5 | `aurum-ai-tools.ts:188` |
| REF-09 | Memória longo prazo por emitente (Dexie `conversasEmitente`, chave emitenteId, limite 30, TTL 90d, indiferente de empresa ativa) | pedido §6 | `schema.ts` v12, `store/chat.ts`, `store/sessao.ts` |
| REF-10 | Chaos matrix 22 casos com oráculo + suíte regressão + gate ≥85% sucesso de conversa | pedido orquestrador | `tests/chat-simples-*.test.ts` |
| REF-11 | Pipeline FineTuning: dataset `frases-modelo + logs + ia_feedback`, augmentation 5–10×, treino=reindex pesos/sinônimos, eval massa controle, versionamento MANIFEST+CHECKSUMS | pedido FT | `recursos-ia/conhecimento/*`, `scripts/*` |
| REF-12 | Docs + UAT: atualizar verbetes, capacidades, relatório analítico linkado, aceite print Anexo I sem Fator R | pedido disponibilidade | `aurum-ai-conhecimento.ts`, `aurum-ai-recursos.ts` |

## 4. Tracer Slice (verify first)

**08-00 Tracer (executar antes de tudo, 1 dia):**
`chat.ts:enviar("Quanto vou pagar no Anexo I? RBT12 12 mil e receita 36 mil?")` → `responderSimples` com guard `USA_FATOR_R=false` → texto sem `Fator R`, sem `III × V`, com `DAS R$ 1.440,00` + botões `Comparar anexos / Comparar híbrido / Abrir Simples` → clicar `Comparar anexos` re-envia `__COMPARAR_ANEXOS__ RBT12=12000 RECEITA=36000 FOLHA=0 ANEXO_ATUAL=I` → matriz I–V + veredito. Pass criteria: sem menção a Fator R no turno 1; matriz com 5 linhas no turno 2; `tsc 0 + vitest tracer verde`.

Só após tracer verde, expandir 08-01..08-06.

## 5. Plans

### 08-01 — Inferência de anexo + guard Fator R [REF-01, REF-02]
**Goal:** `Anexo I` nunca mais sugere `Anexo V`.
**Tasks:**
1. Novo `src/domain/services/anexo-inferencia.ts`: `inferirAnexoPorAtividade(texto)` — ordem: `extrairAnexoRobusto` (explícito, conf 1.0) → regex IV → II → I → V (conf 0.75, `precisaConfirmar=true`) → III (0.75) → null. Listas: I `comercio,loja,revenda,mercadinho,distribuidora,lojista,comesio`; II `industria,fabrica,fabrico,produzo`; III `salao,barbeiro,academia,aula,curso,manutencao,reparo,locacao bens moveis,creche`; IV `construcao,empreitada,vigilancia,limpeza,conservacao,advocacia,advogado,paisagismo`; V `medico,engenheiro,contador,consultoria,ti,programador,dev,software,designer,auditor,publicidade,jornalista,veterinario,psicologo` + normalização NFD + typos (`advogacia,emgenheiro,comesio`).
2. Patch `responderSimples (aurum-ai-chat.ts:1050)`: `anexoId = slots.anexo ?? inferir() ?? ctx.ultimoAnexo`; conflito contexto: frase atual sempre vence herança.
3. Guard exibição (substitui `:1096,1112`): `USA_FATOR_R` acima; `linhaFatorR=''` para I/II/IV; fonte `Fator R…` só quando `USA_FATOR_R`; `folhaAviso` neutro (`sem folha informada — se for serviço elegível…`) em vez de `sugere Anexo V` quando `folhaCtx==null`.
4. Validações: `RBT12>4.8M` → fora do Simples; `RBT12<=0` → perguntar; `receita>RBT12` mantém `alertaReceita` sem autocorreção; `MEI` → orientar, não calcular; atividade mista (`comércio e serviços`) → pedir split ou CNPJ.
**Verify:** print Anexo I sem `Fator R`; 36 exemplos inferem certo; `extrairAnexoRobusto` (`primeiro…quinto,1-5`) vence inferência; suíte `chat-simples-anexo.test.ts` ≥30 casos.
**Prohibition:** MUST NOT exibir `sugere Anexo V` quando anexo explícito é I/II/IV (grep + test).

### 08-02 — Botões comparativos com valores da conversa [REF-03, REF-04]
**Goal:** 1 clique → matriz real, sem redigitar.
**Tasks:**
1. `responderSimples` sucesso retorna 3 botões: `⚖️ Comparar com outros anexos` (`perguntar __COMPARAR_ANEXOS__ RBT12=.. RECEITA=.. FOLHA=.. ANEXO_ATUAL=..`), `🔀 Comparar com regime híbrido` (`perguntar __COMPARAR_HIBRIDO__ RBT12=.. RECEITA=.. FOLHA=.. ANEXO=.. DESPESA=0`), `Abrir Simples Nacional` (`navegar simples`).
2. Intercept no topo de `responderChat` antes de `detectarIntencaoChat`: `startsWith('__COMPARAR_ANEXOS__') → responderComparativoMatriz`; `__COMPARAR_HIBRIDO__ → responderComparativoHibrido`. `parsePayload` estrito (`Number>0`, anexo∈I–V); falha → fallback PERGUNTA, nunca `resolverSlot(1000)`.
3. `responderComparativoMatriz`: loop `ANEXOS_SIMPLES` com `calcularConvencional` + `fatorR`; tabela `| Anexo | Faixa | Aliq | DAS | CBS dentro |` + veredito `Menor carga: Anexo X`; nota `III×V só faz sentido p/ serviços` quando atual é I/II/IV; idempotência (payload idêntico ao último → `já calculado acima`).
4. `responderComparativoHibrido`: `calcularConvencional + calcularHibrido`; tabela Conv vs DAS reduzido vs CBS fora vs total vs economia vs `melhor`; sem DESPESA → avisa pessimista + botão pedindo `DESPESA=?`.
**Verify:** turno 1 Anexo I gera payload com `RBT12=12000 RECEITA=36000`; turno 2 matriz 5 linhas com DAS corretos (I 1440.00 no print); híbrido sem despesa avisa; clique duplo idempotente.
**Checkpoint:** payload `__COMPARAR_*__` é contrato chat→orquestrador (one-way: quebra botões antigos) — requer confirmação.

### 08-03 — Dispatcher + roteamento dinâmico RAG+lexical [REF-05, REF-06]
**Goal:** intenção→tool auditável, sem chute.
**Tasks:**
1. `executarTool(nome,args,ctx)` em `aurum-ai-tools.ts`: valida inputs (simples exige 3 obrigatórios; cálculo exige 8dg+base>0), chama RAG só em `consultarNCM/NBS` (`extrairNucleoBusca → SINONIMOS_FISCAIS/SERVICOS → indice-lexical.json → pesos.json → resolvedor`), chama motor em `calcular*/simular*`, retorna `pensamento` com trilha `intenção→tool · quandoUsar · ms`.
2. `responderChat → detectar → refinar → toolParaIntencao → executarTool`; `refinarIntencaoComContexto` passa a reconhecer `__COMPARAR_*__` e `comparar|hibrido + houveSimples` (corrige gap atual que retorna `generico` quando há só `houveCnpj`).
3. Documentar em `PLANO_TOOL_CALLING` as 2 novas tools `simularComparativoMatriz/Hibrido` (quandoUsar, inputs, guardrail `sem números → PERGUNTA`).
4. Preservar barreira `detectarForaDeEscopo` + `MENSAGEM_FORA_DE_ESCOPO_CHAT` exata.
**Verify:** `toolParaIntencao` cobre 13 tools; `__COMPARAR_*__` nunca cai em `generico`; sem lastro → NÃO SEI instrutivo; `tsc + vitest tools` verdes.

### 08-04 — Motor probabilístico P(anexo) [REF-07]
**Goal:** anexo incerto vira pergunta, não chute.
**Tasks:**
1. Novo `src/domain/services/anexo-probabilistico.ts`: `score(anexo)=log P(anexo)+Σ log P(token|anexo)+w_FR·log PriorFR`; `conf=softmax(top)`, `margem=P1-P2`; `baseTexto=P1` passa por `calibrarConfiancaFinal({baseTexto, margem:(P1-P2)*10, temVinculo:cnaeTabelado, temPin, tokens})`. Corpus: `frases-modelo.json + frases-modelo-servicos.json + CNAE×Anexo + ia_feedback` com Laplace smoothing. `PriorFR`: III/V com folha+rbt12 conhecidos → 0.85/0.15 pelo lado ≥/<28%, senão 0.5/0.5; I/II/IV neutro 1.
2. Limiares (reuso `LIMIAR_ALTA 0.75/MEDIA 0.40`): `P1≥0.75+margem≥0.20 → confirma`; `0.40–0.75 ou margem<0.20 → sugere + pede 1 dado`; `<0.40 → pergunta anexo`.
3. Estender `IaFeedback` (`schema.ts`): `features{tokens,cnae,FR,P,margem}, anexoSugerido, anexoConfirmado, correcaoUsuario`; promote +2 quando confirmado repete (demote −500 existente mantido).
4. Substituir conf fixa do Simples (0.9/0.85) por calibrada; conceito/comparativo sem números mantêm 0.9.
**Verify:** `desenvolvimento de software, folha 200k, RBT500k → III 0.78/V 0.19 → confirma III`; `sou MEI → pergunta`; massa 36 exemplos ≥85% top-1 ou `perguntar` honesto (nunca anexo errado com conf alta).

### 08-05 — Memória curto + longo prazo por emitente [REF-08, REF-09]
**Goal:** cada seção gravada no perfil do emitente, indiferente da empresa ativa.
**Tasks:**
1. Curto prazo (`extrairContextoConversa` janela 20 mantida): 2 camadas — `slots` (só `user`, como hoje) + `discursivo` (últimas 6 `user+assistant`: `ultimoCodigoSugerido, ultimoAnexoSugerido, confirmado?`). Slots tipados `{anexo,rbt12,receitaMes,folha12,ncm,nbs,cnpj,valorBase,dominio}`.
2. Longo prazo Dexie v12 (nova store, demais intactas): `conversasEmitente: 'conversaId, emitenteId, updatedAt'` com `{conversaId, emitenteId(hash nome+cnpj ou 'default'), empresaAtivaId(só auditoria), mensagens, slots, titulo, createdAt, updatedAt}`. `espelharAtiva (chat.ts:86)` estendida para `db.conversasEmitente.put` a cada turno com `emitenteId` de `useSessao.emitente` (nunca `ativa.id`); troca de empresa não limpa; troca de emitente restaura última do novo; limite 30/emitente, TTL 90d lazy, entra em `backup.ts`.
3. UI: lista arquivadas filtra por `emitenteId`; `restaurar` preserva `slots`.
**Verify:** troca empresa mantém conversa; troca emitente troca arquivo; reload persiste; `sessao.selecionar` não apaga; migração v11→v12 com rollback test.
**Checkpoint:** migração Dexie v12 (one-way) — backup/rollback obrigatório.

### 08-06 — Chaos, FineTuning, eval ≥85% e docs [REF-10, REF-11, REF-12]
**Goal:** provar 85%+ antes de shippar.
**Tasks:**
1. Chaos matrix 22 casos (oráculo fechado): Anexo I sem Fator R; `sou comercio/comersio`→I; `sou industria/fabrica`→II; `salão/academia/aula`→III; `construção/advocacia/vigilância/limpeza`→IV; `médico/engenheiro/contador/TI`→V provisório+pedir folha; `anexo 1/primeiro anexo` explícito vence; `MEI`; `comércio e serviços` (split/CNPJ); `RBT12 0/ausente`; `receita>RBT12`; `RBT12>4.8M`; `folha>RBT12`; `comparar sem números`; `o que é Fator R?` (conceito); `__COMPARAR payload adulterado`; `emitente sem ID`; `troca empresa no meio`; `histórico 50 msgs`; `híbrido sem despesa`; `clique duplo idempotente`; `IBS R$1000 não vira receita`.
2. Suítes `tests/chat-simples-anexo.test.ts + chat-simples-comparativo.test.ts + chat-memoria-emitente.test.ts`: cada chaos 1 test; gate `≥85% (19/22)` + zero `sugere Anexo V` para I/II/IV (grep) + `npm test` total verde.
3. FT: dataset `frases-modelo*.json + logs/*.jsonl + ia_feedback` (só `ncmValidado!=null`); augmentation 5–10× (typos, paráfrases, valores, ordem); treino=reindex `pesos.json/sinonimos.json/indice-lexical.json` (nunca GGUF nem vínculo/CST); eval massa controle + chaos; versionar `CHECKSUMS.txt + MANIFEST{versao,data,precisão,corpusHash}`; `invalidarCacheFichaAbsoluta()` pós-import.
4. Docs: verbete `anexo I/II/IV (sem Fator R)` em `aurum-ai-conhecimento.ts`; `TOOLS_AURUM_AI` + `VIEWS` com comparativos; `SPEC_RELATORIO_ANALITICO` linkado no veredito.
**Verify:** 22 chaos executados, relatório `docs/chaos-phase-08.md` com tabela caso→esperado→obtido→pass/fail + taxa; se <85% → refinar pesos/regex e repetir (máx 3 iterações); UAT print Anexo I refeito sem Fator R.

## 6. File Map (create / patch)

**Create:** `src/domain/services/anexo-inferencia.ts`, `src/domain/services/anexo-probabilistico.ts`, `tests/chat-simples-anexo.test.ts`, `tests/chat-simples-comparativo.test.ts`, `tests/chat-memoria-emitente.test.ts`, `docs/chaos-phase-08.md`, `.planning/phase-08/08-PLAN.md` (este).
**Patch:** `src/application/aurum-ai-chat.ts` (guard Fator R, botões, intercept `__COMPARAR_*__`, `responderComparativoMatriz/Hibrido`), `src/application/aurum-ai-tools.ts` (`executarTool`, refino comparativo, contexto 2 camadas), `src/domain/services/valores-chat.ts` (export regex anexo p/ reuso), `src/domain/services/detector-chat.ts` (sinais atividade sem `anexo`), `src/application/aurum-ai-conhecimento.ts` (verbetes I/II/IV), `src/application/aurum-ai-recursos.ts` (tools comparativas), `src/store/chat.ts` (espelho por emitente), `src/infrastructure/db/schema.ts` (v12 `conversasEmitente`), `src/store/sessao.ts`, `src/infrastructure/backup.ts`, `recursos-ia/conhecimento/pesos.json`, `recursos-ia/CHECKSUMS.txt`, `.planning/ROADMAP.md`, `.planning/STATE.md`.

## 7. Verification Loop

Per-plan: `tsc --noEmit` + `vitest run <suite>` + grep `sugere Anexo V` em resposta I/II/IV = 0 + `npm test` final. Gates: tracer 08-00 verde antes de 08-01; Dexie v12 com rollback; payload idempotente; `taxa_uso_ia` inalterada (<30%); sniff rede (só BrasilAPI no CNPJ); UAT terceiro refaz print. Nyquist/security: segredo nenhum em repo; GGUF nunca commitado; PII só local; backup com opt-out.

## 8. Risks

* Atividade ambígua (`sou dentista` III nativo vs V elegível) — mitigar com `precisaConfirmar` + Fator R como prior, nunca auto-confirmar com margem <0.20.
* Matriz I–V confunde MEI/fora do Simples — mitigar com `RBT12_MAX 4.8M (tabelas.ts:46)` + sublimite 4 cenários antes da matriz.
* Híbrido sem créditos vira número pessimista — mitigar com aviso explícito + pedido de DESPESA.
* Persistência por emitente vaza entre perfis — mitigar com chave `emitenteId` + filtro UI + teste troca emitente.
* FT descalibra pesos NCM — mitigar com massa controle NCM ≥85% travada + versionamento MANIFEST.

## 9. Acceptance (12/12)

1. Print refeito: Anexo I + RBT12 12k + receita 36k → DAS R$ 1.440,00, zero `Fator R`, zero `III × V`.
2. 36 expressões atividade inferem anexo certo ou perguntam (nunca anexo errado confiante).
3. Botão anexos → matriz 5 linhas com veredito; botão híbrido → duelo com economia/`melhor`.
4. Roteador cobre 15 tools com trilha auditável; `__COMPARAR_*__` nunca cai em genérico.
5. `P(anexo)` calibrada; <0.40 pergunta; margem <0.20 pede confirmação.
6. Curto prazo herda código/valor/anexo sem poluição IBS↔Simples.
7. Longo prazo por emitente: troca empresa mantém, troca emitente troca arquivo, reload persiste.
8. 22 chaos ≥85% (19/22) documentados em `docs/chaos-phase-08.md`.
9. FT versionado (MANIFEST+CHECKSUMS), sem retreinar GGUF/base legal.
10. `tsc 0 + npm test` total verde (incl. 648 legados + ~60 novos).
11. Docs e capacidades atualizados; relatório analítico linkado.
12. UAT terceiro executa print + 5 conversas sem ajuda e aprova.

---

*Next: `/gsd-execute-phase 8` onda 1 (tracer 08-00 + 08-01), depois 08-02/08-03 em paralelo, 08-04/08-05, fechar 08-06 com chaos até ≥85%.*
