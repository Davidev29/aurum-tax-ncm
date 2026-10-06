/**
 * Simples Projection — custo pessoa física do pró-labore (módulo PURO).
 *
 * Fontes oficiais (vigência jan/2026):
 * - IRPF mensal: tabela da Receita Federal (Lei nº 15.191/2025) +
 *   redução mensal da Lei nº 15.270/2025 (isenção até R$ 5.000, redução
 *   linear até R$ 7.350). Exemplos oficiais validados em
 *   `receita.fazenda — exemplos de aplicação da Lei 15.270/2025`.
 * - INSS do contribuinte individual/pró-labore: 11% sobre a remuneração,
 *   respeitado o teto do RGPS. Teto default = R$ 8.157,41 (Portaria
 *   Interministerial MPS/MF nº 13/2025, ref. 2025 — atualizar quando a
 *   portaria de 2026 for publicada; a constante é parametrizável).
 *
 * Algoritmo do IRPF (conforme exemplos oficiais):
 * 1. base = rendimentos − max(INSS, desconto simplificado R$ 607,20)
 *    (a fonte pagadora usa o mais vantajoso ao contribuinte);
 * 2. impostoTabela pela faixa da base;
 * 3. redução pela faixa dos RENDIMENTOS (bruto, não a base):
 *    ≤ R$ 5.000 → min(imposto, 312,89) — zera;
 *    R$ 5.000,01–7.350 → max(0, 978,62 − 0,133145 × rendimentos);
 *    ≥ R$ 7.350 → sem redução.
 *
 * PURA: sem I/O, sem rede, sem banco.
 */

export interface FaixaIRPFMensal {
  limite: number;
  aliquota: number;
  deducao: number;
}

/** Tabela mensal 2026 — Lei nº 15.191/2025 (Receita Federal). */
export const TABELA_IRPF_MENSAL_2026: FaixaIRPFMensal[] = [
  { limite: 2428.8, aliquota: 0, deducao: 0 },
  { limite: 2826.65, aliquota: 0.075, deducao: 182.16 },
  { limite: 3751.05, aliquota: 0.15, deducao: 394.16 },
  { limite: 4664.68, aliquota: 0.225, deducao: 675.49 },
  { limite: Number.POSITIVE_INFINITY, aliquota: 0.275, deducao: 908.73 },
];

/** 25% do limite da 1ª faixa — substitui todas as deduções legais quando maior. */
export const DESCONTO_SIMPLIFICADO_MENSAL_2026 = 607.2;

/** Redução mensal — Lei nº 15.270/2025. */
export const REDUCAO_IRPF = {
  limiteIsencao: 5000,
  limiteFim: 7350,
  tetoFaixa1: 312.89,
  baseFaixa2: 978.62,
  fatorFaixa2: 0.133145,
} as const;

/** Teto do RGPS, ref. 2025 (Portaria Interministerial MPS/MF nº 13/2025). */
export const TETO_INSS_MENSAL_REF_2025 = 8157.41;

/** Piso do pró-labore = 1 salário-mínimo (ref. 2025: R$ 1.518). */
export const SALARIO_MINIMO_REF_2025 = 1518;

/** Alíquota do contribuinte individual sobre o pró-labore. */
export const ALIQUOTA_INSS_PRO_LABORE = 0.11;

export const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

export interface OpcoesINSS {
  /** Teto mensal do RGPS (default: ref. 2025 — atualizar p/ portaria 2026). */
  teto?: number;
}

export interface ResultadoINSS {
  bruto: number;
  /** Base efetivamente tributada (travada no teto). */
  baseTributada: number;
  inss: number;
  /** true quando o teto limitou a base (contribuição não cresce acima disso). */
  tetoAplicado: boolean;
}

/** INSS do pró-labore: 11% sobre o bruto, travado no teto do RGPS. */
export function calcularINSSProLabore(brutoMensal: number, opts: OpcoesINSS = {}): ResultadoINSS {
  const bruto = Math.max(0, Number(brutoMensal) || 0);
  const teto = opts.teto ?? TETO_INSS_MENSAL_REF_2025;
  const baseTributada = Math.min(bruto, teto);
  return {
    bruto: round2(bruto),
    baseTributada: round2(baseTributada),
    inss: round2(baseTributada * ALIQUOTA_INSS_PRO_LABORE),
    tetoAplicado: bruto > teto,
  };
}

export interface OpcoesIRPF {
  /** INSS já descontado (dedução legal). Default 0. */
  inss?: number;
  /** Usa o desconto simplificado quando maior que o INSS. Default true. */
  usarSimplificado?: boolean;
}

export interface ResultadoIRPF {
  rendimentos: number;
  deducaoAplicada: number;
  baseCalculo: number;
  impostoTabela: number;
  reducao: number;
  /** Imposto final (nunca negativo). */
  irpf: number;
  /** true quando a redução da Lei 15.270 zerou ou reduziu o imposto. */
  comReducaoLei15270: boolean;
}

/**
 * IRPF mensal 2026 sobre rendimentos do trabalho (pró-labore).
 * Segue os exemplos oficiais da Receita (base × alíquota − dedução,
 * redução sobre os rendimentos brutos).
 */
export function calcularIRPFMensal2026(rendimentosMensais: number, opts: OpcoesIRPF = {}): ResultadoIRPF {
  const rendimentos = Math.max(0, Number(rendimentosMensais) || 0);
  const inss = Math.max(0, Number(opts.inss) || 0);
  const simplificado = opts.usarSimplificado ?? true;
  const deducaoAplicada = simplificado
    ? Math.max(inss, DESCONTO_SIMPLIFICADO_MENSAL_2026)
    : inss;
  const baseCalculo = Math.max(0, rendimentos - deducaoAplicada);

  let impostoTabela = 0;
  if (baseCalculo > 0) {
    const faixa = TABELA_IRPF_MENSAL_2026.find((f) => baseCalculo <= f.limite)!;
    impostoTabela = Math.max(0, baseCalculo * faixa.aliquota - faixa.deducao);
  }
  impostoTabela = round2(impostoTabela);

  let reducao = 0;
  if (impostoTabela > 0 && rendimentos <= REDUCAO_IRPF.limiteIsencao) {
    reducao = Math.min(impostoTabela, REDUCAO_IRPF.tetoFaixa1);
  } else if (impostoTabela > 0 && rendimentos < REDUCAO_IRPF.limiteFim) {
    reducao = Math.max(0, REDUCAO_IRPF.baseFaixa2 - REDUCAO_IRPF.fatorFaixa2 * rendimentos);
    reducao = round2(Math.min(reducao, impostoTabela));
  }

  const irpf = round2(Math.max(0, impostoTabela - reducao));
  return {
    rendimentos: round2(rendimentos),
    deducaoAplicada: round2(deducaoAplicada),
    baseCalculo: round2(baseCalculo),
    impostoTabela,
    reducao: round2(reducao),
    irpf,
    comReducaoLei15270: reducao > 0,
  };
}

export interface OpcoesCustoProLabore extends OpcoesINSS, OpcoesIRPF {
  /** Quando há Anexo IV envolvido, a CPP patronal (20%) é devida por fora do DAS. */
  envolveAnexoIV?: boolean;
  /** Alíquota patronal por fora no Anexo IV (default 20%). */
  aliquotaPatronalAnexoIV?: number;
}

export interface CustoProLabore {
  bruto: number;
  inss: number;
  baseIRPF: number;
  irpf: number;
  /** Líquido que cai na pessoa física (bruto − INSS − IRPF). */
  liquido: number;
  /** Soma dos descontos da pessoa física (INSS + IRPF). */
  descontosPF: number;
  /** CPP patronal por fora (só quando Anexo IV; 0 nos demais). */
  cppPatronalPorFora: number;
  /** Custo total da decisão (descontos PF + CPP por fora, se houver). */
  custoTotal: number;
  tetoINSSAplicado: boolean;
  abaixoDoMinimo: boolean;
}

/**
 * Custo pessoa física de um pró-labore mensal: INSS 11% + IRPF 2026.
 * Estimativa sobre o valor isolado — se o sócio já tem outros rendimentos,
 * a alíquota marginal do IRPF pode ser maior (sinalizado na UI).
 */
export function calcularCustoProLabore(brutoMensal: number, opts: OpcoesCustoProLabore = {}): CustoProLabore {
  const bruto = Math.max(0, Number(brutoMensal) || 0);
  const { inss, tetoAplicado } = calcularINSSProLabore(bruto, { teto: opts.teto });
  const r = calcularIRPFMensal2026(bruto, { inss, usarSimplificado: opts.usarSimplificado });
  const cppPatronalPorFora =
    opts.envolveAnexoIV === true ? round2(bruto * (opts.aliquotaPatronalAnexoIV ?? 0.2)) : 0;
  const descontosPF = round2(inss + r.irpf);
  return {
    bruto: round2(bruto),
    inss,
    baseIRPF: r.baseCalculo,
    irpf: r.irpf,
    liquido: round2(bruto - descontosPF),
    descontosPF,
    cppPatronalPorFora,
    custoTotal: round2(descontosPF + cppPatronalPorFora),
    tetoINSSAplicado: tetoAplicado,
    abaixoDoMinimo: bruto > 0 && bruto < SALARIO_MINIMO_REF_2025,
  };
}
