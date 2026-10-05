/**
 * Markdown leve do chat — negrito, listas, títulos e segurança.
 */
import { describe, expect, it } from 'vitest'
import { blocosChat, inlineChat } from '@/ui/chat-markdown'

describe('chat-markdown (blocos)', () => {
  it('negrito de seção vira parágrafo próprio', () => {
    const b = blocosChat('**CNPJ 11.222.333/0001-81 — Escola**\n**Atividades (3):**')
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ tipo: 'paragrafo' })
  })
  it('bullets consecutivos viram uma lista', () => {
    const b = blocosChat('• item um\n• item **dois**\n• item três')
    expect(b).toHaveLength(1)
    expect(b[0].tipo).toBe('bullet')
    if (b[0].tipo === 'bullet') expect(b[0].itens).toHaveLength(3)
  })
  it('título ## e divisor ---', () => {
    const b = blocosChat('## Atividades\n---\ntexto')
    expect(b.map((x) => x.tipo)).toEqual(['titulo', 'divisor', 'paragrafo'])
  })
  it('numerada 1. 2.', () => {
    const b = blocosChat('1. primeiro\n2. segundo')
    expect(b).toHaveLength(1)
    expect(b[0].tipo).toBe('numero')
  })
  it('linha vazia separa parágrafos', () => {
    const b = blocosChat('linha um\n\nlinha dois')
    expect(b).toHaveLength(2)
  })
})

describe('chat-markdown (inline + segurança)', () => {
  it('**negrito** vira <strong>', () => {
    const nos = inlineChat('olá **mundo** fim', 'k')
    expect(nos).toHaveLength(3)
  })
  it('`código` vira <code>', () => {
    const nos = inlineChat('use `6201-5/01` aqui', 'k')
    expect(nos.some((n) => (n as { type?: unknown })?.type === 'code')).toBe(true)
  })
  it('** não fechado fica literal', () => {
    const nos = inlineChat('preço **100 fechado', 'k')
    expect(nos).toHaveLength(1)
  })
  it('HTML do usuário não vaza como tag (escape do React)', () => {
    const nos = inlineChat('<img src=x onerror=alert(1)> **oi**', 'k')
    const primeiro = nos[0] as { props?: { children?: unknown } }
    expect(String(primeiro?.props?.children ?? '')).toContain('<img')
  })
})
