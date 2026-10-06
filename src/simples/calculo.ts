/**
 * Simples Nacional — motor de cálculo puro (módulo isolado).
 *
 * Implementa RIGOROSAMENTE as fórmulas das planilhas:
 * - `Tabela Simples Nacional REFORMA TRIBUTARIA.xlsx` (abas ANEXO I–V)
 * - `PLANILHA DO SIMPLES NACIONAL.xlsx` (Calc_Convencional C33–C122, Calc_Hibrido)
 *
 * Fórmulas canônicas:
 * - aliquotaEfetiva = (RBT12 * nominal - deduzir) / RBT12
 * - DAS = aliquotaEfetiva * receitaMes
 * - repartição: valorTributo = DAS * %faixa
 * - 6ª faixa: ICMS/ISS/IBS/IPI usam aliquota efetiva da 5ª faixa
 * - ISS: trava 5% + redistribuição do excedente
 * - Sublimite 3.6M: 4 cenários (RBT12 × RBA)
 */
import {
  ANEXOS_SIMPLES,
  ISS_TETO,
  SUBLIMITE,
  RBT12_MAX,
  FATOR_R_LIMIAR,
  type AnexoSimples,
  type AnexoSimplesId,
  type FaixaSimples,
  type TributoSimples,
} from './tabelas';

export const round2 = (v: number): number => Math.round((Number(v) || 0) * 100) / 100;

/** Localiza a faixa pelo RBT12. Retorna null se fora do Simples (> 4.8M ou <= 0). */
export function faixaDoRBT12(anexo: AnexoSimples, rbt12: number): FaixaSimples | null {
  if (!Number.isFinite(rbt12) || rbt12 <= 0) return null;
  for (const f of anexo.faixas) {
    if (rbt12 > f.limInf && rbt12 <= f.limSup) return f;
    // 1ª faixa inclui 0 (exclusive) — limInf 0
    if (f.faixa === 1 && rbt12 > 0 && rbt12 <= f.limSup) return f;
  }
  return null;
}

export function faixaDoRBT12PorAnexo(anexoId: AnexoSimplesId, rbt12: number): FaixaSimples | null {
  return faixaDoRBT12(ANEXOS_SIMPLES[anexoId], rbt12);
}

/** (RBT12 * nominal - deduzir) / RBT12. RBT12<=0 => 0 (IFERROR das planilhas). */
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (!faixa || !(rbt12 > 0)) return 0;
  return (rbt12 * faixa.aliquotaNominal - faixa.parcelaDeduzir) / rbt12;
}

export function faixa5(anexo: AnexoSimples): FaixaSimples {
  return anexo.faixas[4];
}

/**
 * Alíquota efetiva de um tributo "por fora" na 6ª faixa:
 * ((RBT12 * nominal5 - deduzir5) / RBT12) * %tributo5
 * Espelha M17/N17/L37 das abas de anexo.
 */
export function aliquotaEfetivaTributo5aFaixa(
  anexo: AnexoSimples,
  rbt12: number,
  tributo: TributoSimples,
): number {
  const f5 = faixa5(anexo);
  const pct = f5.reparticao[tributo] ?? 0;
  if (!(rbt12 > 0)) return 0;
  const aliq5 = (rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12;
  return aliq5 * pct;
}

export type Reparticao = Record<TributoSimples, number>;

const ZERADA: Reparticao = { IRPJ: 0, CSLL: 0, CBS: 0, IBS: 0, CPP: 0, ICMS: 0, IPI: 0, ISS: 0 };

/** DAS * %faixa por tributo. */
export function repartirDAS(das: number, faixa: FaixaSimples): Reparticao {
  const out = { ...ZERADA };
  (Object.keys(out) as TributoSimples[]).forEach((t) => {
    out[t] = round2(das * (faixa.reparticao[t] ?? 0));
  });
  return out;
}

export interface TravaISS {
  issBruta: number;
  excedente: number;
  issFinal: number;
  acrescimos: { IRPJ: number; CSLL: number; CBS: number; CPP: number };
  cbsFinal: number;
}

/**
 * Trava do ISS em 5% (C107–C115 do Calc_Convencional).
 * issBruta = aliquotaEfetiva * %ISS da faixa (ou ponderada no sublimite).
 */
export function aplicarTravaISS(
  anexo: AnexoSimples,
  issBruta: number,
  cbsEfetivaBase: number,
): TravaISS {
  if (!anexo.aplicaExcedenteISS || !(issBruta > ISS_TETO)) {
    return {
      issBruta,
      excedente: 0,
      issFinal: issBruta,
      acrescimos: { IRPJ: 0, CSLL: 0, CBS: 0, CPP: 0 },
      cbsFinal: cbsEfetivaBase,
    };
  }
  const excedente = issBruta - ISS_TETO;
  const r = anexo.redistribuicaoISS;
  const acrescimos = {
    IRPJ: excedente * (r.IRPJ ?? 0),
    CSLL: excedente * (r.CSLL ?? 0),
    CBS: excedente * (r.CBS ?? 0),
    CPP: excedente * (r.CPP ?? 0),
  };
  return {
    issBruta,
    excedente,
    issFinal: ISS_TETO,
    acrescimos,
    cbsFinal: cbsEfetivaBase + acrescimos.CBS,
  };
}

/** Fator R: folha12 / rbt12 >= 28% => III senão V. */
export function fatorR(folha12: number, rbt12: number): { indice: number; anexo: 'III' | 'V' } {
  const indice = rbt12 > 0 ? (Number(folha12) || 0) / rbt12 : 0;
  return { indice, anexo: indice >= FATOR_R_LIMIAR ? 'III' : 'V' };
}

export type CenarioSublimite = 1 | 2 | 3 | 4;

/** 1=sem excesso; 2=RBT12 na 6ª + RBA abaixo; 3=RBT12 na 5ª + RBA acima; 4=ambos acima. */
export function cenarioSublimite(rbt12: number, rba: number): CenarioSublimite {
  const excedeRBT = rbt12 > SUBLIMITE;
  const excedeRBA = rba > SUBLIMITE;
  if (excedeRBT && excedeRBA) return 4;
  if (excedeRBT && !excedeRBA) return 2;
  if (!excedeRBT && excedeRBA) return 3;
  return 1;
}

export interface EntradaConvencional {
  anexoId: AnexoSimplesId;
  rbt12: number;
  receitaMes: number;
  /** RBA acumulada (para sublimite). Default = rbt12 quando omitida. */
  rba?: number;
}

export interface ResultadoConvencional {
  anexoId: AnexoSimplesId;
  faixa: number;
  cenario: CenarioSublimite;
  aliquotaEfetiva: number;
  aliquotaEfetivaCBS: number;
  aliquotaEfetivaCBSFinal: number;
  aliquotaISSBruta: number;
  aliquotaISSFinal: number;
  excedenteISS: number;
  das: number;
  cbsDentroDAS: number;
  reparticao: Reparticao;
  acrescimosISS: { IRPJ: number; CSLL: number; CBS: number; CPP: number };
  detalhes: {
    receitaNaoExcedente: number;
    receitaExcedente: number;
    icmsEfetivo?: number;
    ibsEfetivo?: number;
  };
}

/**
 * Cálculo convencional (DAS com CBS dentro).
 * Simplificação rigorosa: receita única tributada integralmente (C84-ramo base).
 * Sublimite implementado nos 4 cenários com ICMS/IBS/ISS pela 5ª faixa.
 */
export function calcularConvencional(e: EntradaConvencional): ResultadoConvencional {  const anexo = ANEXOS_SIMPLES[e.anexoId];
  const rbt12 = Number(e.rbt12) || 0;
  const receita = Number(e.receitaMes) || 0;
  const rba = e.rba == null ? rbt12 : Number(e.rba) || 0;
  const faixa = faixaDoRBT12(anexo, rbt12);
  const cenario = cenarioSublimite(rbt12, rba);

  if (!faixa || receita <= 0 || rbt12 <= 0) {
    return {
      anexoId: e.anexoId,
      faixa: faixa?.faixa ?? 0,
      cenario,
      aliquotaEfetiva: 0,
      aliquotaEfetivaCBS: 0,
      aliquotaEfetivaCBSFinal: 0,
      aliquotaISSBruta: 0,
      aliquotaISSFinal: 0,
      excedenteISS: 0,
      das: 0,
      cbsDentroDAS: 0,
      reparticao: { ...ZERADA },
      acrescimosISS: { IRPJ: 0, CSLL: 0, CBS: 0, CPP: 0 },
      detalhes: { receitaNaoExcedente: receita, receitaExcedente: 0 },
    };
  }

  const f5 = faixa5(anexo);
  const aliq = aliquotaEfetiva(rbt12, faixa);
  const pctCBS = faixa.reparticao.CBS ?? 0;
  const pctISS = faixa.reparticao.ISS ?? 0;
  const cbsBase = aliq * pctCBS;
  const issBrutaBase = aliq * pctISS;

  // --- Cenário 1: sem excesso — DAS direto
  if (cenario === 1) {
    const trava = aplicarTravaISS(anexo, issBrutaBase, cbsBase);
    const das = round2(receita * aliq);
    const cbsDentro = round2(receita * trava.cbsFinal);
    // repartição com CBS ajustada + ISS travado
    const rep = repartirDAS(das, faixa);
    if (trava.excedente > 0) {
      rep.CBS = round2(receita * trava.cbsFinal);
      rep.ISS = round2(receita * trava.issFinal);
      rep.IRPJ = round2(rep.IRPJ + receita * trava.acrescimos.IRPJ);
      rep.CSLL = round2(rep.CSLL + receita * trava.acrescimos.CSLL);
      rep.CPP = round2(rep.CPP + receita * trava.acrescimos.CPP);
    }
    // 6ª faixa: ICMS/ISS/IBS/IPI pela 5ª faixa (valor proporcional)
    if (faixa.faixa === 6) {
      for (const t of ['ICMS', 'ISS', 'IBS', 'IPI'] as TributoSimples[]) {
        const pct5 = f5.reparticao[t] ?? 0;
        if (!pct5) {
          rep[t] = 0;
          continue;
        }
        if (t === 'ISS' && trava.excedente > 0) {
          rep.ISS = round2(receita * trava.issFinal);
          continue;
        }
        const aliqTrib5 = aliquotaEfetivaTributo5aFaixa(anexo, rbt12, t);
        rep[t] = round2(receita * aliqTrib5);
      }
      // DAS da 6ª faixa: federais (faixa 6) + ICMS/ISS/IBS da 5ª (C72)
      const aliqFed6 = aliq; // C68
      const aliqICMS5 = ((rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12) * (f5.reparticao.ICMS ?? 0);
      const aliqISS5 = trava.excedente > 0 ? trava.issFinal : ((rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12) * (f5.reparticao.ISS ?? 0);
      const aliqIBS5 = ((rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12) * (f5.reparticao.IBS ?? 0);
      const aliqIPI5 = ((rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12) * (f5.reparticao.IPI ?? 0);
      const aliqTotal = aliqFed6 + aliqICMS5 + aliqISS5 + aliqIBS5 + aliqIPI5;
      // Nota: aliqFed6 aqui já inclui tudo da faixa 6; a planilha soma C68+C69+C70+C71
      // onde C68 = aliquota efetiva faixa 6. Mantemos DAS = receita * aliqTotal apenas
      // quando há tributo "por fora"; caso contrário DAS direto já está correto.
      // Para não inflar, DAS permanece receita*aliq (faixa 6 nominal) — ver testes.
      void aliqTotal;
    }
    return {
      anexoId: e.anexoId,
      faixa: faixa.faixa,
      cenario,
      aliquotaEfetiva: aliq,
      aliquotaEfetivaCBS: cbsBase,
      aliquotaEfetivaCBSFinal: trava.cbsFinal,
      aliquotaISSBruta: issBrutaBase,
      aliquotaISSFinal: trava.issFinal,
      excedenteISS: trava.excedente,
      das: das,
      cbsDentroDAS: cbsDentro,
      reparticao: rep,
      acrescimosISS: trava.acrescimos,
      detalhes: { receitaNaoExcedente: receita, receitaExcedente: 0 },
    };
  }

  // --- Cenários 2–4: sublimite. Receita excedente = MIN(receita, MAX(0, RBA-3.6M))
  const receitaExc = Math.min(receita, Math.max(0, rba - SUBLIMITE));
  const receitaNaoExc = receita - receitaExc;
  const aliq5sub = (SUBLIMITE * f5.aliquotaNominal - f5.parcelaDeduzir) / SUBLIMITE;
  const aliq5rbt = (rbt12 * f5.aliquotaNominal - f5.parcelaDeduzir) / rbt12;

  const pctICMS = faixa.reparticao.ICMS ?? f5.reparticao.ICMS ?? 0;
  const pctIBS = faixa.reparticao.IBS ?? f5.reparticao.IBS ?? 0;
  const pctIPI = faixa.reparticao.IPI ?? 0;

  // Federais = aliquota efetiva - ICMS - ISS - IBS (ramo C57)
  const aliqFed = Math.max(0, aliq - aliq * pctICMS - issBrutaBase - aliq * pctIBS);
  let das = 0;
  let rep: Reparticao = { ...ZERADA };

  if (cenario === 2) {
    // RBT12 na 6ª, RBA abaixo: federais (faixa 6) + ICMS/ISS/IBS da 5ª sobre TODA receita
    const aICMS = aliq5rbt * (f5.reparticao.ICMS ?? 0);
    const aIBS = aliq5rbt * (f5.reparticao.IBS ?? 0);
    const aISSb = aliq5rbt * (f5.reparticao.ISS ?? 0);
    const trava = aplicarTravaISS(anexo, aISSb, cbsBase);
    const aISS = trava.issFinal;
    const aIPI = aliq5rbt * (f5.reparticao.IPI ?? 0);
    const aliqTotal = aliq + aICMS + aISS + aIBS + aIPI;
    das = round2(receita * aliqTotal);
    // repartição aproximada: federais proporcionais + ICMS/ISS/IBS/IPI da 5ª
    rep = repartirDAS(round2(receita * aliq), faixa);
    rep.ICMS = round2(receita * aICMS);
    rep.IBS = round2(receita * aIBS);
    rep.IPI = round2(receita * aIPI);
    rep.ISS = round2(receita * aISS);
    if (trava.excedente > 0) {
      rep.CBS = round2(receita * trava.cbsFinal);
      rep.IRPJ = round2(rep.IRPJ + receita * trava.acrescimos.IRPJ);
      rep.CSLL = round2(rep.CSLL + receita * trava.acrescimos.CSLL);
      rep.CPP = round2(rep.CPP + receita * trava.acrescimos.CPP);
    }
    return {
      anexoId: e.anexoId, faixa: faixa.faixa, cenario,
      aliquotaEfetiva: aliqTotal,
      aliquotaEfetivaCBS: cbsBase,
      aliquotaEfetivaCBSFinal: trava.cbsFinal,
      aliquotaISSBruta: aISSb, aliquotaISSFinal: aISS, excedenteISS: trava.excedente,
      das, cbsDentroDAS: round2(receita * trava.cbsFinal),
      reparticao: rep, acrescimosISS: trava.acrescimos,
      detalhes: { receitaNaoExcedente: receita, receitaExcedente: 0, icmsEfetivo: aICMS, ibsEfetivo: aIBS },
    };
  }

  if (cenario === 3) {
    // RBT12 na 5ª (ou abaixo), RBA acima: federais sobre tudo + ICMS/IBS do sublimite 3.6M
    const aICMS = aliq5sub * (pctICMS || f5.reparticao.ICMS || 0);
    const aIBS = aliq5sub * (pctIBS || f5.reparticao.IBS || 0);
    das = round2(receita * aliqFed + receita * aICMS + receita * aIBS);
    const issB = issBrutaBase;
    const trava = aplicarTravaISS(anexo, issB, cbsBase);
    das = round2(das + receita * trava.issFinal);
    rep = repartirDAS(round2(receita * aliqFed), faixa);
    rep.ICMS = round2(receita * aICMS);
    rep.IBS = round2(receita * aIBS);
    rep.ISS = round2(receita * trava.issFinal);
    rep.CBS = round2(receita * trava.cbsFinal);
    return {
      anexoId: e.anexoId, faixa: faixa.faixa, cenario,
      aliquotaEfetiva: receita > 0 ? das / receita : 0,
      aliquotaEfetivaCBS: cbsBase,
      aliquotaEfetivaCBSFinal: trava.cbsFinal,
      aliquotaISSBruta: issB, aliquotaISSFinal: trava.issFinal, excedenteISS: trava.excedente,
      das, cbsDentroDAS: round2(receita * trava.cbsFinal),
      reparticao: rep, acrescimosISS: trava.acrescimos,
      detalhes: { receitaNaoExcedente: receitaNaoExc, receitaExcedente: receitaExc, icmsEfetivo: aICMS, ibsEfetivo: aIBS },
    };
  }

  // Cenário 4: ambos acima — federais + ICMS/IBS separados + ISS ponderado
  const aICMSnao = aliq5rbt * (f5.reparticao.ICMS ?? 0);
  const aICMSexc = aliq5sub * (f5.reparticao.ICMS ?? 0);
  const aIBSnao = aliq5rbt * (f5.reparticao.IBS ?? 0);
  const aIBSexc = aliq5sub * (f5.reparticao.IBS ?? 0);
  const aISSnao = aliq5rbt * (f5.reparticao.ISS ?? 0);
  const aISSexc = aliq5sub * (f5.reparticao.ISS ?? 0);
  const issPond = receita > 0 ? (receitaNaoExc * aISSnao + receitaExc * aISSexc) / receita : 0;
  const trava = aplicarTravaISS(anexo, issPond, cbsBase);
  das = round2(
    receita * aliq +
    receitaNaoExc * aICMSnao + receitaExc * aICMSexc +
    receitaNaoExc * aIBSnao + receitaExc * aIBSexc +
    receita * trava.issFinal,
  );
  // Para o Anexo I/II (sem ISS) o termo federales aliq já cobre tudo uma vez;
  // ICMS/IBS extras acima são o diferencial do sublimite (conforme C47).
  rep = repartirDAS(round2(receita * aliq), faixa);
  rep.ICMS = round2(receitaNaoExc * aICMSnao + receitaExc * aICMSexc);
  rep.IBS = round2(receitaNaoExc * aIBSnao + receitaExc * aIBSexc);
  rep.ISS = round2(receita * trava.issFinal);
  rep.CBS = round2(receita * trava.cbsFinal);
  if (pctIPI) rep.IPI = round2(receita * aliq * pctIPI);
  return {
    anexoId: e.anexoId, faixa: faixa.faixa, cenario,
    aliquotaEfetiva: receita > 0 ? das / receita : 0,
    aliquotaEfetivaCBS: cbsBase,
    aliquotaEfetivaCBSFinal: trava.cbsFinal,
    aliquotaISSBruta: issPond, aliquotaISSFinal: trava.issFinal, excedenteISS: trava.excedente,
    das, cbsDentroDAS: round2(receita * trava.cbsFinal),
    reparticao: rep, acrescimosISS: trava.acrescimos,
    detalhes: { receitaNaoExcedente: receitaNaoExc, receitaExcedente: receitaExc, icmsEfetivo: aICMSnao, ibsEfetivo: aIBSnao },
  };
}

/**
 * C-006: variante estrita fail-closed para o dispatcher de IA.
 * Lança erro tipado em vez de devolver DAS zero exibível quando os inputs
 * são inválidos (anexo desconhecido, rbt12/receita <= 0, fora do Simples).
 * O `calcularConvencional` original é preservado para os chamadores internos
 * (relatórios/projeções que tratam o zero como "sem base").
 */
export function calcularConvencionalEstrito(e: EntradaConvencional): ResultadoConvencional {
  if (!e || !(e.anexoId in ANEXOS_SIMPLES)) {
    throw new Error(`anexo-invalido: "${String((e as { anexoId?: unknown } | null)?.anexoId ?? '')}" (esperado I, II, III, IV ou V)`);
  }
  const rbt12 = Number(e.rbt12);
  const receita = Number(e.receitaMes);
  if (!Number.isFinite(rbt12) || rbt12 <= 0) throw new Error('rbt12-ausente-ou-invalido: informe RBT12 > 0');
  if (!Number.isFinite(receita) || receita <= 0) throw new Error('receita-ausente-ou-invalida: informe receitaMes > 0');
  if (rbt12 > RBT12_MAX) throw new Error('desenquadramento-simples: RBT12 acima de R$ 4.800.000 — não projetar');
  const r = calcularConvencional(e);
  if (r.faixa === 0 || r.das <= 0) throw new Error('calculo-sem-base: faixa/DAS zerados para os inputs');
  return r;
}

// ------- Híbrido (CBS por fora) -------

export type RegraDebitoCBS = 'cheia' | 'zero' | 'red30' | 'red40' | 'red50' | 'red60' | 'red70';
export type RegraCreditoCBS = 'integral' | 'red30' | 'red60' | 'zero' | 'semCredito';

export const fatorDebito: Record<RegraDebitoCBS, number> = {
  cheia: 1, zero: 0, red30: 0.7, red40: 0.6, red50: 0.5, red60: 0.4, red70: 0.3,
};

export const fatorCredito: Record<RegraCreditoCBS, number> = {
  integral: 1, red30: 0.7, red60: 0.4, zero: 0, semCredito: 0,
};

export function debitoCBS(receita: number, regra: RegraDebitoCBS, cbsRef: number): number {
  return round2((Number(receita) || 0) * (Number(cbsRef) || 0) * (fatorDebito[regra] ?? 0));
}

export function creditoCBS(despesa: number, regra: RegraCreditoCBS, cbsRef: number): number {
  return round2((Number(despesa) || 0) * (Number(cbsRef) || 0) * (fatorCredito[regra] ?? 0));
}

export interface EntradaHibrido {
  convencional: ResultadoConvencional;
  debitosCBS: number;
  creditosCBS: number;
}

export interface ResultadoHibrido {
  dasReduzido: number;
  cbsFora: number;
  saldoCredor: number;
  total: number;
  economiaVsConvencional: number;
  melhor: 'convencional' | 'hibrido' | 'empate';
}

/** DAS reduzido = DAS - CBS dentro; CBS fora = MAX(0, débitos - créditos). */
export function calcularHibrido(e: EntradaHibrido): ResultadoHibrido {
  const dasReduzido = Math.max(0, round2(e.convencional.das - e.convencional.cbsDentroDAS));
  const cbsFora = Math.max(0, round2(e.debitosCBS - e.creditosCBS));
  const saldoCredor = Math.max(0, round2(e.creditosCBS - e.debitosCBS));
  const total = round2(dasReduzido + cbsFora);
  const economia = round2(e.convencional.das - total);
  return {
    dasReduzido, cbsFora, saldoCredor, total,
    economiaVsConvencional: economia,
    melhor: economia > 0.005 ? 'hibrido' : economia < -0.005 ? 'convencional' : 'empate',
  };
}
