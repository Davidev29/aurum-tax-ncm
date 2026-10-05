/**
 * Pet oficial da Aurum Bit — estado global de humor da Aurinha.
 *
 * Filosofia: a pet é PRESENTE, nunca intrusiva.
 * - Um `mood` por vez, com retorno automático ao `idle` (exceto `sleeping`,
 *   que é pegajoso até a próxima interação).
 * - `agir()` é barato e à prova de spam: chamadas repetidas só empurram o
 *   temporizador, nunca empilham animações.
 * - Duração padrão por humor (ms) calibrada para microinteração (curta) e
 *   nunca travar a sidebar.
 *
 * Mapa ação → humor (contrato com `PetAurum.tsx`):
 * | ação do usuário                          | humor        | frase típica              |
 * |------------------------------------------|--------------|---------------------------|
 * | trocar de menu                           | walking→waving | "Vamos lá!" + destino     |
 * | focar/digitar em campo de busca          | reading      | "Farejando NCMs…"         |
 * | digitar na busca unificada (≥3 letras)     | reading      | "Farejando 'camiseta'…" + palpite |
 * | busca concluída (resultado oficial)        | celebrating  | "Achei! 'X' é NCM …!"   |
 * | busca com N candidatos de texto            | celebrating  | "N candidatos pra 'X'!" |
 * | busca zerada                               | curious      | "Nada pra 'X'… tenta outra?" |
 * | NCM inválido                               | angry        | "Hmm, 'X' não é válido…" |
 * | focar/digitar na Calculadora               | calculating  | "Deixa eu conferir com a lupinha…" |
 * | adicionar item na Calculadora              | calculating  | "Mais um na conta!"     |
 * | classificar/buscar (loading)             | thinking     | "Deixa eu conferir…"      |
 * | busca unificada ativa (farejo + varredura)  | searching    | "Farejando 'X'…" + lupa investigativa |
 * | resultado entregue (lupa ainda varrendo)    | celebrating  | "Achei! 'X' é NCM …!" + lupa varrendo |
 * | resultado encontrado                     | celebrating  | "Achei a classificação!"  |
 * | toast ok / PDF ou Excel exportado        | happy        | "Boa!"                    |
 * | toast err / NCM inválido                 | angry        | "Hmm, esse NCM…"          |
 * | toast warn                               | curious      | "Opa, olha isso!"         |
 * | exportar PDF/Excel/relatório              | celebrating  | "Relatório prontinho!"  |
 * | copiar NCM/conterúdo                       | happy        | "Copiado! Farejei tudinho!" |
 * | passar o mouse / clicar na pet (carinho) | love/happy   | frases fofas aleatórias  |
 * | segurar a pet (pré-arrasto)              | curious      | "Ei, pra onde vamos?"     |
 * | arrastar a pet para fora                 | voando *     | "Wheee! Me solta!"        |
 * | soltar longe (volta de paraquedas)       | retornando * | "Voltando pra caminha!"   |
 * | pouso do paraquedas                      | waving       | "De volta! Sentiu falta?" |
 * | 75 s sem interagir                       | sleeping     | "Zzz…"                    |
 * | qualquer interação após dormir           | waving       | "Voltei!"                 |
 * (* humores de voo são pegajosos — o fluxo de arrasto controla a saída.)
 *
 * Sidebar recolhida: a mesma Aurinha em modo sentinela (rostinho compacto,
 * balão vira tooltip à direita, pupilas patrulham o menu no `idle`).
 * Rotinas da mini-IA local vivem em `store/pet-ia.ts`.
 */
import { create } from 'zustand'

export type PetMood =
  | 'idle'
  | 'reading'
  | 'searching'
  | 'walking'
  | 'waving'
  | 'sleeping'
  | 'angry'
  | 'happy'
  | 'thinking'
  | 'celebrating'
  | 'curious'
  | 'love'
  | 'voando'
  | 'retornando'
  | 'calculating'

/** Quanto tempo cada humor fica no palco antes de voltar ao `idle`. */
const DURACAO: Record<PetMood, number> = {
  idle: 0,
  reading: 4200,
  searching: 6500,
  walking: 1600,
  waving: 2600,
  sleeping: 0, // pegajoso: só sai com interação
  angry: 3200,
  happy: 2200,
  thinking: 5000,
  celebrating: 3200,
  curious: 2800,
  love: 2600,
  voando: 0, // pegajoso: o fluxo de arrasto controla a saída
  retornando: 0, // pegajoso: termina no pouso
  calculating: 5200,
}

interface PetState {
  mood: PetMood
  /** Texto do balão de fala (string vazia = balão recolhido). */
  frase: string
  /** Contador — incrementa a cada ação; serve de "gatilho" p/ re-disparar CSS. */
  seq: number
  /**
   * Ideia acesa (lâmpada do lote) — ortogonal ao `mood`: a conclusão do lote
   * liga `celebrating` (confete + lupa) + `eureka` (lâmpada + glow + raios).
   * Desliga sozinha em 4,5 s ou ao aquietar.
   */
  eureka: boolean
  /**
   * Ambiente sugerido pela IA (`data-ambient` forçado) — ortogonal ao `mood`.
   * A direção IA→Aurinha (`store/pet-direcao-ia.ts`) escreve aqui; o
   * `PetAurum` prioriza sobre o sorteio autônomo e limpa sozinho após
   * `duracaoMs`. `null` = sorteio autônomo manda.
   */
  ambientSugerido: string | null
  agir: (mood: PetMood, frase?: string, duracaoMs?: number) => void
  /** Volta ao respiro neutro (usado pelos temporizadores internos). */
  aquietar: () => void
  dispararEureka: () => void
  limparEureka: () => void
  /** Força um `data-ambient` por `duracaoMs` (0 = limpa na hora). */
  sugerirAmbiente: (id: string | null, duracaoMs?: number) => void
}

let timer: number | null = null
let eurekaTimer: number | null = null
let ambienteTimer: number | null = null

function limparTimerAmbiente() {
  if (ambienteTimer !== null) {
    try { (typeof window !== 'undefined' ? window : globalThis).clearTimeout(ambienteTimer) } catch { /* noop */ }
    ambienteTimer = null
  }
}

function limparTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function limparTimerEureka() {
  if (eurekaTimer !== null) {
    window.clearTimeout(eurekaTimer)
    eurekaTimer = null
  }
}

export const usePet = create<PetState>((set, get) => ({
  mood: 'idle',
  frase: '',
  seq: 0,
  eureka: false,
  ambientSugerido: null,

  agir: (mood, frase = '', duracaoMs) => {
    const cur = get()
    const duracao = duracaoMs ?? DURACAO[mood] ?? 2400
    // Idempotente: mesmo humor + mesma frase só estende o timer, sem `set`
    // (sem re-render). É o que evita lag ao digitar: antes cada tecla fazia
    // `set({seq: +1})` e remontava o SVG pesado da pet no meio do input.
    if (cur.mood === mood && cur.frase === frase) {
      if (duracao > 0) {
        limparTimer()
        const alvo = mood
        timer = window.setTimeout(() => {
          if (get().mood === alvo) set({ mood: 'idle', frase: '' })
        }, duracao)
      }
      return
    }
    limparTimer()
    set((s) => ({ mood, frase, seq: s.seq + 1 }))
    // `idle` e `sleeping` não têm retorno automático.
    if (duracao > 0) {
      timer = window.setTimeout(() => {
        // Só aquieta se ninguém trocou o humor no meio do caminho.
        if (get().mood === mood) set({ mood: 'idle', frase: '' })
      }, duracao)
    }
  },

  aquietar: () => {
    limparTimer()
    limparTimerEureka()
    limparTimerAmbiente()
    set({ mood: 'idle', frase: '', eureka: false, ambientSugerido: null })
  },

  dispararEureka: () => {
    limparTimerEureka()
    set({ eureka: true })
    eurekaTimer = window.setTimeout(() => {
      get().limparEureka()
    }, 4500)
  },

  limparEureka: () => {
    limparTimerEureka()
    if (get().eureka) set({ eureka: false })
  },

  sugerirAmbiente: (id, duracaoMs = 3000) => {
    limparTimerAmbiente()
    if (!id || duracaoMs <= 0) {
      if (get().ambientSugerido !== null) set({ ambientSugerido: null })
      return
    }
    set({ ambientSugerido: id })
    try {
      ambienteTimer = (typeof window !== 'undefined' ? window : globalThis).setTimeout(() => {
        ambienteTimer = null
        if (get().ambientSugerido === id) set({ ambientSugerido: null })
      }, duracaoMs) as unknown as number
    } catch { /* sem temporizador: a sugestão cai no próximo aquietar */ }
  },
}))

/** Frases de carinho — sorteadas quando o usuário faz cafuné na Aurinha. */
const CARINHOS = [
  'Hihi, cócegas!',
  'Aurinha ama você!',
  'Ron-ron-ron…',
  'Você é meu humano favorito!',
  'Farejei carinho por aqui!',
]

/** Frases da lupinha — a pet "confere as contas" na Calculadora. */
export const FRASES_CALCULANDO = [
  'Deixa eu conferir com a lupinha…',
  'Somando tim-tim por tim-tim…',
  'Lupinha a postos, bora somar!',
  'IBS mais CBS… farejando o total…',
]

/** Frases da pesquisa investigativa — a lupa varre enquanto ela fala. */
export const FRASES_PESQUISANDO = [
  'Vasculhando cada cantinho…',
  'Lupinha em modo detetive…',
  'Rastreando pista por pista…',
]

/** Dá cafuné: nunca brava, sempre derrete. */
export function fazerCarinho(): void {
  const frase = CARINHOS[Math.floor(Math.random() * CARINHOS.length)]
  usePet.getState().agir('love', frase)
}

/** Frase de boas-vindas por tela — a pet "apresenta" o setor. */
export const FRASE_POR_VIEW: Record<string, string> = {
  calculadora: 'Bora simular IBS e CBS!',
  consulta: 'Vamos caçar NCMs!',
  lote: 'Manda a planilha que eu confiro!',
  nfe: 'XMLs? Eu adoro farejar XML!',
  produtos: 'Vamos cuidar do seu catálogo!',
  auxiliares: 'Tabelinhas em ordem!',
  legislacao: 'Hora da leitura séria!',
  debugia: 'Modo detetive ativado!',
}
