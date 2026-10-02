/**
 * Autonomia do RAG — correção ortográfica de runtime + hipótese de NCM parcial.
 *
 * Garantias:
 * - typos conhecidos são corrigidos sem tocar na base oficial;
 * - NCM parcial (2–7 dígitos) vira hipótese navegável, nunca NÃO SEI seco;
 * - texto normal continua intacto.
 */
import { describe, expect, it } from 'vitest'
import { corrigirTextoConsulta } from '@/domain/services/correcao-consulta'
import { hipoteseNcmParcial } from '@/application/classificacao-inteligente'

describe('corrigirTextoConsulta (segunda chance)', () => {
  it('corrige typos conhecidos preservando o resto', () => {
    const r = corrigirTextoConsulta('queijo parmezao ralado')
    expect(r.alterado).toBe(true)
    expect(r.textoCorrigido).toMatch(/parmesao/)
    expect(r.correcoes).toEqual(['parmezao→parmesao'])
  })

  it('texto limpo passa intacto', () => {
    const r = corrigirTextoConsulta('queijo parmesao ralado')
    expect(r.alterado).toBe(false)
    expect(r.correcoes).toEqual([])
  })

  it('vazio não quebra', () => {
    expect(corrigirTextoConsulta('').alterado).toBe(false)
    expect(corrigirTextoConsulta('   ').alterado).toBe(false)
  })
})

describe('hipoteseNcmParcial (NCM incompleto)', () => {
  it('2–7 dígitos sem letras viram hipótese', () => {
    expect(hipoteseNcmParcial('0406')).toBe('0406')
    expect(hipoteseNcmParcial('10.05')).toBe('1005')
    expect(hipoteseNcmParcial('2309.10')).toBe('230910')
  })

  it('8 dígitos (completo) e texto não são hipótese parcial', () => {
    expect(hipoteseNcmParcial('02011000')).toBeNull()
    expect(hipoteseNcmParcial('queijo parmesao')).toBeNull()
    expect(hipoteseNcmParcial('queijo 0406')).toBeNull()
    expect(hipoteseNcmParcial('')).toBeNull()
  })
})
