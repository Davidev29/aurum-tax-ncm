/**
 * Leitura do crédito que veio no XML (CSTs + ICMS destacado).
 */
import { describe, expect, it } from 'vitest'
import { creditoDaNota, creditoDoItem } from '@/infrastructure/nfe/credito'

const item = (p: Partial<Parameters<typeof creditoDoItem>[0]> = {}) => ({
  cstIcms: '',
  cstPis: '',
  cstCofins: '',
  vlIcms: 0,
  ...p,
})

describe('creditoDoItem', () => {
  it('ICMS com valor destacado gera crédito mesmo sem CST', () => {
    expect(creditoDoItem(item({ vlIcms: 36 }))).toMatchObject({ temCredito: true, fontes: ['ICMS'] })
  })

  it('CST 00/20/90 e CSOSN 101 geram crédito; 40/60 e 102 não', () => {
    expect(creditoDoItem(item({ cstIcms: '00' })).temCredito).toBe(true)
    expect(creditoDoItem(item({ cstIcms: '20' })).temCredito).toBe(true)
    expect(creditoDoItem(item({ cstIcms: '101' })).temCredito).toBe(true)
    expect(creditoDoItem(item({ cstIcms: '40' })).temCredito).toBe(false)
    expect(creditoDoItem(item({ cstIcms: '60' })).temCredito).toBe(false)
    expect(creditoDoItem(item({ cstIcms: '102' })).temCredito).toBe(false)
  })

  it('PIS/COFINS 50–56 e 60–66 geram crédito; 01/04 não', () => {
    expect(creditoDoItem(item({ cstPis: '50', cstCofins: '50' })).fontes).toEqual(['PIS', 'COFINS'])
    expect(creditoDoItem(item({ cstPis: '60' })).fontes).toEqual(['PIS'])
    expect(creditoDoItem(item({ cstPis: '01', cstCofins: '04' })).temCredito).toBe(false)
  })

  it('combina fontes sem duplicar', () => {
    const c = creditoDoItem(item({ cstIcms: '00', cstPis: '53', vlIcms: 10 }))
    expect(c.fontes).toEqual(['ICMS', 'PIS'])
  })
})

describe('creditoDaNota', () => {
  it('agrega itens, ICMS destacado e fontes', () => {
    const n = creditoDaNota([
      item({ cstIcms: '00', vlIcms: 36 }),
      item({ cstIcms: '40' }),
      item({ cstPis: '50', cstCofins: '01' }),
    ])
    expect(n).toMatchObject({
      totalItens: 3,
      itensComCredito: 2,
      icmsDestacado: 36,
      fontes: ['ICMS', 'PIS'],
    })
  })

  it('nota sem crédito zera tudo', () => {
    expect(creditoDaNota([item({ cstIcms: '102' })])).toMatchObject({
      itensComCredito: 0,
      icmsDestacado: 0,
      fontes: [],
    })
  })
})
