import { describe, expect, it } from 'vitest'
import { extrairValorRobusto, extrairSlotsSimples, extrairAnexoRobusto } from '@/domain/services/valores-chat'

describe('valores PT-BR (fine-tuning extensivo)', () => {
  it.each([
    ['R$ 500.000,00', 500000],
    ['500 mil', 500000],
    ['500k', 500000],
    ['500K', 500000],
    ['1 milhão', 1000000],
    ['1 milhao', 1000000],
    ['1,5 mi', 1500000],
    ['1.2M', 1200000],
    ['500.000', 500000],
    ['500,00', 500],
    ['faturamento de 2 milhões', 2000000],
    ['2 bi', 2000000000],
  ])('%s → %s', (entrada, esperado) => {
    expect(extrairValorRobusto(entrada)).toBe(esperado)
  })

  it('desambigua RBT12 + receita (o caso que falhava)', () => {
    const s = extrairSlotsSimples('RBT12 500 mil e receita 40 mil')
    expect(s.rbt12).toBe(500000)
    expect(s.receitaMes).toBe(40000)
  })

  it('anexo por extenso e número', () => {
    expect(extrairAnexoRobusto('terceiro anexo')).toBe('III')
    expect(extrairAnexoRobusto('anexo 3')).toBe('III')
    expect(extrairAnexoRobusto('Anexo III')).toBe('III')
  })

  it('não confunde Anexo III, NCM ou % com dinheiro', () => {
    expect(extrairValorRobusto('Anexo III')).toBeNull()
    expect(extrairValorRobusto('NCM 08031000')).toBeNull()
  })

  it('folha ausente retorna null (aviso, não chute)', () => {
    expect(extrairSlotsSimples('RBT12 500 mil').folha12).toBeNull()
  })
})
