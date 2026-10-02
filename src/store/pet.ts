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
 * | classificar/buscar (loading)             | thinking     | "Deixa eu conferir…"      |
 * | resultado encontrado                     | celebrating  | "Achei! 🎉" (sem emoji*)  |
 * | toast ok / PDF ou Excel exportado        | happy        | "Boa!"                    |
 * | toast err / NCM inválido                 | angry        | "Hmm, esse NCM…"          |
 * | toast warn                               | curious      | "Opa, olha isso!"         |
 * | clicar em botão primário                 | happy (ping) | — (só bounce)             |
 * | passar o mouse / clicar na pet (carinho) | love/happy   | frases fofas aleatórias  |
 * | 75 s sem interagir                       | sleeping     | "Zzz…"                    |
 * | qualquer interação após dormir           | waving       | "Voltei!"                 |
 * (* sem emoji no balão — o charme vem do SVG.)
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
