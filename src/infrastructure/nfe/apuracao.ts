/**
 * Apuração de IBS/CBS sobre as notas importadas — espelha a lógica do portal
 * da Reforma (tributação sobre o consumo): **débitos** das saídas menos
 * **créditos** das entradas, por tributo e no total.
 *
 * Regras:
 * - **saída** → débito integral de IBS + CBS estimados;
 * - **entrada de emitente em regime normal** → crédito apropriável integral;
 * - **entrada de Simples/MEI** → crédito **bloqueado** (não transfere, LC
 *   214/2025) — somado à parte, nunca abatido;
 * - **entrada com regime desconhecido** → crédito **não confirmado** — também
 *   à parte, por prudência (não afirma o que o XML não prova);
 * - **quarentena** → fora da apuração (direção indefinida), apenas contada.
 *
 * Tudo em R$ com arredondamento de centavos; a comparação final usa tolerância
 * de R$ 0,005 para não gerar "a pagar R$ 0,00" por resíduo de float.
 */
import type { NotaXml } from './tipos'
import { regimeDoEmitente } from './regime'

export type ResultadoApuracao = 'a-pagar' | 'saldo-credor' | 'zerado' | 'sem-movimento'

export interface ApuracaoIbsCbs {
  qtdSaidas: number
  qtdEntradasApropriaveis: number
  qtdEntradasBloqueadas: number
  qtdEntradasNaoConfirmadas: number
  qtdQuarentena: number
  baseSaidas: number
  baseEntradas: number
  debitoIBS: number
  debitoCBS: number
  debitoTotal: number
  creditoIBS: number
  creditoCBS: number
  creditoTotal: number
  bloqueadoIBS: number
  bloqueadoCBS: number
  bloqueadoTotal: number
  naoConfirmadoIBS: number
  naoConfirmadoCBS: number
  naoConfirmadoTotal: number
  saldoIBS: number
  saldoCBS: number
  saldoTotal: number
  resultado: ResultadoApuracao
  /** > 0 quando `a-pagar`; senão 0. */
  valorAPagar: number
  /** > 0 quando `saldo-credor` (módulo, p/ restituição ou compensação). */
  saldoCredor: number
}

const cent = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

type EntradaApuracao = Pick<
  NotaXml,
  'direcao' | 'totalIBS' | 'totalCBS' | 'valorTotal' | 'emitCrt' | 'itensAnalisados'
>

export function apurarIbsCbs(notas: EntradaApuracao[]): ApuracaoIbsCbs {
  const a: ApuracaoIbsCbs = {
    qtdSaidas: 0,
    qtdEntradasApropriaveis: 0,
    qtdEntradasBloqueadas: 0,
    qtdEntradasNaoConfirmadas: 0,
    qtdQuarentena: 0,
    baseSaidas: 0,
    baseEntradas: 0,
    debitoIBS: 0,
    debitoCBS: 0,
    debitoTotal: 0,
    creditoIBS: 0,
    creditoCBS: 0,
    creditoTotal: 0,
    bloqueadoIBS: 0,
    bloqueadoCBS: 0,
    bloqueadoTotal: 0,
    naoConfirmadoIBS: 0,
    naoConfirmadoCBS: 0,
    naoConfirmadoTotal: 0,
    saldoIBS: 0,
    saldoCBS: 0,
    saldoTotal: 0,
    resultado: 'sem-movimento',
    valorAPagar: 0,
    saldoCredor: 0,
  }

  for (const n of notas) {
    const ibs = cent(n.totalIBS)
    const cbs = cent(n.totalCBS)
    if (n.direcao === 'saida') {
      a.qtdSaidas++
      a.baseSaidas = cent(a.baseSaidas + cent(n.valorTotal))
      a.debitoIBS = cent(a.debitoIBS + ibs)
      a.debitoCBS = cent(a.debitoCBS + cbs)
    } else if (n.direcao === 'entrada') {
      a.baseEntradas = cent(a.baseEntradas + cent(n.valorTotal))
      const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
      if (regime === 'normal') {
        a.qtdEntradasApropriaveis++
        a.creditoIBS = cent(a.creditoIBS + ibs)
        a.creditoCBS = cent(a.creditoCBS + cbs)
      } else if (regime === 'simples' || regime === 'mei') {
        a.qtdEntradasBloqueadas++
        a.bloqueadoIBS = cent(a.bloqueadoIBS + ibs)
        a.bloqueadoCBS = cent(a.bloqueadoCBS + cbs)
      } else {
        a.qtdEntradasNaoConfirmadas++
        a.naoConfirmadoIBS = cent(a.naoConfirmadoIBS + ibs)
        a.naoConfirmadoCBS = cent(a.naoConfirmadoCBS + cbs)
      }
    } else {
      a.qtdQuarentena++
    }
  }

  a.debitoTotal = cent(a.debitoIBS + a.debitoCBS)
  a.creditoTotal = cent(a.creditoIBS + a.creditoCBS)
  a.bloqueadoTotal = cent(a.bloqueadoIBS + a.bloqueadoCBS)
  a.naoConfirmadoTotal = cent(a.naoConfirmadoIBS + a.naoConfirmadoCBS)
  a.saldoIBS = cent(a.debitoIBS - a.creditoIBS)
  a.saldoCBS = cent(a.debitoCBS - a.creditoCBS)
  a.saldoTotal = cent(a.saldoIBS + a.saldoCBS)

  const temMovimento = a.qtdSaidas + a.qtdEntradasApropriaveis + a.qtdEntradasBloqueadas + a.qtdEntradasNaoConfirmadas > 0
  if (!temMovimento) {
    a.resultado = 'sem-movimento'
  } else if (a.saldoTotal > 0.005) {
    a.resultado = 'a-pagar'
    a.valorAPagar = a.saldoTotal
  } else if (a.saldoTotal < -0.005) {
    a.resultado = 'saldo-credor'
    a.saldoCredor = Math.abs(a.saldoTotal)
  } else {
    a.resultado = 'zerado'
  }
  return a
}
