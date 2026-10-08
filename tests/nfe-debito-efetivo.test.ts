/**
 * Apuração assistida: débito **efetivo** (você destacou na saída) × débito
 * **informativo** (análise pelo NCM — Pela reforma).
 *
 * Espelho do crédito efetivo:
 * - o saldo usa o efetivo dos dois lados (destacado − destacado);
 * - o NCM não compõe o saldo (vira informativo + divergência da emissão);
 * - saída legada (sem campos do XML) usa o NCM como proxy + `debitoProvisorio`.
 */
import { describe, expect, it } from 'vitest'
import { apurarIbsCbs } from '@/infrastructure/nfe/apuracao'

type Entrada = Parameters<typeof apurarIbsCbs>[0][number]

const item = (p: {
  cfop?: string
  ibs?: number
  cbs?: number
  vIbs?: number
  vCbs?: number
  vlTotal?: number
  cstIcms?: string
}): Entrada['itensAnalisados'][number] =>
  ({
    cfop: p.cfop ?? '5102',
    ibs: p.ibs ?? 0,
    cbs: p.cbs ?? 0,
    vIbsItem: p.vIbs ?? 0,
    vCbsItem: p.vCbs ?? 0,
    vlTotal: p.vlTotal ?? 100,
    cstIcms: p.cstIcms ?? '00',
  }) as never

const nota = (p: {
  direcao: 'entrada' | 'saida' | 'quarentena'
  ibs?: number
  cbs?: number
  base?: number
  crt?: string
  natOp?: string
  /** Destaque da nota; `undefined` = nota legada (campos ausentes). */
  xmlIbs?: number
  xmlCbs?: number
  omitirXml?: boolean
  itens?: ReturnType<typeof item>[]
}): Entrada => {
  const base = {
    direcao: p.direcao,
    totalIBS: p.ibs ?? 0,
    totalCBS: p.cbs ?? 0,
    valorTotal: p.base ?? 0,
    emitCrt: p.crt ?? '3',
    natOp: p.natOp ?? 'VENDA',
    itensAnalisados: p.itens ?? [item({ ibs: p.ibs ?? 0, cbs: p.cbs ?? 0 })],
  } as Entrada
  if (!p.omitirXml) {
    return {
      ...base,
      totalIbsXml: p.xmlIbs ?? 0,
      totalCbsXml: p.xmlCbs ?? 0,
    } as Entrada
  }
  return base
}

describe('débito efetivo × informativo', () => {
  it('só saída com destaque: débito efetivo vira saldo a pagar', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', xmlIbs: 90, xmlCbs: 45,
        itens: [item({ cfop: '5102', ibs: 100, cbs: 50, vIbs: 90, vCbs: 45, vlTotal: 1000 })],
      }),
    ])
    expect(a.qtdSaidas).toBe(1)
    expect(a.debitoEfetivoTotal).toBe(135)
    expect(a.debitoInformativoTotal).toBe(150)
    expect(a.divergenciaDebitoTotal).toBe(-15)
    // Compatibilidade: `debito*` histórico segue como informativo NCM.
    expect(a.debitoTotal).toBe(150)
    expect(a.creditoEfetivoTotal).toBe(0)
    expect(a.saldoTotal).toBe(135)
    expect(a.resultado).toBe('a-pagar')
    expect(a.valorAPagar).toBe(135)
    expect(a.debitoProvisorio).toBe(false)
  })

  it('saída legada usa o NCM como proxy + debitoProvisorio', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', omitirXml: true,
        itens: [item({ cfop: '5102', ibs: 100, cbs: 50, vlTotal: 1000 })],
      }),
    ])
    expect(a.debitoEfetivoTotal).toBe(150)
    expect(a.debitoInformativoTotal).toBe(150)
    expect(a.divergenciaDebitoTotal).toBe(0)
    expect(a.debitoProvisorio).toBe(true)
    expect(a.saldoTotal).toBe(150)
    expect(a.resultado).toBe('a-pagar')
  })

  it('saída sem destaque: efetivo zero, informativo preservado', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', xmlIbs: 0, xmlCbs: 0,
        itens: [item({ cfop: '5102', ibs: 100, cbs: 50, vlTotal: 1000 })],
      }),
    ])
    expect(a.debitoEfetivoTotal).toBe(0)
    expect(a.debitoInformativoTotal).toBe(150)
    expect(a.divergenciaDebitoTotal).toBe(-150)
    expect(a.saldoTotal).toBe(0)
    expect(a.resultado).toBe('zerado')
  })

  it('crédito com destaque abate o débito com destaque (saldo do período)', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 200, cbs: 100, base: 2000,
        natOp: 'VENDA', xmlIbs: 180, xmlCbs: 90,
        itens: [item({ cfop: '5102', ibs: 200, cbs: 100, vIbs: 180, vCbs: 90, vlTotal: 2000 })],
      }),
      nota({
        direcao: 'entrada', ibs: 80, cbs: 40, base: 800,
        natOp: 'COMPRA PARA COMERCIALIZACAO', xmlIbs: 70, xmlCbs: 35,
        itens: [item({ cfop: '1102', ibs: 80, cbs: 40, vIbs: 70, vCbs: 35, vlTotal: 800 })],
      }),
    ])
    expect(a.debitoEfetivoTotal).toBe(270)
    expect(a.creditoEfetivoTotal).toBe(105)
    expect(a.saldoTotal).toBe(165)
    expect(a.resultado).toBe('a-pagar')
  })

  it('crédito maior que o débito destacado gera saldo credor', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 50, cbs: 25, base: 500,
        natOp: 'VENDA', xmlIbs: 45, xmlCbs: 20,
        itens: [item({ cfop: '5102', ibs: 50, cbs: 25, vIbs: 45, vCbs: 20, vlTotal: 500 })],
      }),
      nota({
        direcao: 'entrada', ibs: 60, cbs: 30, base: 600,
        natOp: 'COMPRA PARA COMERCIALIZACAO', xmlIbs: 120, xmlCbs: 60,
        itens: [item({ cfop: '1102', ibs: 60, cbs: 30, vIbs: 120, vCbs: 60, vlTotal: 600 })],
      }),
    ])
    expect(a.saldoTotal).toBe(-115)
    expect(a.resultado).toBe('saldo-credor')
    expect(a.saldoCredor).toBe(115)
  })

  it('saída mista: só o item de venda compõe o débito efetivo', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', xmlIbs: 80, xmlCbs: 40,
        itens: [
          item({ cfop: '5102', ibs: 80, cbs: 40, vIbs: 64, vCbs: 32, vlTotal: 800 }),
          item({ cfop: '5910', ibs: 20, cbs: 10, vlTotal: 200 }),
        ],
      }),
    ])
    expect(a.debitoEfetivoTotal).toBe(96)
    expect(a.debitoInformativoTotal).toBe(120)
    expect(a.debitoSemEfeitoTotal).toBe(30)
    expect(a.baseSaidasEfetiva).toBe(800)
  })
})
