import { describe, expect, it } from 'vitest'
import {
  calcularConta,
  detectarConta,
  detectarContaFollowUp,
  detectarTempo,
  expressaoConta,
  formatarNumeroConta,
  parseNumeroConta,
  removerApelido,
  contemApelido,
} from '@/domain/services/basico-chat'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import { detectarForaDeEscopo } from '@/domain/services/escopo-consulta'

describe('basico-chat: tempo', () => {
  it('detecta hora', () => {
    expect(detectarTempo('Que horas são?')).toBe('hora')
    expect(detectarTempo('aurinha, que horas são?')).toBe('hora')
    expect(detectarTempo('me diz as horas agora')).toBe('hora')
  })
  it('detecta data', () => {
    expect(detectarTempo('Que dia é hoje?')).toBe('data')
    expect(detectarTempo('que dia/mes/ano é hj?')).toBe('data')
    expect(detectarTempo('qual a data de hoje?')).toBe('data')
  })
  it('bom dia não é tempo', () => {
    expect(detectarTempo('bom dia')).toBeNull()
    expect(detectarTempo('bom dia!')).toBeNull()
  })
  it('apelido', () => {
    expect(contemApelido('oi aurinha')).toBe(true)
    expect(removerApelido('aurinha, que horas são?')).toContain('que horas')
  })
})

describe('basico-chat: conta', () => {
  it('soma simbólica', () => {
    expect(detectarConta('quanto é 2+3?')).toMatchObject({ operacao: 'soma', a: 2, b: 3 })
  })
  it('subtração verbal', () => {
    expect(detectarConta('quanto é 10 menos 4?')).toMatchObject({ operacao: 'subtracao', a: 10, b: 4 })
  })
  it('multiplicação', () => {
    expect(detectarConta('quanto é 4 vezes 5?')).toMatchObject({ operacao: 'multiplicacao', a: 4, b: 5 })
    expect(detectarConta('4x5')).toMatchObject({ operacao: 'multiplicacao', a: 4, b: 5 })
  })
  it('divisão', () => {
    expect(detectarConta('10 dividido por 2')).toMatchObject({ operacao: 'divisao', a: 10, b: 2 })
    expect(detectarConta('10/2')).toMatchObject({ operacao: 'divisao', a: 10, b: 2 })
  })
  it('porcentagem', () => {
    expect(detectarConta('quanto é 10% de 500?')).toMatchObject({ operacao: 'porcentagem', a: 10, b: 500 })
  })
  it('resto', () => {
    expect(detectarConta('resto de 10 por 3')).toMatchObject({ operacao: 'resto', a: 10, b: 3 })
    expect(detectarConta('qual o resto da divisão de 10 por 3?')).toMatchObject({ operacao: 'resto', a: 10, b: 3 })
  })
  it('não rouba fiscal', () => {
    expect(detectarConta('quanto fica R$ 1.000 no NCM 08031000?')).toBeNull()
  })
  it('calcula', () => {
    expect(calcularConta({ operacao: 'soma', a: 2, b: 3 })).toBe(5)
    expect(calcularConta({ operacao: 'porcentagem', a: 10, b: 500 })).toBe(50)
    expect(calcularConta({ operacao: 'resto', a: 10, b: 3 })).toBe(1)
    expect(calcularConta({ operacao: 'divisao', a: 1, b: 0 })).toBeNull()
  })
  it('pt-BR', () => {
    expect(parseNumeroConta('1.000,50')).toBe(1000.5)
    expect(formatarNumeroConta(1000.5)).toContain('1.000')
    expect(expressaoConta({ operacao: 'soma', a: 2, b: 3 }, 5)).toContain('=')
  })
  it('follow-up usa último resultado', () => {
    const h = [
      { papel: 'user', texto: 'quanto é 2+3?' },
      { papel: 'assistant', texto: '🧮 2 + 3 = **5**\n\n**Resultado: 5**' },
    ]
    expect(detectarContaFollowUp('e mais 5?', h as never)).toMatchObject({ operacao: 'soma', a: 5, b: 5 })
  })
})

describe('detector: tempo/conta/apelido', () => {
  it('hora vai para tempo', () => {
    expect(detectarIntencaoChat('Que horas são?').intencao).toBe('tempo')
    expect(detectarIntencaoChat('aurinha, que horas são?').intencao).toBe('tempo')
  })
  it('data vai para tempo', () => {
    expect(detectarIntencaoChat('Que dia é hoje?').intencao).toBe('tempo')
    expect(detectarIntencaoChat('que dia/mes/ano é hj?').intencao).toBe('tempo')
  })
  it('conta vai para conta', () => {
    expect(detectarIntencaoChat('quanto é 2+3?').intencao).toBe('conta')
    expect(detectarIntencaoChat('10% de 500').intencao).toBe('conta')
    expect(detectarIntencaoChat('resto de 10 por 3').intencao).toBe('conta')
    expect(detectarIntencaoChat('calcula 4 vezes 5').intencao).toBe('conta')
  })
  it('apelido sozinho vira saudação; identidade vira capacidades', () => {
    expect(detectarIntencaoChat('Aurinha?').intencao).toBe('saudacao')
    expect(detectarIntencaoChat('oi aurinha').intencao).toBe('saudacao')
    expect(detectarIntencaoChat('você é a Aurinha?').intencao).toBe('capacidades')
  })
  it('conta não é fora de escopo', () => {
    expect(detectarForaDeEscopo('quanto é 2+3?')).toBe(false)
    expect(detectarForaDeEscopo('que horas são?')).toBe(false)
  })
})
