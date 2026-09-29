/**
 * Agregações da tela SPED — evolução mensal, confronto de regimes,
 * distribuições e indicadores.
 */
import { describe, expect, it } from 'vitest'
import {
  confrontoRegimesSped,
  distribuicaoPorAnexoSped,
  evolucaoMensalSped,
  indicadoresResumoSped,
  indicadoresSped,
  normalizarMes,
  topCfopSped,
  topCstIcmsSped,
  topCstSped,
  topNcmSped,
} from '@/application/sped-insights'

const item = (over: Record<string, unknown> = {}) => ({
  data: '10/09/2026',
  vlItem: 100,
  totalTributos: 15,
  ibs: 10,
  cbs: 5,
  vlIcms: 18,
  vlPis: 1,
  vlCofins: 2,
  ncm: '02011000',
  cfop: '5102',
  descricaoProduto: 'Produto',
  codItem: 'P1',
  classificacao: { cst: '000', cClassTrib: '000001' },
  anexo: 'isento',
  regraGeral: false,
  ...over,
})

describe('normalizarMes', () => {
  it('aceita dd/mm/aaaa e ISO', () => {
    expect(normalizarMes('10/09/2026')).toBe('2026-09')
    expect(normalizarMes('2026-10-05')).toBe('2026-10')
    expect(normalizarMes('invalida')).toBeNull()
  })
})

describe('evolucaoMensalSped', () => {
  it('agrupa por mês com base, tributos e regime antigo', () => {
    const evo = evolucaoMensalSped([
      item({ data: '10/09/2026' }),
      item({ data: '12/09/2026', vlItem: 200, totalTributos: 30 }),
      item({ data: '01/10/2026' }),
    ])
    expect(evo).toHaveLength(2)
    expect(evo[0]).toMatchObject({ mes: '2026-09', base: 300, trib: 45, qtd: 2 })
    expect(evo[0].antigo).toBe(42)
    expect(evo[1].rotulo).toBe('10/26')
  })
})

describe('confrontoRegimesSped', () => {
  it('soma antigo e novo', () => {
    expect(confrontoRegimesSped([item()])).toMatchObject({
      icms: 18, pisCofins: 3, antigo: 21, ibs: 10, cbs: 5, novo: 15, delta: -6,
    })
  })
})

describe('distribuicoes e rankings', () => {
  it('agrupa por anexo, CST, CFOP e NCM', () => {
    const itens = [
      item({ anexo: 'isento', cfop: '5102', ncm: '02011000', vlItem: 300, totalTributos: 30 }),
      item({ anexo: '60', cfop: '1102', ncm: '02012000', vlItem: 100, totalTributos: 10 }),
    ]
    expect(distribuicaoPorAnexoSped(itens)).toHaveLength(2)
    expect(topCstSped(itens)).toHaveLength(1)
    expect(topCfopSped(itens)[0].chave).toBe('5102')
    expect(topNcmSped(itens)[0].chave).toBe('02011000')
    expect(topCstIcmsSped([{ cstIcms: '00', vlItem: 50, totalTributos: 5 }])[0].chave).toBe('00')
  })
})

describe('indicadores', () => {
  it('modo itens calcula ticket, maior item e qualidade', () => {
    const ind = indicadoresSped([
      item({ vlItem: 100, codItem: 'A' }),
      item({ vlItem: 300, codItem: 'B', regraGeral: true }),
    ] as never)
    expect(ind.qtd).toBe(2)
    expect(ind.ticketMedio).toBe(200)
    expect(ind.maiorItem?.codigo).toBe('B')
    expect(ind.regraGeral).toBe(1)
    expect(ind.ncmsDistintos).toBe(1)
  })

  it('modo resumo agrega grupos', () => {
    const r = indicadoresResumoSped([
      { qtdNotas: 2, totalOperacao: 100, totalTributos: 10, totalIcms: 18 },
      { qtdNotas: 1, totalOperacao: 200, totalTributos: 20, totalIcms: 36 },
    ] as never)
    expect(r).toMatchObject({ grupos: 2, notas: 3, base: 300, trib: 30, icms: 54 })
  })

  it('listas vazias não quebram', () => {
    expect(evolucaoMensalSped([])).toEqual([])
    expect(indicadoresSped([]).qtd).toBe(0)
  })
})
