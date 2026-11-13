# PROMPT TÉCNICO — Módulo Calculadora do Simples Nacional (isolado)

> **Escopo:** apenas a lógica que tange o módulo `src/simples/` + `src/domain/simples/` da aplicação Aurum Tax NCM.
> **Objetivo:** fornecer especificação exaustiva para construção de um sistema **separado** (CALCULADORA) com paridade total de comportamento, sem modificar a aplicação original.
> **Fonte analisada:** `D:\Documents\REFORMA NCM\Aurum Tax NCM\src\simples\*` e `src\domain\simples\*` (vigência das tabelas 2027–2028).
> **Convenção:** regras numeradas `R<n>`. Valores literais entre aspas/backticks são exatos.
> **Restrição:** o módulo é isolado — não importa `@/store/calculadora` nem `@/domain/services/calculo` (motor IBS/CBS da LC 214). Matemática própria.

---

## 1. OBJETIVO E ESCOPO

Construir uma **CALCULADORA standalone** do Simples Nacional (LC 123/2006 + reforma LC 214/2025), determinística, que reproduza exatamente:

- Cálculo do DAS (convencional e híbrido) por anexo I–V, 6 faixas.
- Trava de ISS em 5% com redistribuição do excedente.
- Sublimite estadual R$ 3,6M em 4 cenários (RBT12 × RBA).
- 6ª faixa (composição federais da 6ª + ICMS/ISS/IBS/IPI da 5ª).
- Segregação de receita por anexo (ST e não-ST).
- Fator R (limiar 28%) decidindo III vs V.
- Híbrido CBS por fora (débitos/créditos DRE).
- Relatório analítico multi-cenário + insights IA read-only.
- Exportações CSV/JSON/PDF, guia DAS (PGDAS), gráficos.

Toda a matemática deve ser **pura** (sem I/O, rede, banco). Toda a UI consome o motor; a IA apenas lê.

---

## 2. CONSTANTES GLOBAIS

| Constante | Valor |
|---|---|
| `SUBLIMITE` | `3_600_000` |
| `RBT12_MAX` | `4_800_000` |
| `FATOR_R_LIMIAR` | `0.28` (28%) |
| `ISS_TETO` | `0.05` (5%) |
| `CBS_REF_PADRAO` | `0.088` (8,8%) |
| Anexos | `'I' \| 'II' \| 'III' \| 'IV' \| 'V'` |
| Tributos | `'IRPJ' \| 'CSLL' \| 'CBS' \| 'IBS' \| 'CPP' \| 'ICMS' \| 'IPI' \| 'ISS'` |
| Faixas (limites) | `0..180000`, `180000.01..360000`, `360000.01..720000`, `720000.01..1800000`, `1800000.01..3600000`, `3600000.01..4800000` |

---

## 3. TIPOS CANÔNICOS

```ts
type AnexoSimplesId = 'I' | 'II' | 'III' | 'IV' | 'V';
type TributoSimples = 'IRPJ' | 'CSLL' | 'CBS' | 'IBS' | 'CPP' | 'ICMS' | 'IPI' | 'ISS';
type CenarioSublimite = 1 | 2 | 3 | 4;
type RegimeCenario = 'CONVENCIONAL' | 'HIBRIDO';
type RegraDebitoCBS = 'cheia' | 'zero' | 'red30' | 'red40' | 'red50' | 'red60' | 'red70';
type RegraCreditoCBS = 'integral' | 'red30' | 'red60' | 'zero' | 'semCredito';

interface FaixaSimples {
  faixa: number; limInf: number; limSup: number;
  aliquotaNominal: number; parcelaDeduzir: number;
  reparticao: Partial<Record<TributoSimples, number>>;
}
interface AnexoSimples {
  id: AnexoSimplesId; nome: string; faixas: FaixaSimples[];
  aplicaExcedenteISS: boolean; limiteISSEfetivo: number;
  redistribuicaoISS: Partial<Record<'IRPJ'|'CSLL'|'CBS'|'CPP', number>>;
}
type Reparticao = Record<TributoSimples, number>;
interface ForaSublimite { icms: number; iss: number; ibs: number; total: number; }
interface AliquotasFora { icms: number; iss: number; ibs: number; }
interface TravaISS {
  issBruta: number; excedente: number; issFinal: number;
  acrescimos: { IRPJ: number; CSLL: number; CBS: number; CPP: number; };
  cbsFinal: number;
}
interface EntradaConvencional {
  anexoId: AnexoSimplesId; rbt12: number; receitaMes: number;
  rba?: number; aliqRefICMS?: number | null; aliqRefISS?: number | null;
}
interface ResultadoConvencional {
  anexoId: AnexoSimplesId; faixa: number; cenario: CenarioSublimite;
  aliquotaEfetiva: number; aliquotaEfetivaGuia: number;
  aliquotaEfetivaCBS: number; aliquotaEfetivaCBSFinal: number;
  aliquotaISSBruta: number; aliquotaISSFinal: number; excedenteISS: number;
  das: number; dasGuia: number; cargaTotal: number;
  foraSublimite: ForaSublimite; aliquotasFora: AliquotasFora;
  tributosFora: TributoSimples[]; excedeSublimite: boolean;
  usouReferencia: { icms: boolean; iss: boolean; };
  cbsDentroDAS: number; reparticao: Reparticao; reparticaoGuia: Reparticao;
  acrescimosISS: { IRPJ: number; CSLL: number; CBS: number; CPP: number; };
  detalhes: { receitaNaoExcedente: number; receitaExcedente: number;
              icmsEfetivo?: number; ibsEfetivo?: number; };
}
interface ResultadoHibrido {
  dasReduzido: number; cbsFora: number; saldoCredor: number;
  total: number; foraSublimite: ForaSublimite; cargaTotal: number;
  economiaVsConvencional: number;
  melhor: 'convencional' | 'hibrido' | 'empate';
}
```

---

## 4. TABELAS DOS ANEXOS (I–V)

Vigência 2027–2028. Cada anexo tem 6 faixas.

### Anexo I — Comércio (`aplicaExcedenteISS=false`, `limiteISSEfetivo=0`, `redistribuicaoISS={}`)

| Faixa | limInf | limSup | nominal | deduzir | repartição |
|---|---|---|---|---|---|
| 1 | 0 | 180000 | 0.04 | 0 | IRPJ 0.055, CSLL 0.035, CBS 0.1533, IBS 0.0017, CPP 0.415, ICMS 0.34 |
| 2 | 180000.01 | 360000 | 0.073 | 5940 | (idem faixa 1) |
| 3 | 360000.01 | 720000 | 0.095 | 13860 | IRPJ 0.055, CSLL 0.035, CBS 0.1533, IBS 0.0017, CPP 0.42, ICMS 0.335 |
| 4 | 720000.01 | 1800000 | 0.107 | 22500 | (idem faixa 3) |
| 5 | 1800000.01 | 3600000 | 0.143 | 87300 | (idem faixa 3) |
| 6 | 3600000.01 | 4800000 | 0.189 | 378000 | IRPJ 0.1358, CSLL 0.1006, CBS 0.3402, CPP 0.4234 |

### Anexo II — Indústria (`aplicaExcedenteISS=false`)

| Faixa | limInf | limSup | nominal | deduzir | repartição |
|---|---|---|---|---|---|
| 1 | 0 | 180000 | 0.045 | 0 | IRPJ 0.055, CSLL 0.035, CBS 0.1385, IBS 0.0015, CPP 0.375, IPI 0.075, ICMS 0.32 |
| 2 | 180000.01 | 360000 | 0.078 | 5940 | (idem) |
| 3 | 360000.01 | 720000 | 0.1 | 13860 | (idem) |
| 4 | 720000.01 | 1800000 | 0.112 | 22500 | (idem) |
| 5 | 1800000.01 | 3600000 | 0.147 | 85500 | (idem) |
| 6 | 3600000.01 | 4800000 | 0.299 | 720000 | IRPJ 0.0853, CSLL 0.0753, CBS 0.2522, CPP 0.2359, IPI 0.3513 |

### Anexo III — Serviços (ISS) (`aplicaExcedenteISS=true`, `limiteISSEfetivo=0.05`, `redistribuicaoISS={IRPJ 0.0602, CSLL 0.0526, CBS 0.2346, CPP 0.6526}`)

| Faixa | limInf | limSup | nominal | deduzir | repartição |
|---|---|---|---|---|---|
| 1 | 0 | 180000 | 0.06 | 0 | IRPJ 0.04, CSLL 0.035, CBS 0.1543, IBS 0.0017, CPP 0.434, ISS 0.335 |
| 2 | 180000.01 | 360000 | 0.112 | 9360 | IRPJ 0.04, CSLL 0.035, CBS 0.1691, IBS 0.0019, CPP 0.434, ISS 0.32 |
| 3 | 360000.01 | 720000 | 0.135 | 17640 | IRPJ 0.04, CSLL 0.035, CBS 0.1641, IBS 0.0019, CPP 0.434, ISS 0.325 |
| 4 | 720000.01 | 1800000 | 0.16 | 35640 | (idem faixa 3) |
| 5 | 1800000.01 | 3600000 | 0.21 | 125640 | IRPJ 0.04, CSLL 0.035, CBS 0.1543, IBS 0.0017, CPP 0.434, ISS 0.335 |
| 6 | 3600000.01 | 4800000 | 0.329 | 648000 | IRPJ 0.3509, CSLL 0.1504, CBS 0.1929, CPP 0.3058 |

### Anexo IV — Serviços (sem CPP) (`aplicaExcedenteISS=true`, `limiteISSEfetivo=0.05`, `redistribuicaoISS={IRPJ 0.3133, CSLL 0.32, CBS 0.3667, CPP 0}`)

| Faixa | limInf | limSup | nominal | deduzir | repartição |
|---|---|---|---|---|---|
| 1 | 0 | 180000 | 0.045 | 0 | IRPJ 0.188, CSLL 0.152, CBS 0.2126, IBS 0.0024, ISS 0.445 |
| 2 | 180000.01 | 360000 | 0.09 | 8100 | IRPJ 0.198, CSLL 0.152, CBS 0.2473, IBS 0.0027, ISS 0.4 |
| 3 | 360000.01 | 720000 | 0.102 | 12420 | IRPJ 0.208, CSLL 0.152, CBS 0.2374, IBS 0.0026, ISS 0.4 |
| 4 | 720000.01 | 1800000 | 0.14 | 39780 | IRPJ 0.178, CSLL 0.192, CBS 0.2275, IBS 0.0025, ISS 0.4 |
| 5 | 1800000.01 | 3600000 | 0.22 | 183780 | IRPJ 0.188, CSLL 0.192, CBS 0.2176, IBS 0.0024, ISS 0.4 |
| 6 | 3600000.01 | 4800000 | 0.329 | 828000 | IRPJ 0.5371, CSLL 0.2159, CBS 0.247 |

### Anexo V — Serviços (Fator R) (`aplicaExcedenteISS=true`, `limiteISSEfetivo=0.05`, `redistribuicaoISS={IRPJ 0.3007, CSLL 0.1634, CBS 0.2242, CPP 0.3117}`)

| Faixa | limInf | limSup | nominal | deduzir | repartição |
|---|---|---|---|---|---|
| 1 | 0 | 180000 | 0.155 | 0 | IRPJ 0.25, CSLL 0.15, CBS 0.1696, IBS 0.0019, CPP 0.2885, ISS 0.14 |
| 2 | 180000.01 | 360000 | 0.18 | 4500 | IRPJ 0.23, CSLL 0.15, CBS 0.1696, IBS 0.0019, CPP 0.2785, ISS 0.17 |
| 3 | 360000.01 | 720000 | 0.195 | 9900 | IRPJ 0.24, CSLL 0.15, CBS 0.1795, IBS 0.002, CPP 0.2385, ISS 0.19 |
| 4 | 720000.01 | 1800000 | 0.205 | 17100 | IRPJ 0.21, CSLL 0.15, CBS 0.1894, IBS 0.0021, CPP 0.2385, ISS 0.21 |
| 5 | 1800000.01 | 3600000 | 0.23 | 62100 | IRPJ 0.23, CSLL 0.125, CBS 0.1696, IBS 0.0019, CPP 0.2385, ISS 0.235 |
| 6 | 3600000.01 | 4800000 | 0.304 | 540000 | IRPJ 0.351, CSLL 0.1554, CBS 0.1978, CPP 0.2958 |

### Tributos que usam a 5ª faixa na 6ª faixa (`TRIBUTO_SUBLIMITE_6A_FAIXA`)

- I: `['ICMS', 'IBS']`
- II: `['ICMS', 'IBS', 'IPI']`
- III: `['ISS', 'IBS']`
- IV: `['ISS', 'IBS']`
- V: `['ISS', 'IBS']`

---

## 5. NÚCLEO MATEMÁTICO

### `round2(v)`
- `NaN` (inclui `Number(undefined|null|'')`) → `0` (IFERROR das planilhas).
- `±Infinity` → lança `Error('round2-infinito...')` (nunca pode virar DAS exibível).
- senão `Math.round(v * 100) / 100`.

### `faixaDoRBT12(anexo, rbt12)`
- `null` se `!Number.isFinite(rbt12) || rbt12 <= 0`.
- senão percorre faixas; retorna a faixa onde `rbt12 >= limInf && rbt12 <= limSup` (limites inclusivos; 1ª faixa casa primeiro).
- `null` se fora do Simples (> 4,8M).

### `aliquotaEfetiva(rbt12, faixa)`
- se `!faixa || !(rbt12 > 0)` → `0`.
- senão `(rbt12 * faixa.aliquotaNominal - faixa.parcelaDeduzir) / rbt12`.

### `fatorR(folha12, rbt12)`
- `indice = rbt12 > 0 ? folha12 / rbt12 : 0`.
- `anexo = indice >= 0.28 ? 'III' : 'V'`.

### `folhaMinima28(rbt12)` = `round2(0.28 * rbt12)`.
### `gapFolha(folha12, rbt12)` = `0` se `rbt <= 0 || folha <= 0`; senão `max(0, round2(folhaMinima28(rbt) - folha))`.
### `detalharFatorR(folha12, rbt12)` → `FatorRDetalhe` com `valor`, `threshold=0.28`, `enquadrado = dadosSuficientes && valor >= 0.28`, `folhaMinimaIII`, `gapFolha`, `gapMensalProlabore = gap > 0 ? round2(gap/12) : 0` (`dadosSuficientes = rbt > 0 && folha > 0`).

### `repartirDAS(das, faixa)`
- para cada tributo `round2(das * %faixa)`.
- `residuo = round2(das - soma)`; se `!== 0`, a maior parcela absorve o resíduo (centavos).

### `aplicarTravaISS(anexo, issBruta, cbsEfetivaBase)`
- se `!anexo.aplicaExcedenteISS || !(issBruta > 0.05)` → sem excedente: `issFinal=issBruta`, `cbsFinal=cbsEfetivaBase`, acréscimos zero.
- senão: `excedente = issBruta - 0.05`; acréscimos = `excedente * redistribuicaoISS.{IRPJ,CSLL,CBS,CPP}`; `issFinal = 0.05`; `cbsFinal = cbsEfetivaBase + acrescimos.CBS`.

### `cenarioSublimite(rbt12, rba)`
- `excedeRBT = rbt12 > 3.6M`; `excedeRBA = rba > 3.6M`.
- 4 se ambos; 2 se só RBT; 3 se só RBA; 1 se nenhum.

### `rbaNormalizada(rbt12, rba?)`
- `rbt = Number(rbt12) || 0`; `r = rba == null ? NaN : Number(rba)`.
- retorna `r > 0 ? r : rbt`.

### `excedeSublimite(rbt12, rba?)` = `cenarioSublimite(rbt, rbaNormalizada(rbt, rba)) !== 1`.

### `tributosForaSublimite(anexoId)`
- I/II → `['ICMS', 'IBS']`.
- III/IV/V → `['ISS', 'IBS']`.

### `aliquotaEfetivaTributo5aFaixa(anexo, rbt12, tributo)`
- `pct = f5.reparticao[tributo] ?? 0`; se `!(rbt12>0)` → 0.
- `aliq5 = (rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12`; retorna `aliq5 * pct`.

---

## 6. VALIDAÇÃO FAIL-CLOSED

### `exigirRbtReceita(rbt12, receitaMes)`
- `!Number.isFinite(rbt)` ou `rbt <= 0` → throw `'rbt12-ausente-ou-invalido: informe RBT12 > 0'`.
- `!Number.isFinite(rec)` ou `rec <= 0` → throw `'receita-ausente-ou-invalida: informe receitaMes > 0'`.
- `rbt > 4_800_000` → throw `'desenquadramento-simples: RBT12 acima de R$ 4.800.000 — não projetar'`.
- retorna `{ rbt12: rbt, receitaMes: rec }`.

### `calcularConvencionalEstrito(e)`
- se `!e || !(e.anexoId in ANEXOS_SIMPLES)` → throw `'anexo-invalido: "..." (esperado I, II, III, IV ou V)'`.
- `exigirRbtReceita(e.rbt12, e.receitaMes)`.
- `r = calcularConvencional(e)`.
- se `r.faixa === 0 || r.das <= 0` → throw `'calculo-sem-base: faixa/DAS zerados para os inputs'`.
- retorna `r`.

**Regra:** Infinity/NaN/≤0 e RBT12 acima do teto **nunca** podem virar DAS 0 exibível — lançam erro tipado.

---

## 7. CRÉDITOS DE CBS POR DESPESA

### `fatorCreditoDespesa(rotulo, regra)`
- se `/aluguel/i` → `0.3`.
- `integral` → 1; `red30` → 0.7; `red60` → 0.4; demais → 0.

### `creditoDaDespesaGenerico(d, cbsRef)` = `round2(valor * cbsRef * fator)`.
### `totalCreditos(despesas, cbsRef)` = `round2(soma de valor * cbsRef * fator)` (soma sem arredondar intermediário).

---

## 8. MOTOR CONVENCIONAL — `calcularConvencional(e)`

### Algoritmo

1. `rbt12 = Number(e.rbt12) || 0`; `receita = Number(e.receitaMes) || 0`; `rba = rbaNormalizada(rbt12, e.rba)`.
2. `faixa = faixaDoRBT12(anexo, rbt12)`; `cenario = cenarioSublimite(rbt12, rba)`.
3. Se `!faixa || receita <= 0 || rbt12 <= 0` → `resultadoSemSublimite` (zeros, `faixa=0`, `das=0`, repartição zerada, `detalhes={receitaNaoExcedente: receita, receitaExcedente: 0}`).
4. Parse `refICMS`, `refISS`: válidos se finitos e `>= 0`, senão `null`.
5. `tributosFora = tributosForaSublimite(anexoId)`; `f5 = faixa5(anexo)`; `aliq = aliquotaEfetiva(rbt12, faixa)`; `pctCBS = faixa.reparticao.CBS ?? 0`; `pctISS = faixa.reparticao.ISS ?? 0`; `cbsBase = aliq * pctCBS`; `issBrutaBase = aliq * pctISS`.

#### Cenário 1 (sem excesso)
- `trava = aplicarTravaISS(anexo, issBrutaBase, cbsBase)`.
- `das = round2(receita * aliq)`; `cbsDentro = round2(receita * trava.cbsFinal)`.
- `rep = repartirDAS(das, faixa)`.
- Se `trava.excedente > 0`: `rep.CBS = round2(receita*trava.cbsFinal)`; `rep.ISS = round2(receita*trava.issFinal)`; `rep.IRPJ += round2(receita*trava.acrescimos.IRPJ)`; idem CSLL/CPP.
- Se `faixa.faixa === 6`: para `['ICMS','ISS','IBS','IPI']`: se `pct5=0` → `rep[t]=0`; se `t==='ISS' && excedente>0` → `rep.ISS = round2(receita*trava.issFinal)`; senão `rep[t] = round2(receita * aliquotaEfetivaTributo5aFaixa(anexo, rbt12, t))`. (DAS permanece `receita*aliq` da 6ª faixa.)
- Retorna `resultadoSemSublimite` (`excedeSublimite=false`, fora zerado, `dasGuia=das`).

#### Cenário 2 (RBT12 na 6ª, RBA ≤ sublimite)
- `aliq5rbt = (rbt12*f5.nominal - f5.deduzir)/rbt12`.
- `aICMS = aliq5rbt*(f5.reparticao.ICMS ?? 0)`; `aIBS = aliq5rbt*(f5.reparticao.IBS ?? 0)`; `aISSb = aliq5rbt*(f5.reparticao.ISS ?? 0)`; `trava = aplicarTravaISS(anexo, aISSb, cbsBase)`; `aISS = trava.issFinal`; `aIPI = aliq5rbt*(f5.reparticao.IPI ?? 0)`.
- `usaRefICMS = refICMS != null && tributosFora.includes('ICMS')` (idem ISS).
- `foraICMS = usaRefICMS ? round2(receita*refICMS) : round2(receita*aICMS)`; `foraIBS = round2(receita*aIBS)`; `foraISS = usaRefISS ? round2(receita*refISS) : round2(receita*aISS)`.
- `foraTotal = round2(soma condicional por tributosFora)`.
- `das = round2(receita*aliq + receita*aIPI + foraTotal)`.
- `rep = repartirDAS(round2(receita*aliq), faixa)`; `rep.ICMS = round2(receita*aICMS)` (ou foraICMS se ref); `rep.IBS = round2(receita*aIBS)`; `rep.IPI = round2(receita*aIPI)`; `rep.ISS = round2(receita*aISS)` (ou foraISS); se excedente, ajusta CBS/IRPJ/CSLL/CPP.
- Retorna com `excedeSublimite=true`.

#### Cenário 3 (RBT12 ≤5ª, RBA > sublimite)
- `aliq5sub = (SUBLIMITE*f5.nominal - f5.deduzir)/SUBLIMITE`.
- `aICMS = aliq5sub*(pctICMS || f5.reparticao.ICMS || 0)`; `aIBS = aliq5sub*(pctIBS || f5.reparticao.IBS || 0)`.
- `issB = faixa.faixa===6 ? aliq5rbt*(f5.reparticao.ISS ?? 0) : issBrutaBase`; `trava = aplicarTravaISS(anexo, issB, cbsBase)`.
- Fora com/sem ref (ISS usa `trava.issFinal` por padrão).
- `aliqFed = max(0, aliq - aliq*pctICMS - issBrutaBase - aliq*pctIBS)`.
- `das = round2(receita*aliqFed + receita*trava.issFinal + round2(receita*aICMS) + round2(receita*aIBS))`; se ref usado ajusta (subtrai padrão, soma ref).
- `receitaExc = min(receita, max(0, rba - SUBLIMITE))`; `receitaNaoExc = receita - receitaExc`.

#### Cenário 4 (ambos acima)
- `aICMSnao = aliq5rbt*(f5.ICMS)`; `aICMSexc = aliq5sub*(f5.ICMS)`; idem IBS e ISS.
- `issPond = receita>0 ? (receitaNaoExc*aISSnao + receitaExc*aISSexc)/receita : 0`; `trava = aplicarTravaISS(anexo, issPond, cbsBase)`.
- `defICMS = round2(receitaNaoExc*aICMSnao + receitaExc*aICMSexc)`; `defIBS = round2(receitaNaoExc*aIBSnao + receitaExc*aIBSexc)`; `defISS = round2(receita*trava.issFinal)`.
- Fora com/sem ref; `das = round2(receita*aliq + defICMS + defIBS + defISS)`; se ref usado ajusta.
- `rep`: `repartirDAS(round2(receita*aliq), faixa)` + `rep.ICMS=defICMS (ou foraICMS)`, `rep.IBS=defIBS`, `rep.ISS=defISS (ou foraISS)`, `rep.CBS=round2(receita*trava.cbsFinal)`, `rep.IPI = round2(receita*aliq*pctIPI)` se `pctIPI`.

Em todos os cenários 2–4: `aplicarSeparacaoGuia(das, rep, tributosFora, fora, aliqs, usouRef)` → `{dasGuia, reparticaoGuia}` com tributos fora zerados na guia e `dasGuia = max(0, round2(das - fora.total))`.

### `resultadoSemSublimite(base)`
Preenche `aliquotaEfetivaGuia = base.aliquotaEfetiva`, `dasGuia = base.das`, `cargaTotal = base.das`, `foraSublimite = FORA_ZERADA`, `aliquotasFora = ALIQ_FORA_ZERADA`, `tributosFora = []`, `excedeSublimite = false`, `usouReferencia = {icms:false, iss:false}`, `reparticaoGuia = base.reparticao`.

### `aplicarSeparacaoGuia(das, rep, tributosFora, fora, aliquotas, usouReferencia)`
- `repGuia = {...rep}`; para cada `t` em `tributosFora` → `repGuia[t] = 0`.
- `dasGuia = max(0, round2(das - fora.total))`.
- retorna `{dasGuia, reparticaoGuia: repGuia}`.

---

## 9. HÍBRIDO — `calcularHibrido(e)`

- `guia = conv.dasGuia ?? conv.das`; `fora = conv.foraSublimite ?? FORA_ZERADA`.
- `dasReduzido = max(0, round2(guia - conv.cbsDentroDAS))`.
- `cbsFora = max(0, round2(debitosCBS - creditosCBS))`.
- `saldoCredor = max(0, round2(creditosCBS - debitosCBS))`.
- `total = round2(dasReduzido + cbsFora)`.
- `cargaTotal = round2(total + fora.total)`.
- `economiaVsConvencional = round2(guia - total)`.
- `melhor = economia > 0.005 ? 'hibrido' : economia < -0.005 ? 'convencional' : 'empate'`.

Com sublimite, o duelo usa a **guia** (fora cancela nos dois lados).

---

## 10. CBS POR FORA

### `fatorDebito` / `fatorCredito`
- `fatorDebito`: `{ cheia:1, zero:0, red30:0.7, red40:0.6, red50:0.5, red60:0.4, red70:0.3 }`.
- `fatorCredito`: `{ integral:1, red30:0.7, red60:0.4, zero:0, semCredito:0 }`.

### `debitoCBS(receita, regra, cbsRef)` = `round2(receita * cbsRef * (fatorDebito[regra] ?? 0))`.
### `creditoCBS(despesa, regra, cbsRef)` = `round2(despesa * cbsRef * (fatorCredito[regra] ?? 0))`.

---

## 11. SUB LIMITE — REGRAS

- Sublimite estadual: R$ 3,6M (constante).
- `cenarioSublimite(rbt12, rba)` conforme seção 5.
- `rbaNormalizada`: se `rba` nulo/≤0/inválido → usa `rbt12` (sublimite dinâmico pelo RBT12).
- `excedeSublimite = cenario !== 1`.
- `tributosForaSublimite`: I/II → `['ICMS','IBS']`; III/IV/V → `['ISS','IBS']`.
- CBS, IRPJ, CSLL, CPP e IPI permanecem na guia; ICMS/ISS/IBS saem quando há excesso.
- `dasGuia = das - fora.total`; `cargaTotal = das = dasGuia + fora.total`.
- Com excesso, o comparativo híbrido é ativado sozinho (usuário pode desmarcar).

---

## 12. TRAVA DE ISS

- `aplicaExcedenteISS`: III, IV, V = true; I, II = false.
- `limiteISSEfetivo = 0.05`.
- Redistribuição do excedente (soma = 1):
  - III: `{ IRPJ: 0.0602, CSLL: 0.0526, CBS: 0.2346, CPP: 0.6526 }`.
  - IV: `{ IRPJ: 0.3133, CSLL: 0.32, CBS: 0.3667, CPP: 0 }`.
  - V: `{ IRPJ: 0.3007, CSLL: 0.1634, CBS: 0.2242, CPP: 0.3117 }`.
- Se `issBruta > 0.05`: `excedente = issBruta - 0.05`; `issFinal = 0.05`; `cbsFinal = cbsBase + excedente * redist.CBS`; acréscimos em IRPJ/CSLL/CBS/CPP.

---

## 13. SEGREGAÇÃO ST (Substituição Tributária)

### Tipos
- `TributoST = 'ICMS' | 'ISS'`; `PreferenciaST = 'auto' | TributoST`.

### `tributoSTDoAnexo(anexoId)` = I/II → 'ICMS'; demais → 'ISS'.
### `resolverTributoST(anexoId, pref='auto')` = se pref for 'ICMS'/'ISS' força; senão segue anexo.

### `ResultadoST`
`{ tributo, valorST, deducao, dasFinal, dasIntegral, tributoIntegral, tributoFinal, reparticaoFinal, convAjustado }`.

### `calcularST(conv, receitaMes, valorSTBruto, tributo)`
- `receita = max(0, receitaMes)`; `valorST = clamp(valorSTBruto, 0, receita)`.
- `guia = conv.dasGuia ?? conv.das`; `repGuia = conv.reparticaoGuia ?? conv.reparticao`.
- `integral = round2(repGuia[tributo] ?? 0)`.
- Fail-closed: se `receita <= 0 || valorST <= 0 || integral <= 0` → dedução 0, `dasFinal=guia`, `dasIntegral=guia`, `tributoIntegral=tributoFinal=integral`, `reparticaoFinal={...repGuia}`, `convAjustado=conv`.
- `deducao = min(integral, round2(integral * valorST / receita))`.
- `tributoFinal = round2(integral - deducao)`; `dasFinal = round2(guia - deducao)`.
- `reparticaoFinal = {...repGuia, [tributo]: tributoFinal}`.
- `convAjustado = {...conv, das: round2((conv.das ?? guia) - deducao), dasGuia: dasFinal, cargaTotal: round2((conv.cargaTotal ?? conv.das ?? guia) - deducao), reparticao: {...conv.reparticao, [tributo]: round2((conv.reparticao[tributo]??0)-deducao)}, reparticaoGuia: reparticaoFinal }`.

**Regra fiscal:** dedução proporcional ao valor segregado; ST total zera o tributo na guia (item 1007 some quando ICMS 100% ST); com sublimite o tributo já fora da guia não é deduzido (dedução 0).

---

## 14. SEGREGAÇÃO DE RECEITA POR ANEXO

### Tipos
```ts
interface ParcelaSegEntrada { anexoId; receitaMes; st?; resto?; escolhido?; }
interface DetalheParcelaSeg { anexoId; anexoCalculado; receitaMes; faixa; aliquotaEfetiva;
  das; dasGuia; dasBruto; dasBrutoGuia; reparticao; reparticaoGuia; reparticaoBruta;
  reparticaoBrutaGuia; foraSublimite; tributosFora; excedeSublimite; cbsDentroDAS;
  st; tributoST; deducaoST; resto; escolhido; excedenteISS; receitaNaoExcedente; receitaExcedente; }
interface ResultadoSegregado { rbt12; receitaMes; das; dasGuia; cargaTotal; foraSublimite;
  excedeSublimite; dasBruto; deducaoST; temST; tributosST; stDetalhe; receitaNaoExcedente;
  receitaExcedente; reparticao; reparticaoGuia; reparticaoBruta; reparticaoBrutaGuia;
  dasBrutoGuia; cbsDentroDAS; aliquotaMedia; anexos; parcelas; }
```

### `anexoEfetivoParcela(anexoId, rbt12, folha12)`
- Se `anexoId === 'V'` e `rbt > 0` e `folha > 0` e `fatorR(folha, rbt).anexo === 'III'` → `{ anexo: 'III', redirecionado: true }`.
- senão `{ anexo: anexoId, redirecionado: false }`.

### `calcularSegregado(rbt12Total, parcelas, rba?, folha12?, refs?)`
1. `rbt = max(0, rbt12Total)`; se `<= 0` throw `'rbt12-ausente-ou-invalido'`.
2. `folha = max(0, folha12)`.
3. `validas` = parcelas mapeadas (`anexoId`, `receitaMes=max(0,...)`, `st`, `resto`, `escolhido=escolhido ?? anexoId`) filtradas `receitaMes > 0`. Se vazio throw `'parcelas vazias'`.
4. **Sublimite rateado pro-rata:**
   - `rbaNum = rbaNormalizada(rbt, rba)`; `excessoTotal = max(0, rbaNum - SUBLIMITE)`.
   - `recTotal = soma receitaMes`; `excDistribuivel = min(excessoTotal, recTotal)`.
   - `maiorIdx` = índice da parcela com maior receitaMes (ties → primeiro).
   - Para `i !== maiorIdx`: `exc = round2(excDistribuivel * receitaMes_i / recTotal)`; acumula `excAcumulado`.
   - `maiorIdx`: `exc = round2(excDistribuivel - excAcumulado)`.
   - `rbasFinais[i] = SUBLIMITE + exc_i`.
5. Para cada parcela:
   - `anexoCalc = anexoEfetivoParcela(anexoId, rbt, folha).anexo`.
   - `conv = calcularConvencional({ anexoId: anexoCalc, rbt12: rbt, receitaMes, rba: rbasFinais[i], aliqRefICMS, aliqRefISS })`.
   - `repBruta = {...conv.reparticao}`; `repBrutaGuia = {...conv.reparticaoGuia}`.
   - Se `st === true`: `tax = tributoSTDoAnexo(anexoCalc)`; `rst = calcularST(conv, receitaMes_parcela, receitaMes_parcela, tax)`; `das=rst.convAjustado.das`; `dasGuia=rst.dasFinal`; `dasBruto=conv.das`; `dasBrutoGuia=conv.dasGuia`; `reparticao={...rst.convAjustado.reparticao}`; `reparticaoGuia={...rst.reparticaoFinal}`; `st=true`; `tributoST=tax`; `deducaoST=rst.deducao`.
   - senão: `das=conv.das`; `dasGuia=conv.dasGuia`; `dasBruto=conv.das`; `dasBrutoGuia=conv.dasGuia`; `reparticao={...conv.reparticao}`; `reparticaoGuia={...conv.reparticaoGuia}`; `st=false`; `tributoST=null`; `deducaoST=0`.
6. Agregação:
   - `soma` helper round2 reduce; `somaRep` soma por tributo.
   - `receitaMes = soma receitaMes`; `das = soma das`; `dasGuia`; `dasBruto`; `dasBrutoGuia`; `deducaoST = round2(dasBruto - das)`.
   - `foraSublimite = {icms, iss, ibs, total}` somas.
   - `excedeSublimite = any parcela excede`.
   - `tributosST`: anexos/tributos com `st` e `deducaoST > 0` (dedup).
   - `stDetalhe`: por tributo → `{tributo, valorST: soma receitaMes das parcelas st com aquele tributo, deducao: soma deducaoST}`.
   - `anexos`: `anexoCalculado` dedup.
   - `aliquotaMedia = receitaMes > 0 ? das / receitaMes : 0`.
   - `receitaNaoExcedente = soma`; `receitaExcedente = soma`.
7. Retorna `ResultadoSegregado`.

### `somaParcelas(parcelas)` = `round2(soma max(0, valor))`.

### `pseudoConvDoSegregado(seg, base)`
Constrói `ResultadoConvencional` a partir do segregado:
- spread `base`; `anexoId=base.anexoId`; `faixa=primeira parcela?.faixa ?? base.faixa`.
- `aliquotaEfetiva = seg.das/rec`; `aliquotaEfetivaGuia = seg.dasGuia/rec`; `aliquotaEfetivaCBS = cbsDentroDAS/rec`; `aliquotaEfetivaCBSFinal = mesmo`; `aliquotaISSBruta = reparticaoBruta.ISS/rec`; `aliquotaISSFinal = reparticaoGuia.ISS/rec`.
- `excedenteISS = soma parcelas.excedenteISS`.
- `das=seg.das`; `dasGuia=seg.dasGuia`; `cargaTotal=seg.das`; `foraSublimite={...}`; `aliquotasFora` por tributo/rec; `tributosFora` dedup de parcelas; `excedeSublimite`; `usouReferencia={icms:false,iss:false}`; `cbsDentroDAS=seg.cbsDentroDAS`; `reparticao={...seg.reparticao}`; `reparticaoGuia={...seg.reparticaoGuia}`; `detalhes={...base.detalhes, receitaNaoExcedente, receitaExcedente}`.

---

## 15. FATOR R

- `FATOR_R_LIMIAR = 0.28`.
- `fatorR(folha12, rbt12)`: `indice = rbt12 > 0 ? folha12 / rbt12 : 0`; `anexo = indice >= 0.28 ? 'III' : 'V'`.
- `folhaMinima28(rbt12) = round2(0.28 * rbt12)`.
- `gapFolha(folha12, rbt12)`: se `rbt <= 0 || folha <= 0` → 0; senão `max(0, round2(folhaMinima28(rbt) - folha))`.
- `detalharFatorR`: `dadosSuficientes = rbt > 0 && folha > 0`; `valor = rbt > 0 ? folha / rbt : 0`; `enquadrado = dadosSuficientes && valor >= 0.28`; `gapMensalProlabore = gap > 0 ? round2(gap/12) : 0`.

**Regra de aplicação:** Fator R só quando Anexo V está envolvido (`envolveAnexoV`). Em CNPJ com anexos III e V, o Fator R decide: ≥ 28% → III, senão V. Sem folha informada, mantém V (provisório).

---

## 16. STORE / ESTADO / FLUXO

### `SimplesState` (Zustand)
Campos: `modo`, `anexoId`, `escolheuAnexo`, `rbt12`, `receitaMes`, `folha12`, `rba`, `usarRba`, `cbsRef`, `aliqRefICMS`, `aliqRefISS`, `despesas`, `compararHibrido`, `cnpj`, `buscandoCnpj`, `empresaNome`, `opcaoSimples`, `opcoes` (CnaeOpcao[]), `cnaeEscolhido`, `relatorioVisivel`, `convencional`, `hibrido`, `debitosCBS`, `creditosCBS`, `segAtivo`, `segParcelas`, + ações.

### Modos
- `manual`: usuário escolhe anexo I–V.
- `cnpj`: busca CNPJ (BrasilAPI), lista CNAEs, escolhe um; anexos normalizados; NBS informativo.

### Helpers
- `normalizarListaAnexosSimples(v)`: aceita array/string, split em `/ , ; |`, uppercase, filtra I–V, dedup.
- `envolveAnexoV(s)`: true se `anexoId === 'V'` ou (cnpj + cnae escolhido com anexos incluindo 'V' ou `exigeFatorR` ou `tabela.fatorR`).
- `temDuploAnexoFatorR(s)`: cnpj + cnae com anexos III e V.
- `preverAnexoFatorR(rbt12, folha12)`: retorna `{indice, anexo, definido}`.
- `etapa1Pronta(s)`: manual → `escolheuAnexo`; cnpj → `Boolean(cnaeEscolhido)`.
- `sublimiteEstourado(s)`: `rbt > 0 && excedeSublimite(rbt, rbaEfetiva(s))` (RBA efetiva = RBT12 sempre, sem RBA manual).
- `rbaEfetiva(s)` = `Number(s.rbt12) || 0`.
- `refsForaDoAnexo(anexoId)` = `tributosForaSublimite(anexoId)` filtrado para 'ICMS'/'ISS'.

### `calcular()` (fluxo)
1. Guard fail-closed: `exigirRbtReceita(rbt12, receitaMes)`; em erro toast e zera resultados.
2. `estourado = sublimiteEstourado(s)`; `comparar = compararHibrido || estourado`.
3. `anexoEfetivo = anexoId`; se `envolveAnexoV(s) && folha12 > 0 && rbt12 > 0` → `anexoEfetivo = fatorR(folha12, rbt12).anexo`.
4. `conv = calcularConvencional({ anexoId: anexoEfetivo, rbt12, receitaMes, rba: rbaEfetiva(s), aliqRefICMS, aliqRefISS })`.
5. Se `!comparar`: set convencional=conv, hibrido=null, debitos=0, creditos=0, relatorioVisivel=true.
6. `debitos = debitoCBS(receitaMes, 'cheia', cbsRef)`.
7. `creditos = round2(despesas.reduce((acc,d) => acc + valor * cbsRef * fatorDespesa(d), 0))`.
8. `hib = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos })`.
9. set convencional=conv, hibrido=hib, debitos, creditos, relatorioVisivel=true, compararHibrido=comparar.

### `buscarPorCnpj(opts)`
- Valida 14 dígitos; ano = `normalizarAnoReferencia(opts?.anoReferencia ?? 2033)`.
- Busca dados (BrasilAPI); monta lista de CNAEs (principal + secundários dedup).
- Para cada CNAE: `c7 = codigo7De(codigo)`; tabela = `db.cnae.get(c7)`; anexos normalizados; exigeFatorR; regras; NBS (best-effort, cache).
- **Não pré-seleciona** CNAE (`cnaeEscolhido=''`).

### `escolherCnae(cnae7)`
- `validos = normalizarListaAnexosSimples(op.anexos).filter(a => ANEXOS_SIMPLES[a])`.
- sugerido: 1 válido → esse; inclui 'V' → 'V'; >1 válido → validos[0]; else anexoId atual.
- set cnaeEscolhido, anexoId=sugerido, relatorioVisivel=false.

### `limpar()` reseta tudo.

---

## 17. RELATÓRIO ANALÍTICO

### `RelatorioInput`
`{ empresa: EmpresaIdent; competencia; exercicioReferencia; rbt12; rba; receitaMes; folha12; cbsRef; despesas: DespesaAnalitica[]; aliqRefICMS?; aliqRefISS?; contexto: { modo; anexoSelecionado; anexosElegiveis } }`.

### `EmpresaIdent`
`{ origem: 'CNPJ_API'|'MANUAL'; razaoSocial; nomeFantasia?; cnpj?; enderecoCompleto?; cnaePrincipal?; cnaesSecundarios?; regimeAtual? }`.

### Tipos de cenário
- `ScenarioId`: `III_CONV | V_CONV | III_HIB | V_HIB | I_CONV | I_HIB | II_CONV | II_HIB | IV_CONV | IV_HIB`.
- `RegimeCenario = 'CONVENCIONAL' | 'HIBRIDO'`.
- `CenarioAnalitico`: `{ scenarioId, anexo, regime, faixa, aliquotaNominal, parcelaDeduzir, aliquotaEfetiva, dasTotal|null, cbsDentroDas|null, dasReduzidoSemCbs|null, debitosCbs|null, creditosCbs|null, cbsARecolher|null, saldoCredor|null, totalPagar, cenarioSublimite, regraDas, dasGuia, foraSublimite, excedeSublimite, vencedor? }`.

### `ReportAnalitico`
`{ reportId, geradoEm, motorVersao, empresa, competencia, premissas, fatorR, cenarios, contexto, memoriaHibrido, dueloFoco, comparativo, metodologia, hash }`.

- `premissas`: `{ rbt12, rba, receitaMes, folha12, cbsRef, sublimiteAnual, excedeSublimiteRbt12, excedeSublimiteRba, guiaSemFora, regraDas }`.
- `contexto`: `{ modo, anexoSelecionado, anexosElegiveis, mostrarMatrizIIIV, mostrarFatorR }`.
- `comparativo`: `{ menorCargaScenarioId, menorGeralScenarioId, matrizDeltas, tabelaOutrosAnexos }`.
- `metodologia`: `{ formulas, fontes, aviso }`.

### `orquestrarRelatorio(input)` — algoritmo
1. Normaliza inputs (`Number(...) || 0`); `rba = rbaNormalizada(rbt12, input.rba)`.
2. `elegiveis` filtrados; `modo`; `foco` validado ou 'I'; `elegiveisEfetivos` unique ou [foco].
3. `mostrarMatrizIIIV = modo === 'cnpj' && elegiveis contêm 'III' e 'V'`.
4. `mostrarFatorR = elegiveis contêm 'V' OU foco === 'V'`.
5. `fatorR = calcularFatorRDetalhado(folha12, rbt12)`.
6. `debitos = debitoCBS(receitaMes, 'cheia', cbsRef)`; `creditos = totalCreditosDespesas(input.despesas, cbsRef)`.
7. `convPorAnexo`: para I–V, `calcularConvencional({anexoId, rbt12, receitaMes, rba, aliqRefICMS, aliqRefISS})`.
8. `pares`: III, V, I, II, IV (cada com convId/hibId).
9. Para cada par: `hibCalc = calcularHibrido({convencional: conv, debitosCBS: debitos, creditosCBS: creditos})`; push conv + hib via `montarCenario`.
10. `memoriaHibrido`: para cada anexo, monta `porDespesa` com `fator = fatorCreditoDespesa(rotulo, regra)` e `credito = round2(valor * cbsRef * fator)`.
11. `dueloFoco`: conv/hib do foco; `deltaFoco = round2(hib.total - conv.total)`; vencedor EMPATE se |delta| ≤ 0.005, senão CONV se delta > 0 else HIB.
12. Veredito principal: `quorum` com matriz → `['III_CONV','V_CONV','III_HIB','V_HIB']`; sem matriz → `[focoConvId, focoHibId]`. `menor` = id de menor `totalPagar` (se `temBase = receitaMes > 0 && rbt12 > 0`). `menorGeral` = id de menor `totalPagar` entre os 10 (informativo). Marca `vencedor = true` no cenário `menor`.
13. `matrizDeltas`: 4 comparativos fixos: `V_CONV→III_CONV`, `V_HIB→III_HIB`, `III_CONV→III_HIB`, `V_CONV→V_HIB`. Cada: `deltaRs = round2(b.total - a.total)`; `deltaPp = round2((b.aliquotaEfetiva - a.aliquotaEfetiva)*100)` ou null; `deltaPct = round2((deltaRs/a.total)*100)` ou null.
14. `tabelaOutrosAnexos`: para I, II, IV: convTotal, hibTotal, deltaRs, vencedor, aliquotaEfetivaConv, cbsDentroDas, cbsFora.
15. Premissas finais: `excedeRbt = rbt12 > 3.6M`; `excedeRba = rba > 3.6M`; `cenarioRef = convPorAnexo.get(foco)?.cenario ?? convPorAnexo.get('III')?.cenario ?? 1`; `guiaSemFora = algum conv excedeSublimite OU excedeSublimite(rbt12, rba)`; `regraDas = REGRA_DAS_LABEL[cenarioRef]`.
16. Retorno: `{...base, reportId: uuid(), geradoEm: ISO, hash: hashRelatorio(base)}`.

### Hash
- `fnv1a(str)`: FNV-1a 32-bit (inicial `0x811c9dc5`, multiplicador `0x01000193`), hex 8 chars.
- `hashRelatorio(report) = fnv1a(JSON.stringify([premissas, fatorR, cenarios, comparativo, contexto, dueloFoco, memoriaHibrido]))`.

### `coletarNumerosPermitidos(report)`
Whitelist anti-alucinação: coleta todos os números citáveis (premissas, fatorR, por cenário, deltas, tabelaOutrosAnexos, dueloFoco, memoriaHibrido). Tolerância `0.011`.

### `montarCenario(conv, hib, debitos, creditos, scenarioId, regime)`
- `guiaConv = conv.dasGuia ?? conv.das`; `totalPagar = guiaConv` (conv) ou `hib.total`.
- `aliquotaEfetiva = conv.aliquotaEfetivaGuia ?? conv.aliquotaEfetiva`.
- Duelo na mesma base da guia (fora à parte).

---

## 18. IA INSIGHTS (READ-ONLY)

### Tipos
- `NivelInsight = 'OPORTUNIDADE' | 'ALERTA' | 'INFO'`.
- `AiInsight = { insightId, titulo, texto, nivel, cenariosRef: ScenarioId[], valoresCitados: number[] }`.

### `validarInsights(report, insights)`
- `permitidos = coletarNumerosPermitidos(report)`.
- Para cada insight (máx. 5):
  - `titulo` não vazio e ≤ 90 chars.
  - `texto` não vazio e ≤ 600 chars.
  - cada `cenariosRef` deve existir em `idsCenarios`.
  - cada `valoresCitados` deve ser `numeroPermitido(v, permitidos, tol=0.011)`.
  - cada número extraído do texto por `extrairNumerosDoTexto` (BRL `R$ X,XX` e percentuais `Y,Z%`) deve ser permitido.
  - rejeita padrão de cálculo no texto: regex `/=\s*R\$|×\s*R\$|x\s*R\$|\+ R\$|R\$\s?[\d.,]+\s?(\+|-|×|x|\*|\/)/`.
- `ok = filtrados.length > 0 && erros.length === 0`.

### Geração
- `gerarInsightsFallback(report)`: se `!mostrarMatrizIIIV` → `gerarInsightsFoco`; senão `gerarInsightsMatriz`.
- `gerarInsightsMatriz`: 4 insights (veredito, fator r, híbrido, ação).
- `gerarInsightsFoco`: 3 insights (veredito, memória, ação).

### `SYSTEM_PROMPT_IA`
Modo leitura, uso exclusivo do JSON canônico, máx. 5 insights, pt-BR executivo, 2ª pessoa, sem juridiquês. Ordem: veredito → Fator r/gap → híbrido vs convencional → próximos passos.

### `montarPrompt(report)`
Envia `SYSTEM_PROMPT_IA` + JSON canônico. Resposta esperada `{"insights": [...]}`.

**Regra:** IA nunca altera valores; todo número citado deve estar na whitelist.

---

## 19. EXPORTAÇÕES

### `csvSimples(p)` / `jsonSimples(p)` / `exportarSimplesCSV` / `exportarSimplesJSON`
- `PayloadSimples`: `{ anexoId, rbt12, receitaMes, folha12, rba, cbsRef, conv, hib|null, debitosCBS, creditosCBS, empresa?, cnae?, dasReferencia, st?, seg? }`.
- CSV: cabeçalho + anexo efetivo, Fator R, faixa, cenário sublimite, RBT12, receita, folha, RBA, alíquota efetiva (com/sem sublimite), blocos de segregação (anexos, parcelas, DAS bruto, DAS segregado, DAS convencional referência) ou DAS convencional guia, ICMS/ISS/IBS fora da guia, bloco ST, repartição, e (se hib) DAS reduzido, débitos, créditos, CBS a recolher, total híbrido, carga híbrida, melhor regime.
- JSON: `JSON.stringify({exportadoEm, ...p})`.
- Arquivos: `simples_{anexo}_{data}.csv` / `.json`.

### `csvRelatorioAnalitico(r)` / `jsonRelatorioAnalitico(r, insights)` / `exportarRelatorioAnaliticoCSV/JSON/PDF`
- CSV: empresa, origem, CNPJ, competência, anexo em foco, matriz exibida?, premissas (RBT12, RBA, receita, folha, Fator r, gap), tabela de cenários, deltas.
- JSON: `{exportadoEm, report: r, insights}`.
- PDF premium (A4, timbrado + rodapé + marca d'água): capa, KPIs, faixa veredito, seção 1 duelo, Fator r, memória do híbrido, demais anexos, insights IA, metodologia.
- Arquivo: `Relatorio-Simples-{tag}-{competencia}-{hash}`.

### `RISCOS_PDF` / `pdfText(v)`
Sanitiza glifos não suportados pela Roboto embutida (✓, ⚠, ✕, setas, −, quadrados, dingbats, ≈, surrogates, VS).

---

## 20. UI / FLUXO DO USUÁRIO

### Wizard de 3 etapas
1. **Valores base**: RBT12 (máscara moeda, teto 4,8M), Receita do mês, Sublimite automático (badge verde/âmbar), Folha 12m (opcional, Fator R), previsão III/V. Valida `RBT12>0 && receitaMes>0`.
2. **Anexo / Atividade**:
   - Manual: grade 2×5 de anexos I–V.
   - CNPJ: input CNPJ + Buscar; razão social; lista aberta de CNAEs; atividade focada; NBS informativos.
   - Segregação de receita: botão "＋ Segregar receita"; parcelas com anexo + receita + checkbox ST; validação soma ≤ receita; restante automático.
   - Avançado: sublimite (ICMS/ISS fora da guia %), checkbox híbrido (CBS ref + despesas com regra de crédito), inputs de %.
   - Navegação: "← Dados" e "✦ Ver resultado".
3. **Resultado**: skeleton 750ms → revela:
   - Memória de cálculo + Desmembramentos (se segregado) + Fechamento.
   - Hero DAS + Gráficos (Rosca/Pizza/Barras/Tabela).
   - Painel Convencional × Híbrido (se comparar).
   - Ações: CSV, JSON, ✂ Dividir em 2 (CNPJ), Reiniciar, PDF analítico.

### Modais
- `DasModal`: guia DAS (PGDAS) — documento oficial, composição, barras ITF, QR placeholder, imprimir.
- `InsightsModal`: relatório analítico premium — tabs Resumo/Comparativo/Gráficos/Insights IA/Método.

### Máscaras
- `moeda`: `R$ 0,00` (parseMoeda: dígitos / 100).
- `cnpj`: `AA.BBB.CCC/DDDD-EE`.
- `ncm`, `cfop`, `cst`, `cstPis`, `qtd`.

### Formatação
- `fmtMoeda` (BRL pt-BR), `fmtCnpj`, `fmtCarga` (alíquota %), `fmtNbs`, `parseMoeda`, `parseQtd`.

---

## 21. DAS MODAL (PGDAS)

### `montarDadosDas(convAjustado, { empresa?, cnae?, st?, seg? })`
- `periodoApuracao` = mês anterior; `competenciaCurta`; `vencimento` = dia 20 do mês atual; `numeroDocumento` gerado.
- Itens por tributo (ORDEM: IRPJ, CSLL, CBS, IBS, CPP, ICMS, IPI, ISS) filtrando `reparticaoGuia > 0.005`, com código (1001…1010), denominação "X - SIMPLES NACIONAL", principal, detalhe competência.
- Total = guia DAS.
- Observações: Anexo · faixa · RBT12 · Receita + sublimite (cenário/tributos fora/valor) + segregado + ST + CNAE + "Documento elaborado pelo Aurum TAX".

### Layout
Cabeçalho com logo "S" + "SIMPLES NACIONAL" + título "Documento de Arrecadação do Simples Nacional"; caixas CNPJ/Razão Social; Período de Apuração/Data de Vencimento/Número do Documento; Observações; "Pagar este documento até" e "Valor Total do Documento" (verde); tabela "Composição do Documento de Arrecadação": Código | Denominação | Principal | Multa | Juros | Total; totais. Rodapé "SENDA (Versão:1.8.0) · Página 1/1 · emitidoEm". Autenticação mecânica com grupos de arrecadação zerados (4×11 dígitos + DV mod10) e barras ITF. Canhoto com CNPJ, Número, Pagar até, Valor e QR placeholder. Botões: Imprimir, Fechar.

---

## 22. GRÁFICOS (GraficosDAS)

Componente puro (props: final, bruta?, dasBruto, dasFinal, temST). Sem cálculo/fetch/store.

- Modos (tabs): Rosca (Doughnut), Pizza (Pie), Barras (Bar), Tabela.
- Cores por tributo: IRPJ #2b3f63, CSLL #475569, CBS #be9433, IBS #eab308, CPP #047857, ICMS #0284c7, IPI #7c3aed, ISS #e11d48. Bruto #94a3b8, Guia #be9433. Limiar 0.005 oculta residuais.
- Rosca/Pizza: final por tributo, legend bottom, tooltip com valor + % do total.
- Barras: Bruto×Guia se ST (2 datasets), senão Guia por tributo colorido; orientação vertical/horizontal; scales com grace 12%.
- Tabela: tributo · valor · % + tfoot "Guia".
- Header: "Para onde vai o DAS" + subtítulo (Bruto X × Guia Y ou Guia Y). Nota de rodapé contextual.

---

## 23. VETORES DE TESTE (OURO)

### EX1 — Anexo I, RBT12 250.000, receita 30.000
- `faixaDoRBT12(ANEXOS_SIMPLES.I, 250_000)` → faixa `2`.
- `aliquotaEfetiva(250_000, faixa)` → `0.04924`.
- `calcularConvencional({ anexoId: 'I', rbt12: 250_000, receitaMes: 30_000 })`: `das = 1477.20`; `reparticao.IRPJ = 81.25`; `reparticao.ICMS = 502.25`.

### EX2 — Anexo III, RBT12 500.000, receita 60.000
- `faixa = 3`; `aliquotaEfetiva = 0.09972`; `das = 5983.20`; `excedenteISS = 0`.

### EX3 — Fator R
- `fatorR(100_000, 300_000).anexo = 'III'`; `fatorR(80_000, 300_000).anexo = 'V'`.

### EX4 — Sublimite cenário 4
- `calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 3_700_000 })`: `cenario = 4`; `detalhes.receitaExcedente = 100_000`; `das > 20_000`.

### EX5 — Híbrido, Anexo I com créditos pequenos
- `debitos = debitoCBS(200_000, 'cheia', 0.088) = 17600`.
- `cred = round2(creditoCBS(1500, 'integral', 0.088) * 0.3 + creditoCBS(300, 'integral', 0.088)) = 66`.
- `calcularHibrido(...)` → `melhor = 'convencional'`.

### Edge: RBT12 zero
- `calcularConvencional({ anexoId: 'I', rbt12: 0, receitaMes: 10_000 }).das = 0` (sem throw).

### Limites de RBT12 (Anexo I)
| RBT12 | Faixa |
|---|---:|
| 0 | null |
| 180000 | 1 |
| 180000.01 | 2 |
| 3600000 | 5 |
| 4800000 | 6 |
| 4800001 | null |

### 4 cenários de sublimite
| RBT12 | RBA | Cenário |
|---:|---:|---:|
| 3000000 | 3000000 | 1 |
| 3800000 | 3000000 | 2 |
| 3000000 | 3700000 | 3 |
| 3800000 | 3700000 | 4 |

### Trava ISS
- Anexo I: `aplicarTravaISS(ANEXOS_SIMPLES.I, 0.2, 0.01)` → `excedente=0`, `issFinal=0.2`.
- Anexo III: `aplicarTravaISS(ANEXOS_SIMPLES.III, 0.07, 0.01)` → `issFinal ≈ 0.05`, `excedente ≈ 0.02`, `cbsFinal > 0.01`.
- ISS bruto ≤ 5%: `aplicarTravaISS(ANEXOS_SIMPLES.III, 0.03, 0.01)` → `excedente=0`, `issFinal=0.03`.

### Fator R fronteira
- `fatorR(84_000, 300_000).anexo = 'III'`; `.indice = 0.28`.
- `fatorR(83_999, 300_000).anexo = 'V'`.

### Robustez
- `rbt12 ∈ {NaN, -1, -100}` → `das ≥ 0`, não NaN.
- `receitaMes ∈ {NaN, -1, -100}` → `das ≥ 0`, não NaN.
- `rbt12 ∈ {Infinity, -Infinity}` → `das = 0`, não NaN.
- `receitaMes = Infinity` → pode lançar Error tipado ou retornar DAS não-NaN ≥ 0.

### Golden EX1/EX2
- EX1: `das ≈ 1477.2`, `round2(das) = 1477.2`.
- EX2: `faixa = 3`, `das ≈ 5983.2`, `round2(das) = 5983.2`, `excedenteISS = 0`.

### Segregação (valores-chave)
- RBT12 total 704423.80; parcelas usam RBT12 total; DAS soma.
- ST proporcional: `deducao = reparticao.tributo × valorST / receitaTotal`.
- ST total zera o tributo na guia (item 1007 some quando ICMS 100% ST).
- Clamp: `valorST` não pode exceder `receitaMes`.
- Fator R compartilhado: parcela V com folha/RBT12 ≥ 28% calcula como III; ST em parcela redirecionada deduz ISS.
- Restante automático (`resto: true`): parcela parcial segrega; o resto calcula no anexo efetivo.
- `pseudoConvDoSegregado`: `das = seg.das`; `aliquotaEfetivaCBS × receita ≈ cbsDentroDAS`.
- `stDetalhe`: agrega base e dedução por tributo.

### Sublimite rateado fecha com cálculo único
- `unico = calcularConvencional({ anexoId: 'I', rbt12: 4000000, receitaMes: 500000, rba: 4000000 })`.
- `seg = calcularSegregado(4000000, [{ anexoId: 'I', receitaMes: 250000 }, { anexoId: 'I', receitaMes: 250000 }], 4000000)`.
- `seg.receitaExcedente ≈ 400000`; `seg.receitaNaoExcedente ≈ 100000`; `seg.das ≈ unico.das`.

### Cenário do print: V+V+III com folha 33,22% totaliza ~R$ 10.751
- `seg = calcularSegregado(704423.80, [{ anexoId: 'V', receitaMes: 20703.75 }, { anexoId: 'V', receitaMes: 109928.41, st: true }, { anexoId: 'III', receitaMes: 4250, st: true }], 704423.80, 233998.14)`.
- `seg.das ≈ 10751.07`; `seg.dasBruto ≈ 14831.41`.

---

## 24. INVARIANTES

1. `DAS = receita × alíquota efetiva` (±0,01, resíduo de round2).
2. `soma(repartição) = DAS` (resíduo de 1 centavo absorvido na maior parcela; tolerância ±0,05).
3. Na 6ª faixa há sublimite por desenho (cenário 2): `das = dasGuia + fora.total`.
4. `dasGuia + foraSublimite.total ≈ das` (tolerância 0–2 casas).
5. `soma(redistribuicaoISS) ≈ 1` (III, IV, V).
6. `Fator R limiar = 0.28` (fronteira exata).
7. `RBT12 zero → DAS 0` (sem throw).
8. `RBT12 > 4.8M → faixa null, DAS 0` (sem throw no convencional; throw no estrito).
9. Sublimite exato em `3.6M` → cenário 1.
10. `excedeSublimite(3.6M) = false`; `excedeSublimite(3.6M+0.01) = true`.
11. `rbaNormalizada` usa RBT12 quando rba nulo/≤0.
12. ST total zera o tributo na guia.
13. Parcela V redirecionada (Fator R ≥ 28%) deduz ISS, não ICMS.
14. Restante automático guarda o anexo escolhido (badge V→III).
15. Projeção de RBT12: o mês corrente **nunca** entra no RBT12 (retroativo).
16. IA nunca altera valores; todo número citado deve estar na whitelist `coletarNumerosPermitidos` (tolerância 0,011).
17. Matriz III×V só aparece quando `modo === 'cnpj'` E anexos elegíveis contêm III e V.
18. Fator R só quando Anexo V envolvido.
19. Exportações ignoram o filtro de texto (exportam cache inteiro).
20. `round2(NaN) = 0`; `round2(±Infinity)` lança.

---

## 25. REGRAS DE PARIDADE E NÃO-MODIFICAÇÃO

- **Não modificar absolutamente nada na aplicação atual.** Este prompt é apenas especificação para um sistema separado.
- O motor determinístico é a única fonte de verdade numérica; UI, IA e PDF apenas consomem.
- Toda função de cálculo deve ser **pura** (sem I/O, rede, banco).
- Fidelidade aos vetores ouro (EX1–EX5) e às bordas (RBT12 0 / 4.800.001, sublimite 3.600.000, Fator R 28%).
- `motor_simples.py` é port fiel do TS e usado apenas para ground-truth; em produção o motor é o TS original. Divergência intencional: `r2` do Python adiciona `1e-9` antes do `round`; o TS usa `Math.round(n*100)/100` com guardas para NaN/±Infinity.
- O Python cobre cenários 3/4 por aproximação linear "fiel" (federais + 5ª faixa); o TS implementa os 4 cenários completos.

---

## 26. ARQUIVOS DE REFERÊNCIA

- `src/simples/tabelas.ts` — tabelas dos anexos.
- `src/simples/calculo.ts` — motor convencional/híbrido/ST/CBS.
- `src/simples/store.ts` — estado Zustand e fluxo CNPJ.
- `src/simples/segregacao-st.ts` — segregação com ST.
- `src/simples/segregacao-receita.ts` — segregação por anexo.
- `src/simples/relatorio-analitico.ts` — orquestrador do relatório.
- `src/simples/ia-insights.ts` — insights IA read-only.
- `src/simples/export.ts` — exportação CSV/JSON.
- `src/simples/export-relatorio-analitico.ts` — exportação do relatório (CSV/JSON/PDF).
- `src/simples/page.tsx` — UI (wizard 3 etapas).
- `src/simples/DasModal.tsx` — guia DAS (PGDAS).
- `src/simples/Graficos.tsx` — gráficos (chart.js).
- `src/simples/RelatorioAnalitico.tsx` — relatório compacto.
- `src/simples/InsightsModal.tsx` — relatório analítico premium.
- `src/domain/simples/nucleo.ts` — núcleo matemático.
- `src/domain/simples/validacao.ts` — validação fail-closed.
- `src/domain/simples/creditos.ts` — créditos CBS por despesa.
- `tests/simples-*.test.ts` — vetores de teste.
- `finetune_simples_inverso/motor_simples.py` — port Python (ground-truth).
- `docs/fine-tuning-simples-fatorR.md` — documentação de fine-tuning.

---

**Fim do prompt técnico.**
