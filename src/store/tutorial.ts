/**
 * Estado do tour guiado — aberto sob demanda pelo botão "Guia" no header.
 *
 * Tour informativo com CTA real: cada passo oferece "Experimentar agora"
 * (fecha o tour e navega ao menu). O progresso é linear (10 passos em
 * 3 trilhas); `visitados` marca os já vistos para o contador do stepper.
 * `animar` pausa as animações de ambiente sem depender só do SO.
 */
import { create } from 'zustand'
import { TOUR_KEY } from '@/domain/tutorial'

function carimbar(): void {
  try {
    localStorage.setItem(TOUR_KEY, new Date().toISOString())
  } catch {
    /* sem armazenamento: vale só na sessão */
  }
}

function comVisitado(lista: number[], n: number): number[] {
  return lista.includes(n) ? lista : [...lista, n]
}

interface TutorialState {
  aberto: boolean
  passo: number
  /** Pausa/retoma as animações de ambiente do guia. */
  animar: boolean
  /** Passos já visitados nesta sessão (stepper + contador). */
  visitados: number[]
  abrir: (passo?: number) => void
  fechar: () => void
  concluir: () => void
  irPasso: (n: number) => void
  proximo: (total: number) => void
  anterior: () => void
  alternarAnimacao: () => void
}

export const useTutorial = create<TutorialState>((set, get) => ({
  aberto: false,
  passo: 0,
  animar: true,
  visitados: [],

  abrir: (passo = 0) => set({ aberto: true, passo, visitados: comVisitado(get().visitados, passo) }),
  fechar: () => set({ aberto: false }),
  concluir: () => {
    carimbar()
    set({ aberto: false, passo: 0 })
  },
  irPasso: (n) => set((s) => ({ passo: Math.max(0, n), visitados: comVisitado(s.visitados, Math.max(0, n)) })),
  proximo: (total) => {
    const { passo } = get()
    if (passo + 1 >= total) {
      get().concluir()
      return
    }
    get().irPasso(passo + 1)
  },
  anterior: () => set((s) => ({ passo: Math.max(0, s.passo - 1) })),
  alternarAnimacao: () => set((s) => ({ animar: !s.animar })),
}))

/** Reabre o tour sob demanda (botão Guia no header). */
export function reabrirTour(passo = 0): void {
  useTutorial.getState().abrir(passo)
}
