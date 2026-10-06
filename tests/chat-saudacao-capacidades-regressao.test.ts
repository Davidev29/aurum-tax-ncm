import { describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { sanitizarLivre } from '@/application/aurum-ai-livre'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'

describe('verificação do pedido do usuário', () => {
  it('saudações variadas dão retorno simples + convite', async () => {
    for (const s of ['oi', 'oie', 'olá', 'bom dia', 'boa tarde', 'boa noite']) {
      const r = await responderChat(s)
      expect(r.texto).toContain('Em que vamos trabalhar hoje?')
      expect(r.texto.length).toBeLessThan(400)
      expect(r.texto).not.toMatch(/im_start|im_end|eot_id|INST/)
      expect(r.sugestoes?.length).toBeGreaterThan(0)
    }
  })
  it('capacidades listam ferramentas reais do sistema', async () => {
    const r = await responderChat('o que você pode fazer?')
    expect(r.texto).toMatch(/NCM/)
    expect(r.texto).toMatch(/NBS/)
    expect(r.texto).toMatch(/Fator R/)
    expect(r.texto).toMatch(/CNAE/i)
    expect(r.texto).not.toMatch(/tradução, criação de textos/)
  })
  it('detector entende oie e capacidades com sistema', () => {
    expect(detectarIntencaoChat('oie').intencao).toBe('saudacao')
    expect(detectarIntencaoChat('o que você pode fazer no sistema?').intencao).toBe('capacidades')
  })
  it('sanitização barra vazamento de template do modelo novo', () => {
    expect(sanitizarLivre('<|im_start|>assistant\nOlá! Bom dia!')).toBe('Olá! Bom dia!')
    expect(sanitizarLivre('Olá! Bom dia! user')).toBe('Olá! Bom dia!')
    expect(sanitizarLivre('o que você pode fazer?< assistant')).not.toMatch(/assistant/)
    expect(sanitizarLivre('<|eot_id|>Oi')).toBe('Oi')
  })
})
