import { describe, expect, it } from 'vitest'
import { calcularConvencionalEstrito } from '@/simples/calculo'

// C-006: motor estrito fail-closed — nunca DAS zero ou número fictício.
describe('calcularConvencionalEstrito (C-006)', () => {
  it('lança em vez de DAS zero: rbt/receita <= 0', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 0, receitaMes: 50000 } as never)).toThrow(/rbt12/)
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 500000, receitaMes: 0 } as never)).toThrow(/receita/)
  })
  it('lança acima de 4.8M (desenquadramento)', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 5000000, receitaMes: 50000 } as never)).toThrow(/desenquadramento/)
  })
  it('lança com anexo inválido', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'XX', rbt12: 500000, receitaMes: 50000 } as never)).toThrow(/anexo-invalido/)
  })
  it('caso válido calcula', () => {
    const r = calcularConvencionalEstrito({ anexoId: 'III', rbt12: 500000, receitaMes: 50000 } as never)
    expect(r.das).toBeGreaterThan(0)
  })
})
