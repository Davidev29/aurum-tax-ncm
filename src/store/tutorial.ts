/**
 * Estado do tour guiado — abre 1x após a instalação + sob demanda.
 *
 * Tour 100% informativo: o modal nunca navega sozinho — o usuário aprende
 * onde fica cada menu pelo quadro animado e navega por conta própria.
 *
 * - `deveAbrirAposInstalacao()`: primeira execução (sem carimbo) → auto-abre.
 * - `abrir() / fechar() / concluir()`: controle via botão "Guia" no header.
 */
import { create } from 'zustand'
import { TOUR_KEY } from '@/domain/tutorial'

function lido(): string | null {
  try {
    return localStorage.getItem(TOUR_KEY)
  } catch {
    return null
  }
}

function carimbar(): void {
  try {
    localStorage.setItem(TOUR_KEY, new Date().toISOString())
  } catch {
    /* sem armazenamento: vale só na sessão */
  }
}

interface TutorialState {
  aberto: boolean
  passo: number
  abrir: (passo?: number) => void
  fechar: () => void
  concluir: () => void
  irPasso: (n: number) => void
  proximo: (total: number) => void
  anterior: () => void
}

export const useTutorial = create<TutorialState>((set, get) => ({
  aberto: false,
  passo: 0,

  abrir: (passo = 0) => set({ aberto: true, passo }),
  fechar: () => set({ aberto: false }),
  concluir: () => {
    carimbar()
    set({ aberto: false, passo: 0 })
  },
  irPasso: (n) => set({ passo: Math.max(0, n) }),
  proximo: (total) => {
    const { passo } = get()
    if (passo + 1 >= total) {
      get().concluir()
      return
    }
    set({ passo: passo + 1 })
  },
  anterior: () => set((s) => ({ passo: Math.max(0, s.passo - 1) })),
}))

/** Primeira execução (tour nunca visto)? */
export function deveAbrirAposInstalacao(): boolean {
  return lido() == null
}

/** Reabre o tour mesmo já concluído (botão Guia). */
export function reabrirTour(passo = 0): void {
  useTutorial.getState().abrir(passo)
}
