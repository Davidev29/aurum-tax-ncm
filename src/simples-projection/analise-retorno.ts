/**
 * Simples Projection — análise do retorno do investimento (módulo PURO).
 *
 * Responde "em quanto tempo vejo retorno positivo — ou se só há prejuízo":
 * classifica a série de economias líquidas (DAS unificado − DAS dividido −
 * custo) em um dos quatro estados e resume médias, melhor/pior mês e totais.
 *
 * Estados:
 * - `lucro-imediato`: já no 1º mês o acumulado fica positivo e nunca volta
 *   a zerar (dividir paga menos desde o início);
 * - `payback-horizonte`: o acumulado cruza zero em algum mês do horizonte;
 * - `sem-payback`: há meses positivos, mas o acumulado nunca zera;
 * - `prejuizo`: nenhum mês positivo — dividir só aumenta o custo.
 *
 * PURA: sem I/O, sem rede, sem banco. Sem texto qualitativo (a UI redige o
 * veredito a partir destes números).
 */
import { round2 } from './pro-labore';

export type StatusRetorno = 'lucro-imediato' | 'payback-horizonte' | 'sem-payback' | 'prejuizo';

export interface EntradaSerieRetorno {
  mes: string;
  economiaMes: number;
  economiaAcumulada: number;
  receitaTotal: number;
  dasUnificadoReferencia: number;
  dasMae: number;
  dasNova: number;
}

export interface ExtremoRetorno {
  mes: string;
  valor: number;
}

export interface AnaliseRetorno {
  status: StatusRetorno;
  /** 1-based: em qual mês o acumulado cruzou zero (null quando nunca). */
  mesesParaRetorno: number | null;
  mesPayback: string | null;
  economiaTotal: number;
  economiaMediaMensal: number;
  /** Economia bruta de DAS (sem descontar o custo da nova empresa). */
  totalEconomiaBrutaDAS: number;
  /** Custo total da nova empresa no horizonte. */
  totalCustos: number;
  mesesPositivos: number;
  mesesNegativos: number;
  melhorMes: ExtremoRetorno | null;
  piorMes: ExtremoRetorno | null;
}

/**
 * Classifica o retorno a partir da série líquida mensal.
 * `custoMensalNova` serve apenas para decompor bruto × custos no resumo.
 */
export function analisarRetorno(
  serie: EntradaSerieRetorno[],
  custoMensalNova: number,
): AnaliseRetorno {
  const linhas = Array.isArray(serie) ? serie : [];
  const custo = Math.max(0, Number(custoMensalNova) || 0);

  if (linhas.length === 0) {
    return {
      status: 'prejuizo',
      mesesParaRetorno: null,
      mesPayback: null,
      economiaTotal: 0,
      economiaMediaMensal: 0,
      totalEconomiaBrutaDAS: 0,
      totalCustos: 0,
      mesesPositivos: 0,
      mesesNegativos: 0,
      melhorMes: null,
      piorMes: null,
    };
  }

  let totalEconomiaBrutaDAS = 0;
  let mesesPositivos = 0;
  let mesesNegativos = 0;
  let melhor: ExtremoRetorno | null = null;
  let pior: ExtremoRetorno | null = null;
  let primeiroCruzamentoIdx: number | null = null;

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i]!;
    const bruta = (Number(l.dasUnificadoReferencia) || 0) - (Number(l.dasMae) || 0) - (Number(l.dasNova) || 0);
    totalEconomiaBrutaDAS = round2(totalEconomiaBrutaDAS + bruta);
    if (l.economiaMes > 0) mesesPositivos += 1;
    if (l.economiaMes < 0) mesesNegativos += 1;
    if (!melhor || l.economiaMes > melhor.valor) melhor = { mes: l.mes, valor: l.economiaMes };
    if (!pior || l.economiaMes < pior.valor) pior = { mes: l.mes, valor: l.economiaMes };
    if (primeiroCruzamentoIdx === null && l.economiaAcumulada > 0) primeiroCruzamentoIdx = i;
  }

  const economiaTotal = linhas[linhas.length - 1]!.economiaAcumulada;
  const totalCustos = round2(custo * linhas.length);

  let status: StatusRetorno;
  if (primeiroCruzamentoIdx === 0 && linhas.every((l) => l.economiaAcumulada > 0)) {
    status = 'lucro-imediato';
  } else if (primeiroCruzamentoIdx !== null) {
    status = 'payback-horizonte';
  } else if (mesesPositivos > 0) {
    status = 'sem-payback';
  } else {
    status = 'prejuizo';
  }

  return {
    status,
    mesesParaRetorno: primeiroCruzamentoIdx === null ? null : primeiroCruzamentoIdx + 1,
    mesPayback: primeiroCruzamentoIdx === null ? null : linhas[primeiroCruzamentoIdx]!.mes,
    economiaTotal: round2(economiaTotal),
    economiaMediaMensal: round2(economiaTotal / linhas.length),
    totalEconomiaBrutaDAS: round2(totalEconomiaBrutaDAS),
    totalCustos,
    mesesPositivos,
    mesesNegativos,
    melhorMes: melhor,
    piorMes: pior,
  };
}
