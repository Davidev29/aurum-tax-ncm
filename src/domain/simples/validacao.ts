/**
 * Simples Nacional — validação fail-closed de entradas (RBT12/receita).
 *
 * Fonte única da guarda usada pelo motor estrito (`calcularConvencionalEstrito`)
 * e pela store da tela: Infinity/NaN/<=0 e RBT12 acima do teto NUNCA podem
 * virar DAS 0 exibível — lançam erro tipado com mensagem explícita.
 *
 * Pura: sem I/O, sem rede, sem banco.
 */

import { RBT12_MAX } from '@/simples/tabelas';

export interface RbtReceitaValidados {
  rbt12: number;
  receitaMes: number;
}

/**
 * Exige RBT12 e receita finitos e > 0, com RBT12 dentro do Simples (<= 4.8M).
 * - `!isFinite` (NaN/Infinity) ou <= 0 => erro `rbt12/receita-ausente-ou-invalido`.
 * - RBT12 > 4.8M => erro `desenquadramento-simples` (não projetar DAS).
 */
export function exigirRbtReceita(rbt12: number, receitaMes: number): RbtReceitaValidados {
  const rbt = Number(rbt12);
  const rec = Number(receitaMes);
  if (!Number.isFinite(rbt) || !(rbt > 0)) {
    throw new Error('rbt12-ausente-ou-invalido: informe RBT12 > 0');
  }
  if (!Number.isFinite(rec) || !(rec > 0)) {
    throw new Error('receita-ausente-ou-invalida: informe receitaMes > 0');
  }
  if (rbt > RBT12_MAX) {
    throw new Error('desenquadramento-simples: RBT12 acima de R$ 4.800.000 — não projetar');
  }
  return { rbt12: rbt, receitaMes: rec };
}
