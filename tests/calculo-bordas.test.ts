/**
 * Cálculo IBS/CBS — bordas: nunca throw, total >= 0, sem NaN no total.
 *
 * Cobre base degenerada, redução fora de [0,100] e CSTs inválidos sobre
 * `calcularTributos` (LC 214/2025 — redução de ALÍQUOTA).
 */
import { describe, expect, it } from 'vitest'
import { calcularTributos, motivoRegimeEspecial } from '@/domain/services/calculo'
import { REF_DEFAULT } from '@/domain/constants'

const { IBS: REF_IBS, CBS: REF_CBS } = REF_DEFAULT

describe('calculo bordas — base degenerada', () => {
  const bases = [NaN, Infinity, -0.01, 0, 0.005, 1e12]
  it.each(bases)('base %s: nunca throw, total >= 0, sem NaN no total', (base) => {
    let r!: ReturnType<typeof calcularTributos>
    expect(() => {
      r = calcularTributos(base, 0, 0, REF_IBS, REF_CBS)
    }).not.toThrow()
    for (const k of ['base', 'bcIBS', 'bcCBS', 'aliqIBS', 'aliqCBS', 'vIBS', 'vCBS', 'total'] as const) {
      expect(Number.isNaN(r[k]), `${k} é NaN`).toBe(false)
    }
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(r.vIBS).toBeGreaterThanOrEqual(0)
    expect(r.vCBS).toBeGreaterThanOrEqual(0)
  })

  it('carga é finita para base finita', () => {
    for (const base of [-0.01, 0, 0.005, 1e12]) {
      const r = calcularTributos(base, 0, 0, REF_IBS, REF_CBS)
      if (r.base > 0) {
        expect(Number.isNaN(r.carga), `carga NaN com base ${base}`).toBe(false)
        expect(Number.isFinite(r.carga)).toBe(true)
      }
    }
  })

  it('base 1e12 calcula ordem de grandeza correta', () => {
    const r = calcularTributos(1e12, 0, 0, REF_IBS, REF_CBS)
    expect(r.total).toBeCloseTo(1e12 * (REF_IBS + REF_CBS) / 100, -2)
  })

  it('base 0.005 arredonda para centavos sem resíduo', () => {
    const r = calcularTributos(0.005, 0, 0, REF_IBS, REF_CBS)
    expect(r.base).toBe(0.01)
    expect(r.total).toBeGreaterThanOrEqual(0)
  })
})

describe('calculo bordas — redução fora de [0,100]', () => {
  const reds: Array<[unknown, unknown]> = [
    [-5, -5],
    [100.01, 100.01],
    [Infinity, Infinity],
    [-Infinity, 50],
    [NaN, NaN],
  ]
  it.each(reds)('redIBS=%s redCBS=%s: clamp 0–100, nunca throw, total >= 0', (redIBS, redCBS) => {
    let r!: ReturnType<typeof calcularTributos>
    expect(() => {
      r = calcularTributos(1000, redIBS as number, redCBS as number, REF_IBS, REF_CBS)
    }).not.toThrow()
    expect(r.redIBS).toBeGreaterThanOrEqual(0)
    expect(r.redIBS).toBeLessThanOrEqual(100)
    expect(r.redCBS).toBeGreaterThanOrEqual(0)
    expect(r.redCBS).toBeLessThanOrEqual(100)
    expect(r.aliqIBS).toBeGreaterThanOrEqual(0)
    expect(r.aliqCBS).toBeGreaterThanOrEqual(0)
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(r.total)).toBe(false)
  })

  it('red > 100 zera a alíquota (sem alíquota negativa)', () => {
    const r = calcularTributos(1000, 150, 150, REF_IBS, REF_CBS)
    expect(r.aliqIBS).toBe(0)
    expect(r.aliqCBS).toBe(0)
    expect(r.total).toBe(0)
    expect(r.bcIBS).toBe(1000)
  })
})

describe('calculo bordas — cst inválidos', () => {
  const csts = ['', 'abc', '999', '00', null, undefined, 123 as unknown as string, {}, [] as unknown as string]
  it.each(csts)('cst=%s: nunca throw, total >= 0', (cst) => {
    let r!: ReturnType<typeof calcularTributos>
    expect(() => {
      r = calcularTributos(1000, 0, 0, REF_IBS, REF_CBS, { cst })
    }).not.toThrow()
    expect(r.total).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(r.total)).toBe(false)
  })

  it('cst desconhecido não aciona gate de regime', () => {
    expect(motivoRegimeEspecial('999')).toBeNull()
    expect(motivoRegimeEspecial('')).toBeNull()
    expect(motivoRegimeEspecial(null)).toBeNull()
  })

  it('cst sem débito continua zerando mesmo com base borda', () => {
    for (const base of [NaN, 0, 1e12]) {
      const r = calcularTributos(base, 0, 0, REF_IBS, REF_CBS, { cst: '620' })
      expect(r.total).toBe(0)
      expect(r.vIBS).toBe(0)
      expect(r.vCBS).toBe(0)
    }
  })
})

describe('calculo bordas — referências degeneradas', () => {
  it('ref NaN/Infinity/negativa não gera NaN nem throw', () => {
    for (const [ri, rc] of [[NaN, NaN], [Infinity, 9], [19, -5]] as Array<[number, number]>) {
      let r!: ReturnType<typeof calcularTributos>
      expect(() => {
        r = calcularTributos(1000, 0, 0, ri, rc)
      }).not.toThrow()
      expect(Number.isNaN(r.total)).toBe(false)
    }
  })
})
