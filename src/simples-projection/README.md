# simples-projection — Projeção Financeira Multi-Empresa

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
| `janela-rbt12.ts` | `projetarRBT12Rolling` — RBT12 deslizante (Etapa 3). |
| `cenario-dividido.ts` | `simularCenarioDividido` — orquestrador mãe/nova (Etapa 4). |
| `entrada.ts` | `prepararEntradaProjecao` — valida manual/CNPJ (Etapa 5). |
| `relatorio.ts` | `montarRelatorioProjecao`, `emitirAlertasFiscais` — envelope final. |
| `ferramentas.ts` | `specsFerramentasProjecao`, `listarFerramentasProjecaoParaModelo`, `executarFerramentaProjecao`. |
| `index.ts` | Barrel público. |

## Fluxo (texto)

```
input manual/CNPJ
  → prepararEntradaProjecao (valida; CNPJ via buscarCnpj existente; nunca inventa)
  → ParamsCenarioDividido
  → simularCenarioDividido
      ├─ fatiar receita total por percentualNova
      ├─ projetarRBT12Rolling ×3 (mãe, nova, referência-unificada)
      ├─ calcularConvencional ×3 por mês (motor existente: faixa/alíquota/DAS)
      ├─ economiaMes = DAS_ref − (DAS_mãe + DAS_nova) − custoMensalNova
      ├─ economiaAcumulada + payback (1º mês acumulado > 0)
      └─ alertas (sublimite 3.6M, 4.8M, Fator R, empresa nova, consolidação)
  → RelatorioProjecao { serieMensal, payback, economiaTotal, alertas, insightsSugeridos: [] }
  → LLM preenche insights (motor nunca gera texto qualitativo)
```

## Regras fiscais aplicadas

- `RBT12(t) = soma(R[m])`, m em [t−12, t−1] — nunca inclui o próprio mês.
- Empresa nova (< 12m): `(soma desde abertura / meses) × 12`; 1º mês sem histórico: `receita × 12`.
- Sublimite R$ 3,6M → alerta `SUBLIMITE_3_6M`; limite R$ 4,8M → `DESENQUADRAMENTO_4_8M`.
- Fator R = folha12 / RBT12; ≥ 28% → Anexo III senão V (alerta `FATOR_R_TROCA_ANEXO`).
- Baseline "unificado": tudo na mãe (anexo/histórico da mãe + total). `rba` omitido (= rbt12, comportamento do motor).
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
