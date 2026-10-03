/**
 * Simples Nacional — tabelas oficiais (módulo isolado).
 *
 * Fonte: `Tabela Simples Nacional REFORMA TRIBUTARIA.xlsx` (abas ANEXO I–V)
 * + `PLANILHA DO SIMPLES NACIONAL.xlsx` (Base_Dados, Dashboard).
 * Vigência: 2027–2028. A partir de 2029 as porcentagens mudam.
 *
 * Isolamento: este módulo NÃO importa `@/store/calculadora` nem
 * `@/domain/services/calculo` (motor IBS/CBS da LC 214). Matemática própria.
 */

export type AnexoSimplesId = 'I' | 'II' | 'III' | 'IV' | 'V';

export type TributoSimples =
  | 'IRPJ'
  | 'CSLL'
  | 'CBS'
  | 'IBS'
  | 'CPP'
  | 'ICMS'
  | 'IPI'
  | 'ISS';

export interface FaixaSimples {
  faixa: number;
  limInf: number;
  limSup: number;
  aliquotaNominal: number;
  parcelaDeduzir: number;
  /** Percentuais de repartição (soma = 1). Ausente = 0. */
  reparticao: Partial<Record<TributoSimples, number>>;
}

export interface AnexoSimples {
  id: AnexoSimplesId;
  nome: string;
  faixas: FaixaSimples[];
  /** Aplica trava de ISS 5%? (III, IV, V) */
  aplicaExcedenteISS: boolean;
  limiteISSEfetivo: number;
  /** Redistribuição do excedente de ISS (soma = 1). */
  redistribuicaoISS: Partial<Record<'IRPJ' | 'CSLL' | 'CBS' | 'CPP', number>>;
}

export const SUBLIMITE = 3_600_000;
export const RBT12_MAX = 4_800_000;
export const FATOR_R_LIMIAR = 0.28;
export const CBS_REF_PADRAO = 0.088;
export const ISS_TETO = 0.05;

const R = (
  faixa: number,
  limInf: number,
  limSup: number,
  aliquotaNominal: number,
  parcelaDeduzir: number,
  reparticao: Partial<Record<TributoSimples, number>>,
): FaixaSimples => ({ faixa, limInf, limSup, aliquotaNominal, parcelaDeduzir, reparticao });

export const ANEXOS_SIMPLES: Record<AnexoSimplesId, AnexoSimples> = {
  I: {
    id: 'I',
    nome: 'Comércio',
    aplicaExcedenteISS: false,
    limiteISSEfetivo: 0,
    redistribuicaoISS: {},
    faixas: [
      R(1, 0, 180000, 0.04, 0, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1533, IBS: 0.0017, CPP: 0.415, ICMS: 0.34 }),
      R(2, 180000.01, 360000, 0.073, 5940, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1533, IBS: 0.0017, CPP: 0.415, ICMS: 0.34 }),
      R(3, 360000.01, 720000, 0.095, 13860, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1533, IBS: 0.0017, CPP: 0.42, ICMS: 0.335 }),
      R(4, 720000.01, 1800000, 0.107, 22500, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1533, IBS: 0.0017, CPP: 0.42, ICMS: 0.335 }),
      R(5, 1800000.01, 3600000, 0.143, 87300, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1533, IBS: 0.0017, CPP: 0.42, ICMS: 0.335 }),
      R(6, 3600000.01, 4800000, 0.189, 378000, { IRPJ: 0.1358, CSLL: 0.1006, CBS: 0.3402, CPP: 0.4234 }),
    ],
  },
  II: {
    id: 'II',
    nome: 'Indústria',
    aplicaExcedenteISS: false,
    limiteISSEfetivo: 0,
    redistribuicaoISS: {},
    faixas: [
      R(1, 0, 180000, 0.045, 0, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1385, IBS: 0.0015, CPP: 0.375, IPI: 0.075, ICMS: 0.32 }),
      R(2, 180000.01, 360000, 0.078, 5940, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1385, IBS: 0.0015, CPP: 0.375, IPI: 0.075, ICMS: 0.32 }),
      R(3, 360000.01, 720000, 0.1, 13860, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1385, IBS: 0.0015, CPP: 0.375, IPI: 0.075, ICMS: 0.32 }),
      R(4, 720000.01, 1800000, 0.112, 22500, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1385, IBS: 0.0015, CPP: 0.375, IPI: 0.075, ICMS: 0.32 }),
      R(5, 1800000.01, 3600000, 0.147, 85500, { IRPJ: 0.055, CSLL: 0.035, CBS: 0.1385, IBS: 0.0015, CPP: 0.375, IPI: 0.075, ICMS: 0.32 }),
      R(6, 3600000.01, 4800000, 0.299, 720000, { IRPJ: 0.0853, CSLL: 0.0753, CBS: 0.2522, CPP: 0.2359, IPI: 0.3513 }),
    ],
  },
  III: {
    id: 'III',
    nome: 'Serviços (ISS)',
    aplicaExcedenteISS: true,
    limiteISSEfetivo: 0.05,
    redistribuicaoISS: { IRPJ: 0.0602, CSLL: 0.0526, CBS: 0.2346, CPP: 0.6526 },
    faixas: [
      R(1, 0, 180000, 0.06, 0, { IRPJ: 0.04, CSLL: 0.035, CBS: 0.1543, IBS: 0.0017, CPP: 0.434, ISS: 0.335 }),
      R(2, 180000.01, 360000, 0.112, 9360, { IRPJ: 0.04, CSLL: 0.035, CBS: 0.1691, IBS: 0.0019, CPP: 0.434, ISS: 0.32 }),
      R(3, 360000.01, 720000, 0.135, 17640, { IRPJ: 0.04, CSLL: 0.035, CBS: 0.1641, IBS: 0.0019, CPP: 0.434, ISS: 0.325 }),
      R(4, 720000.01, 1800000, 0.16, 35640, { IRPJ: 0.04, CSLL: 0.035, CBS: 0.1641, IBS: 0.0019, CPP: 0.434, ISS: 0.325 }),
      R(5, 1800000.01, 3600000, 0.21, 125640, { IRPJ: 0.04, CSLL: 0.035, CBS: 0.1543, IBS: 0.0017, CPP: 0.434, ISS: 0.335 }),
      R(6, 3600000.01, 4800000, 0.329, 648000, { IRPJ: 0.3509, CSLL: 0.1504, CBS: 0.1929, CPP: 0.3058 }),
    ],
  },
  IV: {
    id: 'IV',
    nome: 'Serviços (sem CPP)',
    aplicaExcedenteISS: true,
    limiteISSEfetivo: 0.05,
    redistribuicaoISS: { IRPJ: 0.3133, CSLL: 0.32, CBS: 0.3667, CPP: 0 },
    faixas: [
      R(1, 0, 180000, 0.045, 0, { IRPJ: 0.188, CSLL: 0.152, CBS: 0.2126, IBS: 0.0024, ISS: 0.445 }),
      R(2, 180000.01, 360000, 0.09, 8100, { IRPJ: 0.198, CSLL: 0.152, CBS: 0.2473, IBS: 0.0027, ISS: 0.4 }),
      R(3, 360000.01, 720000, 0.102, 12420, { IRPJ: 0.208, CSLL: 0.152, CBS: 0.2374, IBS: 0.0026, ISS: 0.4 }),
      R(4, 720000.01, 1800000, 0.14, 39780, { IRPJ: 0.178, CSLL: 0.192, CBS: 0.2275, IBS: 0.0025, ISS: 0.4 }),
      R(5, 1800000.01, 3600000, 0.22, 183780, { IRPJ: 0.188, CSLL: 0.192, CBS: 0.2176, IBS: 0.0024, ISS: 0.4 }),
      R(6, 3600000.01, 4800000, 0.329, 828000, { IRPJ: 0.5371, CSLL: 0.2159, CBS: 0.247 }),
    ],
  },
  V: {
    id: 'V',
    nome: 'Serviços (Fator R)',
    aplicaExcedenteISS: true,
    limiteISSEfetivo: 0.05,
    redistribuicaoISS: { IRPJ: 0.3007, CSLL: 0.1634, CBS: 0.2242, CPP: 0.3117 },
    faixas: [
      R(1, 0, 180000, 0.155, 0, { IRPJ: 0.25, CSLL: 0.15, CBS: 0.1696, IBS: 0.0019, CPP: 0.2885, ISS: 0.14 }),
      R(2, 180000.01, 360000, 0.18, 4500, { IRPJ: 0.23, CSLL: 0.15, CBS: 0.1696, IBS: 0.0019, CPP: 0.2785, ISS: 0.17 }),
      R(3, 360000.01, 720000, 0.195, 9900, { IRPJ: 0.24, CSLL: 0.15, CBS: 0.1795, IBS: 0.002, CPP: 0.2385, ISS: 0.19 }),
      R(4, 720000.01, 1800000, 0.205, 17100, { IRPJ: 0.21, CSLL: 0.15, CBS: 0.1894, IBS: 0.0021, CPP: 0.2385, ISS: 0.21 }),
      R(5, 1800000.01, 3600000, 0.23, 62100, { IRPJ: 0.23, CSLL: 0.125, CBS: 0.1696, IBS: 0.0019, CPP: 0.2385, ISS: 0.235 }),
      R(6, 3600000.01, 4800000, 0.304, 540000, { IRPJ: 0.351, CSLL: 0.1554, CBS: 0.1978, CPP: 0.2958 }),
    ],
  },
};

export const ANEXO_LABEL: Record<AnexoSimplesId, string> = {
  I: 'Anexo I — Comércio',
  II: 'Anexo II — Indústria',
  III: 'Anexo III — Serviços',
  IV: 'Anexo IV — Serviços (sem CPP)',
  V: 'Anexo V — Serviços (Fator R)',
};

/** Tributo que usa a 5ª faixa na 6ª faixa, por anexo. */
export const TRIBUTO_SUBLIMITE_6A_FAIXA: Record<AnexoSimplesId, TributoSimples[]> = {
  I: ['ICMS', 'IBS'],
  II: ['ICMS', 'IBS', 'IPI'],
  III: ['ISS', 'IBS'],
  IV: ['ISS', 'IBS'],
  V: ['ISS', 'IBS'],
};
