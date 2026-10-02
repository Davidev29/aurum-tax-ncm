/**
 * Trava da grade do sprite da Aurinha: simetria quebrada aqui vira
 * defeito visível na sidebar — o teste falha antes.
 */
import { describe, expect, it } from 'vitest'
import { LARGURA_GRADE, LOUPE, OVERLAYS, PALETA, SPRITE } from '@/ui/pet-sprite'

describe('sprite da Aurinha', () => {
  it('tem grade retangular de 26 colunas', () => {
    expect(SPRITE.length).toBeGreaterThan(20)
    for (const linha of SPRITE) expect(linha.length).toBe(LARGURA_GRADE)
  })

  it('só usa caracteres da paleta (ou transparente)', () => {
    const todas = [...SPRITE, ...LOUPE]
    for (const linha of todas) {
      for (const ch of linha) {
        expect(ch === '.' || ch in PALETA, `caractere inesperado: ${ch}`).toBe(true)
      }
    }
    expect(LOUPE.every((l) => l.length === 7)).toBe(true)
  })

  it('é simétrica onde importa: cabeça e tronco espelham perfeito', () => {
    // Linhas 0–22 (cabeça + tronco): espelho exato. O rabinho (23–25) é
    // de propósito lateral, como na referência.
    for (const [i, linha] of SPRITE.slice(0, 23).entries()) {
      expect(linha, `linha ${i} assimétrica: ${linha}`).toBe([...linha].reverse().join(''))
    }
  })

  it('overlays vivem dentro da grade e usam a paleta', () => {
    for (const [nome, blocos] of Object.entries(OVERLAYS)) {
      for (const [x, y, w, _h, ch] of blocos) {
        void _h
        expect(x >= 0 && y >= 0 && x + w <= LARGURA_GRADE, `${nome} fora da grade`).toBe(true)
        expect(ch in PALETA, `${nome} com cor inválida: ${ch}`).toBe(true)
      }
    }
  })
})
