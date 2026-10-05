import { describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import {
  historicoSlotsSimples,
  observarIntencaoSimples,
  resolverValorPorReferencia,
  resolverAnexoPorReferencia,
  anexoExigeFolha,
} from '@/domain/services/valores-chat'

describe('v7 — pilha e intenção contínua', () => {
  it('historicoSlotsSimples empilha por fala em ordem', () => {
    const p = historicoSlotsSimples([
      'Anexo III, RBT12 500 mil, receita 40 mil',
      'corrige RBT pra 600 mil',
      'e com folha 150 mil?',
    ])
    expect(p.turnos.length).toBe(3)
    expect(p.turnos[0].rbt12).toBe(500000)
    expect(p.turnos[1].rbt12).toBe(600000)
    expect(p.turnos[2].folha12).toBe(150000)
    expect(p.topo?.folha12).toBe(150000)
  })
  it('resolverValorPorReferencia: primeiro/anterior', () => {
    expect(resolverValorPorReferencia('usa o primeiro RBT', [500000, 600000, 700000])).toBe(500000)
    expect(resolverValorPorReferencia('volta para o RBT anterior', [500000, 600000])).toBe(500000)
    expect(resolverValorPorReferencia('o último RBT', [500000, 600000])).toBe(600000)
  })
  it('resolverAnexoPorReferencia: o outro', () => {
    expect(resolverAnexoPorReferencia('e no outro anexo?', ['III', 'V'], 'V', null)).toBe('III')
    expect(resolverAnexoPorReferencia('e no outro anexo?', ['III'], 'III', null)).toBeNull()
    expect(resolverAnexoPorReferencia('troca para o V', ['III'], 'III', 'V')).toBe('V')
  })
  it('anexoExigeFolha: só III/V', () => {
    expect(anexoExigeFolha('III')).toBe(true)
    expect(anexoExigeFolha('V')).toBe(true)
    expect(anexoExigeFolha('I')).toBe(false)
    expect(anexoExigeFolha('II')).toBe(false)
    expect(anexoExigeFolha('IV')).toBe(false)
  })
  it('observarIntencaoSimples: ordem reverte > troca > edita', () => {
    expect(observarIntencaoSimples('volta para o RBT anterior', { temContexto: true }).tipo).toBe('reverte')
    expect(observarIntencaoSimples('troca para o Anexo V com os mesmos valores', { temContexto: true }).tipo).toBe('troca_anexo')
    expect(observarIntencaoSimples('qual melhor, III ou V?', { temContexto: true }).tipo).toBe('comparativo')
    expect(observarIntencaoSimples('aumenta a folha pra 30% do RBT', { temContexto: true }).tipo).toBe('edita_slot')
  })
})

describe('v7 — troca de anexo com mesmos valores', () => {
  const base = [
    { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil, folha 150 mil' },
    { papel: 'assistant' as const, texto: 'Anexo III calculado' },
  ]
  it('troca para o V mantém RBT/receita/folha', async () => {
    const r = await responderChat('troca para o Anexo V com os mesmos valores', base)
    expect(r.texto).toMatch(/Anexo V/)
    expect(r.texto).toContain('500.000')
    expect(r.texto).toContain('40.000')
    expect(r.texto).toContain('150.000')
    expect(r.texto).toMatch(/mesmos valores|Alterado: Anexo/i)
  }, 15000)
  it('e no Anexo I arquiva a folha (não exige Fator R)', async () => {
    const r = await responderChat('e no Anexo I com os mesmos valores?', base)
    expect(r.texto).toMatch(/Anexo I/)
    expect(r.texto).toContain('500.000')
    expect(r.texto).not.toMatch(/Fator R/i)
    expect(r.texto).not.toContain('150.000')
  }, 15000)
  it('volta para a receita anterior após edição', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil, folha 150 mil' },
      { papel: 'assistant' as const, texto: 'ok' },
      { papel: 'user' as const, texto: 'troca a receita pra 50 mil' },
      { papel: 'assistant' as const, texto: 'Alterado: receita' },
    ]
    const r = await responderChat('volta para a receita anterior', hist)
    expect(r.texto).toContain('40.000')
  }, 15000)
  it('usa o primeiro RBT após duas mudanças', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil' },
      { papel: 'assistant' as const, texto: 'ok' },
      { papel: 'user' as const, texto: 'corrige RBT pra 600 mil' },
      { papel: 'assistant' as const, texto: 'ok' },
      { papel: 'user' as const, texto: 'corrige RBT pra 700 mil' },
      { papel: 'assistant' as const, texto: 'ok' },
    ]
    const r = await responderChat('usa o primeiro RBT', hist)
    expect(r.texto).toContain('500.000')
  }, 15000)
  it('e no outro anexo? com III e V na pilha resolve sem chutar', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil' },
      { papel: 'assistant' as const, texto: 'ok' },
      { papel: 'user' as const, texto: 'troca para o Anexo V com os mesmos valores' },
      { papel: 'assistant' as const, texto: 'ok' },
    ]
    const r = await responderChat('e no outro anexo?', hist)
    expect(r.texto).toMatch(/Anexo III/)
  }, 15000)
  it('faz o cálculo mudando só a folha pra 200 mil', async () => {
    const r = await responderChat('faz o cálculo mudando só a folha pra 200 mil', base)
    expect(r.texto).toContain('200.000')
    expect(r.texto).toMatch(/Alterado: folha/i)
  }, 15000)
})
