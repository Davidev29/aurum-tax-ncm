# Fine-tuning v6 — Simples / Fator R na conversa direta

> Fluxo agêntico: AGENTE-MOEDA × AGENTE-FATOR-R × AGENTE-EVAL debateram as specs.
> Este documento é o contrato do fine-tuning (dataset + regras + avaliação).
> O sistema é **determinístico** (todo número vem de `simples/calculo.ts`);
> "fine-tuning" aqui = refino de parsing/diálogo + dataset de regressão, não pesos de LLM.

## 1. O que mudou

### 1.1 Formatador de moeda eficiente (`domain/services/format.ts`)
- `fmtMoeda` agora reusa `Intl.NumberFormat` singleton (sem alocação por chamada).
- Novo `fmtMoedaEficiente(v, quandoVazio='—')`: fast-path para number, `-0`→`R$ 0,00`,
  fallback `fmtBRL` manual (loop de milhar, sem `Intl`) para offline/SSR.
- `fmtBRL`/`fmtInt`/`fmtNum` sem `new Intl` por chamada.

### 1.2 Parser robusto (`domain/services/valores-chat.ts`)
- Sufixos: `k/mil`, `mi/milhão (com/sem acento)`, `bi/bilhão`, `M`,
  `conto(s)=1e3`, `pau(s)/pila(s)/prata=1x` (documentado: "70 paus"=R$70),
  `reais/real/brl` como âncora.
- Preposições: `pra/para/por/com` ("receita pra 50 mil").
- Rótulos: `flh`, `salários`, `colaboradores/funcionários`, `pró-labore/encargos`,
  `receita competência`, `fatura/rec`.
- Novo: `classificarSlotEdicao`, `extrairPercentualDeRBT` ("30% do RBT"),
  `resolverFolhaPercentual`, `aplicarEdicaoSimples` (anti-"RBT fantasma"):
  valor avulso sem rótulo após RBT+receita vira **folha**, nunca RBT.

### 1.3 Diálogo Fator R (`application/aurum-ai-chat.ts` — `responderSimples`)
- `Fator R < 28%`:
  - Frase normativa: "**não é tributada pelo Anexo III** — vai para o **Anexo V**".
  - Quantifica: `folhaMinima = 28% × RBT12`, `gap`, `gapMensal = gap/12`,
    `DAS III × DAS V`, `economiaMes`.
  - Frase: "Aumente sua folha de pagamento para **R$ X** (12m)".
  - Botão: `🔁 Refazer cálculo com folha R$ X` →
    `__RECALCULAR_FATOR_R__ RBT12=.. RECEITA=.. FOLHA=.. ANEXO_ATUAL=..`
    (recalcula herdando tudo; prefixa "🔁 Recálculo com folha sugerida").
- `Fator R ≥ 28%`: "enquadrado (≥ 28%), sustenta o III".
- Sem folha: "não calculado (sem folha) — informe a folha 12m".
- Edição: eco obrigatório `Alterado: {slot} (antigo → novo), mantidos ...`.
- Valor avulso ambíguo: pergunta "É RBT12, receita ou folha?" com 3 botões.

### 1.4 Roteamento (`application/aurum-ai-tools.ts`)
- `refinarIntencaoComContexto` cobre dialetos: `paus/pila/conto/mi/bi/%`,
  verbos `troca/muda/corrige/bota/aumenta/refaz/recalcula`, `30% do RBT`.
- `PLANO_TOOL_CALLING.calcularSimples` documenta edição + `__RECALCULAR_FATOR_R__`.

## 2. Dataset (30 casos)

Arquivo: `tests/fixtures/simples-finetuning-30.jsonl` (1 JSON por linha).

Campos: `id`, `categoria` (`I{1-4}-O{1-4}-D{1-6}-R{1-7}`),
`input`, `historico`, `slots_esperados`, `resposta_contem`,
`resposta_nao_contem`, `botoes_esperados`, `observacao`.

Eixos (pesos): I1 cálculo completo 40%, I2 follow-up edição 30%,
I3 Fator R 20%, I4 controle 10%. Ver `AGENTE-EVAL` para matriz completa.

## 3. Como rodar

```powershell
cd "C:\Users\david\Documents\REFORMA NCM\Aurum Tax NCM"
npx vitest run tests/chat-simples-fatorR.test.ts
npx vitest run tests/chat-probabilistico.test.ts
npx vitest run tests/chat-valores.test.ts tests/chat-simples-anexo.test.ts tests/chat-finetuning-v2.test.ts tests/chat-simples-fatorR.test.ts tests/chat-probabilistico.test.ts
```

Critério: global ≥90%; I1/I2/I3 ≥85%; I4 ≥80%.
Se I2/I3 < alvo, ampliar o `.jsonl` nesses dialetos antes de mexer em regra.

## 4. Como evoluir o fine-tuning (sem treinar LLM)

1. Adicione a frase real do usuário como nova linha no `.jsonl`
   (com `slots_esperados` + `resposta_contem/nao_contem`).
2. Rode o harness; se MISS, ajuste `valores-chat.ts` (rótulo/sufixo/verbo)
   ou `aurum-ai-chat.ts` (texto/botão), nunca o motor `simples/calculo.ts`.
3. Re- rode até ≥90%. O `.jsonl` é a regressão permanente.

Para LLM local (opcional, `recursos-ia/modelo`): exporte o `.jsonl`
para JSONL de instrução (`prompt: input + contexto`, `completion: slots + template`)
e treine LoRA com máscara só no `completion`. O determinismo continua valendo:
o modelo sugere slots, o motor calcula.

## 6. v7 — intenção contínua e memória em pilha

- `valores-chat.ts`: `historicoSlotsSimples()` empilha um turno por fala
  (ordem cronológica, sem `join` cego); `resolverValorPorReferencia()`
  (`primeiro/último/anterior/volta`), `resolverAnexoPorReferencia()`
  (`o outro` = distinto do topo; 0–1 candidato → pergunta),
  `observarIntencaoSimples()` (`reverte > troca_anexo > edita_slot`,
  `comparativo` avaliado antes para não ser roubado por "anexo"),
  `anexoExigeFolha()` (só III/V).
- `aplicarEdicaoSimples(..., pilha?)`: troca de anexo com mesmos valores
  carrega RBT+receita e só herda a folha se o destino exige (I/II/IV
  arquivam a folha — some do eco, segue na pilha para a volta).
- `aurum-ai-tools.ts`: `ContextoConversa` ganha
  `historicoAnexos/Rbt12/Receitas/Folhas`; `ultimoAnexo` sai do topo da
  pilha (antes o `match` pegava a primeira menção); rede de segurança
  promove `ncm/nbs` com vocabulário de slot + conversa Simples para
  `simples` (ex.: "e no outro anexo?").
- `detector-chat.ts`: `anexo` isolado (com fronteira) virou sinal do Simples.
- `aurum-ai-chat.ts`: eco `Indo para o Anexo X com os mesmos valores`,
  `Voltado para o valor anterior`, `Usando o primeiro valor`; folha some
  do eco/contexto quando o destino é I/II/IV; "outro anexo" sem 2
  candidatos pergunta o destino.
- Testes: `tests/chat-simples-intencao.test.ts` (11 testes).

## 7. v8 — híbrido sob demanda + 2 guias + roteamento por contexto

- Regra: o duelo Conv×Híb só aparece sob demanda (clique em "Comparar com
  regime híbrido" ou pedido explícito) ou com despesas já informadas.
  Matriz exploratória sem pedido mostra só o convencional + convite com
  botão; gráfico cai para `graficoComparativoAnexos`; insights viram convite
  ("Híbrido sob demanda").
- Entrega única do híbrido (`responderHibridoAnexo`, única saída): as 2 guias
  — **Guia DAS (sem CBS)** + **Guia DARF (CBS por fora)** — + total, veredito
  e STEP-BY-STEP da referência quando sem despesas.
- Pedido só no híbrido ("Anexo III ... no híbrido") e refino em thread
  híbrida ("aluguel 2000", "usar referência" — antes virava folha fantasma)
  calculam e entregam as 2 guias; `contextoHibridoAtivo()` decide.
- `responderComparativo` com menção a híbrido + números calcula (não
  despista para o módulo); sem números, pergunta objetiva; III×V ganha botão
  de matriz em 1 clique. Gates com texto normalizado (sem acento) para
  "híbrido".
- Testes: `tests/chat-simples-hibrido-gating.test.ts` (6 testes).

## 8. v9 — reduções no híbrido + motor de porcentagem + léxico

- Motor de porcentagem (`domain/services/percentual-chat.ts`, regexes
  pré-compiladas): "30%", "30 por cento", "redução de 30%", "red30",
  "70% da alíquota", "alíquota zero", "sem crédito", "integral", com a
  distinção `reducao_de` (reduz N) × `paga_x` (paga N) e mapas para
  `RegraCreditoCBS`/`RegraDebitoCBS`.
- Crédito por tipo: `regraPertoDeComFonte()` distingue integral explícito de
  assumido (`regraExplicita`); léxico tolerante (`casaToken` + sinônimos, os
  primitivos do RAG de NCM) canonicaliza typos/sinônimos ("alugel",
  "locação", "conta de luz"); sem lastro o rótulo segue livre.
- Pergunta guiada (uma por resposta): receita com redução sem % ("qual
  porcentagem?", botões 30/60/zero/sem redução) e primeira despesa com regra
  assumida ("tem redução?", botões Integral/30/60/zero/sem crédito, em
  linguagem natural recalculável). Aluguel usa 30% da categoria sem perguntar.
- Débito com redução: `detectarRegraDebitoReceita()` ("receita com redução
  de 30%" → red30; "X% do RBT" e "receita bruta" ignorados); entrega nas
  2 guias + `Regras aplicadas:` transparente; análise final sempre retornada.
- Roteamento: guarda anti-roubo no refino de NCM (`%`/despesa + conversa
  Simples não vira NCM) e rede dados→simples ("receita tem redução" não vai
  aos XMLs).
- Testes: `tests/chat-simples-hibrido-reducao.test.ts` (11 testes).

## 5. Limites conhecidos (documentados, não bugs)

- "70 paus" = R$ 70 (1x). Para 70 mil, diga "70k/70 mil/70 contos".
- Por extenso total ("quinhentos mil") ainda não parseia número — pede confirmação.
- `12x 5k` (parcelado) não soma automaticamente — informe o total 12m.
- `%` sozinho nunca é dinheiro (apagado pelo mascarador); só vale em "X% do RBT".
