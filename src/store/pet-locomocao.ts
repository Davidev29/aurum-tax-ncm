/**
 * Locomoção da Aurinha — matemática pura do passeio pela sidebar.
 *
 * A locomoção real mora no `useLocomocaoDaAurinha` (`PetAurum.tsx`), que
 * escreve `transform` direto no DOM via rAF (zero re-render, como o voo).
 * Aqui ficam só as funções puras e testáveis: limites do trilho, escolha de
 * alvo, velocidades e física dos pulinhos.
 *
 * Convenções:
 * - `x` é o deslocamento em px a partir do centro da casinha (0 = centro).
 * - Pulinhos são parábolas de seno: `y = -h · sin(π · progresso)`.
 */

export interface LimitesTrilho {
  min: number
  max: number
}

/** Metade livre do trilho: (casa − pet) / 2, menos a margem de respiro. */
export function limitesPasseio(
  larguraCasa: number,
  larguraPet: number,
  margem = 4,
): LimitesTrilho {
  const livre = Math.max(0, (larguraCasa - larguraPet) / 2 - margem)
  // Normaliza o -0 para o teste de igualdade (`toEqual` distingue -0 de 0).
  return { min: livre === 0 ? 0 : -livre, max: livre }
}

/** Escolhe o próximo destino, exigindo viagem mínima (sem micro-tremor). */
export function escolherAlvo(
  limites: LimitesTrilho,
  atual: number,
  rand: () => number = Math.random,
  viagemMinima = 20,
): number {
  const amplitude = limites.max - limites.min
  if (amplitude <= 0) return 0
  for (let i = 0; i < 6; i++) {
    const alvo = limites.min + rand() * amplitude
    if (Math.abs(alvo - atual) >= Math.min(viagemMinima, amplitude / 2)) return alvo
  }
  // Fallback: espelha o lado atual (sempre rende viagem longa).
  return atual >= 0 ? limites.min : limites.max
}

/** Velocidade do passeio (px/s) — varia para nunca parecer metrônomo. */
export function velocidadePasseio(rand: () => number = Math.random): number {
  return 28 + rand() * 30
}

/** Altura do pulinho (px) — quiques de 8 a 16 px. */
export function alturaPulo(rand: () => number = Math.random): number {
  return 8 + rand() * 8
}

/** Duração do pulo (ms) cresce com a altura — física honesta. */
export function duracaoPulo(alturaPx: number): number {
  return Math.round(360 + alturaPx * 10)
}

/** Pausa entre viagens (ms) — ela para, olha, fareja, depois decide. */
export function pausaEntreViagens(rand: () => number = Math.random): number {
  return Math.round(1200 + rand() * 3000)
}

/** Intervalo até o próximo pulinho espontâneo (ms). */
export function intervaloPuloAleatorio(rand: () => number = Math.random): number {
  return Math.round(6000 + rand() * 8000)
}

/** Humores em que ela pode vagar (só livre de verdade). */
export const HUMORES_VAGAR = ['idle'] as const

/** Humores em que pulinhos são bem-vindos (festa, carinho, tchau). */
export const HUMORES_PULO = [
  'idle',
  'celebrating',
  'happy',
  'love',
  'waving',
  'curious',
] as const

export function podeVagar(mood: string, fase: string): boolean {
  return fase === 'doca' && (HUMORES_VAGAR as readonly string[]).includes(mood)
}

export function podePular(mood: string, fase: string): boolean {
  return fase === 'doca' && (HUMORES_PULO as readonly string[]).includes(mood)
}
