import { describe, expect, it } from 'vitest'
import { extrairValorRobusto, extrairSlotsSimples, extrairAnexoRobusto, extrairIntervalos } from '@/domain/services/valores-chat'

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

  it('intervalo "entre X e Y" vira média como referência (não 2 slots)', () => {
    const s = extrairSlotsSimples('Para uma empresa anexo III hj ela tem a RTB 12 de 720 mil, e fatura por mes entre 63 e 65 mil')
    expect(s.anexo).toBe('III')
    expect(s.rbt12).toBe(720000)
    expect(s.receitaMes).toBe(64000)
    expect(s.receitaIntervalo).toMatchObject({ min: 63000, max: 65000, media: 64000 })
    expect(s.rbt12Intervalo).toBeNull()
  })

  it.each([
    ['fatura entre 63 e 65 mil', 64000],
    ['receita de 63 a 65 mil', 64000],
    ['fatura 63-65 mil', 64000],
    ['faturamento mensal entre 63 e 65k', 64000],
  ])('%s → média %s', (entrada, media) => {
    const s = extrairSlotsSimples(`${entrada}, RBT12 720 mil`)
    expect(s.receitaMes).toBe(media)
    expect(s.rbt12).toBe(720000)
  })

  it('dois slots distintos não viram intervalo ("RBT12 500 mil e receita 40 mil")', () => {
    expect(extrairIntervalos('RBT12 500 mil e receita 40 mil')).toEqual([])
  })

  it('hora "16:49" nunca vira dinheiro', () => {
    expect(extrairValorRobusto('ano 16:49')).toBeNull()
  })

  it('rótulo + valor pontilhado iniciado em 12 não perde dígitos ("folha 127.500")', () => {
    const s = extrairSlotsSimples('Anexo V, RBT12 850.000,00, receita 50.000,00, folha 127.500,00')
    expect(s.anexo).toBe('V')
    expect(s.rbt12).toBe(850000)
    expect(s.receitaMes).toBe(50000)
    expect(s.folha12).toBe(127500)
  })

  it('rótulo + valor iniciado em 12 sem pontos ("rbt 120 mil")', () => {
    const s = extrairSlotsSimples('rbt 120 mil e receita 40 mil')
    expect(s.rbt12).toBe(120000)
    expect(s.receitaMes).toBe(40000)
  })
})
