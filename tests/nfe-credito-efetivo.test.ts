/**
 * Apuração assistida: crédito **efetivo** (veio na nota) × crédito
 * **informativo** (análise pelo NCM — Pela reforma).
 *
 * - O saldo usa o efetivo; o NCM não abate (vira informativo + divergência).
 * - CFOP diferente de venda / imobilizado cai nos buckets, fora do crédito.
 * - Nota legada (sem campos do XML) usa o NCM como proxy + `creditoProvisorio`.
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
    cfop: p.cfop ?? '1102',
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

describe('crédito efetivo × informativo', () => {
  it('saldo usa o efetivo; NCM vira informativo + divergência', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 200, cbs: 100, base: 2000, omitirXml: true, itens: [] }),
      nota({
        direcao: 'entrada', ibs: 80, cbs: 40, base: 800,
        omitirXml: true,
        itens: [item({ cfop: '1102', ibs: 80, cbs: 40 })],
      }),
    ])
    // Legado (sem campos do XML): proxy NCM, comportamento histórico mantido.
    expect(a.creditoEfetivoTotal).toBe(120)
    expect(a.creditoInformativoTotal).toBe(120)
    expect(a.saldoTotal).toBe(180)
    expect(a.resultado).toBe('a-pagar')
    expect(a.creditoProvisorio).toBe(true)
  })

  it('entrada com destaque usa os valores da nota', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 200, cbs: 100, base: 2000, omitirXml: true, itens: [] }),
      nota({
        direcao: 'entrada', ibs: 80, cbs: 40, base: 800,
        xmlIbs: 50, xmlCbs: 25,
        itens: [item({ cfop: '1102', ibs: 80, cbs: 40, vIbs: 50, vCbs: 25, vlTotal: 800 })],
      }),
    ])
    expect(a.creditoInformativoTotal).toBe(120)
    expect(a.creditoEfetivoTotal).toBe(75)
    expect(a.divergenciaCreditoTotal).toBe(-45)
    expect(a.saldoTotal).toBe(225)
    expect(a.qtdEntradasEfetivas).toBe(1)
    expect(a.baseEntradasEfetiva).toBe(800)
    expect(a.creditoProvisorio).toBe(false)
  })

  it('XML sem destaque: efetivo zero, informativo preservado', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 100, cbs: 50, base: 1000, omitirXml: true, itens: [] }),
      nota({
        direcao: 'entrada', ibs: 100, cbs: 50, base: 1000,
        xmlIbs: 0, xmlCbs: 0,
        itens: [item({ cfop: '1102', ibs: 100, cbs: 50 })],
      }),
    ])
    expect(a.creditoEfetivoTotal).toBe(0)
    expect(a.creditoInformativoTotal).toBe(150)
    expect(a.saldoTotal).toBe(150)
    expect(a.resultado).toBe('a-pagar')
  })

  it('destaque maior que o débito gera saldo credor assistido', () => {
    const a = apurarIbsCbs([
      nota({ direcao: 'saida', ibs: 50, cbs: 25, base: 500, omitirXml: true, itens: [] }),
      nota({
        direcao: 'entrada', ibs: 60, cbs: 30, base: 600,
        xmlIbs: 120, xmlCbs: 60,
        itens: [item({ cfop: '1102', ibs: 60, cbs: 30, vIbs: 120, vCbs: 60, vlTotal: 600 })],
      }),
    ])
    expect(a.saldoTotal).toBe(-105)
    expect(a.resultado).toBe('saldo-credor')
    expect(a.saldoCredor).toBe(105)
  })

  it('CFOP diferente de venda cai no sem-efeito, fora do crédito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'entrada', ibs: 30, cbs: 15, base: 300,
        natOp: 'REMESSA EM BONIFICACAO', xmlIbs: 0, xmlCbs: 0,
        itens: [item({ cfop: '5910', ibs: 30, cbs: 15 })],
      }),
    ])
    expect(a.qtdEntradasApropriaveis).toBe(0)
    expect(a.qtdSemEfeito).toBe(1)
    expect(a.semEfeitoTotal).toBe(45)
    expect(a.creditoEfetivoTotal).toBe(0)
    expect(a.creditoInformativoTotal).toBe(0)
    expect(a.resultado).toBe('zerado')
  })

  it('compra p/ imobilizado não gera crédito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'entrada', ibs: 100, cbs: 50, base: 5000,
        natOp: 'COMPRA DE BEM PARA O ATIVO IMOBILIZADO', xmlIbs: 0, xmlCbs: 0,
        itens: [item({ cfop: '1551', ibs: 100, cbs: 50, vlTotal: 5000 })],
      }),
    ])
    expect(a.qtdImobilizado).toBe(1)
    expect(a.imobilizadoTotal).toBe(150)
    expect(a.creditoEfetivoTotal).toBe(0)
    expect(a.resultado).toBe('zerado')
  })

  it('nota mista: só o item de compra compõe o crédito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'entrada', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', xmlIbs: 0, xmlCbs: 0,
        itens: [
          item({ cfop: '1102', ibs: 80, cbs: 40, vIbs: 60, vCbs: 30, vlTotal: 800 }),
          item({ cfop: '5910', ibs: 20, cbs: 10, vlTotal: 200 }),
        ],
      }),
    ])
    expect(a.creditoInformativoTotal).toBe(120)
    expect(a.creditoEfetivoTotal).toBe(90)
    expect(a.semEfeitoTotal).toBe(30)
    expect(a.baseEntradasEfetiva).toBe(800)
  })
})

describe('direção correta: emitiu = débito, recebeu = crédito (só venda)', () => {
  it('só saída de venda = débito, nenhum crédito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', omitirXml: true,
        itens: [item({ cfop: '5102', ibs: 100, cbs: 50, vlTotal: 1000 })],
      }),
    ])
    expect(a.debitoTotal).toBe(150)
    expect(a.qtdSaidas).toBe(1)
    expect(a.creditoEfetivoTotal).toBe(0)
    expect(a.creditoInformativoTotal).toBe(0)
    expect(a.saldoTotal).toBe(150)
    expect(a.resultado).toBe('a-pagar')
  })

  it('saída fora de venda não compõe o débito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'REMESSA EM BONIFICACAO', omitirXml: true,
        itens: [item({ cfop: '5910', ibs: 100, cbs: 50, vlTotal: 1000 })],
      }),
    ])
    expect(a.qtdSaidas).toBe(0)
    expect(a.debitoTotal).toBe(0)
    expect(a.qtdSaidasSemEfeito).toBe(1)
    expect(a.debitoSemEfeitoTotal).toBe(150)
    expect(a.saldoTotal).toBe(0)
    expect(a.resultado).toBe('zerado')
  })

  it('saída mista: só o item de venda compõe o débito', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 100, cbs: 50, base: 1000,
        natOp: 'VENDA', omitirXml: true,
        itens: [
          item({ cfop: '5102', ibs: 80, cbs: 40, vlTotal: 800 }),
          item({ cfop: '5910', ibs: 20, cbs: 10, vlTotal: 200 }),
        ],
      }),
    ])
    expect(a.debitoTotal).toBe(120)
    expect(a.debitoSemEfeitoTotal).toBe(30)
    expect(a.qtdSaidas).toBe(1)
    expect(a.qtdSaidasSemEfeito).toBe(1)
  })

  it('emitiu venda e recebeu venda com destaque: débito − crédito efetivo', () => {
    const a = apurarIbsCbs([
      nota({
        direcao: 'saida', ibs: 200, cbs: 100, base: 2000,
        natOp: 'VENDA', omitirXml: true,
        itens: [item({ cfop: '5102', ibs: 200, cbs: 100, vlTotal: 2000 })],
      }),
      nota({
        direcao: 'entrada', ibs: 80, cbs: 40, base: 800,
        natOp: 'COMPRA PARA COMERCIALIZACAO', xmlIbs: 70, xmlCbs: 35,
        itens: [item({ cfop: '1102', ibs: 80, cbs: 40, vIbs: 70, vCbs: 35, vlTotal: 800 })],
      }),
    ])
    // Você emitiu (saída/venda) = seu débito; recebeu (entrada/venda) = seu crédito.
    expect(a.debitoTotal).toBe(300)
    expect(a.creditoEfetivoTotal).toBe(105)
    expect(a.creditoInformativoTotal).toBe(120)
    expect(a.saldoTotal).toBe(195)
    expect(a.resultado).toBe('a-pagar')
  })
})
