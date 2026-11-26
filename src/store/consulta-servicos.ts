/**
 * Tela **Consulta Serviços**: busca NBS manual + automática por CNPJ.
 *
 * Espelho enxuto de `store/consulta.ts` para o domínio NBS (9 dígitos):
 * - exato 9 dígitos → `resolverClassificacoesNbs`;
 * - prefixo → `sugerirNbs`;
 * - texto → `buscarNbsPorTexto`;
 * - frase → busca automática de serviços (`classificarComBuscaServicos`, `via` auditável).
 *
 * Aba CNPJ: `consultarPorCnpj` (BrasilAPI + 1 GATE NBS por CNAE).
 */
import type { ViaClassificacao } from '@/infrastructure/busca/classificacao-repo'
import { create } from 'zustand'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { Classificacao } from '@/domain/entities'
import { interpretarEntradaNbs } from '@/domain/services/classificacao-nbs'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import { fmtNbs } from '@/domain/services/format'
import {
  buscarNbsPorTexto,
  resolverClassificacoesNbs,
  sugerirNbs,
  type ResultadoBuscaTextoNbs,
} from '@/infrastructure/base/classificacao-repo'
import type { EntradaDescricaoServico } from '@/application/classificacao-inteligente-servicos'
import {
  classificarComBuscaServicos,
} from '@/infrastructure/busca/classificacao-servicos-repo'
import { registrarFeedbackBusca } from '@/infrastructure/busca/classificacao-repo'
import type { CandidatoBusca } from '@/infrastructure/busca/classificacao-repo'
import type { ResultadoCalculo } from '@/domain/entities'
import {
  consultarPorCnpj,
  type VereditoEmpresa,
} from '@/application/consultar-por-cnpj'
import { registrarLimpeza } from './ui'

export interface ResultadoConsultaServicos {
  __uid: string
  classificacao: Classificacao
  regraGeral: boolean
}

export type ModoServicos = 'manual' | 'cnpj'

function montarResultados(lista: Classificacao[]): ResultadoConsultaServicos[] {
  return lista.map((c, i) => ({
    __uid: `nbs-${i}-${c.regraGeral ? 'default' : c.id}`,
    classificacao: c,
    regraGeral: c.regraGeral,
  }))
}

let seqBuscaTexto = 0
let seqSugestoes = 0
let seqDescricao = 0
let seqCnpj = 0

interface ServicosState {
  modo: ModoServicos
  setModo: (m: ModoServicos) => void

  entrada: string
  codigo: string
  resultados: ResultadoConsultaServicos[]
  regraGeral: boolean
  avisoInvalido: boolean
  carregando: boolean
  sugestoes: { codigo: string; titulo: string }[]
  resultadosTexto: ResultadoBuscaTextoNbs[]
  buscandoTexto: boolean

  destinatario: string
  localPrestacao: string
  usoServico: string
  setDestinatario: (v: string) => void
  setLocalPrestacao: (v: string) => void
  setUsoServico: (v: string) => void
  sugestao: import('@/application/classificacao-inteligente-servicos').SugestaoNbsJson | null
  classificandoDescricao: boolean
  via: ViaClassificacao | null
  candidatosBusca: CandidatoBusca[]
  decisaoBusca: Classificacao | null
  calculoBusca: ResultadoCalculo | null
  codigoBusca: string | null
  confiancaBusca: number
  motivoBusca: string | null
  feedbackEnviado: boolean
  fontesBusca: string[]

  cnpjEntrada: string
  buscandoCnpj: boolean
  vereditoEmpresa: VereditoEmpresa | null
  erroCnpj: string | null
  /** Guarda o CNPJ já normalizado e limitado a 14 dígitos (o display mascara). */
  setCnpjEntrada: (v: string) => void

  setEntrada: (v: string) => void
  consultar: (codigo?: string) => Promise<void>
  buscarSugestoes: (texto: string) => Promise<void>
  buscarTexto: (termo?: string) => Promise<void>
  consultarUnificada: (entrada?: string) => Promise<void>
  escolherUnificada: (codigo: string) => Promise<void>
  classificarDescricao: (entrada?: EntradaDescricaoServico) => Promise<void>
  usarSugestao: () => Promise<void>
  usarSugestaoBusca: () => Promise<void>
  feedbackNegativo: () => Promise<void>
  consultarCnpj: (cnpj?: string, forcar?: boolean) => Promise<void>
  limpar: () => void
}

export const useServicos = create<ServicosState>((set, get) => ({
  modo: 'manual',
  setModo: (m) => set({ modo: m }),

  entrada: '',
  codigo: '',
  resultados: [],
  regraGeral: false,
  avisoInvalido: false,
  carregando: false,
  sugestoes: [],
  resultadosTexto: [],
  buscandoTexto: false,

  destinatario: '',
  localPrestacao: '',
  usoServico: '',
  setDestinatario: (v) => set({ destinatario: v }),
  setLocalPrestacao: (v) => set({ localPrestacao: v }),
  setUsoServico: (v) => set({ usoServico: v }),
  sugestao: null,
  classificandoDescricao: false,

  via: null,
  candidatosBusca: [],
  decisaoBusca: null,
  calculoBusca: null,
  codigoBusca: null,
  confiancaBusca: 0,
  motivoBusca: null,
  feedbackEnviado: false,
  fontesBusca: [],

  cnpjEntrada: '',
  buscandoCnpj: false,
  vereditoEmpresa: null,
  erroCnpj: null,

  setCnpjEntrada: (v) => set({ cnpjEntrada: v.replace(/\D+/g, '').slice(0, 14) }),

  setEntrada: (v) => set({ entrada: v }),

  consultar: async (codigo) => {
    const alvo = (codigo ?? get().codigo).trim()
    set({ codigo: alvo, carregando: true })
    const r = await resolverClassificacoesNbs(alvo)
    const invalido = interpretarEntradaNbs(alvo).kind !== 'ok'
    if (invalido) {
      set({ resultados: [], regraGeral: false, avisoInvalido: true, carregando: false })
      return
    }
    set({
      resultados: montarResultados(r.lista),
      regraGeral: r.regraGeral,
      avisoInvalido: false,
      carregando: false,
    })
  },

  buscarSugestoes: async (texto) => {
    const t = texto.trim()
    const seq = ++seqSugestoes
    if (!t) {
      set({ sugestoes: [] })
      return
    }
    const lista = await sugerirNbs(
      t.replace(/\D+/g, ''),
      SUGGEST_LIMITS.buscaNomenclatura,
    )
    if (seq !== seqSugestoes) return
    const { tituloNbs } = await import('@/infrastructure/base/classificacao-repo')
    set({ sugestoes: lista.map((v) => ({ codigo: v.codigo, titulo: tituloNbs(v) })) })
  },

  buscarTexto: async (termo) => {
    const alvo = (termo ?? get().entrada).trim()
    const seq = ++seqBuscaTexto
    if (alvo.length < 2) {
      set({ resultadosTexto: [], buscandoTexto: false })
      return
    }
    set({ buscandoTexto: true })
    const lista = await buscarNbsPorTexto(alvo, SUGGEST_LIMITS.buscaTexto)
    if (seq !== seqBuscaTexto) return
    set({ resultadosTexto: lista, buscandoTexto: false })
  },

  consultarUnificada: async (entrada) => {
    const cru = (entrada ?? get().entrada).trim()
    // Domínio NBS: 8 dígitos nunca classificam nem ganham selo de NCM.
    const intencao = detectarIntencaoConsulta(cru, 'nbs')
    set({ entrada: cru, codigo: intencao.digitos ? fmtNbs(intencao.digitos) || cru : cru })
    if (intencao.tipo === 'vazia') {
      seqSugestoes++
      seqBuscaTexto++
      seqDescricao++
      set({
        resultados: [],
        regraGeral: false,
        avisoInvalido: false,
        carregando: false,
        sugestoes: [],
        resultadosTexto: [],
        buscandoTexto: false,
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
      return
    }
    const tarefas: Array<Promise<unknown>> = []
    if (intencao.deveBuscarExato) {
      tarefas.push(get().buscarSugestoes(intencao.digitos))
      if (intencao.deveClassificarExato && intencao.digitos.length === 9) {
        tarefas.push(get().consultar(intencao.digitos))
      } else if (!intencao.deveClassificarExato || intencao.digitos.length !== 9) {
        // NBS só tem exato com 9 dígitos: qualquer outro tamanho limpa o
        // painel exato (8 dígitos é NCM — outra tela, não ancora aqui).
        if (intencao.digitos.length !== 9) {
          set({ resultados: [], regraGeral: false, avisoInvalido: false })
        }
      }
    }
    if (intencao.deveBuscarNome) {
      tarefas.push(get().buscarTexto(cru))
    } else {
      seqBuscaTexto++
      set({ resultadosTexto: [], buscandoTexto: false })
    }
    if (intencao.deveBuscarDescricao) {
      const s = get()
      tarefas.push(
        s.classificarDescricao({
          descricao: cru,
          tomador: s.destinatario,
          local: s.localPrestacao,
          uso: s.usoServico,
        }),
      )
    } else {
      seqDescricao++
      set({
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
    }
    await Promise.allSettled(tarefas)
  },

  escolherUnificada: async (codigo) => {
    const digitos = codigo.replace(/\D+/g, '')
    if (digitos.length !== 9) return
    seqBuscaTexto++
    seqDescricao++
    set({ entrada: fmtNbs(digitos) })
    await get().consultar(digitos)
  },

  classificarDescricao: async (entrada) => {
    const e: EntradaDescricaoServico = entrada ?? {
      descricao: get().entrada,
      tomador: get().destinatario,
      local: get().localPrestacao,
      uso: get().usoServico,
    }
    if (!e.descricao.trim()) {
      seqDescricao++
      set({
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
      return
    }
    const seq = ++seqDescricao
    set({ classificandoDescricao: true, feedbackEnviado: false })
    try {
      const r = await classificarComBuscaServicos(e)
      if (seq !== seqDescricao) return
      set({
        sugestao: r.sugestao,
        classificandoDescricao: false,
        via: r.via,
        candidatosBusca: r.candidatos,
        decisaoBusca: r.decisao,
        calculoBusca: r.calculo,
        codigoBusca: r.codigoEscolhido,
        confiancaBusca: r.confianca,
        motivoBusca: r.motivo,
        feedbackEnviado: false,
        fontesBusca: r.fontes,
      })
    } catch {
      if (seq !== seqDescricao) return
      set({
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
    }
  },

  usarSugestao: async () => {
    const s = get().sugestao?.nbs_provavel
    if (!s) return
    set({ entrada: s })
    await get().consultar(s)
  },

  usarSugestaoBusca: async () => {
    const s = get().codigoBusca
    if (!s) return
    set({ entrada: s })
    await get().consultar(s)
  },

  feedbackNegativo: async () => {
    const s = get()
    if (!s.codigoBusca) return
    if (s.feedbackEnviado) return
    try {
      await registrarFeedbackBusca({
        descricao: s.entrada,
        via: s.via ?? 'sem-resultado',
        decisao: s.codigoBusca,
        confianca: s.confiancaBusca,
        motivo: 'feedback-negativo',
      })
    } catch {
      /* feedback é best-effort */
    }
    set({ feedbackEnviado: true })
  },

  consultarCnpj: async (cnpj, forcar) => {
    const alvo = (cnpj ?? get().cnpjEntrada).trim()
    const seq = ++seqCnpj
    set({ cnpjEntrada: alvo, buscandoCnpj: true, erroCnpj: null })
    try {
      const veredito = await consultarPorCnpj(alvo, { forcarAtualizacao: forcar })
      if (seq !== seqCnpj) return
      set({ vereditoEmpresa: veredito, buscandoCnpj: false })
    } catch (e) {
      if (seq !== seqCnpj) return
      set({
        vereditoEmpresa: null,
        buscandoCnpj: false,
        erroCnpj: e instanceof Error ? e.message : String(e),
      })
    }
  },

  limpar: () =>
    set({
      entrada: '',
      codigo: '',
      resultados: [],
      regraGeral: false,
      avisoInvalido: false,
      carregando: false,
      sugestoes: [],
      resultadosTexto: [],
      buscandoTexto: false,
      destinatario: '',
      localPrestacao: '',
      usoServico: '',
      sugestao: null,
      classificandoDescricao: false,
      via: null,
      candidatosBusca: [],
      decisaoBusca: null,
      calculoBusca: null,
      codigoBusca: null,
      confiancaBusca: 0,
      motivoBusca: null,
      feedbackEnviado: false,
      fontesBusca: [],
      cnpjEntrada: '',
      buscandoCnpj: false,
      vereditoEmpresa: null,
      erroCnpj: null,
    }),
}))

registrarLimpeza('servicos', () => useServicos.getState().limpar())


