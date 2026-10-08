/**
 * Store do fundo global (Pexels) — uma única fonte para todas as telas.
 *
 * A chave de API vive embutida no código (`CHAVE_API_PEXELS`); aqui ficam
 * tema, animação, intervalo e as fotos (cache 24 h → rede). O `FundoGlobal`
 * exibe a camada; a aba 🎨 Aparência das Configurações edita tema/intervalo.
 */
import { create } from 'zustand'
import {
  buscarFotosPexels,
  lerAnimarPexels,
  lerCacheFundo,
  lerChavePexels,
  lerIntervaloPexels,
  lerQueryPexels,
  salvarAnimarPexels,
  salvarCacheFundo,
  salvarIntervaloPexels,
  salvarQueryPexels,
  type FotoFundo,
} from '@/infrastructure/fundo/pexels'

interface FundoState {
  fotos: FotoFundo[]
  indice: number
  tema: string
  animar: boolean
  /** Segundos entre as trocas (5 s–24 h). */
  intervalo: number
  carregando: boolean
  iniciado: boolean
  chaveNoCodigo: boolean
  /** Carga inicial (cache → rede). Idempotente. */
  iniciar: () => void
  setTema: (q: string) => void
  setAnimar: (v: boolean) => void
  setIntervalo: (s: number) => void
  proximo: () => void
  /** Persiste tema/animação/intervalo e recarrega as fotos. */
  atualizar: () => Promise<void>
}

async function carregar(query: string, set: (p: Partial<FundoState>) => void): Promise<void> {
  const chave = lerChavePexels()
  if (!chave) {
    set({ fotos: [], carregando: false })
    return
  }
  const cache = lerCacheFundo(query)
  if (cache.length) {
    set({ fotos: cache, indice: 0, carregando: false })
    return
  }
  set({ carregando: true })
  const fotos = await buscarFotosPexels(chave, query)
  if (fotos.length) salvarCacheFundo(query, fotos)
  set({ fotos, indice: 0, carregando: false })
}

export const useFundo = create<FundoState>((set, get) => ({
  fotos: [],
  indice: 0,
  tema: lerQueryPexels(),
  animar: lerAnimarPexels(),
  intervalo: lerIntervaloPexels(),
  carregando: false,
  iniciado: false,
  chaveNoCodigo: lerChavePexels().length > 0,

  iniciar: () => {
    if (get().iniciado) return
    set({ iniciado: true, tema: lerQueryPexels(), animar: lerAnimarPexels(), intervalo: lerIntervaloPexels(), chaveNoCodigo: lerChavePexels().length > 0 })
    void carregar(get().tema, set)
  },

  setTema: (q) => set({ tema: q }),

  setAnimar: (v) => {
    salvarAnimarPexels(v)
    set({ animar: v })
  },

  setIntervalo: (s) => {
    const v = Math.max(5, Math.min(86400, Math.round(Number(s) || 14)))
    salvarIntervaloPexels(v)
    set({ intervalo: v })
  },

  proximo: () => set((s) => ({ indice: s.fotos.length ? (s.indice + 1) % s.fotos.length : 0 })),

  atualizar: async () => {
    const q = get().tema.trim() || 'natureza minimalista'
    salvarQueryPexels(q)
    salvarAnimarPexels(get().animar)
    salvarIntervaloPexels(get().intervalo)
    set({ tema: q })
    await carregar(q, set)
  },
}))
