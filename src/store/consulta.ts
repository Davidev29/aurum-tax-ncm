/**
 * Tela **Consulta NCM**: busca, sugestões e painel de classificações (0/1/N).
 *
 * O painel devolve `__uid` estável por card para que o simulador rápido
 * embutido consiga referenciar a fonte de redução sem efeitos colaterais.
 */
import type { ViaClassificacao } from '@/infrastructure/busca/classificacao-repo'
import { create } from 'zustand'
import { SUGGEST_LIMITS } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { interpretarEntradaNcm } from '@/domain/services/classificacao'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import { fmtNcm, MASK } from '@/domain/services/format'
import {
  buscarNomenclaturaPorTexto,
  resolverClassificacoes,
  sugerirNomenclatura,
  type ResultadoBuscaTexto,
} from '@/infrastructure/base/classificacao-repo'
import type {
  EntradaDescricao,
  SugestaoNcmJson,
} from '@/application/classificacao-inteligente'
import { classificarComBusca, registrarFeedbackBusca } from '@/infrastructure/busca/classificacao-repo'
import type { CandidatoBusca } from '@/infrastructure/busca/classificacao-repo'
import type { ResultadoCalculo } from '@/domain/entities'
import { registrarLimpeza } from './ui'

export interface ResultadoConsulta {
  __uid: string
  classificacao: Classificacao
  regraGeral: boolean
  manual: boolean
}

export type ModoConsulta = 'ncm' | 'texto' | 'descricao'

/**
 * Pré-preenchimento do modal "Salvar como produto" da Consulta.
 *
 * Usado pela tela **Produtos** (botão Editar): como o formulário avulso de
 * Classificação foi removido, a edição acontece na Consulta — o produto viaja
 * para cá, o usuário escolhe a classificação e salva com o mesmo SKU
 * (`editarId` atualiza o registro original em vez de criar outro).
 */
export interface PrefillSalvar {
  codigo: string
  nome: string
  qtd: string
  valor: string
  cfop: string
  cstIcms: string
  pis: string
  cofins: string
  editarId: number | null
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

  /** Aba ativa da consulta: NCM (8 dígitos) ou texto (nome do produto). */
  modo: ModoConsulta
  /** Texto digitado na aba de busca por nome. */
  buscaTexto: string
  /** Resultados da busca textual (somente NCMs de 8 dígitos). */
  resultadosTexto: ResultadoBuscaTexto[]
  buscandoTexto: boolean
  /** Pré-preenchimento do modal de salvar (edição vinda de Produtos). */
  prefillSalvar: PrefillSalvar | null
  /**
   * Entrada única da busca unificada (NCM, nome ou descrição).
   * Espelha `codigo`/`buscaTexto`/`descricao` conforme a intenção detectada,
   * de modo que fluxos legados (Produtos → Consulta) continuam funcionando.
   */
  entrada: string

  /** Aba "por descrição": entrada livre + contexto opcional. */
  descricao: string
  destinacao: string
  composicao: string
  usoDescricao: string
  /** Resultado do classificador inteligente (JSON ancorado na base oficial). */
  sugestao: SugestaoNcmJson | null
  classificandoDescricao: boolean

  /**
   * Camada automática (Phase 6 / 06-06): `via` indica se o determinístico venceu
   * (`deterministico`) ou o seletor automático acionou (`ia`).
   * Phase 10-05: `base local` quando o base fiscal participou.
   * Só quando `via` é `ia`/`base local`/`base local+ia` a UI exibe a seção "Resultado automático".
   */
  via: ViaClassificacao | null
  candidatosBusca: CandidatoBusca[]
  decisaoBusca: Classificacao | null
  nomenclaturaBusca: NomenclaturaNcm | null
  regraGeralBusca: boolean
  calculoBusca: ResultadoCalculo | null
  codigoBusca: string | null
  confiancaBusca: number
  motivoBusca: string | null
  feedbackEnviado: boolean
  fontesBusca: string[]

  setCodigo: (v: string) => void
  consultar: (codigo?: string) => Promise<void>
  buscarSugestoes: (texto: string) => Promise<void>
  setModo: (m: ModoConsulta) => void
  setBuscaTexto: (v: string) => void
  buscarTexto: (termo?: string) => Promise<void>
  /** Escolhe um NCM achado pelo nome e classifica imediatamente. */
  escolherTexto: (codigo: string) => Promise<void>
  /** Define a entrada única e dispara os 3 motors conforme a intenção. */
  setEntrada: (v: string) => void
  /**
   * Orquestrador da busca unificada (fan-out robusto):
   * - dígitos → sugestões de prefixo + classificação exata (8 dígitos);
   * - texto → busca por nome;
   * - frase expressiva → predição assistiva por descrição.
   * Cada motor tem guarda de geração própria; só o mais recente escreve.
   */
  consultarUnificada: (entrada?: string) => Promise<void>
  /** Escolhe um NCM de qualquer seção e ancora no painel oficial. */
  escolherUnificada: (codigo: string) => Promise<void>
  /** Define/limpa o pré-preenchimento do modal de salvar. */
  setPrefillSalvar: (p: PrefillSalvar | null) => void
  setDescricao: (v: string) => void
  setDestinacao: (v: string) => void
  setComposicao: (v: string) => void
  setUsoDescricao: (v: string) => void
  /** Roda o classificador inteligente sobre descrição + contexto. */
  classificarDescricao: (entrada?: EntradaDescricao) => Promise<void>
  /** Classifica oficialmente o NCM sugerido (ancora a sugestão na base). */
  usarSugestao: () => Promise<void>
  /** Usa a decisão busca validada (ancora o NCM escolhido pelo fallback). */
  usarSugestaoBusca: () => Promise<void>
  /** Registra "Não é esse" para a sugestão busca atual (Dexie `ia_feedback`). */
  feedbackNegativo: () => Promise<void>
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

/** Geração das sugestões por prefixo — idem (evita resultado velho cobrindo o novo). */
let seqSugestoes = 0

/** Geração da busca unificada — invalida fan-outs anteriores. */
let seqUnificada = 0

/** Geração da predição/IA — só a mais recente escreve (evita motor velho cobrindo o novo). */
let seqDescricao = 0

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
  prefillSalvar: null,
  entrada: '',

  descricao: '',
  destinacao: '',
  composicao: '',
  usoDescricao: '',
  sugestao: null,
  classificandoDescricao: false,

  via: null,
  candidatosBusca: [],
  decisaoBusca: null,
  nomenclaturaBusca: null,
  regraGeralBusca: false,
  calculoBusca: null,
  codigoBusca: null,
  confiancaBusca: 0,
  motivoBusca: null,
  feedbackEnviado: false,
  fontesBusca: [],

  setCodigo: (v) => set({ codigo: v }),

  consultar: async (codigo) => {
    const alvo = (codigo ?? get().codigo).trim()
    set({ codigo: alvo, carregando: true })
    const r = await resolverClassificacoes(alvo)
    // Política da Consulta: só 8 dígitos exatos classificam (intérprete único).
    const invalido = interpretarEntradaNcm(alvo).kind !== 'ok'

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
    const seq = ++seqSugestoes
    if (!t) {
      set({ sugestoes: [] })
      return
    }
    const lista = await sugerirNomenclatura(t.replace(/\D+/g, ''), SUGGEST_LIMITS.buscaNomenclatura)
    if (seq !== seqSugestoes) return
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
    if (digitos.length !== 8) {
      // Prefixo (2–7 dígitos): refina a busca no próprio campo — antes o
      // clique era um no-op silencioso ("0201" não fazia nada).
      if (digitos.length >= 2) {
        seqSugestoes++
        seqBuscaTexto++
        set({ modo: 'ncm', entrada: MASK.ncm(digitos) })
      }
      return
    }
    set({ modo: 'ncm', entrada: fmtNcm(digitos) })
    await get().consultar(digitos)
  },

  setEntrada: (v) => set({ entrada: v }),

  consultarUnificada: async (entrada) => {
    const cru = (entrada ?? get().entrada).trim()
    const seq = ++seqUnificada
    // Espelha nos campos legados para compat (Produtos → Consulta, etc.).
    const intencao = detectarIntencaoConsulta(cru)
    set({
      entrada: cru,
      codigo: intencao.digitos ? fmtNcm(intencao.digitos) || cru : cru,
      buscaTexto: cru,
      descricao: cru,
    })
    if (intencao.tipo === 'vazia') {
      seqSugestoes++
      seqBuscaTexto++
      seqDescricao++
      set({
        nomenclatura: null,
        resultados: [],
        regraGeral: false,
        manual: false,
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
        nomenclaturaBusca: null,
        regraGeralBusca: false,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
      return
    }
    const aindaVale = () => seq === seqUnificada
    const tarefas: Array<Promise<unknown>> = []
    if (intencao.deveBuscarExato) {
      // Prefixo: sugestões imediatas.
      tarefas.push(get().buscarSugestoes(intencao.digitos))
      if (intencao.deveClassificarExato) {
        tarefas.push(
          (async () => {
            await get().consultar(intencao.digitos)
            // Consulta exata histórica não deve ser sobrescrita por fan-out velho,
            // mas `consultar` não tem guarda de geração — revalida aqui.
            if (!aindaVale()) return
          })(),
        )
      } else {
        // Prefixo incompleto: limpa o painel oficial sem piscar erro.
        set({ nomenclatura: null, resultados: [], regraGeral: false, manual: false, avisoInvalido: false })
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
          destinacao: s.destinacao,
          composicao: s.composicao,
          uso: s.usoDescricao,
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
        nomenclaturaBusca: null,
        regraGeralBusca: false,
        calculoBusca: null,
        codigoBusca: null,
        confiancaBusca: 0,
        motivoBusca: null,
        feedbackEnviado: false,
        fontesBusca: [],
      })
    }
    await Promise.allSettled(tarefas)
    if (!aindaVale()) return
  },

  escolherUnificada: async (codigo) => {
    const digitos = codigo.replace(/\D+/g, '')
    if (digitos.length !== 8) {
      // Prefixo (2–7 dígitos): refina a busca no próprio input — ver sugestões
      // dos filhos (antes, clique em "0201"/"0201.10" não fazia nada).
      if (digitos.length >= 2) {
        seqUnificada++
        seqBuscaTexto++
        seqDescricao++
        seqSugestoes++
        set({ modo: 'ncm', entrada: MASK.ncm(digitos) })
      }
      return
    }
    seqUnificada++
    seqBuscaTexto++
    seqDescricao++
    set({ modo: 'ncm', entrada: fmtNcm(digitos) })
    await get().consultar(digitos)
  },

  setPrefillSalvar: (p) => set({ prefillSalvar: p }),

  setDescricao: (v) => set({ descricao: v }),
  setDestinacao: (v) => set({ destinacao: v }),
  setComposicao: (v) => set({ composicao: v }),
  setUsoDescricao: (v) => set({ usoDescricao: v }),

  classificarDescricao: async (entrada) => {
    const e: EntradaDescricao = entrada ?? {
      descricao: get().descricao,
      destinacao: get().destinacao,
      composicao: get().composicao,
      uso: get().usoDescricao,
    }
    if (!e.descricao.trim()) {
      seqDescricao++
      set({
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        nomenclaturaBusca: null,
        regraGeralBusca: false,
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
      // GATE busca automática como camada superior: determinístico primeiro; motor só no
      // fallback (baixa/null). O fan-out exato/descritivo/preditivo segue
      // intacto — só a predição passa a carregar `via`/candidatos/calculo/ficha.
      const r = await classificarComBusca(e)
      if (seq !== seqDescricao) return
      set({
        sugestao: r.sugestao,
        classificandoDescricao: false,
        via: r.via,
        candidatosBusca: r.candidatos,
        decisaoBusca: r.decisao,
        nomenclaturaBusca: r.nomenclatura,
        regraGeralBusca: r.regraGeral,
        calculoBusca: r.calculo,
        codigoBusca: r.codigoEscolhido,
        confiancaBusca: r.confianca,
        motivoBusca: r.motivo,
        feedbackEnviado: false,
        fontesBusca: r.fontes,
      })
      try {
      } catch {
      }
    } catch {
      if (seq !== seqDescricao) return
      set({
        sugestao: null,
        classificandoDescricao: false,
        via: null,
        candidatosBusca: [],
        decisaoBusca: null,
        nomenclaturaBusca: null,
        regraGeralBusca: false,
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
    const s = get().sugestao?.ncm_provavel
    if (!s) return
    set({ modo: 'ncm', entrada: s })
    await get().consultar(s)
  },

  usarSugestaoBusca: async () => {
    const s = get().codigoBusca
    if (!s) return
    set({ modo: 'ncm', entrada: s })
    await get().consultar(s)
  },

  feedbackNegativo: async () => {
    const s = get()
    if (!s.codigoBusca) return
    if (s.feedbackEnviado) return
    try {
      await registrarFeedbackBusca({
        descricao: s.entrada || s.descricao,
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

  limpar: () =>
    set({
      entrada: '',
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
      prefillSalvar: null,
      descricao: '',
      destinacao: '',
      composicao: '',
      usoDescricao: '',
      sugestao: null,
      classificandoDescricao: false,
      via: null,
      candidatosBusca: [],
      decisaoBusca: null,
      nomenclaturaBusca: null,
      regraGeralBusca: false,
      calculoBusca: null,
      codigoBusca: null,
      confiancaBusca: 0,
      motivoBusca: null,
      feedbackEnviado: false,
      fontesBusca: [],
    }),
}))

/** Ao sair da Consulta, a próxima visita começa em branco. */
registrarLimpeza('consulta', () => useConsulta.getState().limpar())


