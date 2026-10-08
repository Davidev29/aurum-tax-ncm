/**
 * Simples Nacional — núcleo matemático único (fonte canônica da lógica simples).
 *
 * Centraliza os primitivos antes duplicados entre `src/simples/calculo.ts`,
 * `src/simples/relatorio-analitico.ts`, `src/simples/store.ts` e o chat:
 * arredondamento, alíquota efetiva, faixa por RBT12 e Fator R.
 *
 * Puro: sem I/O, sem rede, sem banco.
 */

import type { AnexoSimples, FaixaSimples } from '@/simples/tabelas';

/** Limiar do Fator R: folha12/RBT12 >= 28% => Anexo III, senão V. */
export const FATOR_R_LIMIAR = 0.28;

/**
 * Arredonda para 2 casas (centavos).
 * - NaN (inclui `Number(undefined|null|'')`) => 0 (IFERROR das planilhas).
 * - ±Infinity => lança erro (nunca pode virar DAS exibível).
 */
export function round2(v: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  if (!Number.isFinite(n)) {
    throw new Error('round2-infinito: valor não-finito não pode ser arredondado');
  }
  return Math.round(n * 100) / 100;
}

/** Localiza a faixa pelo RBT12. Retorna null se fora do Simples (> 4.8M ou <= 0).
 * Limites da LC 123 são inclusivos (faixa 2 começa em 180000.01 exato);
 * a 1ª faixa casa primeiro, então valores no limite superior ficam nela. */
export function faixaDoRBT12(anexo: AnexoSimples, rbt12: number): FaixaSimples | null {
  if (!Number.isFinite(rbt12) || rbt12 <= 0) return null;
  for (const f of anexo.faixas) {
    if (rbt12 >= f.limInf && rbt12 <= f.limSup) return f;
  }
  return null;
}

/** (RBT12 * nominal - deduzir) / RBT12. RBT12<=0 => 0 (IFERROR das planilhas). */
export function aliquotaEfetiva(rbt12: number, faixa: FaixaSimples): number {
  if (!faixa || !(rbt12 > 0)) return 0;
  return (rbt12 * faixa.aliquotaNominal - faixa.parcelaDeduzir) / rbt12;
}

/** Fator R: folha12 / rbt12 >= 28% => III senão V. */
export function fatorR(folha12: number, rbt12: number): { indice: number; anexo: 'III' | 'V' } {
  const indice = rbt12 > 0 ? (Number(folha12) || 0) / rbt12 : 0;
  return { indice, anexo: indice >= FATOR_R_LIMIAR ? 'III' : 'V' };
}

/** Folha 12m necessária para o índice exato de 28%. */
export function folhaMinima28(rbt12: number): number {
  return round2(FATOR_R_LIMIAR * (Number(rbt12) || 0));
}

/** Quanto falta na folha 12m para alcançar 28% (0 quando já atinge ou sem base). */
export function gapFolha(folha12: number, rbt12: number): number {
  const rbt = Number(rbt12) || 0;
  const folha = Number(folha12) || 0;
  if (!(rbt > 0) || !(folha > 0)) return 0;
  return Math.max(0, round2(folhaMinima28(rbt) - folha));
}

export interface FatorRDetalhe {
  folha12: number;
  rbt12: number;
  valor: number;
  threshold: number;
  enquadrado: boolean;
  dadosSuficientes: boolean;
  folhaMinimaIII: number;
  gapFolha: number;
  gapMensalProlabore: number;
}

/**
 * Detalhamento do Fator R (matemática única; o relatório só adiciona `formulaId`).
 * Espelha a regra da tela: sem folha/RBT12 não há enquadramento.
 */
export function detalharFatorR(folha12: number, rbt12: number): FatorRDetalhe {
  const folha = Number(folha12) || 0;
  const rbt = Number(rbt12) || 0;
  const dadosSuficientes = rbt > 0 && folha > 0;
  const valor = rbt > 0 ? folha / rbt : 0;
  const folhaMinima = folhaMinima28(rbt);
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
  };
}
