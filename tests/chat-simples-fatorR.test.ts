import { describe, expect, it } from 'vitest'
import { fmtMoeda, fmtMoedaEficiente, fmtBRL } from '@/domain/services/format'
import {
  extrairSlotsSimples,
  extrairValorRobusto,
  aplicarEdicaoSimples,
  classificarSlotEdicao,
  resolverFolhaPercentual,
} from '@/domain/services/valores-chat'
import { responderChat } from '@/application/aurum-ai-chat'

describe('fine-tuning v6 — formatador de moeda eficiente', () => {
  const normEspaco = (s: string): string => s.replace(/ /g, ' ')
  it('fmtMoedaEficiente bate com fmtMoeda e fmtBRL (a menos de NBSP)', () => {
    for (const v of [0, 1, 50, 1234.56, 500000, 168000, 123456789.01]) {
      expect(fmtMoedaEficiente(v)).toBe(fmtMoeda(v))
      // Intl usa NBSP após "R$"; o manual usa espaço — normaliza antes de comparar.
      expect(normEspaco(fmtMoedaEficiente(v))).toBe(normEspaco(fmtBRL(v)))
    }
  })
  it('vazio/NaN/Infinity viram placeholder sem quebrar', () => {
    expect(fmtMoedaEficiente(null)).toBe('—')
    expect(fmtMoedaEficiente(NaN)).toBe('—')
    expect(fmtMoedaEficiente(Infinity)).toBe('—')
    expect(fmtMoedaEficiente('')).toBe('—')
  })
  it('parse cobre dialetos (colado, sem acento, contos, reais)', () => {
    expect(extrairValorRobusto('R$500mil')).toBe(500000)
    expect(extrairValorRobusto('500mil')).toBe(500000)
    expect(extrairValorRobusto('60k')).toBe(60000)
    expect(extrairValorRobusto('1 milhao')).toBe(1000000)
    expect(extrairValorRobusto('1.500,00 reais')).toBe(1500)
    expect(extrairValorRobusto('5.000 reais')).toBe(5000)
    expect(extrairValorRobusto('40 contos')).toBe(40000)
    expect(extrairValorRobusto('Anexo III')).toBeNull()
  })
  it('receita pra 50 mil ancora com preposição pra/para', () => {
    const s = extrairSlotsSimples('troca a receita pra 50 mil')
    expect(s.receitaMes).toBe(50000)
  })
  it('30% do RBT resolve contra o RBT', () => {
    expect(resolverFolhaPercentual('aumenta folha pra 30% do RBT', 600000)).toBe(180000)
    expect(classificarSlotEdicao('aumenta folha pra 30% do RBT')).toBe('folha12')
  })
})

describe('fine-tuning v6 — Fator R <28% sugere folha + botão refazer', () => {
  it('Anexo III com folha 60 mil em RBT12 600 mil avisa que não é III', async () => {
    const r = await responderChat('Anexo III, RBT12 600 mil, receita 50 mil, folha 60 mil', [])
    expect(r.texto).toMatch(/não é tributada pelo Anexo III/i)
    expect(r.texto).toMatch(/Anexo V/)
    // folha mínima = 28% × 600.000 = 168.000
    expect(r.texto).toContain('168.000')
    expect(r.texto).toMatch(/Aumente sua folha/i)
    const botao = r.botoes?.find((b) => b.alvo.startsWith('__RECALCULAR_FATOR_R__'))
    expect(botao).toBeDefined()
    expect(botao?.alvo).toContain('FOLHA=168000')
    expect(botao?.alvo).toContain('RBT12=600000')
    expect(botao?.alvo).toContain('RECEITA=50000')
  }, 15000)

  it('botão refazer recalcula com a folha sugerida herdando RBT/receita', async () => {
    const r1 = await responderChat('Anexo III, RBT12 600 mil, receita 50 mil, folha 60 mil', [])
    const alvo = r1.botoes?.find((b) => b.alvo.startsWith('__RECALCULAR_FATOR_R__'))?.alvo
    expect(alvo).toBeDefined()
    const r2 = await responderChat(alvo!, [])
    expect(r2.texto).toContain('168.000')
    expect(r2.texto).toMatch(/Fator R.*28,00%/i)
  }, 15000)

  it('Fator R >=28% não sugere aumento', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil, folha 200 mil', [])
    expect(r.texto).toMatch(/enquadrado/i)
    expect(r.texto).not.toMatch(/não é tributada pelo Anexo III/i)
    expect(r.botoes?.some((b) => b.alvo.startsWith('__RECALCULAR_FATOR_R__'))).toBe(false)
  }, 15000)
})

describe('fine-tuning v6 — edição multi-dialeto refaz o cálculo', () => {
  const base = [
    { papel: 'user' as const, texto: 'Anexo III, RBT12 600 mil, receita 50 mil, folha 60 mil' },
    { papel: 'assistant' as const, texto: 'Fator R abaixo de 28%' },
  ]
  it('e com folha 200 mil? altera só a folha', async () => {
    const r = await responderChat('e com folha 200 mil?', base)
    expect(r.texto).toContain('200.000')
    expect(r.texto).toMatch(/Alterado: folha/i)
  }, 15000)
  it('e com 200 mil? (avulso após Fator R) vira folha, não RBT', async () => {
    const r = await responderChat('e com 200 mil?', base)
    expect(r.texto).toContain('200.000')
    expect(r.texto).not.toContain('RBT12 R$ 200.000')
  }, 15000)
  it('corrige o RBT12 para 1,2mi altera só o RBT', async () => {
    const r = await responderChat('corrige o RBT12 para 1,2mi', base)
    expect(r.texto).toContain('1.200.000')
    expect(r.texto).toMatch(/Alterado: RBT12/i)
  }, 15000)
  it('aumenta folha pra 30% do RBT resolve 180 mil', async () => {
    const r = await responderChat('aumenta folha pra 30% do RBT', base)
    expect(r.texto).toContain('180.000')
  }, 15000)
  it('bota anexo V troca o anexo mantendo valores', async () => {
    const r = await responderChat('bota anexo V', [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III' },
    ])
    expect(r.texto).toMatch(/Anexo V/)
  }, 15000)
  it('aplicarEdicaoSimples não cria RBT fantasma', () => {
    const ctx = { ultimoAnexo: 'III' as const, ultimoRbt12: 600000, ultimaReceita: 50000, ultimaFolha: 60000 }
    const slots = extrairSlotsSimples('e com 200 mil?')
    const ed = aplicarEdicaoSimples('e com 200 mil?', slots, ctx)
    expect(ed.folha12).toBe(200000)
    expect(ed.rbt12).toBe(600000)
    expect(ed.receitaMes).toBe(50000)
    expect(ed.slotAlterado).toBe('folha12')
  })
})
