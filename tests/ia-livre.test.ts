import { describe, expect, it } from 'vitest'
import { intencaoLiberada, montarSistemaLivre, sanitizarLivre } from '@/application/aurum-ai-livre'

describe('ia-livre (IA-06)', () => {
  it('libera só papo simples, nunca fiscal com número', () => {
    expect(intencaoLiberada('saudacao')).toBe(true)
    expect(intencaoLiberada('conversa_leve')).toBe(true)
    expect(intencaoLiberada('generico')).toBe(true)
    expect(intencaoLiberada('ncm')).toBe(false)
    expect(intencaoLiberada('calculo')).toBe(false)
    expect(intencaoLiberada('simples')).toBe(false)
  })

  it('sistema carrega as travas do motor', () => {
    const s = montarSistemaLivre({ nome: 'David', modo: 'leve' })
    expect(s).toMatch(/assistente fiscal do Aurum Tax NCM/)
    expect(s).toMatch(/Nunca invente/)
  })

  it('sanitiza invenção fiscal (fail-closed)', () => {
    expect(sanitizarLivre('O NCM é 08031000, confia!', {})).toBeNull()
    expect(sanitizarLivre('Veja o art. 128 da lei', {})).toBeNull()
    expect(sanitizarLivre('<think>raciocinio</think> Oi, tudo bem!', {})).toContain('Oi')
    expect(sanitizarLivre('Oi! Posso classificar NCM e calcular IBS/CBS.', {})).toContain('Oi')
  })

  it('sanitiza vazamento do prompt e loop do 0.6B (caso Olá)', () => {
    expect(sanitizarLivre('não entendi? --- Fatos do motor para verbalizar: Olá, Davi!', {})).toBeNull()
    expect(sanitizarLivre('Davi, tenho um problema com o ncm de um produto. O ncm é 08031000', {})).toBeNull()
    expect(sanitizarLivre('O valor do ncm é R$ 1.000. O valor do produto é R$ 1.000.', {})).toBeNull()
    expect(sanitizarLivre('Oi! Tudo bem por aqui.', {})).toContain('Oi')
  })

  it('abertura fiscal nunca carrega número (RAG manda)', async () => {
    const { sanitizarAbertura } = await import('@/application/aurum-ai-livre')
    expect(sanitizarAbertura('Claro, calculei aqui!')).toContain('Claro')
    expect(sanitizarAbertura('O DAS é R$ 1.000')).toBeNull()
    expect(sanitizarAbertura('O NCM 08031000 está correto')).toBeNull()
  })

  it('remove vazamento de papéis do ChatML (user/assistant)', () => {
    expect(sanitizarLivre('user\nObrigado, pessoal!', {})).toBe('Obrigado, pessoal!')
    expect(sanitizarLivre('assistant: Oi, tudo bem!', {})).toBe('Oi, tudo bem!')
    expect(sanitizarLivre('user', {})).toBeNull()
  })

  it('permite código quando estava nos fatos', () => {
    const t = sanitizarLivre('O NCM 08031000 que vimos segue válido.', { codigos: ['08031000'] })
    expect(t).toContain('08031000')
  })
})
