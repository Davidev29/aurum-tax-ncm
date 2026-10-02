/**
 * Sprite pixel-art da Aurinha — versão esguia da detetive fiscal.
 *
 * Grade de 26 × 29 px, desenhada à mão (100% vetorial/SVG em tempo de
 * execução — nenhum asset de imagem; o PNG de referência foi removido):
 * orelhinhas, óculos redondos verde-petróleo com olhos
 * kawaii, focinho creme, corpinho magro de lontra com barriguinha clara,
 * rabinho afunilado e a lupinha na patinha direita.
 *
 * Convenções:
 * - `SPRITE`: mapa base (cabeça `CABECA` = linhas 0–15, corpo `CORPO` = resto).
 *   Pés, braços, rabo, lupa, pálpebras e bocas são overlays (`OVERLAYS`) para
 *   que o CSS anime cada parte sem redesenhar nada.
 * - `S` é sombra translúcida (o renderizador aplica `opacity 0.18`).
 * - `tests/pet-sprite.test.ts` trava a grade: toda linha tem a mesma largura
 *   e só usa caracteres da paleta — quebrou a simetria, quebrou o teste.
 */

export const PALETA: Record<string, string> = {
  K: '#241610', // contorno
  F: '#a8703f', // pelo
  D: '#7c4a2d', // pelo escuro (sombra, orelha interna, patas, rabo)
  C: '#fbeed3', // creme (focinho, barriga)
  T: '#22a8a8', // aro do óculos
  t: '#0f6f6f', // pálpebra fechada
  G: '#bfe9ef', // lente
  H: '#ffffff', // brilho do olho
  W: '#ffffff', // branco do olho
  P: '#22344d', // pupila
  N: '#5b3a26', // nariz
  R: '#e8938a', // blush
  M: '#8291a3', // metal da lupa
  m: '#3c4450', // cabo da lupa
  S: '#16233a', // sombra do chão
}

/** Corpo + cabeça (26 colunas × 29 linhas). */
export const SPRITE: string[] = [
  '.....KK............KK.....',
  '.....KRRK........KRRK.....',
  '......KKKKKKKKKKKKKK......',
  '....KKFFFFFFFFFFFFFFKK....',
  '....KFFFFFFFFFFFFFFFFK....',
  '....KFTTTTTTFFTTTTTTFK....',
  '....KFTHWWWTFFTWWWHTFK....',
  '....KFTWPPWTFFTWPPWTFK....',
  '....KFTWWWWTFFTWWWWTFK....',
  '....KFTTTTTTFFTTTTTTFK....',
  '....KFFFCCCCCCCCCCFFFK....',
  '....KFRRCCCCNNCCCCRRFK....',
  '....KFFFCCCCKKCCCCFFFK....',
  '....KFFFFFKKCCKKFFFFFK....',
  '....KFFFCCCCCCCCCCFFFK....',
  '.......KKKKKKKKKKKK.......',
  '........KKKKKKKKKK........',
  '........KFFFFFFFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '........KFFCCCCFFK........',
  '.........KFFFFFFK.........',
  '.........KKK..KKK.........',
  '..........................',
  '..........SSSSSS..........',
]

/** Linhas da cabeça (balança e inclina sozinha). */
export const CABECA: string[] = SPRITE.slice(0, 16)
/** Linhas do corpo (squash & stretch mora aqui). */
export const CORPO: string[] = SPRITE.slice(16)

/** Lupinha de 7 × 11 px, desenhada no próprio sistema de coordenadas. */
export const LOUPE: string[] = [
  '..MMM..',
  '.MGGGM.',
  'MGGGGGM',
  'MGHGGGM',
  'MGGGGGM',
  '.MGGGM.',
  '..MMM..',
  '...mm..',
  '...mm..',
  '...mm..',
  '...mm..',
]

/** Canto superior-esquerdo da lupa na grade global. */
export const LOUPE_POS = { x: 19, y: 18 }

/** Bloco de pixels: [x, y, largura, altura, caractere da paleta]. */
export type Bloco = [number, number, number, number, string]

/** Marcha parada: pé esquerdo plantado, direito levantado. */
const PES_A: Bloco[] = [
  [8, 27, 1, 1, 'K'], [9, 27, 2, 1, 'D'], [11, 27, 1, 1, 'K'],
  [12, 26, 1, 1, 'K'], [13, 26, 2, 1, 'D'], [15, 26, 1, 1, 'K'],
]
/** Marcha parada, fase oposta. */
const PES_B: Bloco[] = [
  [8, 26, 1, 1, 'K'], [9, 26, 2, 1, 'D'], [11, 26, 1, 1, 'K'],
  [12, 27, 1, 1, 'K'], [13, 27, 2, 1, 'D'], [15, 27, 1, 1, 'K'],
]
/** Bracinho esquerdo abaixado (repouso). */
const BRACO_BAIXO_E: Bloco[] = [
  [6, 20, 1, 1, 'K'], [7, 20, 1, 1, 'F'],
  [6, 21, 2, 1, 'F'],
  [6, 22, 2, 1, 'F'],
  [6, 23, 2, 1, 'D'],
]
/** Bracinho esquerdo erguido (tchauzinho). */
const BRACO_ALTO_E: Bloco[] = [
  [5, 15, 1, 1, 'K'], [4, 15, 1, 1, 'F'],
  [4, 16, 2, 1, 'F'],
  [4, 17, 2, 1, 'F'],
  [4, 18, 2, 1, 'D'],
]
/** Braço direito segurando a lupa (sempre à mostra). */
const BRACO_DIR: Bloco[] = [
  [18, 20, 1, 1, 'F'], [19, 20, 1, 1, 'K'],
  [18, 21, 2, 1, 'F'],
  [18, 22, 2, 1, 'F'],
  [18, 23, 2, 1, 'F'],
  [18, 24, 2, 1, 'D'],
  [19, 24, 2, 1, 'F'],
]
/** Rabinho afunilado com listra (origem do giro = encaixe no corpo). */
const RABO: Bloco[] = [
  [5, 23, 1, 1, 'K'], [6, 23, 1, 1, 'F'],
  [4, 24, 1, 1, 'K'], [5, 24, 1, 1, 'D'], [6, 24, 1, 1, 'D'], [7, 24, 1, 1, 'F'],
  [4, 25, 1, 1, 'K'], [5, 25, 1, 1, 'D'],
]
/** Pálpebras fechadas (piscada + soneca) — cobrem as lentes. */
const PALPEBRAS: Bloco[] = [
  [6, 7, 6, 1, 't'],
  [14, 7, 6, 1, 't'],
]
/** Sobrancelhas de brava. */
const SOBRANCELHAS: Bloco[] = [
  [6, 4, 1, 1, 'K'], [7, 4, 1, 1, 'K'], [8, 5, 1, 1, 'K'],
  [19, 4, 1, 1, 'K'], [18, 4, 1, 1, 'K'], [17, 5, 1, 1, 'K'],
]
/** Boca emburrada (cobre o sorriso base). */
const BOCA_BRAVA: Bloco[] = [
  [10, 13, 2, 1, 'C'], [14, 13, 2, 1, 'C'],
  [11, 13, 4, 1, 'K'],
]
/** Boquinha em "o" (voo e paraquedas). */
const BOCA_ABERTA: Bloco[] = [
  [12, 12, 2, 1, 'C'], [10, 13, 2, 1, 'C'], [14, 13, 2, 1, 'C'],
  [12, 12, 2, 2, 'K'],
]

/** Braço esquerdo esticado (Superman pose - voo). */
const BRACO_SUPERMAN_E: Bloco[] = [
  [2, 19, 1, 1, 'K'], [3, 19, 1, 1, 'F'],
  [2, 20, 1, 1, 'K'], [3, 20, 4, 1, 'F'],
  [2, 21, 1, 1, 'K'], [3, 21, 4, 1, 'F'],
  [2, 22, 1, 1, 'D'],
]

/** Braço direito esticado (Superman pose - voo). */
const BRACO_SUPERMAN_D: Bloco[] = [
  [23, 19, 1, 1, 'F'], [24, 19, 1, 1, 'K'],
  [20, 20, 4, 1, 'F'], [24, 20, 1, 1, 'K'],
  [20, 21, 4, 1, 'F'], [24, 21, 1, 1, 'K'],
  [23, 22, 2, 1, 'D'],
]

export const OVERLAYS = {
  PES_A,
  PES_B,
  BRACO_BAIXO_E,
  BRACO_ALTO_E,
  BRACO_DIR,
  BRACO_SUPERMAN_E,
  BRACO_SUPERMAN_D,
  RABO,
  PALPEBRAS,
  SOBRANCELHAS,
  BOCA_BRAVA,
  BOCA_ABERTA,
}

export const LARGURA_GRADE = 26
