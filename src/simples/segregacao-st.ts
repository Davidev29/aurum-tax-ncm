/**
 * Simples Nacional — segregação de receita com Substituição Tributária (ST).
 *
 * Caso real do PGDAS: parte da receita do mês já teve ICMS/ISS recolhido por
 * ST (substituto). Essa parcela não compõe a guia — o DAS deduz apenas a
 * fração do tributo substituído, proporcional ao valor segregado.
 *
 * REGRA FISCAL (proporcional, LC 123/2006 art. 18 + PGDAS):
 * - tributoST = ICMS (Anexos I/II) ou ISS (Anexos III/IV/V)
 * - deducao = reparticao[tributoST] * (valorST / receitaMes)
 * - dasFinal = das - deducao
 * - reparticaoFinal[tributoST] = reparticao[tributoST] - deducao
 * - demais tributos e CBS dentro do DAS: inalterados
 * - guia PGDAS (DasModal/PDF): SOMENTE valores finais (deduzidos)
 * - tela: tributo substituído aparece riscado (valor integral) + legenda
 *   com DAS integral abaixo do principal
 *
 * PURA: sem I/O. Consome apenas tipos de `calculo.ts`.
 */
import { round2, type Reparticao, type ResultadoConvencional } from './calculo';
import type { AnexoSimplesId } from './tabelas';

export type TributoST = 'ICMS' | 'ISS';
export type PreferenciaST = 'auto' | TributoST;

/** Tributo substituível por anexo: I/II → ICMS, III/IV/V → ISS. */
export function tributoSTDoAnexo(anexoId: AnexoSimplesId): TributoST {
  return anexoId === 'I' || anexoId === 'II' ? 'ICMS' : 'ISS';
}

/** Resolve a flag da UI: 'auto' segue o anexo; manual força ICMS/ISS. */
export function resolverTributoST(anexoId: AnexoSimplesId, pref: PreferenciaST = 'auto'): TributoST {
  if (pref === 'ICMS' || pref === 'ISS') return pref;
  return tributoSTDoAnexo(anexoId);
}

export interface ResultadoST {
  tributo: TributoST;
  /** Valor da receita com ST informado pelo usuário (clamp 0..receitaMes). */
  valorST: number;
  /** Parcela do tributo que sai da guia (proporcional). */
  deducao: number;
  /** DAS a pagar (final, deduzido). */
  dasFinal: number;
  /** DAS integral (antes da ST) — exibido como legenda. */
  dasIntegral: number;
  /** Valor integral do tributo (antes) — exibido riscado. */
  tributoIntegral: number;
  /** Valor final do tributo (vai à guia). */
  tributoFinal: number;
  reparticaoFinal: Reparticao;
  convAjustado: ResultadoConvencional;
}

/**
 * Aplica a ST sobre um cálculo convencional já apurado.
 * Fail-closed nos limites: valorST<=0 ou receita<=0 → sem dedução (dedução 0).
 * valorST > receitaMes é travado na receita (nunca zera além do tributo).
 */
export function calcularST(
  conv: ResultadoConvencional,
  receitaMes: number,
  valorSTBruto: number,
  tributo: TributoST,
): ResultadoST {
  const receita = Math.max(0, Number(receitaMes) || 0);
  const valorST = Math.min(Math.max(0, Number(valorSTBruto) || 0), receita);
  const integral = round2(conv.reparticao[tributo] ?? 0);
  if (!(receita > 0) || !(valorST > 0) || !(integral > 0)) {
    return {
      tributo,
      valorST,
      deducao: 0,
      dasFinal: conv.das,
      dasIntegral: conv.das,
      tributoIntegral: integral,
      tributoFinal: integral,
      reparticaoFinal: { ...conv.reparticao },
      convAjustado: conv,
    };
  }
  const deducao = Math.min(integral, round2((integral * valorST) / receita));
  const tributoFinal = round2(integral - deducao);
  const dasFinal = round2(conv.das - deducao);
  const reparticaoFinal: Reparticao = { ...conv.reparticao, [tributo]: tributoFinal };
  return {
    tributo,
    valorST,
    deducao,
    dasFinal,
    dasIntegral: conv.das,
    tributoIntegral: integral,
    tributoFinal,
    reparticaoFinal,
    convAjustado: { ...conv, das: dasFinal, reparticao: reparticaoFinal },
  };
}
