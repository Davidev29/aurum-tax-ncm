/**
 * Relatório Analítico e Inteligente — orquestrador determinístico.
 *
 * ÚNICA fonte de verdade numérica do relatório (tela, IA e PDF consomem
 * o `ReportAnalitico` daqui). Nenhum cálculo é feito na IA ou na UI.
 *
 * Fórmulas (espelham `calculo.ts` + planilhas):
 * - aliquotaEfetiva = (RBT12 × nominal − deduzir) / RBT12
 * - fatorR = folha12 / rbt12 (threshold 0.28)
 * - gapFolha = max(0, 0.28 × rbt12 − folha12)
 * - híbrido: dasReduzido = DAS − CBSdentro; cbsFora = max(0, débitos − créditos)
 */
import {
  ANEXOS_SIMPLES,
  FATOR_R_LIMIAR,
  type AnexoSimplesId,
} from './tabelas';
import {
  calcularConvencional,
  calcularHibrido,
  debitoCBS,
  round2,
  type RegraCreditoCBS,
  type ResultadoConvencional,
} from './calculo';

export const MOTOR_VERSAO = 'calc-engine v3 + LC214';
export const FORMULA_FATOR_R = 'FATOR_R_v1';
export const REGRA_DAS_LABEL: Record<number, string> = {
  1: 'Sem excesso de sublimite',
  2: 'RBA abaixo do sublimite e RBT12 na 6ª faixa',
  3: 'RBA acima do sublimite e RBT12 na 5ª faixa',
  4: 'RBA acima do sublimite e RBT12 na 6ª faixa',
};

/* ---------------------------------- tipos --------------------------------- */

export type OrigemEmpresa = 'CNPJ_API' | 'MANUAL';

export interface EmpresaIdent {
  origem: OrigemEmpresa;
  razaoSocial: string;
  nomeFantasia?: string | null;
  cnpj?: string | null;
  enderecoCompleto?: string | null;
  cnaePrincipal?: string | null;
  cnaesSecundarios?: string[];
  regimeAtual?: string | null;
}

export interface DespesaAnalitica {
  rotulo: string;
  valor: number;
  regra: RegraCreditoCBS;
}

export interface RelatorioInput {
  empresa: EmpresaIdent;
  competencia: string;
  exercicioReferencia: number;
  rbt12: number;
  rba: number;
  receitaMes: number;
  folha12: number;
  cbsRef: number;
  despesas: DespesaAnalitica[];
  /** Alíquotas de referência fora da guia (sublimite). null = automático 5ª faixa. */
  aliqRefICMS?: number | null;
  aliqRefISS?: number | null;
  /**
   * Contexto de elegibilidade (CNAE/CNPJ × manual).
   * - CNPJ: `anexosElegiveis` = anexos do CNAE escolhido; `anexoSelecionado` = anexo efetivo.
   * - Manual: `anexosElegiveis` = [anexo escolhido]; matriz III×V NUNCA exibe.
   * Regra de produto: a matriz III×V só existe quando modo=cnpj E elegíveis contêm III e V.
   */
  contexto: {
    modo: 'manual' | 'cnpj';
    anexoSelecionado: AnexoSimplesId;
    anexosElegiveis: AnexoSimplesId[];
  };
}

export interface FatorRDetalhado {
  folha12: number;
  rbt12: number;
  valor: number;
  threshold: number;
  enquadrado: boolean;
  dadosSuficientes: boolean;
  folhaMinimaIII: number;
  gapFolha: number;
  gapMensalProlabore: number;
  formulaId: string;
}

export type RegimeCenario = 'CONVENCIONAL' | 'HIBRIDO';
export type ScenarioId =
  | 'III_CONV' | 'V_CONV' | 'III_HIB' | 'V_HIB'
  | 'I_CONV' | 'I_HIB' | 'II_CONV' | 'II_HIB' | 'IV_CONV' | 'IV_HIB';

export interface CenarioAnalitico {
  scenarioId: ScenarioId;
  anexo: AnexoSimplesId;
  regime: RegimeCenario;
  faixa: number;
  aliquotaNominal: number;
  parcelaDeduzir: number;
  aliquotaEfetiva: number;
  dasTotal: number | null;
  cbsDentroDas: number | null;
  dasReduzidoSemCbs: number | null;
  debitosCbs: number | null;
  creditosCbs: number | null;
  cbsARecolher: number | null;
  saldoCredor: number | null;
  totalPagar: number;
  cenarioSublimite: number;
  regraDas: string;
  /** Valor dentro da guia DAS (sem ICMS/ISS/IBS do sublimite). */
  dasGuia: number;
  /** ICMS/ISS/IBS fora da guia (0 sem excesso). */
  foraSublimite: number;
  excedeSublimite: boolean;
  vencedor?: boolean;
}

export interface DeltaComparativo {
  de: ScenarioId;
  para: ScenarioId;
  deltaRs: number;
  deltaPp: number | null;
  deltaPct: number | null;
}

export interface LinhaOutroAnexo {
  anexo: AnexoSimplesId;
  convTotal: number;
  hibTotal: number;
  deltaRs: number;
  vencedor: 'CONV' | 'HIB' | 'EMPATE';
  aliquotaEfetivaConv: number;
  cbsDentroDas: number;
  cbsFora: number;
}

/** Memória de cálculo do regime híbrido por anexo (demonstração passo a passo). */
export interface MemoriaHibrido {
  anexo: AnexoSimplesId;
  /** 1. DAS convencional (CBS dentro). */
  dasTotal: number;
  /** 2. CBS embutida no DAS (a subtrair). */
  cbsDentroDas: number;
  /** 3. DAS reduzido = DAS − CBS dentro. */
  dasReduzido: number;
  /** 4. Débitos CBS = receita × alíquota de referência. */
  debitosCbs: number;
  /** 5. Créditos CBS por despesa (valor × ref × fator). */
  creditosPorDespesa: { rotulo: string; valor: number; fator: number; credito: number }[];
  /** 5b. Total de créditos. */
  creditosCbs: number;
  /** 6. CBS a recolher = max(0, débitos − créditos). */
  cbsARecolher: number;
  saldoCredor: number;
  /** 7. Total híbrido = DAS reduzido + CBS a recolher. */
  totalHibrido: number;
}

/** Duelo Convencional × Híbrido do anexo em foco (modo sem matriz III×V). */
export interface DueloFoco {
  anexo: AnexoSimplesId;
  convId: ScenarioId;
  hibId: ScenarioId;
  convTotal: number;
  hibTotal: number;
  deltaRs: number;
  vencedor: 'CONV' | 'HIB' | 'EMPATE';
  aliquotaEfetivaConv: number;
  cbsDentroDas: number;
  cbsFora: number;
}

export interface ReportAnalitico {
  reportId: string;
  geradoEm: string;
  motorVersao: string;
  empresa: EmpresaIdent;
  competencia: string;
  premissas: {
    rbt12: number;
    rba: number;
    receitaMes: number;
    folha12: number;
    cbsRef: number;
    sublimiteAnual: number;
    excedeSublimiteRbt12: boolean;
    excedeSublimiteRba: boolean;
    /** true quando a guia DAS sai sem ICMS/ISS/IBS (cenários 2–4). */
    guiaSemFora: boolean;
    regraDas: string;
  };
  fatorR: FatorRDetalhado;
  cenarios: CenarioAnalitico[];
  /** Elegibilidade e chaves de exibição (matriz III×V só em CNPJ dual). */
  contexto: {
    modo: 'manual' | 'cnpj';
    anexoSelecionado: AnexoSimplesId;
    anexosElegiveis: AnexoSimplesId[];
    mostrarMatrizIIIV: boolean;
    mostrarFatorR: boolean;
  };
  /** Memória de cálculo do híbrido por anexo. */
  memoriaHibrido: Record<AnexoSimplesId, MemoriaHibrido>;
  /** Duelo do anexo em foco (usado quando NÃO há matriz III×V). */
  dueloFoco: DueloFoco;
  comparativo: {
    /** Menor carga entre os 4 cenários de serviço (III/V × Conv/Híb) — veredito principal. */
    menorCargaScenarioId: ScenarioId | null;
    /** Menor carga entre os 10 cenários (informativo; pode ser de outro anexo inelegível). */
    menorGeralScenarioId: ScenarioId | null;
    matrizDeltas: DeltaComparativo[];
    tabelaOutrosAnexos: LinhaOutroAnexo[];
  };
  metodologia: {
    formulas: string[];
    fontes: string[];
    aviso: string;
  };
  hash: string;
}

/* --------------------------------- helpers -------------------------------- */

export function calcularFatorRDetalhado(folha12: number, rbt12: number): FatorRDetalhado {
  const folha = Number(folha12) || 0;
  const rbt = Number(rbt12) || 0;
  const dadosSuficientes = rbt > 0 && folha > 0;
  const valor = rbt > 0 ? folha / rbt : 0;
  const folhaMinima = round2(FATOR_R_LIMIAR * rbt);
  const gap = dadosSuficientes ? Math.max(0, round2(folhaMinima - folha)) : 0;
  return {
    folha12: round2(folha),
    rbt12: round2(rbt),
    valor: dadosSuficientes ? valor : 0,
    threshold: FATOR_R_LIMIAR,
    enquadrado: dadosSuficientes && valor >= FATOR_R_LIMIAR,
    dadosSuficientes,
    folhaMinimaIII: folhaMinima,
    gapFolha: gap,
    gapMensalProlabore: gap > 0 ? round2(gap / 12) : 0,
    formulaId: FORMULA_FATOR_R,
  };
}

/** Paridade com `store.ts:fatorDespesa` (aluguel = 30% da alíquota). */
export function fatorCreditoDespesa(rotulo: string, regra: RegraCreditoCBS): number {
  if (/aluguel/i.test(rotulo ?? '')) return 0.3;
  if (regra === 'integral') return 1;
  if (regra === 'red30') return 0.7;
  if (regra === 'red60') return 0.4;
  return 0;
}

export function totalCreditosDespesas(despesas: DespesaAnalitica[], cbsRef: number): number {
  const total = (despesas ?? []).reduce(
    (acc, d) => acc + (Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorCreditoDespesa(d.rotulo, d.regra),
    0,
  );
  return round2(total);
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function hashRelatorio(report: Omit<ReportAnalitico, 'hash' | 'reportId' | 'geradoEm'>): string {
  return fnv1a(JSON.stringify([report.premissas, report.fatorR, report.cenarios, report.comparativo, report.contexto, report.dueloFoco, report.memoriaHibrido]));
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function montarCenario(
  conv: ResultadoConvencional,
  hib: { dasReduzido: number; cbsFora: number; saldoCredor: number; total: number } | null,
  debitos: number,
  creditos: number,
  scenarioId: ScenarioId,
  regime: RegimeCenario,
): CenarioAnalitico {
  const anexo = ANEXOS_SIMPLES[conv.anexoId];
  const faixa = anexo.faixas.find((f) => f.faixa === conv.faixa);
  // Duelo na MESMA base: a guia DAS (sem ICMS/ISS/IBS do sublimite).
  // O fora é igual nos dois regimes e aparece à parte (foraSublimite).
  const guiaConv = conv.dasGuia ?? conv.das;
  const totalPagar = regime === 'CONVENCIONAL' ? guiaConv : (hib?.total ?? guiaConv);
  return {
    scenarioId,
    anexo: conv.anexoId,
    regime,
    faixa: conv.faixa,
    aliquotaNominal: faixa?.aliquotaNominal ?? 0,
    parcelaDeduzir: faixa?.parcelaDeduzir ?? 0,
    aliquotaEfetiva: conv.aliquotaEfetiva,
    dasTotal: regime === 'CONVENCIONAL' ? guiaConv : null,
    cbsDentroDas: conv.cbsDentroDAS,
    dasReduzidoSemCbs: regime === 'HIBRIDO' ? (hib?.dasReduzido ?? null) : null,
    debitosCbs: regime === 'HIBRIDO' ? round2(debitos) : null,
    creditosCbs: regime === 'HIBRIDO' ? round2(creditos) : null,
    cbsARecolher: regime === 'HIBRIDO' ? (hib?.cbsFora ?? null) : null,
    saldoCredor: regime === 'HIBRIDO' ? (hib?.saldoCredor ?? null) : null,
    totalPagar,
    cenarioSublimite: conv.cenario,
    regraDas: REGRA_DAS_LABEL[conv.cenario] ?? `Cenário ${conv.cenario}`,
    dasGuia: conv.dasGuia ?? conv.das,
    foraSublimite: conv.foraSublimite?.total ?? 0,
    excedeSublimite: conv.excedeSublimite ?? false,
  };
}

/* ------------------------------ orquestrador ------------------------------ */

/**
 * Executa os cenários determinísticos com os MESMOS inputs. Não chama IA, não acessa rede.
 *
 * Regra de exibição (produto):
 * - Matriz III×V SOMENTE quando `contexto.modo === 'cnpj'` E os anexos elegíveis
 *   do CNAE contêm III e V. Caso contrário, o relatório mostra apenas o duelo
 *   Convencional × Híbrido do `anexoSelecionado`.
 * Os 10 cenários continuam calculados (auditoria), mas a UI/PDF condiciona a exibição.
 */
export function orquestrarRelatorio(input: RelatorioInput): ReportAnalitico {
  const rbt12 = Number(input.rbt12) || 0;
  const receitaMes = Number(input.receitaMes) || 0;
  const rba = Number(input.rba) || 0;
  const folha12 = Number(input.folha12) || 0;
  const cbsRef = Number(input.cbsRef) || 0;

  const ANEXOS_VALIDOS: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];
  const elegiveis = (input.contexto?.anexosElegiveis ?? []).filter((a): a is AnexoSimplesId =>
    (ANEXOS_VALIDOS as string[]).includes(a),
  );
  const modo = input.contexto?.modo ?? 'manual';
  const foco: AnexoSimplesId = (ANEXOS_VALIDOS as string[]).includes(input.contexto?.anexoSelecionado)
    ? input.contexto.anexoSelecionado
    : 'I';
  const elegiveisEfetivos = elegiveis.length > 0 ? [...new Set(elegiveis)] : [foco];
  const mostrarMatrizIIIV = modo === 'cnpj' && elegiveisEfetivos.includes('III') && elegiveisEfetivos.includes('V');
  // Fator R SÓ quando o Anexo V está envolvido (espelha `envolveAnexoV` do motor:
  // o cálculo só aplica o Fator R nesse caso). Anexo III puro já é III e nunca
  // precisa do Fator R; I, II e IV tampouco.
  const mostrarFatorR = elegiveisEfetivos.includes('V') || foco === 'V';

  const fatorR = calcularFatorRDetalhado(folha12, rbt12);
  const debitos = debitoCBS(receitaMes, 'cheia', cbsRef);
  const creditos = totalCreditosDespesas(input.despesas, cbsRef);

  const convPorAnexo = new Map<AnexoSimplesId, ResultadoConvencional>();
  const anexos: AnexoSimplesId[] = ['I', 'II', 'III', 'IV', 'V'];
  for (const a of anexos) {
    convPorAnexo.set(a, calcularConvencional({ anexoId: a, rbt12, receitaMes, rba, aliqRefICMS: input.aliqRefICMS, aliqRefISS: input.aliqRefISS }));
  }

  const pares: { anexo: AnexoSimplesId; convId: ScenarioId; hibId: ScenarioId }[] = [
    { anexo: 'III', convId: 'III_CONV', hibId: 'III_HIB' },
    { anexo: 'V', convId: 'V_CONV', hibId: 'V_HIB' },
    { anexo: 'I', convId: 'I_CONV', hibId: 'I_HIB' },
    { anexo: 'II', convId: 'II_CONV', hibId: 'II_HIB' },
    { anexo: 'IV', convId: 'IV_CONV', hibId: 'IV_HIB' },
  ];

  const cenarios: CenarioAnalitico[] = [];
  for (const p of pares) {
    const conv = convPorAnexo.get(p.anexo)!;
    const hibCalc = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos });
    cenarios.push(montarCenario(conv, hibCalc, debitos, creditos, p.convId, 'CONVENCIONAL'));
    cenarios.push(montarCenario(conv, hibCalc, debitos, creditos, p.hibId, 'HIBRIDO'));
  }

  const porId = new Map(cenarios.map((c) => [c.scenarioId, c]));
  const get = (id: ScenarioId): CenarioAnalitico => porId.get(id)!;

  // Memória de cálculo do híbrido por anexo (passo a passo demonstrável).
  const memoriaHibrido = {} as Record<AnexoSimplesId, MemoriaHibrido>;
  for (const a of anexos) {
    const conv = convPorAnexo.get(a)!;
    const hibCalc = calcularHibrido({ convencional: conv, debitosCBS: debitos, creditosCBS: creditos });
    const porDespesa = (input.despesas ?? []).map((d) => {
      const fator = fatorCreditoDespesa(d.rotulo, d.regra);
      return {
        rotulo: d.rotulo,
        valor: round2(Number(d.valor) || 0),
        fator,
        credito: round2((Number(d.valor) || 0) * cbsRef * fator),
      };
    });
    memoriaHibrido[a] = {
      anexo: a,
      dasTotal: conv.dasGuia ?? conv.das,
      cbsDentroDas: conv.cbsDentroDAS,
      dasReduzido: hibCalc.dasReduzido,
      debitosCbs: round2(debitos),
      creditosPorDespesa: porDespesa,
      creditosCbs: round2(creditos),
      cbsARecolher: hibCalc.cbsFora,
      saldoCredor: hibCalc.saldoCredor,
      totalHibrido: hibCalc.total,
    };
  }

  // Duelo do anexo em foco (modo sem matriz): Conv × Hib desse anexo.
  const focoConvId = `${foco}_CONV` as ScenarioId;
  const focoHibId = `${foco}_HIB` as ScenarioId;
  const focoConv = get(focoConvId);
  const focoHib = get(focoHibId);
  const deltaFoco = round2(focoHib.totalPagar - focoConv.totalPagar);
  const dueloFoco: DueloFoco = {
    anexo: foco,
    convId: focoConvId,
    hibId: focoHibId,
    convTotal: focoConv.totalPagar,
    hibTotal: focoHib.totalPagar,
    deltaRs: deltaFoco,
    vencedor: Math.abs(deltaFoco) <= 0.005 ? 'EMPATE' : deltaFoco > 0 ? 'CONV' : 'HIB',
    aliquotaEfetivaConv: focoConv.aliquotaEfetiva,
    cbsDentroDas: focoConv.cbsDentroDas ?? 0,
    cbsFora: focoHib.cbsARecolher ?? 0,
  };

  // Veredito principal:
  // - COM matriz (CNPJ dual III/V): menor entre os 4 cenários de serviço.
  // - SEM matriz: duelo do anexo em foco (Conv × Hib).
  // `menorGeral` (10 cenários) segue apenas como referência informativa.
  const quorum: ScenarioId[] = mostrarMatrizIIIV
    ? ['III_CONV', 'V_CONV', 'III_HIB', 'V_HIB']
    : [focoConvId, focoHibId];
  let menor: ScenarioId | null = null;
  let menorValor = Number.POSITIVE_INFINITY;
  let menorGeral: ScenarioId | null = null;
  let menorGeralValor = Number.POSITIVE_INFINITY;
  const temBase = receitaMes > 0 && rbt12 > 0;
  if (temBase) {
    for (const id of quorum) {
      const c = get(id);
      if (c.totalPagar < menorValor) {
        menorValor = c.totalPagar;
        menor = id;
      }
    }
    for (const c of cenarios) {
      if (c.totalPagar < menorGeralValor) {
        menorGeralValor = c.totalPagar;
        menorGeral = c.scenarioId;
      }
    }
  }
  if (menor) {
    const alvo = porId.get(menor);
    if (alvo) alvo.vencedor = true;
  }

  const delta = (de: ScenarioId, para: ScenarioId): DeltaComparativo => {
    const a = get(de);
    const b = get(para);
    const deltaRs = round2(b.totalPagar - a.totalPagar);
    const deltaPp = a.aliquotaEfetiva != null && b.aliquotaEfetiva != null
      ? round2((b.aliquotaEfetiva - a.aliquotaEfetiva) * 100)
      : null;
    // deltaPct relativo ao total "de" (negativo = economia ao migrar).
    const deltaPct = a.totalPagar > 0 ? round2((deltaRs / a.totalPagar) * 100) : null;
    return { de, para, deltaRs, deltaPp, deltaPct };
  };

  const matrizDeltas: DeltaComparativo[] = [
    delta('V_CONV', 'III_CONV'),
    delta('V_HIB', 'III_HIB'),
    delta('III_CONV', 'III_HIB'),
    delta('V_CONV', 'V_HIB'),
  ];

  const tabelaOutrosAnexos: LinhaOutroAnexo[] = (['I', 'II', 'IV'] as AnexoSimplesId[]).map((a) => {
    const convId = `${a}_CONV` as ScenarioId;
    const hibId = `${a}_HIB` as ScenarioId;
    const c = get(convId);
    const h = get(hibId);
    const dRs = round2(h.totalPagar - c.totalPagar);
    return {
      anexo: a,
      convTotal: c.totalPagar,
      hibTotal: h.totalPagar,
      deltaRs: dRs,
      vencedor: Math.abs(dRs) <= 0.005 ? 'EMPATE' : dRs > 0 ? 'CONV' : 'HIB',
      aliquotaEfetivaConv: c.aliquotaEfetiva,
      cbsDentroDas: c.cbsDentroDas ?? 0,
      cbsFora: h.cbsARecolher ?? 0,
    };
  });

  const excedeRbt = rbt12 > 3_600_000;
  const excedeRba = rba > 3_600_000;
  const cenarioRef = convPorAnexo.get('III')?.cenario ?? 1;

  const base: Omit<ReportAnalitico, 'hash' | 'reportId' | 'geradoEm'> = {
    motorVersao: MOTOR_VERSAO,
    empresa: {
      ...input.empresa,
      cnaesSecundarios: input.empresa.cnaesSecundarios ?? [],
    },
    competencia: input.competencia,
    premissas: {
      rbt12: round2(rbt12),
      rba: round2(rba),
      receitaMes: round2(receitaMes),
      folha12: round2(folha12),
      cbsRef,
      sublimiteAnual: 3_600_000,
      excedeSublimiteRbt12: excedeRbt,
      excedeSublimiteRba: excedeRba,
      guiaSemFora: (convPorAnexo.get('III')?.excedeSublimite ?? false) || excedeRbt || excedeRba,
      regraDas: REGRA_DAS_LABEL[cenarioRef] ?? `Cenário ${cenarioRef}`,
    },
    fatorR,
    cenarios,
    contexto: {
      modo,
      anexoSelecionado: foco,
      anexosElegiveis: elegiveisEfetivos,
      mostrarMatrizIIIV,
      mostrarFatorR,
    },
    memoriaHibrido,
    dueloFoco,
    comparativo: { menorCargaScenarioId: menor, menorGeralScenarioId: menorGeral, matrizDeltas, tabelaOutrosAnexos },
    metodologia: {
      formulas: [
        'ALIQUOTA_EFETIVA=(RBT12×alíquota nominal−parcela a deduzir)/RBT12',
        'FATOR_R=Folha12/RBT12 (threshold 28%)',
        'GAP_FOLHA=max(0; 0,28×RBT12−Folha12)',
        'DAS_REDUZIDO=DAS−CBS dentro do DAS',
        'CBS_FORA=max(0; débitos CBS−créditos CBS DRE)',
      ],
      fontes: ['LC 123/2006 Art. 18', 'LC 214/2025 Arts. 28–45', 'Tabelas Anexos I–V (vigência 2027–2028)'],
      aviso: 'Valores calculados pelo motor determinístico. A IA atua em modo leitura e não altera valores.',
    },
  };

  return {
    ...base,
    reportId: uuid(),
    geradoEm: new Date().toISOString(),
    hash: hashRelatorio(base),
  };
}

/** Todos os números citáveis pela IA (para o validador anti-alucinação). */
export function coletarNumerosPermitidos(report: ReportAnalitico): number[] {
  const nums: number[] = [];
  const push = (v: unknown): void => {
    const n = Number(v);
    if (Number.isFinite(n)) nums.push(n);
  };
  push(report.premissas.rbt12);
  push(report.premissas.rba);
  push(report.premissas.receitaMes);
  push(report.premissas.folha12);
  push(report.premissas.cbsRef);
  push(report.fatorR.valor);
  push(report.fatorR.valor * 100);
  push(report.fatorR.threshold);
  push(report.fatorR.threshold * 100);
  push(report.fatorR.folhaMinimaIII);
  push(report.fatorR.gapFolha);
  push(report.fatorR.gapMensalProlabore);
  for (const c of report.cenarios) {
    push(c.aliquotaEfetiva);
    push(c.aliquotaEfetiva * 100);
    push(c.aliquotaNominal);
    push(c.aliquotaNominal * 100);
    push(c.parcelaDeduzir);
    push(c.totalPagar);
    push(c.dasGuia);
    push(c.foraSublimite);
    if (c.dasTotal != null) push(c.dasTotal);
    if (c.cbsDentroDas != null) push(c.cbsDentroDas);
    if (c.dasReduzidoSemCbs != null) push(c.dasReduzidoSemCbs);
    if (c.debitosCbs != null) push(c.debitosCbs);
    if (c.creditosCbs != null) push(c.creditosCbs);
    if (c.cbsARecolher != null) push(c.cbsARecolher);
    if (c.saldoCredor != null) push(c.saldoCredor);
  }
  for (const d of report.comparativo.matrizDeltas) {
    push(d.deltaRs);
    push(Math.abs(d.deltaRs));
    if (d.deltaPp != null) { push(d.deltaPp); push(Math.abs(d.deltaPp)); }
    if (d.deltaPct != null) { push(d.deltaPct); push(Math.abs(d.deltaPct)); }
  }
  for (const l of report.comparativo.tabelaOutrosAnexos) {
    push(l.convTotal);
    push(l.hibTotal);
    push(l.deltaRs);
    push(Math.abs(l.deltaRs));
    push(l.aliquotaEfetivaConv);
    push(l.aliquotaEfetivaConv * 100);
    push(l.cbsDentroDas);
    push(l.cbsFora);
  }
  push(report.dueloFoco.convTotal);
  push(report.dueloFoco.hibTotal);
  push(report.dueloFoco.deltaRs);
  push(Math.abs(report.dueloFoco.deltaRs));
  for (const a of Object.values(report.memoriaHibrido)) {
    push(a.dasTotal);
    push(a.cbsDentroDas);
    push(a.dasReduzido);
    push(a.debitosCbs);
    push(a.creditosCbs);
    push(a.cbsARecolher);
    push(a.totalHibrido);
    push(a.saldoCredor);
    for (const d of a.creditosPorDespesa) {
      push(d.valor);
      push(d.credito);
    }
  }
  return nums;
}
