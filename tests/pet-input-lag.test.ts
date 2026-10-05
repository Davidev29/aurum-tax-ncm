import { describe, expect, it, beforeEach, vi } from 'vitest'
import { usePet } from '@/store/pet'

describe('pet agir idempotente (anti-lag nos inputs)', () => {
  beforeEach(() => {
    usePet.getState().aquietar()
    vi.useFakeTimers()
  })

  it('mesmo humor+frase não dá set (sem re-render, sem seq+1)', () => {
    const s0 = usePet.getState()
    s0.agir('reading', 'Farejando…')
    const seq1 = usePet.getState().seq
    usePet.getState().agir('reading', 'Farejando…')
    usePet.getState().agir('reading', 'Farejando…')
    expect(usePet.getState().seq).toBe(seq1)
    expect(usePet.getState().mood).toBe('reading')
  })

  it('humor diferente incrementa seq', () => {
    usePet.getState().agir('reading', 'A')
    const seq1 = usePet.getState().seq
    usePet.getState().agir('calculating', 'B')
    expect(usePet.getState().seq).toBe(seq1 + 1)
  })
})
