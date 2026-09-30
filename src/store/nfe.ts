/**
 * Tela **Notas Fiscais (XML)** — importação, histórico e simulação.
 *
 * Regras:
 * - exige empresa ativa (o XML é sempre vinculado ao cadastro);
 * - direção entrada/saída/quarentena decidida pelo CNPJ (nunca descarta);
 * - chave de acesso duplicada é pulada, sem duplicar o banco.
 */
import { create } from 'zustand'
import { REF_DEFAULT } from '@/domain/constants'
import { clamp } from '@/domain/services/format'
import { obterAliquotasRefDinamica } from '@/domain/services/referencia-service'
import type { Empresa } from '@/domain/entities'
import {
  contarPorDia,
  excluirNota,
  importarXmls,
  listarCstIcmsNotas,
  listarFornecedores,
  listarNotas,
  rankingFornecedores,
  reaplicarClassificacaoNota,
  vincularProdutosNfe,
} from '@/application/notas-xml'
import type {
  CreditoFornecedor,
  FiltrosNfe,
  NotaXml,
  ResumoImportacaoXml,
} from '@/infrastructure/nfe/tipos'
import { filtrosIniciaisNfe } from '@/infrastructure/nfe/tipos'
import { useProdutos } from './produtos'
import { useSessao } from './sessao'
import { registrarLimpeza, toast } from './ui'
import { confirmar } from './dialogo'

interface NfeState {
  processando: boolean
  etapa: string | null
  /** `true` enquanto o histórico (notas/filtros/ranking) está sendo lido. */
  carregandoHistorico: boolean
  notas: NotaXml[]
  diasComNota: Map<number, number>
  fornecedores: { cnpj: string; nome: string }[]
  ranking: CreditoFornecedor[]
  /**
   * CST/CSOSN distintos nas notas da empresa — opções do dropdown de filtro
   * (gerado do dado real; vazio quando não há notas).
   */
  cstIcmsOpcoes: string[]
  filtros: FiltrosNfe
  mesAno: number
  mesMes: number
  notaAberta: NotaXml | null
  ultimoResumo: ResumoImportacaoXml | null
  refIBS: number
  refCBS: number

  importar: (files: File[] | FileList) => Promise<void>
  carregar: () => Promise<void>
  setFiltros: (parcial: Partial<FiltrosNfe>) => void
  limparFiltros: () => void
  setMes: (ano: number, mes: number) => void
  filtrarPorDia: (dia: number | null) => void
  abrirNota: (n: NotaXml) => void
  fecharNota: () => void
  setRef: (tributo: 'IBS' | 'CBS', valor: number) => void
  vincularProdutos: () => Promise<void>
  excluir: (n: NotaXml) => Promise<void>
  /** Reaplica a vigente num item/nota aberta (pós-reclassificação manual). */
  reaplicarNota: (id: number) => Promise<boolean>
  /** Reaplica a vigente em todas as notas filtradas (pós-reclassificação). */
  reaplicarVigentes: () => Promise<void>
}

const agora = () => {
  const d = new Date()
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 }
}

/** Geração da carga vigente — descarta resultados de cargas superadas. */
let seqCarregar = 0

export const useNfe = create<NfeState>((set, get) => ({
  processando: false,
  etapa: null,
  carregandoHistorico: true,
  notas: [],
  diasComNota: new Map(),
  fornecedores: [],
  ranking: [],
  cstIcmsOpcoes: [],
  filtros: filtrosIniciaisNfe(),
  mesAno: agora().ano,
  mesMes: agora().mes,
  notaAberta: null,
  ultimoResumo: null,
  refIBS: REF_DEFAULT.IBS,
  refCBS: REF_DEFAULT.CBS,

  importar: async (files) => {
    const lista = [...files].filter((f) => /\.xml$/i.test(f.name))
    if (!lista.length) {
      toast('Selecione ao menos um arquivo .xml.', 'warn')
      return
    }
    const ativa: Empresa | null = useSessao.getState().ativa
    if (!ativa) {
      toast('Cadastre e selecione uma empresa para vincular os XMLs.', 'warn')
      return
    }
    set({ processando: true, etapa: `Lendo ${lista.length} XML(s)…`, ultimoResumo: null })
    try {
      const ref = { refIBS: get().refIBS, refCBS: get().refCBS }
      const resumo = await importarXmls(lista, ativa, ref, (feito, total) =>
        set({ etapa: `Importando ${Math.min(feito, total)} de ${total} XML(s)…` }),
      )
      set({ processando: false, etapa: null, ultimoResumo: resumo })
      const partes = [`${resumo.novas} nota(s) importada(s)`]
      if (resumo.duplicadas) partes.push(`${resumo.duplicadas} duplicada(s) ignorada(s)`)
      if (resumo.quarentena) partes.push(`${resumo.quarentena} em quarentena`)
      if (resumo.erros.length) partes.push(`${resumo.erros.length} erro(s)`)
      toast(partes.join(' · '), resumo.erros.length || resumo.quarentena ? 'warn' : 'ok')
      await get().carregar()
    } catch (e) {
      set({ processando: false, etapa: null })
      toast(`Erro ao importar: ${e instanceof Error ? e.message : String(e)}`, 'err')
    }
  },

  carregar: async () => {
    const ativa = useSessao.getState().ativa
    if (!ativa?.id) {
      set({
        notas: [],
        diasComNota: new Map(),
        fornecedores: [],
        ranking: [],
        cstIcmsOpcoes: [],
        carregandoHistorico: false,
      })
      return
    }
    // Sinaliza antes de qualquer `await` para a tela exibir o loading
    // imediatamente (sem as notas "surgirem do nada").
    set({ carregandoHistorico: true })
    // Cede 2 frames para o React pintar o modal glass ANTES do trabalho
    // pesado (IndexedDB + ranking + re-render de tabelas/gráficos). Sem
    // isso, a thread trava primeiro e o spinner só aparece depois — ou nem
    // aparece em cargas rápidas, dando a sensação de "só o glass".
    await new Promise<void>((r) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      } else {
        setTimeout(() => r(), 32)
      }
    })
    // Guarda contra filtros clicados em rajada: só a carga mais recente
    // pode publicar resultados e apagar o loading.
    const vez = ++seqCarregar
    try {
      const { filtros, mesAno, mesMes } = get()
      const [notas, dias, fornecedores, cstIcmsOpcoes] = await Promise.all([
        listarNotas(ativa.id, filtros),
        contarPorDia(ativa.id, mesAno, mesMes),
        listarFornecedores(ativa.id),
        listarCstIcmsNotas(ativa.id),
      ])
      const inicio = filtros.inicio || `${mesAno}-${String(mesMes).padStart(2, '0')}-01`
      const fim = filtros.fim || `${mesAno}-${String(mesMes).padStart(2, '0')}-31`
      const ranking = await rankingFornecedores(ativa.id, inicio, fim)
      if (vez !== seqCarregar) return
      set({ notas, diasComNota: dias, fornecedores, ranking, cstIcmsOpcoes })
    } finally {
      if (vez === seqCarregar) set({ carregandoHistorico: false })
    }
  },

  setFiltros: (parcial) => {
    set((s) => ({ filtros: { ...s.filtros, ...parcial } }))
    void get().carregar()
  },

  limparFiltros: () => {
    set({ filtros: filtrosIniciaisNfe() })
    void get().carregar()
  },

  setMes: (ano, mes) => {
    set({ mesAno: ano, mesMes: mes })
    void get().carregar()
  },

  filtrarPorDia: (dia) => {
    const { mesAno, mesMes } = get()
    if (dia == null) {
      set((s) => ({ filtros: { ...s.filtros, inicio: '', fim: '' } }))
    } else {
      const base = `${mesAno}-${String(mesMes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      set((s) => ({ filtros: { ...s.filtros, inicio: base, fim: base } }))
    }
    void get().carregar()
  },

  abrirNota: (n) => set({ notaAberta: n }),
  fecharNota: () => set({ notaAberta: null }),

  setRef: (tributo, valor) => {
    const v = clamp(Number(valor) || 0, 0, 100)
    set(tributo === 'IBS' ? { refIBS: v } : { refCBS: v })
  },

  vincularProdutos: async () => {
    const { notas } = get()
    if (!notas.length) {
      toast('Nenhuma nota filtrada para vincular.', 'warn')
      return
    }
    const ativa = useSessao.getState().ativa
    if (!ativa?.id) {
      toast('Selecione uma empresa ativa.', 'warn')
      return
    }
    const ok = await confirmar(
      'Vincular produtos?',
      `Criar/atualizar produtos do cadastro a partir de ${notas.length} nota(s) filtrada(s)?`,
      { icone: '📦', confirmar: 'Vincular' },
    )
    if (!ok) return
    const c = await vincularProdutosNfe(ativa.id, notas)
    await useProdutos.getState().carregar()
    toast(`${c.salvos + c.atualizados} produto(s) vinculado(s)`, 'ok')
  },

  excluir: async (n) => {
    const ok = await confirmar(
      'Excluir nota?',
      `Remover a nota ${n.numero || n.chave.slice(-8)} e o XML guardado?`,
      { icone: '🗑', confirmar: 'Excluir', perigo: true },
    )
    if (!ok) return
    await excluirNota(n)
    set((s) => ({
      notas: s.notas.filter((x) => x.id !== n.id),
      notaAberta: s.notaAberta?.id === n.id ? null : s.notaAberta,
    }))
    toast('Nota excluída.', 'ok')
  },

  reaplicarNota: async (id) => {
    const r = await reaplicarClassificacaoNota(id)
    if (!r.ok) {
      toast(r.motivo, 'warn')
      return false
    }
    await get().carregar()
    // A nota aberta guarda um snapshot — recarrega para exibir a vigente.
    const { notaAberta } = get()
    if (notaAberta?.id === id) {
      const fresca = get().notas.find((x) => x.id === id) ?? null
      if (fresca) set({ notaAberta: fresca })
    }
    toast(
      r.alterados > 0
        ? `Classificação vigente reaplicada — ${r.alterados} de ${r.itens} item(ns) atualizado(s).`
        : 'Nota já estava com a classificação vigente.',
      r.alterados > 0 ? 'ok' : 'warn',
    )
    return true
  },

  reaplicarVigentes: async () => {
    const { notas } = get()
    if (!notas.length) {
      toast('Nenhuma nota filtrada para reaplicar.', 'warn')
      return
    }
    const ok = await confirmar(
      'Reaplicar vigentes?',
      `Recalcular ${notas.length} nota(s) filtrada(s) pela classificação vigente (base oficial › manual › regra geral)?`,
      { icone: '↻', confirmar: 'Reaplicar' },
    )
    if (!ok) return
    set({ processando: true, etapa: 'Reaplicando classificações vigentes…' })
    try {
      let alterados = 0
      let itens = 0
      for (let i = 0; i < notas.length; i++) {
        const n = notas[i]
        if (n.id == null) continue
        set({ etapa: `Reaplicando ${Math.min(i + 1, notas.length)} de ${notas.length} nota(s)…` })
        const r = await reaplicarClassificacaoNota(n.id)
        if (r.ok) {
          itens += r.itens
          alterados += r.alterados
        }
      }
      await get().carregar()
      const { notaAberta } = get()
      if (notaAberta?.id != null) {
        const fresca = get().notas.find((x) => x.id === notaAberta.id) ?? null
        set({ notaAberta: fresca })
      }
      toast(
        alterados > 0
          ? `Vigentes reaplicadas — ${alterados} de ${itens} item(ns) atualizado(s) em ${notas.length} nota(s).`
          : 'Todas as notas já estavam com a classificação vigente.',
        alterados > 0 ? 'ok' : 'warn',
      )
    } finally {
      set({ processando: false, etapa: null })
    }
  },
}))

/**
 * Ao sair da tela: filtros voltam ao padrão (últimos 30 dias), nota aberta e
 * resumo da última importação voltam ao padrão. O recarregamento acontece na
 * montagem da página (`carregar`).
 */
registrarLimpeza('nfe', () =>
  useNfe.setState({
    filtros: filtrosIniciaisNfe(),
    notaAberta: null,
    ultimoResumo: null,
  }),
)

// Carrega alíquotas dinâmicas do banco na inicialização (reativo a mudanças de regras vigentes)
void obterAliquotasRefDinamica().then((ref) => {
  useNfe.setState({ refIBS: ref.refIBS, refCBS: ref.refCBS })
})
