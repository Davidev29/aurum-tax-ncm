/**
 * Falas da hora da Aurinha: elogios carismáticos lendo o relógio atual,
 * sorteados em tempos aleatórios sem repetição imediata.
 */
import { describe, expect, it } from 'vitest'
import {
  FRASES_HORA,
  HUMORES_FALA_HORA,
  INTERVALO_FALA_HORA_MAX,
  INTERVALO_FALA_HORA_MIN,
  formatarHoraRelogio,
  renderizarFalaHora,
  saudacaoPorTurno,
  sortearFalaHora,
  sortearHumorFalaHora,
  sortearIntervaloFalaHora,
  sortearTemplateHora,
} from '@/store/pet-falas-hora'

describe('falas da hora da Aurinha', () => {
  it('tem catálogo farto e todo template lê o relógio', () => {
    expect(FRASES_HORA.length).toBeGreaterThanOrEqual(15)
    for (const t of FRASES_HORA) {
      expect(t).toMatch(/\{hora\}/)
    }
  })

  it('formata a hora como 14h05 e saúda por turno', () => {
    const d = new Date(2026, 9, 3, 9, 5)
    expect(formatarHoraRelogio(d)).toBe('09h05')
    expect(saudacaoPorTurno(2)).toMatch(/madrugada/i)
    expect(saudacaoPorTurno(9)).toMatch(/Bom dia/)
    expect(saudacaoPorTurno(15)).toMatch(/Boa tarde/)
    expect(saudacaoPorTurno(21)).toMatch(/Boa noite/)
  })

  it('renderiza sem deixar placeholder pra trás', () => {
    const d = new Date(2026, 9, 3, 14, 32)
    for (const t of FRASES_HORA) {
      const frase = renderizarFalaHora(t, d)
      expect(frase).toContain('14h32')
      expect(frase).not.toMatch(/\{hora\}|\{turno\}/)
    }
  })

  it('não repete o template anterior imediato', () => {
    for (let i = 0; i < 200; i++) {
      const anterior = FRASES_HORA[(i * 7) % FRASES_HORA.length]!
      const sorteado = sortearTemplateHora(anterior, () => (i * 0.6180339887) % 1)
      expect(sorteado).not.toBe(anterior)
    }
  })

  it('sorteia intervalos irregulares dentro da faixa', () => {
    expect(sortearIntervaloFalaHora(() => 0)).toBe(INTERVALO_FALA_HORA_MIN)
    expect(sortearIntervaloFalaHora(() => 0.9999)).toBeLessThanOrEqual(INTERVALO_FALA_HORA_MAX)
    const meio = sortearIntervaloFalaHora(() => 0.5)
    expect(meio).toBeGreaterThan(INTERVALO_FALA_HORA_MIN)
    expect(meio).toBeLessThan(INTERVALO_FALA_HORA_MAX)
  })

  it('fala final sempre traz a hora atual', () => {
    const d = new Date(2026, 9, 3, 18, 7)
    for (let i = 0; i < 20; i++) {
      expect(sortearFalaHora(d, null, () => (i * 0.37) % 1)).toContain('18h07')
    }
  })

  it('humores são só alegres (elogio nunca reclama)', () => {
    for (const h of HUMORES_FALA_HORA) {
      expect(['happy', 'love', 'celebrating', 'waving']).toContain(h)
    }
    for (let i = 0; i < 10; i++) {
      expect(HUMORES_FALA_HORA).toContain(sortearHumorFalaHora(() => i / 10))
    }
  })
})
