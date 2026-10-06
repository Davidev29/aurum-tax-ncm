import { describe, expect, it } from 'vitest'
import { calcularTributos, motivoRegimeEspecial } from '@/domain/services/calculo'
import { ALIQUOTAS_REF } from '@/domain/constants/aliases'
import { REF_DEFAULT, REF_FONTE } from '@/domain/constants'

// C-011/C-012: gates do cálculo fiscal
describe('gate de regimes (C-011)', () => {
  const casos: Array<[string, string]> = [
    ['620', 'monofasica'],
    ['550', 'regime-aduaneiro'],
    ['410', 'imunidade'],
    ['800', 'ajuste'],
    ['810', 'ajuste'],
  ]
  for (const [cst, parte] of casos) {
    it(`CST ${cst} não gera débito (${parte})`, () => {
      expect(motivoRegimeEspecial(cst)).toMatch(new RegExp(parte.slice(0, 6), 'i'))
      const r = calcularTributos(1000, 0, 0, 19, 9, { cst })
      expect(r.total).toBe(0)
      expect(r.vIBS).toBe(0)
      expect(r.vCBS).toBe(0)
      // preserva base e não rotula como benefício
      expect(r.base).toBe(1000)
    })
  }
  it('CST 200 calcula normalmente', () => {
    expect(motivoRegimeEspecial('200')).toBe(null)
    const r = calcularTributos(1000, 0, 0, 19, 9, { cst: '200' })
    expect(r.total).toBeGreaterThan(0)
  })
  it('sem cst informado mantém comportamento legado', () => {
    const r = calcularTributos(1000, 0, 0, 19, 9)
    expect(r.total).toBe(280)
  })
})

describe('armadilha vinculo.aliquota (C-011)', () => {
  it('ALIQUOTAS_REF lança em vez de devolver fração sub-1%', async () => {
    await expect(ALIQUOTAS_REF.ibs('08031000')).rejects.toThrow(/bloqueado/)
    await expect(ALIQUOTAS_REF.cbs('08031000')).rejects.toThrow(/bloqueado/)
    await expect(ALIQUOTAS_REF.soma('08031000')).rejects.toThrow(/bloqueado/)
  })
  it('REF_DEFAULT é 19/9 soma 28 (nunca IBS 28)', () => {
    expect(REF_DEFAULT.IBS).toBe(19)
    expect(REF_DEFAULT.CBS).toBe(9)
    expect(REF_FONTE.soma).toBe(28)
  })
})

describe('golden centavos + propriedades (C-012)', () => {
  it('base 100, ref 19/9, red 60 → 7.60/3.60/11.20/carga 11.2%', () => {
    const r = calcularTributos(100, 60, 60, 19, 9)
    expect(r.vIBS).toBe(7.6)
    expect(r.vCBS).toBe(3.6)
    expect(r.total).toBe(11.2)
    expect(r.carga).toBeCloseTo(11.2, 10)
  })
  it('bcIBS/bcCBS === base cheia (redução é de alíquota, não de base)', () => {
    const r = calcularTributos(1000, 60, 60, 19, 9)
    expect(r.bcIBS).toBe(r.base)
    expect(r.bcCBS).toBe(r.base)
    expect(r.aliqIBS).toBeCloseTo(7.6, 10)
  })
  it('total = só tributos (vIBS+vCBS), não operação+tributos', () => {
    const r = calcularTributos(1000, 0, 0, 19, 9)
    expect(r.total).toBe(280) // 190 + 90 — quem soma base está usando o total da calculadora
    expect(r.valorOperacao).toBe(1000)
  })
  it('carga usa valores arredondados', () => {
    const r = calcularTributos(100, 60, 60, 19, 9)
    expect(r.carga).toBe((r.total / r.base) * 100)
  })
})
