/**
 * Tour guiado — garantias do guia menu a menu.
 */
import { describe, expect, it } from 'vitest'
import { PASSOS_TOUR } from '@/domain/tutorial'

describe('tour guiado — cobertura menu a menu', () => {
  it('cobre os 10 menus do sistema, sem repetir', () => {
    expect(PASSOS_TOUR).toHaveLength(10)
    const ids = PASSOS_TOUR.map((p) => p.id)
    expect(new Set(ids).size).toBe(10)
    for (const esperada of [
      'calculadora',
      'simples',
      'consulta',
      'servicos',
      'cnaes',
      'lote',
      'nfe',
      'produtos',
      'auxiliares',
      'legislacao',
    ]) {
      expect(ids).toContain(esperada)
    }
  })

  it('cada passo explica o que faz, como usar e dica', () => {
    for (const p of PASSOS_TOUR) {
      expect(p.menu.trim().length).toBeGreaterThan(0)
      expect(p.oQueFaz.trim().length).toBeGreaterThan(20)
      expect(p.comoUsar.length).toBeGreaterThanOrEqual(3)
      expect(p.dica.trim().length).toBeGreaterThan(10)
      expect(p.acao.trim().length).toBeGreaterThan(0)
    }
  })
})
