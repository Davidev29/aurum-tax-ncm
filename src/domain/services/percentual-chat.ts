/**
 * Motor de porcentagem eficiente (chat Aurum AI — v9).
 *
 * Puro, sem I/O. Regexes pré-compiladas no módulo (zero alocação por
 * chamada). Cobre PT-BR: "30%", "30 por cento", "redução de 30%", "red30",
 * "70% da alíquota", "alíquota zero", "isento", "sem crédito", "integral".
 *
 * Distinção central (não confundir):
 * - `reducao_de N` — a alíquota foi REDUZIDA em N (paga 100−N);
 * - `paga_x N` — paga N da alíquota (ex.: "30% da alíquota", aluguel).
 */
import type { RegraCreditoCBS, RegraDebitoCBS } from '@/simples/calculo';

const RX_PCT_NUM = /(\d+(?:[.,]\d+)?)\s*%/;
const RX_POR_CENTO = /(\d+(?:[.,]\d+)?)\s*por\s*cento/i;
const RX_REDUCAO_DE = /(?:redu[cç][aã]o|red\.?|desc\.?|desconto)(?:\s*de)?\s*(\d+(?:[.,]\d+)?)\s*%?/i;
const RX_PAGA_ALIQUOTA = /(\d+(?:[.,]\d+)?)\s*%\s*da\s*al[ií]quota/i;
const RX_ZERO = /al[ií]quota\s*zero|zerad[oa]?|isent[oa]?|imune|sem\s*cbs/i;
const RX_SEM_CREDITO = /sem\s*cr[eé]dito|n[aã]o\s*(?:gera?|d[aá]|tem)\s*cr[eé]dito|n[aã]o\s*onerad/i;
const RX_INTEGRAL = /integral|cheia?|sem\s*redu[cç][aã]o|sem\s*desconto|al[ií]quota\s*cheia/i;

const num = (s: string): number => Number(String(s ?? '').replace(',', '.'));

const perto = (v: number, alvo: number, tol = 0.035): boolean => Math.abs(v - alvo) <= tol;

export type ContextoPercentual = 'reducao_de' | 'paga_x' | 'direto';

export interface PercentualDetectado {
  /** Fração 0–1. Em `reducao_de` é o quanto REDUZ; em `paga_x`/`direto`, o quanto PAGA. */
  fracao: number;
  contexto: ContextoPercentual;
  bruto: string;
}

/**
 * Extrai o percentual de um texto. Ordem: zero → paga-da-alíquota →
 * redução-de → por-cento → N% direto. Retorna null sem número válido.
 */
export function extrairPercentualRobusto(texto: string): PercentualDetectado | null {
  const t = String(texto ?? '');
  if (!t.trim()) return null;
  if (RX_ZERO.test(t)) {
    const m = t.match(RX_ZERO);
    return { fracao: 0, contexto: 'paga_x', bruto: m?.[0] ?? 'zero' };
  }
  let m = t.match(RX_PAGA_ALIQUOTA);
  if (m) {
    const v = num(m[1]) / 100;
    if (v >= 0 && v <= 1) return { fracao: Math.round(v * 10000) / 10000, contexto: 'paga_x', bruto: m[0] };
  }
  m = t.match(RX_REDUCAO_DE);
  if (m) {
    const v = num(m[1]) / 100;
    if (v > 0 && v <= 1) return { fracao: Math.round(v * 10000) / 10000, contexto: 'reducao_de', bruto: m[0] };
  }
  m = t.match(RX_POR_CENTO);
  if (m) {
    const v = num(m[1]) / 100;
    if (v > 0 && v <= 1) return { fracao: Math.round(v * 10000) / 10000, contexto: 'direto', bruto: m[0] };
  }
  m = t.match(RX_PCT_NUM);
  if (m) {
    const v = num(m[1]) / 100;
    if (v > 0 && v <= 1) return { fracao: Math.round(v * 10000) / 10000, contexto: 'direto', bruto: m[0] };
  }
  return null;
}

/** "sem crédito" explícito (crédito zerado por vedação, não por alíquota). */
export function temVedacaoCredito(texto: string): boolean {
  return RX_SEM_CREDITO.test(String(texto ?? ''));
}

/** "integral/cheia/sem redução" explícito. */
export function temRegraIntegral(texto: string): boolean {
  return RX_INTEGRAL.test(String(texto ?? ''));
}

/**
 * Mapeia fração → regra de CRÉDITO (integral/red30/red60/zero/semCredito).
 * `reducao_de 0.3` = reduz 30% = paga 70% = red30. `paga_x 0.3` (ex.: aluguel)
 * não tem enum — retorna null (o chamador usa a regra do tipo ou pergunta).
 */
export function regraCreditoDePercentual(fracao: number, contexto: ContextoPercentual): RegraCreditoCBS | null {
  const f = Number(fracao);
  if (!Number.isFinite(f) || f < 0 || f > 1) return null;
  if (contexto === 'reducao_de') {
    if (perto(f, 0)) return 'zero';
    if (perto(f, 0.3)) return 'red30';
    if (perto(f, 0.6)) return 'red60';
    return null;
  }
  // paga_x / direto
  if (perto(f, 1)) return 'integral';
  if (perto(f, 0.7)) return 'red30';
  if (perto(f, 0.4)) return 'red60';
  if (perto(f, 0)) return 'zero';
  return null;
}

/**
 * Mapeia fração → regra de DÉBITO (cheia/red30/red40/red50/red60/red70/zero).
 * `reducao_de 0.3` = red30; `paga_x 0.7` = red30; `paga_x 0.3` = red70.
 */
export function regraDebitoDePercentual(fracao: number, contexto: ContextoPercentual): RegraDebitoCBS | null {
  const f = Number(fracao);
  if (!Number.isFinite(f) || f < 0 || f > 1) return null;
  if (contexto === 'reducao_de') {
    if (perto(f, 0)) return 'zero';
    if (perto(f, 0.3)) return 'red30';
    if (perto(f, 0.4)) return 'red40';
    if (perto(f, 0.5)) return 'red50';
    if (perto(f, 0.6)) return 'red60';
    if (perto(f, 0.7)) return 'red70';
    return null;
  }
  if (perto(f, 1)) return 'cheia';
  if (perto(f, 0.7)) return 'red30';
  if (perto(f, 0.6)) return 'red40';
  if (perto(f, 0.5)) return 'red50';
  if (perto(f, 0.4)) return 'red60';
  if (perto(f, 0.3)) return 'red70';
  if (perto(f, 0)) return 'zero';
  return null;
}

/** Rótulo curto da regra para a conversa ("redução de 30%", "alíquota zero"). */
export function rotuloRegraCredito(regra: RegraCreditoCBS): string {
  switch (regra) {
    case 'integral': return 'integral (sem redução)';
    case 'red30': return 'redução de 30%';
    case 'red60': return 'redução de 60%';
    case 'zero': return 'alíquota zero';
    case 'semCredito': return 'sem crédito';
    default: return String(regra);
  }
}

/** Rótulo curto da regra de débito ("redução de 30%", "cheia"). */
export function rotuloRegraDebito(regra: RegraDebitoCBS): string {
  switch (regra) {
    case 'cheia': return 'cheia (sem redução)';
    case 'red30': return 'redução de 30%';
    case 'red40': return 'redução de 40%';
    case 'red50': return 'redução de 50%';
    case 'red60': return 'redução de 60%';
    case 'red70': return 'redução de 70%';
    case 'zero': return 'alíquota zero';
    default: return String(regra);
  }
}
