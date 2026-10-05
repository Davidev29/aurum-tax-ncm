/**
 * Locomoção da Aurinha: matemática pura do passeio pela sidebar.
 * Trilho medido vivo, alvos com viagem mínima, pulos físicos.
 */
import { describe, expect, it } from 'vitest'
import {
  alturaPulo,
  duracaoPulo,
  escolherAlvo,
  intervaloPuloAleatorio,
  limitesPasseio,
  pausaEntreViagens,
  podePular,
  podeVagar,
  velocidadePasseio,
  alvoBorda,
  pedirViagemLonga,
  consumirViagemLonga,
  AMBIENTES_VIAGEM_LONGA,
  podeConsultar,
} from '@/store/pet-locomocao'

describe('limitesPasseio', () => {
  it('usa toda a largura livre da casinha (sidebar aberta)', () => {
    // Sidebar aberta ~240px úteis, pet 72px → ±80px de passeio.
    const lim = limitesPasseio(240, 72)
    expect(lim.min).toBe(-80)
    expect(lim.max).toBe(80)
  })

  it('encolhe na sidebar recolhida sem zerar', () => {
    const lim = limitesPasseio(72, 38)
    expect(lim.max).toBeGreaterThanOrEqual(0)
    expect(lim.min).toBe(-lim.max)
  })

  it('nunca inverte quando a pet é maior que a casa', () => {
    const lim = limitesPasseio(40, 72)
    expect(lim).toEqual({ min: 0, max: 0 })
  })
})

describe('escolherAlvo', () => {
  it('evita micro-viagens (sem tremor parado)', () => {
    const lim = { min: -80, max: 80 }
    for (let i = 0; i < 30; i++) {
      const alvo = escolherAlvo(lim, 0, () => i / 30)
      expect(Math.abs(alvo)).toBeGreaterThanOrEqual(10)
      expect(alvo).toBeGreaterThanOrEqual(-80)
      expect(alvo).toBeLessThanOrEqual(80)
    }
  })

  it('cai no centro quando não há trilho', () => {
    expect(escolherAlvo({ min: 0, max: 0 }, 5)).toBe(0)
  })
})

describe('física dos pulinhos', () => {
  it('velocidade do passeio varia sem exageros', () => {
    for (const r of [0, 0.5, 0.99]) {
      const v = velocidadePasseio(() => r)
      expect(v).toBeGreaterThanOrEqual(28)
      expect(v).toBeLessThanOrEqual(58)
    }
  })

  it('altura e duração do pulo andam juntas', () => {
    const baixo = alturaPulo(() => 0)
    const alto = alturaPulo(() => 0.99)
    expect(alto).toBeGreaterThan(baixo)
    expect(duracaoPulo(alto)).toBeGreaterThan(duracaoPulo(baixo))
    expect(duracaoPulo(baixo)).toBeGreaterThanOrEqual(380)
    expect(duracaoPulo(alto)).toBeLessThanOrEqual(560)
  })

  it('pausas e intervalos têm faixas naturais', () => {
    expect(pausaEntreViagens(() => 0)).toBe(1200)
    expect(pausaEntreViagens(() => 0.99)).toBeLessThanOrEqual(4200)
    expect(intervaloPuloAleatorio(() => 0)).toBe(6000)
    expect(intervaloPuloAleatorio(() => 0.99)).toBeLessThanOrEqual(14000)
  })
})

describe('permissões de movimento', () => {
  it('só vaga livre no idle da doca', () => {
    expect(podeVagar('idle', 'doca')).toBe(true)
    expect(podeVagar('reading', 'doca')).toBe(false)
    expect(podeVagar('idle', 'arrastando')).toBe(false)
    expect(podeVagar('sleeping', 'doca')).toBe(false)
  })

  it('pula na festa, no carinho e no idle — nunca no voo', () => {
    for (const mood of ['idle', 'celebrating', 'happy', 'love', 'waving', 'curious']) {
      expect(podePular(mood, 'doca')).toBe(true)
    }
    expect(podePular('idle', 'arrastando')).toBe(false)
    expect(podePular('sleeping', 'doca')).toBe(false)
    expect(podePular('angry', 'doca')).toBe(false)
  })

  it('viagem longa mira a borda oposta (travessia total)', () => {
    expect(alvoBorda({ min: -80, max: 80 }, 50)).toBe(-80)
    expect(alvoBorda({ min: -80, max: 80 }, -50)).toBe(80)
    expect(alvoBorda({ min: 0, max: 0 }, 5)).toBe(0)
    expect(AMBIENTES_VIAGEM_LONGA).toContain('ronda')
    expect(AMBIENTES_VIAGEM_LONGA).toContain('patrulha-lenta')
    // Sinal consome uma vez por pedido.
    pedirViagemLonga(1)
    expect(consumirViagemLonga()).toBe(true)
    expect(consumirViagemLonga()).toBe(false)
  })

  it('consulta ativa (NCM/NBS/cálculos) pede a gaveta — nunca no voo', () => {
    for (const mood of ['searching', 'reading', 'thinking', 'calculating']) {
      expect(podeConsultar(mood, 'doca')).toBe(true)
    }
    expect(podeConsultar('idle', 'doca')).toBe(false)
    expect(podeConsultar('searching', 'arrastando')).toBe(false)
    expect(podeConsultar('sleeping', 'doca')).toBe(false)
  })
})
