import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'

describe('detector-chat (Aurum AI)', () => {
  it('roteia "tem algum ncm de banana" para ncm', () => {
    expect(detectarIntencaoChat('tem algum ncm de banana').intencao).toBe('ncm')
  })
  it('roteia atividade para nbs', () => {
    expect(detectarIntencaoChat('qual seria a nbs para aula de yoga?').intencao).toBe('nbs')
  })
  it('roteia valor + código para calculo', () => {
    const a = detectarIntencaoChat('quanto fica R$ 1.000 no NCM 08031000?')
    expect(a.intencao).toBe('calculo')
    expect(a.valorBase).toBe(1000)
  })
  it('roteia DAS/anexo para simples', () => {
    expect(detectarIntencaoChat('meu DAS no Anexo III com RBT12 500 mil').intencao).toBe('simples')
  })
  it('roteia pedido de relatório', () => {
    expect(detectarIntencaoChat('gera um relatório dessa conversa').intencao).toBe('relatorio')
  })
  it('saudação não vira RAG', () => {
    expect(detectarIntencaoChat('oi').intencao).toBe('saudacao')
  })
  it('capacidades: "o que você pode fazer?" não vira RAG', () => {
    expect(detectarIntencaoChat('o que você pode fazer?').intencao).toBe('capacidades')
    expect(detectarIntencaoChat('quais suas funções?').intencao).toBe('capacidades')
    expect(detectarIntencaoChat('para que você serve?').intencao).toBe('capacidades')
    expect(detectarIntencaoChat('quem é você?').intencao).toBe('capacidades')
  })
  it('ajuda / navegar / status', () => {
    expect(detectarIntencaoChat('como consultar um NCM?').intencao).toBe('ajuda')
    const nav = detectarIntencaoChat('me leva para a calculadora')
    expect(nav.intencao).toBe('navegar')
    expect(nav.destino).toBe('calculadora')
    expect(detectarIntencaoChat('a base está pronta?').intencao).toBe('status')
  })
  it('vago sem lastro fiscal vira generico (pede esclarecimento, não RAG)', () => {
    expect(detectarIntencaoChat('xyzblt').intencao).toBe('generico')
  })
  it('descrição de produto sem gatilho vai ao RAG (não a genérico)', () => {
    expect(detectarIntencaoChat('camiseta de algodão').intencao).toBe('ncm')
    expect(detectarIntencaoChat('vendo parafuso sextavado').intencao).toBe('ncm')
  })
  it('saudação com pedido não segura a intenção real', () => {
    const nav = detectarIntencaoChat('oi, me leva para a calculadora')
    expect(nav.intencao).toBe('navegar')
    expect(nav.destino).toBe('calculadora')
    expect(detectarIntencaoChat('oi!').intencao).toBe('saudacao')
    expect(detectarIntencaoChat('bom dia!').intencao).toBe('saudacao')
  })
  it('"obrigado, gera um relatório" é relatório', () => {
    expect(detectarIntencaoChat('obrigado, gera um relatório').intencao).toBe('relatorio')
  })
  it('código embutido na frase é extraído (não some)', () => {
    const a = detectarIntencaoChat('quanto fica 2000 no 08031000?')
    expect(a.intencao).toBe('calculo')
    expect(a.codigoDigitos).toBe('08031000')
    expect(a.valorBase).toBe(2000)
  })
  it('valor sem código não força NCM (é continuação de cálculo)', () => {
    expect(detectarIntencaoChat('e para 50 mil?').intencao).toBe('generico')
  })
  it('NBS explícito vence a heurística do Simples (consultoria/advocacia/software)', () => {
    expect(detectarIntencaoChat('quais seriam os NBS para consultoria?').intencao).toBe('nbs')
    expect(detectarIntencaoChat('quais seriam os NBS para advocacia?').intencao).toBe('nbs')
    expect(detectarIntencaoChat('quais seriam os NBS para desenvolvimento de software?').intencao).toBe('nbs')
    expect(detectarIntencaoChat('quais seriam os NBS para contador?').intencao).toBe('nbs')
    expect(detectarIntencaoChat('quais seriam os NBS para salão de beleza?').intencao).toBe('nbs')
  })
  it('NCM explícito vence a heurística do Simples', () => {
    expect(detectarIntencaoChat('qual NCM para comércio de roupas?').intencao).toBe('ncm')
  })
})
