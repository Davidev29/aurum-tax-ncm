# Relatório de Conferência — Precisão de Classificação NCM / NBS

> **Data:** 26/11/2026  
> **Objetivo:** validar de ponta a ponta se a classificação tributária (NCM para bens e NBS para serviços) está correta após a remoção do Aurum AI, com o sistema 100% determinístico.  
> **Status:** executado; 81 verificações de auditoria + 1.059 testes da suíte completa passando.

---

## 1. Fluxo multiagente executado

| Agente | Escopo | Entrega |
|---|---|---|
| **Casos-ouro NCM** | 28 casos de bens lidos de `reforma.json`, `classificacao-tributaria.json`, `nomenclatura.json`, com probes executados contra a base real | NCM/CST/cClassTrib/redução/anexo/confiança esperados + esqueleto de teste |
| **Casos-ouro NBS** | 30 casos de serviços e 12 CNAEs da ponte CNAE→NBS | NBS/CST/cClassTrib/anexo/estado esperados + invariantes de "sem lastro" |
| **Fluxo ponta a ponta** | Consulta NCM, Serviços/CNPJ, Lote e Simples + casos de borda | Cadeias `UI → store → motor → resultado → export` e lacunas de teste |
| **Integridade da base** | SHA-256, contagens, consistência relacional, schemas, vigência | 8/8 hashes, ~30 métricas, 25/25 tabelas, 0 artefatos da camada removida |

**Consolidação (coordenação):** os casos foram materializados em `tests/auditoria-ncm.test.ts` e `tests/auditoria-nbs.test.ts`, executados em **worker único** (`--maxWorkers=1`) para evitar a contenção do SQLite observada em execuções paralelas. Divergências entre expectativa e implementação foram investigadas caso a caso antes de decidir entre corrigir o código ou corrigir a expectativa.

---

## 2. Cobertura

| Dimensão | Casos |
|---|---|
| NCM — bens com benefício, regra geral, herança SH4, vigência, escopo, ambiguidade | 28 |
| NBS — serviços com benefício, sem lastro, DE-PARA, código direto, fora de escopo | 28 |
| Ponte CNAE→NBS — `classificado` × `tributacao-integral` × `sem-mapeamento` × `bens→NCM` | 12 |
| Invariantes fiscais — base legal, redução 60/100, alíquotas de referência, repartição | 13 |
| Integridade — hashes, contagens, relações, schemas, vigência | 8 arquivos + ~30 métricas |

**Total: 81 verificações de auditoria.** Suíte completa: 88 arquivos / 1.059 testes (1 skippado).

---

## 3. Resultado por fluxo

| Fluxo | Cadeia conferida | Resultado |
|---|---|---|
| Consulta NCM | `Consulta.tsx → store/consulta.ts → classificarComBusca → classificarPorDescricao → resolverClassificacoes → cálculo` | ✅ 28/28 casos; `via`, CST, cClassTrib, redução, anexo e confiança conferidos |
| Consulta Serviços | `ConsultaServicos.tsx → store/consulta-servicos.ts → classificarComBuscaServicos → classificarServicoPorDescricao → resolverClassificacoesNbs` | ✅ 28/28 casos; nenhum NBS inventado quando sem lastro |
| CNPJ → CNAE → NBS | `consultarPorCnpj → consultarPorCnae → regrasDoCnae → enriquecerNbsDoCnae` | ✅ 12/12; `semLastro` sempre com 000/000001 e redução 0 |
| Lote | `store/lote → parsers/lote → analise-lote → resolverClassificacoes → salvamento/PDF` | ✅ via testes existentes; lacunas listadas em §6 |
| Simples | `page → cena → store.calcular → validacao + nucleo → DAS/repartição/export` | ✅ via `cena-simples`, `simples-store-fator-r`, `validacao-fator-r` e bateria de bordas |

---

## 4. Achados e correções aplicadas

### 4.1 Bug real corrigido — código NBS digitado como entrada

**Sintoma:** `123.012.300` (NBS 2.00 válido) e `1.2502.20.00` / `1.2701.20.00` (NBS 1.1 legado) eram tratados como descrição livre. O matching fuzzy elegiu `115.012.000` (segurança da informação) — benefício 200043/Anexo XI — para entradas de arte/softuare.

**Correção:** `src/application/classificacao-inteligente-servicos.ts` agora reconhece:
- código oficial 2.00 (`123.012.300` ou `123012300`) → resolve diretamente na base (`200/200029`, 60/60, Anexo III);
- código legado 1.1 (`X.XXXX.XX.XX`) → recusa a conversão automática (DE-PARA é apenas referência) e pede o código 2.00 ou uma descrição.

**Antes → depois:** `123.012.300`: `null/fuzzy` → `123.012.300 · 200/200029`; `1.2502.20.00`: `115.012.000 · 200/200043` → `null` (sem benefício inventado).

### 4.2 Resíduos mortos removidos

`src/infrastructure/db/schema.ts` ainda declarava `BaseGrafoMeta`/`grafometa` e `src/infrastructure/db/validacao.ts` mantinha validadores de `conversasEmitente`/`grafometa` — tabelas que não existem mais no schema. Removidos; typecheck limpo.

### 4.3 Expectativas incorretas dos agentes (corrigidas na bateria)

- `classificarComBusca('Cerveja latao')`: o agente esperou `total=0`; a base dá regra geral `000/000001` → **303** (19% + 11,3% de R$ 1.000). Expectativa corrigida.
- `0201.20.10`: descrição vigente é "Quartos dianteiros", não "não desossadas". O canário continua documentando que o qualificador "desossada" é ignorado.

---

## 5. Fragilidades conhecidas (canários documentados nos testes)

Não houve alteração de regra fiscal nestes pontos — são limitações atuais, registradas como asserções "canário" para detectar mudanças:

| # | Fragilidade | Impacto tributário |
|---|---|---|
| 1 | `Quitosan` (`3913.90.50`, extinto em 30/09/2026) continua em `ncm_provavel`; o resolvedor degrada para 000/000001 e exibe aviso | Nenhum benefício indevido; sugestão ainda mostra código extinto |
| 2 | `3913.90.50` digitado com pontos casa fuzzy com `6815.99.14` (falso positivo); sem pontos retorna `null` | Nenhum benefício indevido (ambos regra geral) |
| 3 | "Carne bovina fresca desossada" elege `0201.20.10` ("Quartos dianteiros") | NCM impreciso; tributação permanece 100/100 Anexo I |
| 4 | Pin curado de token único ("Mozzarela") acerta o NCM mas confiança cai para `baixa` | Apenas apresentação; não muda CST/cClassTrib |
| 5 | "psicologia" elege `123.011.100` (saúde) em vez de `123.019.800` (psicologia) | Mesmo CST/cClassTrib/redução/anexo (200/200029) |
| 6 | "espetáculo teatral" elege `101.057.000` em vez de `111.031.000` | Mesmo CST/cClassTrib/redução/anexo (200/200039) |
| 7 | `tests/helpers/base-minima.ts` (12 NCMs) diverge da base completa: "milho híbrido" dá `alta` na fixture e `media` na base real; "boi Nelore" não tem vínculo na fixture e tem 200038 na real | Expectativas de fixture NEVER devem ser reutilizadas em teste de base cheia |
| 8 | `docs/SPEC-LOGICA-NEGOCIO.md:36` ainda diz `REF_DEFAULT = 17,70/8,80`; código vigente é `19/11,3` | Documentação desatualizada; cálculo correto |

---

## 6. Integridade da base (auditoria separada)

| Item | Resultado |
|---|---|
| SHA-256 dos 8 JSON versionados vs `MANIFEST.json` | ✅ 8/8 idênticos, incluindo `dist/base/` e `app.asar` |
| Contagens declaradas vs reais | ✅ ~30 métricas conferidas (164/2335/17/132/15156/1090/122/3239/1391/6641…) |
| Schemas Prisma / SQL / TS | ✅ 25 models = 25 CREATE TABLE, byte-idênticos; sem tabelas da IA removida |
| Artefatos da IA removida em `dist/`, `release/`, `public/base/` | ✅ nenhum |
| Vigência | ⚠️ 1 NCM extinto (`39139050`), tratado com rebaixamento para regra geral + aviso |

**Ressalvas de qualidade de dados (já quantificadas no MANIFEST, não são corrupção silenciosa):**
- 37 `cClassTrib` da referência não aparecem em `reforma.json`; nenhum é usado pelos 2.335 vínculos NCM/122 NBS, mas 4 aparecem como hipótese com `baseLegal` vazio (`200|200050`, `200|200053`, `200|200054`, `515|515001`).
- 371 links em `cnae-nbs.json` apontam para 55 CNAEs ausentes da base oficial — marcados como `codigo-ausente-oficial`/`divergencia`; o sistema exibe aviso e usa `semLastro`.
- NBS `101052100` (37 CNAEs de construção) não existe na nomenclatura oficial 2.00; cai em 000/000001 com descrição informativa da ponte.
- 6 vínculos NCM sem nomenclatura (`02071400`, `28273998`, `07129010`, `30024993`); CST/benefício permanecem corretos via fallback da descrição do vínculo.
- `parametros.json` é deliberadamente não-hasheado (tabela editável pelo usuário).

---

## 7. Lacunas de cobertura ainda abertas

1. **Renderização das telas** — não há testes de componente (sem Testing Library/jsdom de UI); `PainelExato`, cartão de fora-de-escopo e painel de decisão não são assertados.
2. **Stores de Consulta/Serviços** — `consultarUnificada`, `classificarDescricao`, `consultarCnpj` e a limpeza por geração seguem sem teste direto.
3. **CNPJ sem CNAE** e erros de rede parciais (atividades em `falha`) não têm teste.
4. **Lote** — CFOP/CST no PDF, `salvarProdutosEmLote` (upsert), aceite obrigatório no modal e crédito presumido não são verificados.
5. **`store.calcular()` nas bordas** — RBT12=0, >4,8M, Fator R exatamente 28%, `Infinity` (o motor estrito é testado, a store não).
6. **`usarSugestaoBusca`/`feedbackNegativo`** e `montarPayloadSimples` (CSV/JSON) sem teste direto.

---

## 8. Critério de aceite do fluxo de conferência

| Critério | Resultado |
|---|---|
| Nenhum NCM/NBS inventado em caso sem lastro | ✅ |
| Todo benefício exibido tem vínculo em `reforma.json` | ✅ (exceto hipóteses informativas explícitas) |
| Toda decisão passa pelo resolvedor oficial | ✅ |
| Fator R/sublimite fail-closed | ✅ |
| Base fiscal íntegra (hash + contagens + schemas) | ✅ |
| 81 verificações de auditoria | ✅ |
| Suíte completa sem regressão | ✅ 1.059 testes |

**Veredito:** a classificação tributária de NCM e NBS está correta nos casos-ouro e nos fluxos de ponta a ponta conferidos. Os pontos de atenção são fragilidades de precisão documentadas (§5) e lacunas de teste (§7), não erros de cálculo ou enquadramento.
