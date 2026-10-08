/**
 * Simples Nacional — créditos de CBS por despesa (fator único).
 *
 * Unifica `store.ts:fatorDespesa`, `relatorio-analitico.ts:fatorCreditoDespesa`
 * e os inline 0.3 do chat: aluguel usa 30% da alíquota (redução de 70%,
 * conforme a planilha do Simples), demais despesas seguem a regra de crédito.
 *
 * Puro: sem I/O, sem rede, sem banco.
 */

import { round2 } from './nucleo';

export type RegraCreditoDespesa = 'integral' | 'red30' | 'red60' | 'zero' | 'semCredito';

/** Fator de crédito de uma despesa (aluguel = 30% da alíquota). */
export function fatorCreditoDespesa(rotulo: string, regra: RegraCreditoDespesa | string): number {
  if (/aluguel/i.test(rotulo ?? '')) return 0.3;
  if (regra === 'integral') return 1;
  if (regra === 'red30') return 0.7;
  if (regra === 'red60') return 0.4;
  return 0;
}

export interface DespesaComCredito {
  rotulo: string;
  valor: number;
  regra: RegraCreditoDespesa | string;
}

/** Crédito preview por despesa: valor × CBS ref × fator. */
export function creditoDaDespesaGenerico(d: DespesaComCredito, cbsRef: number): number {
  return round2((Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorCreditoDespesa(d.rotulo, d.regra));
}

/** Total de créditos de CBS de uma lista de despesas. */
export function totalCreditos(despesas: DespesaComCredito[], cbsRef: number): number {
  const total = (despesas ?? []).reduce(
    (acc, d) => acc + (Number(d.valor) || 0) * (Number(cbsRef) || 0) * fatorCreditoDespesa(d.rotulo, d.regra),
    0,
  );
  return round2(total);
}
