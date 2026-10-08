/**
 * Estado do tour guiado — abre 1x após a instalação + sob demanda.
 *
 * - `deveAbrirAposInstalacao()`: primeira execução (sem carimbo) → auto-abre.
 * - `abrir() / fechar() / concluir()`: controle via botão "Guia" no header.
 * - `irParaMenu()`: navega para o menu do passo sem fechar o tour.
 */
import { create } from 'zustand'
import { TOUR_KEY } from '@/domain/tutorial'
import { useUi, type ViewId } from '@/store/ui'

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
  irParaMenu: (view: ViewId) => void
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
  irParaMenu: (view) => {
    useUi.getState().trocarView(view)
  },
}))

/** Primeira execução (tour nunca visto)? */
export function deveAbrirAposInstalacao(): boolean {
  return lido() == null
}

/** Reabre o tour mesmo já concluído (botão Guia). */
export function reabrirTour(passo = 0): void {
  useTutorial.getState().abrir(passo)
}
