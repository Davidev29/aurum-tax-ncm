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
  buscarNomenclaturaPorTexto,
  resolverClassificacoes,
  sugerirNomenclatura,
  type ResultadoBuscaTexto,
} from '@/infrastructure/base/classificacao-repo'
import { registrarLimpeza } from './ui'

export interface ResultadoConsulta {
  __uid: string
  classificacao: Classificacao
  regraGeral: boolean
  manual: boolean
}

export type ModoConsulta = 'ncm' | 'texto'

interface ConsultaState {
  codigo: string
  nomenclatura: NomenclaturaNcm | null
  resultados: ResultadoConsulta[]
  regraGeral: boolean
  manual: boolean
  avisoInvalido: boolean
  carregando: boolean
  sugestoes: NomenclaturaNcm[]

  /** Aba ativa da consulta: NCM (8 dígitos) ou texto (nome do produto). */
  modo: ModoConsulta
  /** Texto digitado na aba de busca por nome. */
  buscaTexto: string
  /** Resultados da busca textual (somente NCMs de 8 dígitos). */
  resultadosTexto: ResultadoBuscaTexto[]
  buscandoTexto: boolean

  setCodigo: (v: string) => void
  consultar: (codigo?: string) => Promise<void>
  buscarSugestoes: (texto: string) => Promise<void>
  setModo: (m: ModoConsulta) => void
  setBuscaTexto: (v: string) => void
  buscarTexto: (termo?: string) => Promise<void>
  /** Escolhe um NCM achado pelo nome e classifica imediatamente. */
  escolherTexto: (codigo: string) => Promise<void>
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

/** Geração da busca textual — só a mais recente pode escrever no estado. */
let seqBuscaTexto = 0

export const useConsulta = create<ConsultaState>((set, get) => ({
  codigo: '',
  nomenclatura: null,
  resultados: [],
  regraGeral: false,
  manual: false,
  avisoInvalido: false,
  carregando: false,
  sugestoes: [],

  modo: 'ncm',
  buscaTexto: '',
  resultadosTexto: [],
  buscandoTexto: false,

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

  setModo: (m) => set({ modo: m }),

  setBuscaTexto: (v) => set({ buscaTexto: v }),

  buscarTexto: async (termo) => {
    const alvo = (termo ?? get().buscaTexto).trim()
    const seq = ++seqBuscaTexto
    if (alvo.length < 2) {
      set({ resultadosTexto: [], buscandoTexto: false })
      return
    }
    set({ buscandoTexto: true })
    const lista = await buscarNomenclaturaPorTexto(alvo, SUGGEST_LIMITS.buscaTexto)
    if (seq !== seqBuscaTexto) return
    set({ resultadosTexto: lista, buscandoTexto: false })
  },

  escolherTexto: async (codigo) => {
    const digitos = codigo.replace(/\D+/g, '')
    if (digitos.length !== 8) return
    set({ modo: 'ncm' })
    await get().consultar(digitos)
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
      buscaTexto: '',
      resultadosTexto: [],
      buscandoTexto: false,
    }),
}))

/** Ao sair da Consulta, a próxima visita começa em branco. */
registrarLimpeza('consulta', () => useConsulta.getState().limpar())
