/**
 * Fine-tuning: pergunta de alíquota do último DAS + folha só a partir do V.
 *
 * - "Qual a alíquota efetiva/base desse cálculo?" (15+ paráfrases) responde
 *   com base + efetiva do turno ou do contexto — em qualquer anexo.
 * - Folha só é pedida quando a análise está no Anexo V; no III explícito
 *   sem folha, só o DAS.
 */
import { describe, expect, it } from 'vitest'
import { detectarPerguntaAliquota } from '@/domain/services/valores-chat'
import { responderChat } from '@/application/aurum-ai-chat'

describe('detectarPerguntaAliquota', () => {
  it.each([
    'Qual a alíquota efetiva usada nesse cálculo?',
    'Qual foi a alíquota efetiva utilizada nesse cálculo?',
    'Que alíquota efetiva foi aplicada nesse cálculo?',
    'Qual alíquota efetiva foi considerada no cálculo?',
    'Qual a alíquota efetiva desse cálculo?',
    'Qual a alíquota efetiva no cálculo?',
    'Qual a alíquota efetiva para esse cálculo?',
    'Qual a alíquota efetiva incidente nesse cálculo?',
    'Qual a alíquota efetiva resultante desse cálculo?',
    'Qual a alíquota efetiva final?',
    'Qual a alíquota efetiva média?',
    'Qual o percentual efetivo usado nesse cálculo?',
    'Qual a taxa efetiva aplicada nesse cálculo?',
    'Qual a carga efetiva nesse cálculo?',
    'Qual o imposto efetivo nesse cálculo?',
    'me diga qual aquiquota efetiva',
  ])('efetiva: %s', (frase) => {
    expect(detectarPerguntaAliquota(frase)).toBe('efetiva')
  })

  it('base', () => {
    expect(detectarPerguntaAliquota('Qual a Aliquota BASE?')).toBe('base')
    expect(detectarPerguntaAliquota('qual a aliquota nominal desse calculo?')).toBe('base')
  })

  it.each([
    'o que é Fator R?',
    'o que é alíquota?',
    'Qual a alíquota?',
    'calcula 2+2',
    'Anexo III, RBT12 500 mil, receita 40 mil',
    'qual melhor III ou V?',
    'Qual a taxa de entrega?',
  ])('ignora: %s', (frase) => {
    expect(detectarPerguntaAliquota(frase)).toBeNull()
  })
})

describe('alíquota do cálculo (qualquer anexo)', () => {
  it('EX01: cálculo + pergunta na mesma frase (com typos RTB/aquiquota)', async () => {
    const r = await responderChat('Faça um calculo no Anexo II e me diga qual aquiquota efetiva: RTB 12 180 mil e receita do mes 23 mil.', [])
    expect(r.texto).toMatch(/Anexo II/)
    expect(r.texto).toMatch(/Base.*4,50%/)
    expect(r.texto).toMatch(/Efetiva.*4,5000%/)
    expect(r.texto).toContain('1.035,00')
  })

  it('EX02: pergunta no turno seguinte usa o contexto', async () => {
    const h1 = await responderChat('Faça um calculo no Anexo II RTB 12 180 mil e receita do mes 23 mil.', [])
    expect(h1.texto).toContain('1.035,00')
    const hist = [
      { papel: 'user' as const, texto: 'Faça um calculo no Anexo II RTB 12 180 mil e receita do mes 23 mil.' },
      { papel: 'assistant' as const, texto: h1.texto },
    ]
    for (const pergunta of [
      'Qual a alíquota efetiva usada nesse cálculo?',
      'Qual a alíquota efetiva final?',
      'Qual o percentual efetivo usado nesse cálculo?',
      'Qual a carga efetiva nesse cálculo?',
    ]) {
      const r = await responderChat(pergunta, hist)
      expect(r.texto).toMatch(/Efetiva.*4,5000%/i)
      expect(r.texto).toMatch(/Base.*4,50%/i)
    }
  })

  it('base e efetiva em Anexo III com RBT12 alto', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil. Qual a alíquota base?', [])
    expect(r.texto).toMatch(/Base.*13,50%/)
    expect(r.texto).toMatch(/Efetiva.*9,9720%/)
  })

  it('troca de anexo + pergunta de alíquota', async () => {
    const h1 = await responderChat('Anexo V, RBT12 500 mil, receita 40 mil', [])
    const hist = [
      { papel: 'user' as const, texto: 'Anexo V, RBT12 500 mil, receita 40 mil' },
      { papel: 'assistant' as const, texto: h1.texto },
    ]
    const r = await responderChat('e no Anexo II com os mesmos valores, qual a efetiva?', hist)
    expect(r.texto).toMatch(/Anexo II/)
    expect(r.texto).toMatch(/Efetiva.*7,2280%/)
  })
})

describe('folha só a partir do Anexo V', () => {
  it('Anexo V explícito sem folha pede a folha', async () => {
    const r = await responderChat('Anexo V, RBT12 500 mil, receita 40 mil', [])
    expect(r.texto).toMatch(/Fator R/i)
    expect(r.texto).toMatch(/folha/i)
  })

  it('Anexo III explícito sem folha não pede (só DAS)', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil', [])
    expect(r.texto).toMatch(/DAS/)
    expect(r.texto).not.toMatch(/Fator R/i)
  })

  it('Anexo II explícito sem folha não pede (só DAS)', async () => {
    const r = await responderChat('Anexo II, RBT12 180 mil, receita 23 mil', [])
    expect(r.texto).toMatch(/DAS/)
    expect(r.texto).not.toMatch(/Fator R/i)
    expect(r.texto).not.toMatch(/folha/i)
  })
})
