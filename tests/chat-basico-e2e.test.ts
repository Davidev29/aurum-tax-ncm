import { beforeEach, describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { db } from '@/infrastructure/db/schema'
import { descarregarMemoria, carregarPerfilMemoria } from '@/application/aurum-ai-memoria'

beforeEach(async () => {
  localStorage.clear()
  await db.table('meta').clear().catch(() => null)
})

describe('chat ponta a ponta: tempo/conta/apelido + melhor amigo', () => {
  it('responde hora', async () => {
    const r = await responderChat('Que horas são?')
    expect(r.texto).toMatch(/Agora são/)
    expect(r.texto).toMatch(/\d{2}:\d{2}/)
  }, 15000)
  it('responde data', async () => {
    const r = await responderChat('Que dia é hoje?')
    expect(r.texto).toMatch(/Hoje é/)
  }, 15000)
  it('soma', async () => {
    const r = await responderChat('quanto é 2+3?')
    expect(r.texto).toContain('Resultado: 5')
  }, 15000)
  it('porcentagem', async () => {
    const r = await responderChat('quanto é 10% de 500?')
    expect(r.texto).toContain('Resultado: 50')
  }, 15000)
  it('resto', async () => {
    const r = await responderChat('qual o resto de 10 por 3?')
    expect(r.texto).toContain('Resultado: 1')
  }, 15000)
  it('divisão por zero honesta', async () => {
    const r = await responderChat('quanto é 10 dividido por 0?')
    expect(r.texto.toLowerCase()).toContain('zero')
  }, 15000)
  it('apelido Aurinha responde como Aurinha', async () => {
    const r = await responderChat('aurinha, que horas são?')
    expect(r.texto).toMatch(/Agora são/)
    expect(r.texto.toLowerCase()).toContain('aurinha')
  }, 15000)
  it('follow-up herda resultado ("e mais 5?")', async () => {
    const h1 = [{ papel: 'user' as const, texto: 'quanto é 2+3?' }]
    const r1 = await responderChat('quanto é 2+3?', h1)
    expect(r1.texto).toContain('Resultado: 5')
    const h2 = [
      { papel: 'user' as const, texto: 'quanto é 2+3?' },
      { papel: 'assistant' as const, texto: r1.texto },
    ]
    const r2 = await responderChat('e mais 5?', h2)
    expect(r2.texto).toContain('Resultado: 10')
  }, 15000)
  it('melhor amigo: aprende padrão conta e usa nome', async () => {
    await responderChat('meu nome é Teste')
    await responderChat('quanto é 2+3?')
    await responderChat('quanto é 4+4?')
    await responderChat('quanto é 10% de 500?')
    await descarregarMemoria()
    const perfil = await carregarPerfilMemoria()
    expect(perfil.nome).toBe('Teste')
    expect(perfil.padroes?.intents['conta']).toBeGreaterThanOrEqual(3)
    const r = await responderChat('que horas são?')
    expect(r.texto).toContain('Teste')
  }, 25000)
}, 60000)
