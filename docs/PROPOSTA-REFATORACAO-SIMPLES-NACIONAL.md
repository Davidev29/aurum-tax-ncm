# Proposta de Refatoração Completa — Módulo Simples Nacional

> **Status:** proposta **implementada** em 26/11/2026 — ver §"Status de implementação" abaixo  
> **Data:** 2026-11-26  
> **Alvo:** `src/simples/` (núcleo), `src/simples-projection/` (projeção)  
> **Fluxo agentico executado:** 4 agentes em paralelo — (1) mapeamento do módulo, (2) diagnóstico arquitetural, (3) impacto da obrigatoriedade do Fator R, (4) proposta de UX/exibição de resultados. Este documento é a consolidação dos quatro relatórios.

---

## Status de implementação (26/11/2026)

**Implementado:** fases 0–7 do plano — testes de caracterização, extração de widgets, `cena.ts` como fonte única de derivação, hooks de wizard/relatório/exportação, Fator R obrigatório com guarda pura e flags na store, wizard e resultado redesenhados, invalidação centralizada e suíte de testes. `page.tsx` passou de ~1.717 para ~630 linhas; o resultado segue `Veredito → Memória → Composição → Cenários → Ações`, com o DAS como primeiro elemento e veredito do Fator R ao vivo na entrada.

**Verificação:** `npx tsc --noEmit` limpo; suítes Vitest verdes (contagem atual: ver `npm test`).

**Fora desta rodada (decisões pendentes da §3.5):** a projeção mãe × nova manteve o comportamento anterior (folha opcional/opt-in). Relatório, insights e exports seguem registrando a folha; a guarda nova garante que ela esteja sempre informada no módulo.

---

## 0. Resumo executivo

O módulo Simples Nacional tem um **núcleo de cálculo são e bem separado** (`src/domain/simples/`, `src/simples/calculo.ts`, `segregacao-receita.ts`, `relatorio-analitico.ts`), mas uma **camada de apresentação que reimplementou esse núcleo quinze vezes** em `useMemo` dentro de um único componente de 1.717 linhas (`src/simples/page.tsx`). O resultado é: Fator R tratado em seis lugares diferentes, repartição exibida três vezes, ações espalhadas em quatro pontos e um DAS que não é o primeiro elemento lido.

A mudança de requisito — **Fator R obrigatório** — expõe essa fragilidade: hoje a folha 12m é opcional (`page.tsx:808-822`), o cálculo a assume como "V provisório" (`store.ts:212-220`, `:322-326`).

**Proposta em três movimentos:**

1. **Congelar o comportamento atual com testes de caracterização** antes de tocar no código (vetores fiscais já existem e devem ser estendidos).
2. **Unificar a derivação** em uma função pura `src/simples/cena.ts`, extrair componentes/hooks e centralizar a invalidação na store — sem mudar nenhuma fórmula fiscal.
3. **Redesenhar a experiência**: Fator R obrigatório com veredito imediato na entrada, e resultado reordernado como `Veredito → Memória → Composição → Cenários → Ações`, com um único número em destaque.

**Regra de negócio adotada para a obrigatoriedade (detalhada na §3):** *coleta obrigatória em todas as simulações (I–V, manual ou CNPJ); efeito no cálculo somente quando a atividade é sujeita (III/V); aviso explícito quando a folha for registrada mas não alterar a alíquota.* Isso preserva a correção fiscal já implementada para Anexo I/II/IV e Anexo III puro.

---

## 1. Diagnóstico

### 1.1 Mapa do módulo

| Área | Arquivos | Papel |
|---|---|---|
| **Entrada** | `src/simples/page.tsx` (lazy em `App.tsx:8,70-71`; nav em `ui/Layout.tsx:31`) | `SimplesNacional()` — wizard 3 etapas + resultado rico |
| **Estado** | `src/simples/store.ts` (`useSimples`) | 22 campos + 7 ações; `calcular()`, `buscarPorCnpj()`, `limpar()` |
| **Motor** | `src/domain/simples/nucleo.ts`, `validacao.ts`, `creditos.ts`; `src/simples/calculo.ts`, `tabelas.ts` | Matemática canônica, tabelas I–V, faixas, repartição, ST, híbrido |
| **Composição** | `segregacao-receita.ts`, `segregacao-st.ts` | Segregação por anexo (LC 123 art. 18) e dedução de ST |
| **Relatório** | `relatorio-analitico.ts`, `insights.ts`, `InsightsModal.tsx`, `RelatorioAnalitico.tsx`, `export-relatorio-analitico.ts` | 10 cenários determinísticos, insights por template somente-leitura, PDF timbrado |
| **Saída/UI** | `DasModal.tsx`, `Graficos.tsx`, `export.ts` | Guia DAS (PGDAS), Chart.js, CSV/JSON |
| **Projeção** | `src/simples-projection/*` (20 arquivos) | "Dividir em 2" — wizard 5 etapas mãe × nova; devolve ao motor existente |
| **Testes** | `tests/simples-*.test.ts`, `tests/relatorio-*.test.ts`, `tests/simples-projecao-*.test.ts` | Vetores ouro EX1–EX5, fronteira 28%, segregação, ST |

### 1.2 Layout e resultado — problemas atuais

| Problema | Evidência |
|---|---|
| **Fator R coletado sem consequência visível** | Card `"Folha · Fator R (opcional)"` (`page.tsx:808-822`), dica *"pode ficar em branco"* (`:814`), resultado só no fim com *"provisório no V"* (`:1611-1615`) |
| **Fator R em quatro pontos** | Etapa 1 (`:808-822`), segregação (`:1136-1154`), rodapé do hero (`:1607-1615`), `dadosDas` (`:510-531`) |
| **DAS não é o primeiro elemento** | Memória vem antes no DOM (`:1371`) e o hero depois (`:1512`), contrariando o princípio "1 número reina" do próprio CSS (`index.css:2637`) |
| **Repartição triplicada** | Barra (`:1549-1560`) + lista dentro do hero (`:1562-1587`) + `GraficosDAS` (`:1637-1647`, que também tem modo Tabela) |
| **Ações em quatro localizações** | `Continuar` (`:824`), `Ver resultado` (`:1322`), `BotaoReparticao/Insights/Reiniciar/PDF` (`:1616-1634`), `CSV/JSON/Dividir` (`:1680-1701`) |
| **Hero sobrecarregado** | Oito blocos de texto secundário dentro do card que deveria conter só o DAS (`:1516-1615`) |
| **Estates pobres** | Vazio é `<p>` passivo (`:1328-1341`), erro é só `toast`, carregamento é `setTimeout` artificial de 750 ms (`:676-680`), falha de gráfico descarta informação (`LimiteErroGrafico`, `:377-393`) |
| **Gate ignora a folha** | `valoresOk` (`:417`), `podeVisualizar` (`:575`) e `continuar1()` (`:693-703`) validam só RBT12 e receita |

### 1.3 Arquitetura — problemas atuais

| Problema | Evidência |
|---|---|
| Componente monolítico | `page.tsx:395-1717` — página, wizard, motor de derivação, adaptador de export, ponte com projeção e biblioteca de widgets no mesmo arquivo |
| 15 `useMemo` de negócio | `:425, 433, 438, 455, 468, 479, 492, 502, 510, 532, 541, 561, 580, 618, 634` |
| Duplicação do Fator R em 6 pontos | `previsaoFR` (`:425-428`), `fr` (`:532-535`), `anexosEfetivosRefs` (`:547-555`), `anexoEfetivoParcela` (`segregacao-receita.ts:127-140`), `calcularFatorRDetalhado` (`relatorio-analitico.ts:344`), `store.calcular` (`store.ts:324-326`) |
| Recálculo duplo | `hibExib` (`:502-509`) reaplica o que a store já calculou (`store.ts:339-343`); `orquestrarRelatorio` (`:580-617`) roda 15 cálculos no render, antes do modal abrir |
| Invalidação manual distribuída | 19 `s.set(...)` + 16 `s.tocarEntrada()`; `set` genérico só invalida ao trocar `modo` (`store.ts:283-290`) — ex.: `:700` altera `compararHibrido` sem invalidar |
| Efeitos colaterais não testáveis | `setTimeout` sem cleanup (`:677-680`), `scrollIntoView`/`scrollTo` (`:641-645, 675, 690, 702, 710`), portal com listeners `document`/`window` (`:141-188, 229-276`), `Date.now()` em ids |
| Acoplamento com outra feature | Importa `NumeroAnimado`, `useProjecaoDividida`, `ModalDivisao` de `@/simples-projection/*` (`:28-30`) e monta o mesmo contexto em dois pontos (`:1014-1023`, `:1687-1696`) |
| Ambiente de teste limitado | `vitest.config.ts:11-13` usa `environment: 'node'`; `tests/setup.ts:238-266` não tem `document.body`, `scrollTo`, `innerWidth`, `addEventListener`; não há `@testing-library/react` (jsdom está instalado) |

### 1.4 Fator R — situação atual

- **Matemática canônica:** `FATOR_R_LIMIAR = 0.28`, `fatorR`, `folhaMinima28`, `gapFolha`, `detalharFatorR` em `src/domain/simples/nucleo.ts:13-14, 47-100`; reexportada em `calculo.ts:25-42` e `tabelas.ts:48`.
- **Coleta:** opcional, apenas na etapa 1 (`page.tsx:808-822`). Não há checkbox de sujeição no módulo principal — só na projeção (`ModalDivisao.tsx:541-572`, `sujeitaFatorRMae/Nova`).
- **Aplicação:** somente se `envolveAnexoV(s) && folha12 > 0 && rbt12 > 0` (`store.ts:322-326`). Sem folha, `preverAnexoFatorR` devolve `{ anexo: 'V', definido: false }` (`store.ts:212-220`).
- **Modelos conviventes (inconsistência central):**
  - módulo: `envolveAnexoV` (V-only);
  - relatório: `elegiveis.includes('V') || foco === 'V'` (`relatorio-analitico.ts:339-342`);
  - projeção: flags `sujeitaFatorRMae/Nova` → `dispensarFatorR`.
- **Resultado:** já há textos corretos ("não se aplica ao Anexo X") em `export-relatorio-analitico.ts:506` e `InsightsModal.tsx:644` — a mudança deve ser de **coleta/auditoria**, não de alíquota.

---

## 2. Princípios de melhoria

1. **Uma pergunta por decisão, consequência na hora** — nenhum dado coletado sem feedback imediato do que ele decide.
2. **Obrigatoriedade honesta** — exigir folha em toda simulação; nunca gerar enquadramento "provisório" silencioso; avisar quando ela não tiver efeito.
3. **Um número reina** — o DAS é o único destaque; todo o resto é evidência.
4. **DOM = leitura = visão** — veredito → memória → composição → cenários → ações, em qualquer breakpoint.
5. **Uma informação, uma casa** — Fator R e repartição não se repetem em blocos concorrentes.
6. **Ações em um só lugar** — ícone + rótulo + estado (`aria-busy`) sempre visíveis.
7. **Cor nunca sozinha** — ícone + texto + ARIA em todo badge de enquadramento, erro ou ST.
8. **Estados são conteúdo** — vazio, inválido, carregando e falha parcial têm layout próprio e um próximo passo.
9. **Reaproveitar, não reinventar** — `Painel`, `Btn`, `Pill`, `Icone`, `Entrada/Secao`, `calc-hero`, tokens `brand`/`aurum` (`src/ui/kit.tsx`, `src/ui/motion.tsx`, `src/index.css`).
10. **Contract-first** — nenhuma fórmula fiscal nova; toda decisão passa a vir de `src/domain/simples/`.

---

## 3. Fator R obrigatório — regra, validação e impacto

### 3.1 Regra de negócio proposta (com caveat jurídico)

A LC 123/2006 (art. 18, §§5º-C a 5º-I, já modelada no repositório) usa o Fator R para decidir **III × V** em atividades sujeitas. Anexo I (comércio), II (indústria), IV (CPP por fora) e Anexo III puro não são afetados. Portanto:

> **Coleta / declaração:** obrigatória em **todas** as simulações do módulo Simples Nacional (I–V, manual ou CNPJ).
>
> **Cálculo efetivo:** somente quando a atividade é sujeita — CNAE com `fatorR`/`exigeFatorR` verdadeiro ou anexos III/V, e `sujeitaFatorR !== false`. Nesses casos, `anexoEfetivo = fatorR(folha12, rbt12).anexo`.
>
> **Aviso explícito:** sempre que a folha for informada mas não alterar a alíquota — *"Fator R registrado para conferência — sem efeito no Anexo {a}"*.
>
> **Nunca:** usar folha ausente como `0` para desenquadrar para V em atividade não sujeita; nunca alterar Anexo I/II/IV por causa da folha.

**Representação da ausência:** hoje `folha12: 0` é ambíguo (zero real × não informado) e percorre toda a cadeia (store → export → projeção). Recomenda-se, por compatibilidade, manter `folha12: number` e acrescentar `folhaInformada: boolean` na store; `number | null` é o estado-final desejável, mas exige migrar `PayloadSimples` e metadados da projeção.

### 3.2 Função pura de validação (nova)

Adicionar em `src/domain/simples/validacao.ts`, ao lado de `exigirRbtReceita` (`:23-36`):

```ts
export type CodigoValidacaoFatorR =
  | 'folha12-ausente'
  | 'folha12-invalida'
  | 'rbt12-invalido';

export interface ResultadoValidacaoFatorR {
  ok: boolean;
  codigo?: CodigoValidacaoFatorR;
  mensagem?: string;              // pt-BR, pronta para toast
  aplicavel: boolean;             // atividade sujeita ao Fator R
  origemNaoAplicavel?: 'anexo-sem-fator-r' | 'iii-puro' | 'nao-sujeito';
}

export function validarFolhaObrigatoria(entrada: {
  folha12: number | null | undefined;
  folhaInformada: boolean;
  confirmouSemFolha?: boolean;
  rbt12: number | null | undefined;
  anexos: string[];               // normalizarListaAnexosSimples
  cnaeFatorR?: boolean;           // op.exigeFatorR / tabela.fatorR
  sujeitaFatorR?: boolean;        // default true
}): ResultadoValidacaoFatorR;

export function exigirFolha12(entrada: ParamsValidacaoFatorR): number;
// lança Error com prefixo de código, no padrão de exigirRbtReceita
```

**Ordem de validação:** `exigirRbtReceita` → `exigirFolha12` → resolver anexo efetivo → `calcularConvencional`.

**Regras:** presença obrigatória; número finito `>= 0`; `0` sem `confirmouSemFolha` é tratado como ausente; `rbt12 <= 0` é erro separado; `aplicavel = (anexos contém III ou V || cnaeFatorR) && sujeitaFatorR !== false`; efeito no cálculo condicionado a `aplicavel`.

Também acrescentar `aplicavel`/`motivoNaoAplicavel` a `FatorRDetalhe` (`nucleo.ts:66-100`) e a `FatorRDetalhado` (`relatorio-analitico.ts:87-94`), mantendo os campos atuais para compatibilidade.

### 3.3 Mensagens pt-BR

| Situação | Mensagem |
|---|---|
| Campo vazio | "Informe a folha de salários dos últimos 12 meses (salários + pró-labore) para continuar." |
| Valor inválido | "Folha 12m inválida. Use um número maior ou igual a zero (ex.: 150000)." |
| Zero sem confirmação | "Folha 12m zerada. Confirme que não houve salários/pró-labore nos últimos 12 meses ou informe o valor correto." |
| `calcular()` bloqueado | "Não foi possível calcular: folha 12m não informada. Volte à etapa 1 e preencha o campo." |
| Anexo I/II/IV | "Folha 12m registrada. No Anexo {a} ela não altera a alíquota — o Fator R vale apenas para atividades sujeitas (III/V)." |
| III puro | "Atividade classificada como Anexo III puro: a folha fica registrada, mas não altera o enquadramento." |
| ≥ 28% | "Fator R {pct}%: enquadramento no Anexo III confirmado." |
| < 28% | "Fator R {pct}%: Anexo V. Faltam {gap} em 12 meses (~{gap/12}/mês) para o Anexo III." |
| Projeção sem folha da nova | "Informe a folha 12m da nova empresa para projetar o Fator R (ou confirme que ela está dispensada)." |

### 3.4 Impacto por camada

| Camada | Pontos de mudança |
|---|---|
| **Domínio** | `nucleo.ts:66-100` (`aplicavel`), `validacao.ts` (nova guarda), `cnae.ts:65-71` (já identifica sujeição) |
| **Motor** | `calculo.ts:196-214, 627-644` — `calcularConvencionalEstrito` deve exigir folha quando III/V sujeito; `EntradaConvencional` pode receber `folha12?`/`sujeitoFatorR?` ou function `resolverAnexoEfetivo` centralizada |
| **Store** | `store.ts:8-9` (doc), `:91` (flag), `:170-225` (predicados), `:283-290` (`set`), `:302-344` (`calcular`), `:434-474` (`escolherCnae`/`limpar` — não apagar folha; reset para "não informado") |
| **Página** | `page.tsx:415-428` (gates), `:438-452` (segregação), `:532-557`, `:575`, `:663-703`, `:808-822` (card), `:920-924`, `:1032-1154`, `:1408-1413`, `:1607-1615`; contextos de projeção em `:1014-1023` e `:1687-1696` |
| **Segregação** | `segregacao-receita.ts:10-19` (doc), `:121-169` — parcela sujeita sem folha bloqueia; folha compartilhada permanece |
| **Relatório/export** | `relatorio-analitico.ts:87-94, 322-344, 501-535`; `RelatorioAnalitico.tsx:79-81, 248-267`; `InsightsModal.tsx:182-186, 308-333, 624-646`; `insights.ts:102-140, 314`; `export.ts:13, 30-42`; `export-relatorio-analitico.ts:169-172, 299, 377-387, 489-506` — sempre registrar folha + `aplicavel`, nunca `0.00` ambíguo nem 0% como dado real |
| **Projeção** | `simples-projection/types.ts:45-55`; `store.ts:25, 151-152, 188-189`; `cenario-dividido.ts:46-58, 278-295`; `fator-r-dividido.ts:24-82`; `entrada.ts:88-122`; `ferramentas.ts:79-80, 156-168`; `ModalDivisao.tsx:33, 175-196, 527-572, 603-616`; `README.md:48, 99` — renomear "dispensa" para "não aplicável" na UI; folha sempre coletada, cálculo condicionado |

### 3.5 Decisões bloqueantes (confirmar antes de implementar)

1. **Folha zero:** aceitar com checkbox explícito "Confirmo que não houve folha/pró-labore em 12 meses" ou tratar como erro? (Recomendação: aceitar somente com confirmação.)
2. **Anexo III puro no módulo principal:** hoje só `sujeitaFatorR` existe na projeção. Criar controle equivalente na etapa 1/2 ou inferir de `fatorR: false` + anexos `['III']`?
3. **Segregação:** parcela V sem folha bloqueia o cálculo inteiro ou segue provisória? (Recomendação: bloquear.)
4. **Projeção mãe × nova:** empresa nova sem 12 meses de folha — exigir estimativa, aceitar zero confirmado ou manter `dispensarFatorR`?

---

## 4. Nova arquitetura do módulo

### 4.1 Árvore sugerida

```
src/simples/
├── page.tsx                       # orquestrador fino (~150-250 linhas)
├── types.ts                       # tipos compartilhados (novo)
├── cena.ts                        # seletor puro: SimplesState -> CenaSimples (novo)
├── hooks/
│   ├── useCenaSimples.ts
│   ├── useWizardSimples.ts        # etapa, timer com cleanup, navegação
│   ├── useRelatorioAnalitico.ts   # lazy: só quando modal/PDF solicitado
│   ├── useExportacaoSimples.ts
│   └── useModaisSimples.ts
├── components/
│   ├── CampoMoeda.tsx, DespesaValor.tsx, SeletorRegraCredito.tsx
│   ├── BarraReparticao.tsx, Passo.tsx, Stepper.tsx, SubCard.tsx
│   ├── LimiteErroGrafico.tsx
│   ├── EtapaValores.tsx           # Base e enquadramento (Fator R obrigatório)
│   ├── EtapaAnexo.tsx
│   │   ├── AnexosManual.tsx, CnpjAtividade.tsx, ListaCnae.tsx, CnaeFocado.tsx
│   │   ├── SegregacaoReceita.tsx  # + CartaoFatorR
│   │   └── AvancadoHibrido.tsx
│   ├── EtapaResultado.tsx
│   │   ├── CartaoVeredito.tsx     # hero DAS (novo)
│   │   ├── MemoriaCalculo.tsx     # <ol> numerada (novo)
│   │   ├── Desmembramentos.tsx
│   │   ├── PainelComposicao.tsx   # GraficosDAS + barra + tabela
│   │   ├── BlocoCenarios.tsx      # conv×híbrido, sublimite, "e se...", dividir
│   │   ├── BarraAcoes.tsx         # CSV/JSON/PDF/Insights/Reiniciar (única)
│   │   └── CarregandoResultado.tsx
│   └── ModaisSimples.tsx          # DasModal + InsightsModal + ponte de divisão
```

Arquivos existentes (`calculo.ts`, `store.ts`, `segregacao-receita.ts`, `relatorio-analitico.ts`, `export.ts`, `DasModal.tsx`, `Graficos.tsx`, `InsightsModal.tsx`, `tabelas.ts`, `insights.ts`, `export-relatorio-analitico.ts`) **não** são renomeados nesta fase.

### 4.2 `cena.ts` — fonte única de derivação

`montarCenaSimples(s: SimplesState): CenaSimples` — função pura, sem React, testável em `environment: 'node'`. Transpõe os 15 `useMemo` atuais sem alterar fórmula alguma:

```ts
export interface CenaSimples {
  convBase: ResultadoConvencional;
  convExib: ResultadoConvencional;
  segResultado: ResultadoSegregado | null;
  segFalhou: boolean;                    // hoje engolido pelo try/catch em :445-450
  dasExib: number; cargaTotalExib: number; dasBruto: number;
  repExib: Reparticao; repBrutaExib?: Reparticao;
  hibExib: ResultadoHibrido | null;
  fr: { indice: number; anexo: 'III' | 'V'; aplicavel: boolean } | null;
  previsaoFR: PrevisaoFatorR;
  anexosEfetivosRefs: AnexoSimplesId[];
  previaConv: ResultadoConvencional | null;
  mostraRefICMS: boolean; mostraRefISS: boolean;
  deducaoSTPorTributo: Partial<Record<'ICMS' | 'ISS', number>>;
  infoSTPorTributo: Partial<Record<'ICMS' | 'ISS', string>>;
  stResumo: { tributo: string; valorST: number; deducao: number; detalhe: string } | null;
  segSoma: number; segExcesso: boolean; segValida: boolean;
  segResto: number; segRestoAnexo: AnexoSimplesId;
  precisaFolha: boolean; estouradoPasso1: boolean;
  valoresOk: boolean; validacaoFolha: ResultadoValidacaoFatorR;
}
```

**Atenção:** as chaves de animação em `page.tsx:1370` e `:1638` (`anexoId/das/deducaoST/dasSeg`) e a key do wizard (`:781`) devem permanecer no mesmo nível da árvore, com a mesma composição.

### 4.3 Hooks

| Hook | Origem | Responsabilidade |
|---|---|---|
| `useCenaSimples` | `:425-577` | Um único `useMemo` em torno de `cena.ts` |
| `useWizardSimples` | `:397-413, 641-712` | `etapa`, `gerando`, `forcarLista`, rolagem, `visualizar`, `irPara`, `continuar1`, `reiniciar`; **timer com `clearTimeout` no cleanup** |
| `useRelatorioAnalitico` | `:580-630` | `orquestrarRelatorio` + insights + PDF **sob demanda** (`enabled = insightsAberto \|\| pdfPendente`) |
| `useExportacaoSimples` | `:714-738, 1681-1682` | `payload()` puro + CSV/JSON |
| `useModaisSimples` | `:398-400` | Flags DAS/Insights/repartição |

### 4.4 Store e invalidação

Centralizar a invalidação na ação de escrita, **sem apagar o cache**:

```ts
const CHAVES_ENTRADA = new Set<keyof SimplesState>([
  'modo', 'anexoId', 'escolheuAnexo', 'rbt12', 'receitaMes', 'folha12',
  'folhaInformada', 'cbsRef', 'aliqRefICMS', 'aliqRefISS', 'despesas',
  'compararHibrido', 'cnpj', 'empresaNome', 'opcaoSimples', 'opcoes',
  'cnaeEscolhido', 'segAtivo', 'segParcelas',
]);

set: (p) => {
  const sujo = Object.keys(p).some((k) => CHAVES_ENTRADA.has(k as keyof SimplesState));
  // Nunca zera convencional/hibrido: "Editar" mantém o resultado até recalcular (:1384).
  set(sujo && p.relatorioVisivel === undefined ? { ...p, relatorioVisivel: false } : p);
};
```

- `calcular()` usa o `set` **interno** do `create` — não deve passar pela invalidação (senão publica e esconde no mesmo tick). Documentar explicitamente.
- Criar ações semânticas (`patchParcelaSeg`, `setAliqRef`, `trocarModo`, `informarFolha`) e eliminar os 16 `tocarEntrada()` manuais.
- `calcular()` inclui `exigirFolha12()` no mesmo `try` de `exigirRbtReceita`, com toast específico; aplica Fator R quando `aplicavel`, não apenas quando `envolveAnexoV`.
- `limpar()` / `escolherCnae()` nunca apagam a folha; reset vai para "não informado".

### 4.5 Performance

- `orquestrarRelatorio` sob demanda (remove ~15 cálculos do render comum).
- `previaConv` calculado só dentro de `AvancadoHibrido` quando `estouradoPasso1 && (mostraRefICMS || mostraRefISS)`.
- `dadosDas` calculado quando `dasAberto` for true (ou dentro do próprio modal).
- Um único `previsaoFR` em `cena.ts`; `anexosEfetivosRefs` reutiliza `anexoEfetivoParcela`.
- Seletores finos (`useSimples((s) => s.rbt12)`) nos componentes folha, reduzindo re-renders e removendo os `eslint-disable react-hooks/exhaustive-deps` atuais.

### 4.6 Desacoplamento de `simples-projection`

```ts
export interface DivisaoGateway {
  abrir(ctx: ContextoSimplesReal): void;
  onIrConsulta(): void;
}
```

Injetar o gateway no orquestrador (default chama `useProjecaoDividida.getState().abrir` e `useUi.getState().trocarView`). Os componentes de negócio deixam de importar a store externa; os testes podem substituir por um spy. `<ModalDivisaoView />` continua montado apenas em `ModaisSimples`. Repassar `sujeitaFatorR` no contexto para não perder a sujeição.

---

## 5. Novo layout e exibição de resultados

### 5.1 Entrada — "Base e enquadramento"

```
[ Passo 1 · Base e enquadramento                          ✓ ]
┌──────────────────────────────────────────────────────────────┐
│ Contexto da atividade  [ V ] [ III × V ] [ Outro anexo ]    │
│ "O Fator R decide entre III e V. Selecione para validar."   │
├──────────────────────────────────────────────────────────────┤
│ Receitas                                                    │
│  RBT12 — 12 meses        │  Receita do mês                  │
├──────────────────────────────────────────────────────────────┤
│ Fator R · obrigatório                                       │
│  Folha de salários 12m   │ [gauge 0 ────── 28% ───── 40%]   │
│  R$ 0,00                 │ [SELO: V · 22,40% · abaixo]      │
│  aria-describedby="fr-ajuda"  aria-required                 │
│  ⓘ Faltam R$ 16.800 (≈ R$ 1.400/mês) para 28%. Hoje: V.    │
│  [ Ver impacto do Anexo III → ]                             │
├──────────────────────────────────────────────────────────────┤
│ Sublimite estadual · R$ 3,6M       [dentro do sublimite]    │
├──────────────────────────────────────────────────────────────┤
│                              [ Continuar → ] (bloqueado até │
│                               campos válidos)               │
└──────────────────────────────────────────────────────────────┘
```

Decisões: (a) seletor de contexto no topo alimenta o mesmo predicado de sujeição — em "Outro anexo" o cartão mostra *"Não se aplica — o Fator R só decide entre III e V"*, sem campo fantasma; (b) ao escolher CNAE na etapa 2, o predicado é reavaliado e, se passar a exigir folha, bloqueia com alerta inline que **foca o campo na etapa 1**; (c) `detalharFatorR` (`nucleo.ts:82-100`) é a única fonte do selo, gauge e gap — zero nova matemática; (d) troca do seletor com `animate-pop-in` e `aria-live="polite"` único; (e) "Avançado — sublimite e híbrido" (`page.tsx:1168-1317`) vira acordeão colapsado; (f) o texto *"volte à etapa 1 se quiser informar"* (`:1150-1152`) vira botão "Editar folha".

### 5.2 Resultado em 5 blocos

```
┌──────────────────────────────────────────────────────────────┐
│ Resultado · [1 Veredito] [2 Memória] [3 Composição]         │ ← nav sticky
│             [4 Cenários] [5 Ações]                          │
├──────────────────────────────────────────────────────────────┤
│ 1 · VEREDITO  (calc-hero, largura total, role="status")     │
│   Fator R 31,20% ≥ 28% → Anexo III        [selo III ✓]      │
│   DAS R$ 5.983,20   ← único número grande (text-4xl)        │
│   Alíquota efetiva 9,97% · Carga total R$ X (sublimite)     │
│   "Fórmula: folha ÷ RBT12 · ver memória"                     │
├──────────────────────────────────────────────────────────────┤
│ 2 · MEMÓRIA DE CÁLCULO  (<ol> numerada)                      │
│   0 Fator R: 100.000 ÷ 300.000 = 33,33% ≥ 28% → III         │
│   1 RBT12 300.000 → faixa 3                                  │
│   2 Alíquota efetiva = (RBT12×nominal − deduzir)/RBT12       │
│   3 DAS = alíquota × receita do mês                          │
│   4 Ajustes: ST −R$ X · sublimite +R$ Y · segregação (n)      │
│   5 Total da guia                    [ Editar cada linha → ] │
│   ▸ Desmembramentos (details, só se segregado)               │
├──────────────────────────────────────────────────────────────┤
│ 3 · COMPOSIÇÃO  (um único painel)                            │
│   [Rosca] [Pizza] [Barras] [Tabela]  ← GraficosDAS           │
│   barra proporcional + tabela como alternativa acessível     │
├──────────────────────────────────────────────────────────────┤
│ 4 · CENÁRIOS E COMPARATIVOS                                  │
│   ⚖ Convencional × Híbrido · Sublimite (guia + fora)         │
│   🔁 "E se a folha chegasse a 28%?" → DAS III estimado        │
│   ✂ Dividir em 2 (único ponto, não duplicado na etapa 2)     │
├──────────────────────────────────────────────────────────────┤
│ 5 · AÇÕES  (barra única, sticky no mobile)                   │
│   [CSV] [JSON] [PDF analítico] [✦ Insights] [↺ Reiniciar]    │
└──────────────────────────────────────────────────────────────┘
```

| Bloco | Componente | Conteúdo |
|---|---|---|
| **1. Veredito** | `CartaoVeredito` (`.calc-hero/.simples-hero`) | Linha de enquadramento, DAS com `NumeroAnimado`, alíquota e carga. A lista de repartição, notas de ISS/sublimite e botões migram para 3 e 5 — no máximo 3 linhas secundárias. |
| **2. Memória** | `MemoriaCalculo` + `<ol>` | Numeração começando no Fator R (passo 0, quando aplicável) e terminando no total; fórmulas em `font-mono tabular-nums`; cada passo com "por quê" e link "Editar" que foca o campo exato. |
| **3. Composição** | `PainelComposicao` | `GraficosDAS` + `BarraReparticao`; modo Tabela passa a ser alternativa textual do canvas; ST mantém riscado **+** badge "ST" **+** texto. |
| **4. Cenários** | `BlocoCenarios` | Conv×Híbrido, sublimite, cenário "e se…" calculado com `calcularConvencional` para o III (rotulado como simulação que **não altera** o resultado exibido), "Dividir em 2". |
| **5. Ações** | `BarraAcoes` | Todos os botões com ícone + rótulo, `aria-busy` via `carregando`; modais permanecem em `ModaisSimples`. |

### 5.3 Fator R didático (uma casa só)

- **Entrada:** cartão compacto com `folha ÷ RBT12`, gauge com marca em 28%, selo de enquadrado/abaixo e link "Entenda a regra" colapsável. Variantes: ≥28%, <28%, sem folha (quando obrigatório), I/II/IV ("não se aplica"), RBT zerado.
- **Resultado:** uma única linha no topo do hero — `Fator R 33,33% ≥ 28% → Anexo III` — com `details` "Ver fórmula". O passo 0 da memória repete o cálculo **como parte da conta**, não como alerta solto. Removem-se o bloco de `:1607-1615` e o texto de `:1150-1152`.
- Linguagem alinhada às mensagens da §3.3 (*"não é tributada pelo Anexo III"*, gap em 12m e mensal).

### 5.4 Responsividade, estados e acessibilidade

- **Mobile (<640):** coluna única na ordem exata 1→2→3→4→5; nav compacta vira `details "Ir para…"`; barra de ações `sticky bottom-0` com `pb-[env(safe-area-inset-bottom)]`; tabelas com `overflow-x-auto`.
- **sm/md:** veredito em largura total; memória/composição em `grid-cols-2` apenas com segregação.
- **lg/xl:** grid `5fr/7fr` entre veredito e composição, com veredito **primeiro no DOM**.
- **Vazio/inválido:** cards com `IconeBadge`, manchete, motivo e `Btn` que foca o primeiro campo pendente; `role="alert"` persistente (não só toast).
- **Carregando:** remover `setTimeout(750)` artificial; skeleton só durante trabalho real com `aria-busy`.
- **Falha parcial:** `LimiteErroGrafico` oferece "Ver tabela de tributos" em vez de texto morto.
- **Sucesso:** um único `aria-live="polite"` — "DAS de R$ X, Anexo Y, Fator R Z%".
- **ARIA:** nova nav com `aria-label="Seções do resultado"` e `aria-current="location"`; gauge como `role="meter"` com `aria-valuetext="31,2% — Anexo III, acima de 28%"`; `aria-required`/`aria-invalid`/`aria-describedby` nos campos obrigatórios; alvos ≥ 44 px; contraste AA; 13 px mínimo; `prefers-reduced-motion` também em `NumeroAnimado`, `animate-ping` e `animate-pulse-soft`.

### 5.5 Antes → depois

| Antes | Depois |
|---|---|
| "Folha · Fator R (**opcional**)" (`page.tsx:808-822`) | "Folha 12m — **obrigatória**" com veredito ao vivo e estado "não se aplica" |
| Avanço sem folha; DAS "provisório no V" (`:575, 693-703, 1611-1615`) | Gate valida folha quando aplicável; bloqueio inline foca o campo; sem provisório silencioso |
| Fator R em 4 pontos | 1 cartão na entrada + 1 linha no veredito + 1 passo na memória |
| Resultado começa pela memória (`:1371` → `:1512`) | Veredito/DAS é o primeiro bloco no DOM e na leitura |
| Repartição triplicada (`:1549, 1562, 1637`) | Um painel de composição com abas e tabela acessível |
| Ações em 4 locais | Uma barra única com ícone, rótulo e estado |
| Skeleton artificial + erros só por toast | Skeleton real com `aria-busy`; vazio/erro com CTA |
| "Editar" genérico devolve à etapa 1 (`:1381-1388`) | Cada passo da memória leva ao campo exato |

---

## 6. Plano de execução (fases e gates)

| Fase | Ação | Risco | Gate |
|---|---|---|---|
| **0 — Caracterização** | Escrever testes do estado atual (`store.calcular`, `pseudoConvDoSegregado`, `calcularSegregado`, `payload`, `relatorio-analitico`, invalidação). Baseline `npm run typecheck` + `npm test`. | — | Todos verdes; valores ouro registrados |
| **1 — Widgets puros** | Extrair `CampoMoeda`, `DespesaValor`, `SeletorRegraCredito`, `Barra`, `Passo`, `Stepper`, `SubCard`, `LimiteErroGrafico`. Só move código. | Baixo | Diff revisual; typecheck; testes dos widgets |
| **2 — `types.ts` + `cena.ts`** | Transpor os 15 `useMemo` para função pura, sem mudar fórmula. `useCenaSimples` substitui `:425-577`. | Médio-alto | Testes ouro idênticos; nenhum `eslint-disable` novo |
| **3 — Hooks de fluxo** | `useWizardSimples` (timer com cleanup), `useModaisSimples`, `useRelatorioAnalitico` (lazy), `useExportacaoSimples`. | Médio | Fake-timer tests; nenhum `setTimeout` solto |
| **4 — Etapa 1 + Fator R obrigatório** | Nova guarda em `validacao.ts`, integração em `calcular`/`continuar1`/`podeVisualizar`, card da etapa 1, badges, mensagens, ajustes na projeção conforme decisões da §3.5. | Alto | `validacao-fator-r.test.ts` + `simples-store-fator-r.test.ts` |
| **5 — Wizard em componentes** | `EtapaValores`, `EtapaAnexo` e filhos. Preservar keys, refs e `rolarPara`. | Médio | Check manual manual↔CNPJ, lista CNAE, segregação, avançado |
| **6 — Resultado em componentes** | `EtapaResultado` + filhos no novo layout 5 blocos; manter chaves de animação e error boundary. | Médio | DAS, PDF, CSV/JSON, gráficos e híbrido com segregação |
| **7 — Desacoplar projeção** | `DivisaoGateway`, `ModaisSimples`. | Baixo-médio | Suíte `simples-projecao-*` verde; nenhum import externo fora do adaptador |
| **8 — Store: invalidação e seletores** | `CHAVES_ENTRADA`, ações semânticas, eliminação dos 16 `tocarEntrada()`. | Alto | `invalidacao-simples.test.ts`; suíte completa + typecheck |

**Nota:** a Fase 4 pode ser antecedida pelas Fases 1–3 ou executada em paralelo, desde que a Fase 0 (caracterização) esteja concluída. O ponto crítico é **não misturar mudança de layout com mudança de regra fiscal** no mesmo commit.

---

## 7. Estratégia de testes

**Novos arquivos:**

- `tests/cena-simples.test.ts` e `tests/cena-simples-ouro.test.ts` — derivações puras + snapshot numérico antes da mudança.
- `tests/payload-simples.test.ts` — `payload()` ↔ `csvSimples/jsonSimples` com ST e segregação.
- `tests/invalidacao-simples.test.ts` — toda chave de entrada publica `relatorioVisivel: false` mas preserva `convencional`.
- `tests/validacao-fator-r.test.ts` — null/undefined, NaN/Infinity, zero com/sem confirmação, `rbt12 <= 0`, anexos I/II/IV → `aplicavel: false`, III puro → `origemNaoAplicavel: 'iii-puro'`, `exigirFolha12` lança com prefixo.
- `tests/simples-store-fator-r.test.ts` — sem folha não preenche `convencional`; com folha em I mantém anexo; ≥28% em V → III; <28% mantém V; `limpar()` volta a "não informado"; trocar CNAE não apaga folha.

**Ajustes em existentes:** `simples-calculo.test.ts`, `simples-matriz.test.ts:166-175`, `simples-seg-receita.test.ts:124-165`, `relatorio-analitico.test.ts:101-147`, `relatorio-pdf-timbrado.test.ts`, `dispatcher-failclosed.test.ts:37-49`, `simples-projecao-fator-r-retorno.test.ts:42-46`, `simples-projecao-segregacao.test.ts:241-252`, `simples-projecao-entrada-ferramentas.test.ts`.

**Testes de UI (novo, opcional):** `vitest.ui.config.ts` com `environment: 'jsdom'` e `include: ['tests/ui/**/*.test.tsx']`, `tests/setup-ui.ts` (stubs de `scrollTo`, `getContext`, `ResizeObserver`) e helper mínimo com `act` + `createRoot` do React 19 — sem adicionar dependência. Cobrir `SeletorRegraCredito` (portal/teclado), wizard com fake timers e resultado com `GraficosDAS` mockado.

---

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Invalidação apagando cache do resultado | Só alterar `relatorioVisivel`; nunca `convencional` em edição (contrato de `page.tsx:1384`). Teste dedicado. |
| Timer órfão após troca de view | `useRef<number>` + `useEffect(() => () => clearTimeout(...), [])` no `useWizardSimples`. |
| Divergência do Fator R (6 pontos) | Uma função em `cena.ts` + guarda em `validacao.ts`; vetores existentes (`simples-calculo.test.ts:39`, `simples-matriz.test.ts:166-175`). |
| Troca de `convBase` por `s.convencional` | Teste de caracterização comparando DAS guia × carga total com segregação/sublimite. |
| `segResultado` nulo silencioso | Expor `segFalhou` em `cena.ts`; manter fallback atual até decisão de produto. |
| Perda de animação/foco/scroll | Preservar keys, refs e `rolarPara`; check manual desktop/mobile após cada fase. |
| Portal e teclado do seletor | Extrair sem alterar `data-regra-menu`, `aria-*` e ordem de foco. |
| chart.js em jsdom | Mockar `GraficosDAS`; manter boundary como classe. |
| Contrato `simples-projection` | Gateway injetável; rodar suíte `simples-projecao-*` em cada fase. |
| Ids não determinísticos | Injetar `gerarId` opcional; não alterar formato dos ids. |
| **Correção fiscal indevida (Fator R em I/II/IV)** | Regra da §3.1: coletar sempre, aplicar só quando sujeito, avisar sempre. Testes de não-regressão em `validacao-fator-r.test.ts`. |

---

## 9. Critérios de aceite / "pronto"

- `page.tsx` ≤ ~250 linhas, sem `useMemo` de negócio e sem `setTimeout`.
- Nenhum componente > ~250 linhas.
- `cena.ts` sem imports de React; 100% das chaves de entrada testadas.
- `relatorioAnalitico` não computado no render comum.
- Todos os `eslint-disable react-hooks/exhaustive-deps` removidos ou justificados.
- Fator R: campo obrigatório com validação fail-closed, veredito único na entrada, uma linha no resultado e um passo na memória; nenhum texto "opcional"/"provisório" restante no módulo.
- Projeção, relatório e exports registram folha + `aplicavel` e nunca usam `0` ambíguo como dado válido.
- DOM do resultado na ordem 1→5 em todos os breakpoints; alvos ≥ 44 px; `aria-*` nos controles; reduced-motion respeitado.
- `npm test` (node) + `vitest -c vitest.ui.config.ts` (jsdom) + `npm run typecheck` verdes.
- Documentação atualizada: `docs/PROMPT_TECNICO_CALCULADORA_SIMPLES_NACIONAL.md:606` ("Folha 12m (opcional)" → obrigatória) e `src/simples-projection/README.md`.

---

## 10. Anexo — inventário rápido de arquivos

**Núcleo:** `src/domain/simples/{nucleo,validacao,creditos}.ts`; `src/simples/{calculo,tabelas,store,segregacao-receita,segregacao-st,relatorio-analitico,insights,export,export-relatorio-analitico}.ts`; `src/simples/{page,DasModal,Graficos,InsightsModal,RelatorioAnalitico}.tsx`.

**Projeção:** `src/simples-projection/{types,store,cenario-dividido,fator-r-dividido,janela-rbt12,baseline,persistencia,das-segregado,pro-labore,analise-retorno,relatorio,entrada,ferramentas,simular-segregacao,export,index}.ts` + `SimuladorSegregacao.tsx`, `ModalDivisao.tsx`, `ControleSplit.tsx`, `NumeroAnimado.tsx`, `README.md`.


**Shell/UI:** `src/App.tsx:8,70-71`; `src/ui/Layout.tsx:31`; `src/ui/{kit,motion}.tsx`; `src/store/{ui,sessao}.ts`; `src/index.css` (tokens `.calc-hero`, `.skeleton`, `.btn-press`, `.simples-anexo-*`, foco ouro).

**Documentação relacionada:** `docs/PROMPT_TECNICO_CALCULADORA_SIMPLES_NACIONAL.md`, `docs/ARQUITETURA.md`, `.planning/codebase/CONVENTIONS.md`.
