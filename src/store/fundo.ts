/**
 * Store do fundo global (Pexels) — uma única fonte para todas as telas.
 *
 * A chave de API vive embutida no código (`CHAVE_API_PEXELS`); aqui ficam
 * só tema, animação e as fotos (cache 24 h → rede). O `FundoGlobal` (Layout)
 * exibe a camada; o painel 🖼 do módulo Aurum AI edita tema/animação.
 */
import { create } from 'zustand'
import {
  buscarFotosPexels,
  lerAnimarPexels,
  lerCacheFundo,
  lerChavePexels,
  lerQueryPexels,
  salvarAnimarPexels,
  salvarCacheFundo,
  salvarQueryPexels,
  type FotoFundo,
} from '@/infrastructure/fundo/pexels'

interface FundoState {
  fotos: FotoFundo[]
  indice: number
  tema: string
  animar: boolean
  carregando: boolean
  iniciado: boolean
  chaveNoCodigo: boolean
  /** Carga inicial (cache → rede). Idempotente. */
  iniciar: () => void
  setTema: (q: string) => void
  setAnimar: (v: boolean) => void
  proximo: () => void
  /** Persiste tema/animação e recarrega as fotos. */
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
  carregando: false,
  iniciado: false,
  chaveNoCodigo: lerChavePexels().length > 0,

  iniciar: () => {
    if (get().iniciado) return
    set({ iniciado: true, tema: lerQueryPexels(), animar: lerAnimarPexels(), chaveNoCodigo: lerChavePexels().length > 0 })
    void carregar(get().tema, set)
  },

  setTema: (q) => set({ tema: q }),

  setAnimar: (v) => {
    salvarAnimarPexels(v)
    set({ animar: v })
  },

  proximo: () => set((s) => ({ indice: s.fotos.length ? (s.indice + 1) % s.fotos.length : 0 })),

  atualizar: async () => {
    const q = get().tema.trim() || 'natureza minimalista'
    salvarQueryPexels(q)
    salvarAnimarPexels(get().animar)
    set({ tema: q })
    await carregar(q, set)
  },
}))
