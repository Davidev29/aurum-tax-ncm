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
  agir: (mood: PetMood, frase?: string, duracaoMs?: number) => void
  /** Volta ao respiro neutro (usado pelos temporizadores internos). */
  aquietar: () => void
}

let timer: number | null = null

function limparTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

export const usePet = create<PetState>((set, get) => ({
  mood: 'idle',
  frase: '',
  seq: 0,

  agir: (mood, frase = '', duracaoMs) => {
    limparTimer()
    set((s) => ({ mood, frase, seq: s.seq + 1 }))
    const duracao = duracaoMs ?? DURACAO[mood] ?? 2400
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
    set({ mood: 'idle', frase: '' })
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
