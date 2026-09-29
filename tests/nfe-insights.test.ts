/**
 * Agregações do módulo XML — evolução mensal, confronto de regimes,
 * distribuições, rankings e indicadores.
 */
import { describe, expect, it } from 'vitest'
import {
  confrontoRegimes,
  distribuicaoPorAnexo,
  evolucaoMensal,
  indicadoresXml,
  resumoDivergencias,
  topCfop,
  topCstReforma,
  topNcm,
} from '@/application/nfe-insights'

const item = (over: Record<string, unknown> = {}) => ({
  vlTotal: 100,
  ibs: 10,
  cbs: 5,
  totalTributos: 15,
  vlIcms: 18,
  vPis: 1,
  vCofins: 2,
  ncm: '02011000',
  cfop: '5102',
  descricao: 'Produto',
  codProd: 'P1',
  classificacao: { cst: '000', cClassTrib: '000001' },
  anexo: 'isento',
  ...over,
})

const nota = (over: Record<string, unknown> = {}) => ({
  dataEmissao: '2026-09-10',
  direcao: 'entrada',
  valorTotal: 100,
  totalTributos: 15,
  numero: '1',
  emitNome: 'Fornecedor',
  itensAnalisados: [item()],
  ...over,
})

describe('evolucaoMensal', () => {
  it('separa entradas e saídas por mês', () => {
    const evo = evolucaoMensal([
      nota({ dataEmissao: '2026-09-10', direcao: 'entrada' }),
      nota({ dataEmissao: '2026-09-12', direcao: 'saida', valorTotal: 200, totalTributos: 30 }),
      nota({ dataEmissao: '2026-10-01', direcao: 'entrada' }),
    ])
    expect(evo).toHaveLength(2)
    expect(evo[0]).toMatchObject({ mes: '2026-09', baseEntradas: 100, baseSaidas: 200, qtdEntradas: 1, qtdSaidas: 1 })
    expect(evo[1].rotulo).toBe('10/26')
  })

  it('ignora datas inválidas', () => {
    expect(evolucaoMensal([nota({ dataEmissao: 'invalida' })])).toHaveLength(0)
  })
})

describe('confrontoRegimes', () => {
  it('soma antigo (ICMS+PIS+COFINS) e novo (IBS+CBS)', () => {
    const c = confrontoRegimes([nota()])
    expect(c).toMatchObject({ icms: 18, pisCofins: 3, antigo: 21, ibs: 10, cbs: 5, novo: 15, delta: -6 })
  })
})

describe('distribuicoes e rankings', () => {
  it('distribuicaoPorAnexo agrupa por anexo', () => {
    const d = distribuicaoPorAnexo([nota(), nota({ itensAnalisados: [item({ anexo: '60', vlTotal: 50, totalTributos: 5 })] })])
    expect(d).toHaveLength(2)
    expect(d[0].anexo).toBe('isento')
  })

  it('topCstReforma, topCfop e topNcm ordenam e limitam', () => {
    const notas = [
      nota({ itensAnalisados: [item({ cfop: '5102', ncm: '02011000', vlTotal: 300, totalTributos: 30 })] }),
      nota({ itensAnalisados: [item({ cfop: '1102', ncm: '02012000', vlTotal: 100, totalTributos: 10 })] }),
    ]
    expect(topCfop(notas)[0].chave).toBe('5102')
    expect(topNcm(notas)[0].chave).toBe('02011000')
    expect(topCstReforma(notas)).toHaveLength(1)
    expect(topNcm(notas, 1)).toHaveLength(1)
  })
})

describe('resumoDivergencias e indicadores', () => {
  it('conta itens com/sem XML e divergentes', () => {
    const comXmlOk = item({ cstIbsCbs: '000', cClassTribIbsCbs: '000001', vIbsItem: 10, vCbsItem: 5 })
    const divergente = item({ cstIbsCbs: '200', cClassTribIbsCbs: '000002', vIbsItem: 10, vCbsItem: 5 })
    const semXml = item({ cstIbsCbs: '', cClassTribIbsCbs: '', vIbsItem: 0, vCbsItem: 0 })
    const q = resumoDivergencias([
      nota({ itensAnalisados: [comXmlOk, divergente, semXml] }),
    ] as never)
    expect(q).toMatchObject({ totalItens: 3, comXml: 2, divergentes: 1, conferem: 1, semXml: 1 })
  })

  it('indicadores calculam tickets, cargas e maior nota', () => {
    const ind = indicadoresXml([
      nota({ direcao: 'entrada', valorTotal: 100, totalTributos: 10, numero: '1', emitNome: 'A' }),
      nota({ direcao: 'saida', valorTotal: 300, totalTributos: 30, numero: '2', emitNome: 'B' }),
    ])
    expect(ind.qtd).toBe(2)
    expect(ind.ticketMedio).toBe(200)
    expect(ind.maiorNota?.numero).toBe('2')
    expect(ind.cargaEntradas).toBeCloseTo(10)
    expect(ind.ncmsDistintos).toBe(1)
  })

  it('listas vazias retornam zeros sem quebrar', () => {
    expect(evolucaoMensal([])).toEqual([])
    expect(indicadoresXml([]).qtd).toBe(0)
    expect(resumoDivergencias([]).totalItens).toBe(0)
  })
})
