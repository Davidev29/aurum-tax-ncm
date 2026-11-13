/**
 * Tour guiado — garantias do guia menu a menu.
 */
import { describe, expect, it } from 'vitest'
import { PASSOS_TOUR, TRILHAS_TOUR } from '@/domain/tutorial'

describe('tour guiado — cobertura menu a menu', () => {
  it('cobre os 9 menus do sistema, sem repetir', () => {
    expect(PASSOS_TOUR).toHaveLength(9)
    const ids = PASSOS_TOUR.map((p) => p.id)
    expect(new Set(ids).size).toBe(9)
    for (const esperada of [
      'consulta',
      'simples',
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
    expect(ids).not.toContain('calculadora')
  })

  it('toda trilha lista passos que existem e cobrem todos os menus', () => {
    const ids = new Set(PASSOS_TOUR.map((p) => p.id))
    for (const t of TRILHAS_TOUR) {
      for (const passo of t.passos) {
        expect(ids).toContain(passo)
      }
    }
    expect(TRILHAS_TOUR.flatMap((t) => t.passos).sort()).toEqual([...ids].sort())
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
