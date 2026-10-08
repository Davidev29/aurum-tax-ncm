# simples-projection — Projeção Financeira Multi-Empresa

> ⚠️ **Nota (08/10/2026):** as menções abaixo a "LLM preenche insights" são legado.
> Hoje não há LLM em runtime — `insightsSugeridos` permanece vazio e nenhum texto
> qualitativo é gerado. Todo número exibido vem do motor determinístico.

Camada **ADITIVA** ao módulo estável `src/simples/` (nunca alterado).
Orquestra o motor existente (`calcularConvencional`, `fatorR`) para simular
divisão de faturamento entre empresa mãe e nova empresa.

## Regra de ouro

- Nenhum arquivo de `src/simples/*` foi tocado.
- Novas pastas/arquivos apenas aqui: `src/simples-projection/`.
- Alíquota, DAS, faixa e Fator R: sempre delegados ao motor existente.
- Motor puro: `janela-rbt12.ts` e `cenario-dividido.ts` sem I/O/rede/banco.
- I/O (CNPJ) isolada em `entrada.ts` via serviço existente `buscarCnpj`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `types.ts` | Contratos de entrada/saída (fonte canônica). |
| `janela-rbt12.ts` | `projetarRBT12Rolling` — RBT12 deslizante. |
| `cenario-dividido.ts` | `simularCenarioDividido` — orquestrador mãe/nova (v2: split 0–100%, virada, veredito, custo inicial, margem de empate). |
| `baseline.ts` | Baseline mês atual = 09, `periodoReferencia`, `distribuirRTB12` (igual/crescente/sazonal), `validarRTB12`. |
| `persistencia.ts` | `salvarRTB12`/`carregarRTB12` por CNPJ/período (localStorage). |
| `simular-segregacao.ts` | `simularSegregacao` — envelope `POST /projecoes/simular-segregacao`. |
| `SimuladorSegregacao.tsx` | `<SimuladorSegregacao />` reutilizável: veredito + RBT12 (linhas) + DAS empilhado + área acumulada + timeline + tabela com memória de cálculo. |
| `NumeroAnimado.tsx` | Contagem animada 400ms (respeita reduced-motion). |
| `store.ts` | `useProjecaoDividida` — wizard 5 etapas, modos RTB12 manual/automático, slider 0–100%, toggle única↔segregada. |
| `ModalDivisao.tsx` | Wizard animado em 5 passos (framer-motion 300–500ms ease-in-out). |
| `entrada.ts` | `prepararEntradaProjecao` — valida manual/CNPJ. |
| `relatorio.ts` | `montarRelatorioProjecao`, `emitirAlertasFiscais` — envelope final. |
| `ferramentas.ts` | `specsFerramentasProjecao`, `listarFerramentasProjecaoParaModelo`, `executarFerramentaProjecao`. |
| `index.ts` | Barrel público. |

## Fluxo animado (5 etapas)

```
1 RTB12 — automático (só o total; 👁 revela a distribuição) | manual (botão
  Preencher abre modal-irmão mês a mês) + receita da competência em curso
  (semeia a projeção) — cabeçalho "Período: MM/AAAA → MM/AAAA (12m antes do
  início, exclui o mês em curso)"
  → 2 Receita total projetada (semeada pela tela 1; mensal | global)
  → 3 Divisão (slider 0–100% + anexos + folha quando III/V + segregação por
  anexo + KPIs ao vivo)
  → 4 Custos & Fator R (mensal + abertura única + margem + folha condicional
  + meses de atividade mãe/nova)
  → 5 Resultado (<SimuladorSegregacao /> + toggle Empresa única ↔ Segregada)
```

Etapa atual do stepper usa `.borda-cintilante` (gradiente cônico animado,
padrão do sistema em `src/index.css`); concluídas ficam verdes.

## Endpoint `POST /projecoes/simular-segregacao`

Payload: `{ mesInicio, receitaTotalMensal[], percentualNova 0–1, mae{anexoId,folha12,historico12,mesesAtividade?}, nova{...}, custoMensalNova?, custoInicialNova?, margemEmpate? }`.
Response: `{ ok, dados: RelatorioProjecao } | { ok: false, erro }` — ver `simular-segregacao.ts`.
`RelatorioProjecao`: `serieMensal[]` (RBT12/faixa/nominal/efetiva/DAS por empresa + `economiaBrutaMes`/`custoMes`/`economiaMes`/`economiaAcumulada`), `payback { mesVirada, mesesAteVirada, mes, mesesAtePayback, veredito }`, `economiaTotal`, `alertas`, `analiseFatorR`, `analiseRetorno`, `metadados`.

## Estados de UX

- Loading: cálculo é síncrono (`useMemo`) — sem skeleton; animações de transição cobrem o feedback.
- Vazio: sem receita → aviso "Informe receitas válidas" + botão Continuar bloqueado com toast.
- Erro: motor lança erro explícito → `relatorio = null` → cartão tracejado instrutivo (nunca número inventado).
- Erro RTB12 = 0 → toast + alerta vermelho; mês zerado isolado → alerta âmbar (sazonalidade?).

## Fluxo (texto)

```
input manual/CNPJ
  → prepararEntradaProjecao (valida; CNPJ via buscarCnpj existente; nunca inventa)
  → ParamsCenarioDividido
  → simularCenarioDividido
      ├─ fatiar receita total por percentualNova (0–100%)
      ├─ projetarRBT12Rolling ×3 (mãe, nova, referência-unificada)
      ├─ calcularConvencional ×3 por mês (motor existente: faixa/alíquota/DAS)
      ├─ economiaBruta = DAS_ref − (DAS_mãe + DAS_nova); custoMes = mensal (+ abertura no mês 1)
      ├─ economiaMes = bruta − custo; economiaAcumulada (soma)
      ├─ virada = 1º mês economiaMes > 0; payback = 1º mês acumulado > 0
      ├─ veredito = compensa | nao-compensa | empate-tecnico (|econ| ≤ margem, margem > 0)
      └─ alertas (sublimite 3.6M, 4.8M, Fator R, empresa nova, consolidação)
  → RelatorioProjecao { serieMensal, payback, economiaTotal, alertas, insightsSugeridos: [] }
  → LLM preenche insights (motor nunca gera texto qualitativo)
```

## Regras fiscais aplicadas (LC 123/2006, art. 18)

- `RBT12(t) = soma(R[m])`, m em [t−12, t−1] — nunca inclui a competência em
  curso; cada competência só entra na RBT12 a partir do mês seguinte.
- O início da projeção é a competência em curso (mês atual dinâmico); o
  histórico cobre os 12 meses anteriores ("Atual − 1" para trás).
- Empresa nova (< 12m): `(soma desde abertura / meses) × 12`; 1º mês sem histórico: `receita × 12`. A base proporcional usa só os últimos N meses (N = idade).
- Segregação intra-empresa: com `composicao` (ex. 60% I + 40% III), a RBT12
  TOTAL define a faixa em cada tabela; cada parcela usa sua alíquota efetiva
  e o DAS é a soma. Sem composição = 100% no anexo principal.
- Sublimite R$ 3,6M → alerta `SUBLIMITE_3_6M`; limite R$ 4,8M → `DESENQUADRAMENTO_4_8M`.
- Fator R = folha12 / RBT12; ≥ 28% → Anexo III senão V (alerta `FATOR_R_TROCA_ANEXO`). Só para atividades sujeitas — Anexo III puro dispensa cálculo, folha e diagnóstico (`dispensarFatorR`). Campos de folha só aparecem para anexos III/V sujeitos.
- Encargos do pró-labore: INSS 11% (teto RGPS) + IRPF tabela mensal 2026; CPP patronal por fora só no Anexo IV. Agregado Σ mensal no painel de carga fiscal.
- Baseline "unificado": tudo na mãe (anexo/histórico/composição da mãe + total). `rba` omitido (= rbt12, comportamento do motor).
- Aviso permanente `CONSOLIDACAO_RECEITA_GRUPO`: valide sublimite consolidado com contador.

## Exemplo de uso

```ts
import { simularCenarioDividido } from '@/simples-projection';

const rel = simularCenarioDividido({
  mesInicio: '2026-01',
  receitaTotalMensal: [
    { mes: '2026-01', receita: 120_000 },
    { mes: '2026-02', receita: 120_000 },
    { mes: '2026-03', receita: 120_000 },
  ],
  percentualNova: 0.3,
  mae: {
    anexoId: 'III', folha12: 400_000,
    historico12: Array.from({ length: 12 }, (_, i) => ({
      mes: `2025-${String(i + 1).padStart(2, '0')}`, receita: 100_000,
    })),
  },
  nova: { anexoId: 'III', folha12: 0, historico12: [] }, // empresa nova
  custoMensalNova: 5000,
});

console.log(rel.serieMensal[0]); // { mes, rbt12Mae: 1200000, rbt12Nova: 432000, dasMae, dasNova, economiaMes, ... }
console.log(rel.payback);        // { mes, mesesAtePayback, valorAcumuladoNoPayback }
console.log(rel.economiaTotal);
console.log(rel.alertas.map((a) => a.codigo)); // ['EMPRESA_NOVA_REGRA_MEDIA', ..., 'CONSOLIDACAO_RECEITA_GRUPO']
```

Entrada validada (manual ou CNPJ):

```ts
import { prepararEntradaProjecao } from '@/simples-projection/entrada';

const r = await prepararEntradaProjecao({
  mesInicio: '2026-01',
  historicoMae12: [...], receitaTotalMensal: [...],
  percentualNova: 0.3, anexoMae: 'III', anexoNova: 'V',
  cnpjReferencia: '11222333000181', // opcional; usa buscarCnpj existente; sem receita manual => erro instrutivo
});
if (!r.ok) console.error(r.erro, r.instrucao); // nunca inventa dados
else simularCenarioDividido(r.params);
```

## Guia de integração com a LLM

Padrão do projeto: `src/application/aurum-ai-registro-ferramentas.ts`
(`SpecFerramenta` + `listarFerramentasParaModelo` + `executarFerramenta`).
Esta camada expõe adaptador isolado — **não auto-registra** no núcleo.

Opção A — plug manual (recomendado, 5 linhas, sem tocar o núcleo além de 1 import):

```ts
import { REGISTRO_FERRAMENTAS, listarFerramentasParaModelo } from '@/application/aurum-ai-registro-ferramentas';
import { SPECS_FERRAMENTAS_PROJECAO } from '@/simples-projection/ferramentas';

// Em tempo de bootstrap do chat (não no módulo simples):
const REGISTRO = [...REGISTRO_FERRAMENTAS, ...SPECS_FERRAMENTAS_PROJECAO];
// Para intenção 'simples'/'comparativo', inclua 'simularCenarioDividido' em ferramentasParaIntencao.
// No dispatcher, roteie os 3 nomes para executarFerramentaProjecao.
```

Opção B — uso avulso (sem registro):

```ts
import { listarFerramentasProjecaoParaModelo, executarFerramentaProjecao } from '@/simples-projection/ferramentas';

const tools = listarFerramentasProjecaoParaModelo(); // OpenAI-compatível
const out = await executarFerramentaProjecao('simularCenarioDividido', { mesInicio: '2026-01', ... });
```

Fine-tuning / guardrails da LLM (obrigatório no prompt do sistema):

1. Todo número exibido deve vir de `serieMensal`/`payback`/`economiaTotal` (whitelist como `coletarNumerosPermitidos`).
2. `insightsSugeridos` começa vazio — a LLM preenche, o motor nunca gera texto qualitativo.
3. Sem receita/percentual/anexos → perguntar, nunca simular com exemplo.
4. BrasilAPI não fornece faturamento — CNPJ válido sem receita manual = `dados-insuficientes`.
5. Alertas são sinalização, não bloqueio; consolidação de grupo exige contador.
6. Dúvida sobre regra do Simples (sublimite, Fator R, faixa) → parar e citar `src/simples/tabelas.ts` + `calculo.ts`, nunca inventar.

## Como estender

- Novo regime (ex. híbrido CBS por fora): chame `calcularHibrido`/`debitoCBS` do motor dentro de `cenario-dividido.ts` — nunca copie a fórmula.
- Nova visualização: componente React puro lendo `RelatorioProjecao` (espelhe `src/simples/RelatorioAnalitico.tsx`); registre a view em `src/store/ui.ts` + `src/App.tsx` (padrão `case 'simples'`).
- Novos alertas: estenda `CodigoAlerta` em `types.ts` + emissores (orquestrador tem Fator R com folha; `relatorio.ts` tem os baseados só em série).
- Testes: vitest, `tests/simples-projecao-*.test.ts`; rede sempre via `fetchFn`/`buscarCnpjFn` injetável (padrão `tests/brasilapi.test.ts`).

## Garantias

- Suíte completa: **134 arquivos / 1365 testes passando** (inclui 19 novos, zero alterações no núcleo).
- `npx tsc --noEmit` limpo; `npx vitest run tests/simples-calculo.test.ts` inalterado e verde.
