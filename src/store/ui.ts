/**
 * Estado global de interface: navegação, tema, toasts e modais.
 *
 * Paridade com a v1 (SPEC §10): 7 views, tema por `localStorage['tema']`,
 * toast de 3400 ms com borda colorida por tipo.
 *
 * Duas responsabilidades extras, ambas de interface:
 * - `registrarLimpeza`: cada tela publica aqui o que deve ser **zerado ao
 *   sair** dela, para que um retorno nunca reabra o formulário congelado;
 * - `abrirCalc`: a fonte que alimenta o modal de cálculo (adicionar item à
 *   calculadora a partir de qualquer tela, sem navegar para ela).
 */
import { create } from 'zustand'
import { TEMA_KEY } from '@/domain/constants'
import type { Classificacao } from '@/domain/entities'
import type { ProdutoLinha } from '@/store/produtos'

export type ViewId =
  | 'calculadora'
  | 'consulta'
  | 'lote'
  | 'nfe'
  | 'produtos'
  | 'auxiliares'
  | 'legislacao'
  | 'debugia'

export const VIEW_META: Record<ViewId, { titulo: string; subtitulo: string }> = {
  calculadora: {
    titulo: 'Calculadora Tributária',
    subtitulo: 'Simule IBS/CBS com base nas regras cadastradas',
  },
  consulta: {
    titulo: 'Consulta NCM',
    subtitulo: 'Busque por NCM e veja todas as classificações da Reforma',
  },
  lote: {
    titulo: 'Classificação em lote',
    subtitulo: 'Envie CSV ou Excel para classificar vários produtos',
  },
  nfe: {
    titulo: 'Notas Fiscais (XML)',
    subtitulo: 'Importe XMLs de NF-e/NFC-e e acompanhe o histórico por período',
  },
  produtos: {
    titulo: 'Produtos cadastrados',
    subtitulo: 'Gerencie, filtre e exporte seus produtos',
  },
  auxiliares: {
    titulo: 'Tabelas auxiliares',
    subtitulo: 'Edite CST, cClassTrib, NCM, CFOP e demais tabelas',
  },
  legislacao: {
    titulo: 'Legislação',
    subtitulo: 'Leia as normas dentro do sistema — base federal, decretos, RICMS-CE e portais',
  },
  // View oculta de diagnóstico (Phase 6 / IA-05): fora da paridade SPEC das
  // 7 telas e do menu lateral — acessível só por `Ctrl+Shift+D`.
  debugia: {
    titulo: 'Diagnóstico IA',
    subtitulo: 'Worker offline · candidatos RAG · decisão validada · taxa_uso_ia',
  },
}

export type TipoToast = 'ok' | 'err' | 'warn' | ''

export interface Toast {
  id: number
  tipo: TipoToast
  texto: string
}

export type ModalId =
  | 'empresas'
  | 'config'
  | 'auxEdit'
  | 'salvarClass'
  | 'calcCustom'
  | 'previewEmitente'
  | 'detalheSped'

/**
 * Origem do item que o usuário pediu para calcular.
 *
 * O modal traduz a fonte em um item da calculadora — assim "Adicionar à
 * calculadora" funciona igualmente vindo de uma classificação (Consulta) ou
 * de um produto já cadastrado (Produtos).
 */
export type FonteCalc =
  | { tipo: 'classificacao'; classificacao: Classificacao }
  | { tipo: 'produto'; produto: ProdutoLinha }

/** Rotina de limpeza de uma tela, executada quando o usuário sai dela. */
type LimpezaTela = () => void

const limpezas = new Map<ViewId, LimpezaTela>()

/**
 * Publica a rotina de limpeza de uma tela.
 *
 * Chamado no carregamento do módulo de cada store (efeito colateral de
 * import). `store/ui` não importa nenhum store de volta, então não há ciclo:
 * o registro é só uma anotação usada por `trocarView`.
 */
export function registrarLimpeza(view: ViewId, limpar: LimpezaTela): void {
  limpezas.set(view, limpar)
}

/** Volta a área rolável da aplicação ao topo (o menu lateral não rola). */
export function rolarParaTopo(): void {
  document.getElementById('conteudo')?.scrollTo({ top: 0 })
  window.scrollTo({ top: 0 })
}

type Tema = 'dark' | 'light'

/** Colapso da sidebar no desktop — persistido para respeitar a preferência. */
const CHAVE_RECOLHIDA = 'aurum:sidebar-recolhida'

function recolhidaInicial(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDA) === '1'
  } catch {
    return false
  }
}

function temaInicial(): Tema {
  const salvo = localStorage.getItem(TEMA_KEY)
  if (salvo === 'dark' || salvo === 'light') return salvo
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function aplicarTema(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'dark')
  localStorage.setItem(TEMA_KEY, tema)
}

interface UiState {
  view: ViewId
  tema: Tema
  toasts: Toast[]
  modal: ModalId | null
  /** Drawer móvel (overlay) — só faz sentido abaixo de `lg`. */
  sidebarAberta: boolean
  /** Colapso no desktop (`lg+`): fechada exibe só os ícones. */
  sidebarRecolhida: boolean
  /** Item que está sendo levado ao modal da calculadora (`null` = fechado). */
  fonteCalc: FonteCalc | null
  /** Abre/fecha um modal (`null` fecha). */
  abrirModal: (id: ModalId | null) => void
  /** Abre/fecha o modal da calculadora (`null` fecha). */
  abrirCalc: (fonte: FonteCalc | null) => void
  trocarView: (v: ViewId) => void
  alternarTema: () => void
  toggleSidebar: () => void
  /** Alterna o colapso no desktop (abre/fecha, com transição elástica). */
  toggleRecolhida: () => void
  /** Fecha o menu móvel (usado por `Escape` e pelo fundo escuro). */
  fecharSidebar: () => void
  toast: (texto: string, tipo?: TipoToast) => void
  dismissToast: (id: number) => void
}

let seqToast = 0

export const useUi = create<UiState>((set, get) => ({
  view: 'calculadora',
  tema: temaInicial(),
  toasts: [],
  modal: null,
  sidebarAberta: false,
  sidebarRecolhida: recolhidaInicial(),
  fonteCalc: null,

  /**
   * Troca de tela. Ao sair, a tela anterior limpa o que o usuário digitou
   * (buscas, filtros, formulários) — assim um retorno futuro nunca reencontra
   * o formulário congelado no último estado.
   */
  trocarView: (v) => {
    const atual = get().view
    if (atual !== v) limpezas.get(atual)?.()
    set({ view: v, sidebarAberta: false, modal: null, fonteCalc: null })
    rolarParaTopo()
  },

  abrirModal: (id) => set({ modal: id }),

  abrirCalc: (fonte) => set({ fonteCalc: fonte }),

  alternarTema: () => {
    const proximo: Tema = get().tema === 'dark' ? 'light' : 'dark'
    aplicarTema(proximo)
    set({ tema: proximo })
  },

  toggleSidebar: () => set((s) => ({ sidebarAberta: !s.sidebarAberta })),

  toggleRecolhida: () => {
    const proxima = !get().sidebarRecolhida
    try {
      localStorage.setItem(CHAVE_RECOLHIDA, proxima ? '1' : '0')
    } catch {
      // Armazenamento indisponível (ex.: modo privado): só vale na sessão.
    }
    set({ sidebarRecolhida: proxima })
  },

  fecharSidebar: () => set({ sidebarAberta: false }),

  toast: (texto, tipo = '') => {
    const id = ++seqToast
    set((s) => ({ toasts: [...s.toasts, { id, tipo, texto }] }))
    window.setTimeout(() => get().dismissToast(id), 3400)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Atalho fora de componentes React. */
export const toast = (texto: string, tipo: TipoToast = '') => useUi.getState().toast(texto, tipo)

/** Aplica o tema salvo imediatamente na carga do módulo. */
aplicarTema(temaInicial())
