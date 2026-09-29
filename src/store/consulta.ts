/**
 * Tela **Consulta NCM**: busca, sugestões e painel de classificações (0/1/N).
 *
 * O painel devolve `__uid` estável por card para que o simulador rápido
 * embutido consiga referenciar a fonte de redução sem efeitos colaterais.
 */
import { create } from 'zustand'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import {
  resolverClassificacoes,
  sugerirNomenclatura,
} from '@/infrastructure/base/classificacao-repo'
import { registrarLimpeza } from './ui'

export interface ResultadoConsulta {
  __uid: string
  classificacao: Classificacao
  regraGeral: boolean
  manual: boolean
}

interface ConsultaState {
  codigo: string
  nomenclatura: NomenclaturaNcm | null
  resultados: ResultadoConsulta[]
  regraGeral: boolean
  manual: boolean
  avisoInvalido: boolean
  carregando: boolean
  sugestoes: NomenclaturaNcm[]

  setCodigo: (v: string) => void
  consultar: (codigo?: string) => Promise<void>
  buscarSugestoes: (texto: string) => Promise<void>
  limpar: () => void
}

function montarResultados(lista: Classificacao[]): ResultadoConsulta[] {
  return lista.map((c, i) => ({
    __uid: `class-${i}-${c.manual ? 'manual' : c.regraGeral ? 'default' : c.id}`,
    classificacao: c,
    regraGeral: c.regraGeral,
    manual: c.manual != null,
  }))
}

export const useConsulta = create<ConsultaState>((set, get) => ({
  codigo: '',
  nomenclatura: null,
  resultados: [],
  regraGeral: false,
  manual: false,
  avisoInvalido: false,
  carregando: false,
  sugestoes: [],

  setCodigo: (v) => set({ codigo: v }),

  consultar: async (codigo) => {
    const alvo = (codigo ?? get().codigo).trim()
    set({ codigo: alvo, carregando: true })
    const r = await resolverClassificacoes(alvo)
    const invalido = alvo.replace(/\D+/g, '').length !== 8

    if (invalido) {
      set({
        nomenclatura: null,
        resultados: [],
        regraGeral: false,
        manual: false,
        avisoInvalido: true,
        carregando: false,
      })
      return
    }
    set({
      nomenclatura: r.nomenclatura,
      resultados: montarResultados(r.lista),
      regraGeral: r.regraGeral,
      manual: r.manual,
      avisoInvalido: false,
      carregando: false,
    })
  },

  buscarSugestoes: async (texto) => {
    const t = texto.trim()
    if (!t) {
      set({ sugestoes: [] })
      return
    }
    const lista = await sugerirNomenclatura(t.replace(/\D+/g, ''), SUGGEST_LIMITS.buscaNomenclatura)
    set({ sugestoes: lista })
  },

  limpar: () =>
    set({
      codigo: '',
      nomenclatura: null,
      resultados: [],
      regraGeral: false,
      manual: false,
      avisoInvalido: false,
      carregando: false,
      sugestoes: [],
    }),
}))

/** Ao sair da Consulta, a próxima visita começa em branco. */
registrarLimpeza('consulta', () => useConsulta.getState().limpar())
