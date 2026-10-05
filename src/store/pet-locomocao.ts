/**
 * Locomoção da Aurinha — matemática pura do passeio pela sidebar.
 *
 * A locomoção real mora no `useLocomocaoDaAurinha` (`PetAurum.tsx`), que
 * escreve `transform` direto no DOM via rAF (zero re-render, como o voo).
 * Aqui ficam só as funções puras e testáveis: limites do trilho, escolha de
 * alvo, velocidades e física dos pulinhos.
 *
 * MODELO FÍSICO (doca):
 * - Eixo X com aceleração + atrito (não é velocidade constante): a pet
 *   ARRanca (`ACELERACAO_PASSEIO`), cruza em `VEL_MAX_PASSEIO` e FREIA com
 *   `ATRITO_PARADA` antes do alvo — por isso ela "derrapa" de leve ao parar.
 * - Inclinação (bank) proporcional à velocidade: `inclinacaoPorVelocidade`.
 * - Squash & stretch com preservação de volume: `squashPorVelocidade`
 *   (esticada em viagem, achatada na frenagem — `sx * sy ≈ 1`).
 * - Pulinhos são balística honesta: subida com `GRAVIDADE_PULO` e descida
 *   mais rápida que a subida (`y = -h · sin(π · p)` ≈ parábola com gravidade);
 *   `duracaoPulo` cresce com a altura.
 * - Vento/balanço residual: `rajadaVento(t)` (senos sobrepostos, média zero)
 *   dá deriva viva sem empurrar o trilho; `penduloDuplo(t)` aproxima o
 *   pêndulo duplo do corpo sob a copa (paraquedas) para o CSS/JS usarem.
 *
 * Convenções:
 * - `x` é o deslocamento em px a partir do centro da casinha (0 = centro).
 * - `vx` é px/s no eixo X. `dt` sempre em segundos.
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

/* ------------------------- FÍSICA DETALHADA (pura) -------------------------
   Constantes calibradas para sprite de ~72px a 60fps. Tudo puro e testável;
   o hook só integra (`vx += a·dt`, `x += vx·dt`). */

/** Aceleração de arrancada no passeio (px/s²). */
export const ACELERACAO_PASSEIO = 260
/** Atrito de frenagem ao aproximar do alvo (1/s — decaimento exponencial). */
export const ATRITO_PARADA = 6.5
/** Atrito de rolamento em cruzeiro (1/s — impede aceleração infinita). */
export const ATRITO_ROLAMENTO = 0.6
/** Teto de velocidade no passeio (px/s) — gaits rápidos multiplicam. */
export const VEL_MAX_PASSEIO = 95
/** Gravidade dos pulinhos (px/s²) — descida mais rápida que a subida. */
export const GRAVIDADE_PULO = 900
/** Multiplicadores de marcha por gait (1 = passeio, 2.2 = galope). */
export const RITMO_GAIT: Record<string, number> = {
  passeio: 1,
  'correr-leve': 1.5,
  trotar: 1.35,
  galopar: 2.2,
  sonambular: 0.45,
  esgueirar: 0.5,
}

/**
 * Integra velocidade em direção ao alvo com aceleração limitada.
 * Retorna a nova velocidade (px/s). `dt` em segundos.
 */
export function acelerarPara(
  velAtual: number,
  velAlvo: number,
  aceleracao: number = ACELERACAO_PASSEIO,
  dt: number,
): number {
  const diff = velAlvo - velAtual
  const passoMax = aceleracao * dt
  if (Math.abs(diff) <= passoMax) return velAlvo
  return velAtual + Math.sign(diff) * passoMax
}

/** Decaimento exponencial da velocidade (atrito) — `dt` em segundos. */
export function aplicarAtrito(vel: number, atrito = ATRITO_PARADA, dt: number): number {
  const k = Math.exp(-atrito * dt)
  const v = vel * k
  return Math.abs(v) < 0.5 ? 0 : v
}

/** Inclinação do corpo (deg) pelo bank da velocidade — clamp ±8°. */
export function inclinacaoPorVelocidade(vx: number): number {
  return Math.max(-8, Math.min(8, vx * 0.055))
}

/**
 * Squash & stretch por velocidade com volume preservado (`sx * sy ≈ 1`).
 * Parada = (1,1); cruzeiro = estica X; frenagem brusca = achata (o chamador
 * inverte o eixo quando `freando=true`).
 */
export function squashPorVelocidade(
  speed: number,
  freando = false,
): { sx: number; sy: number } {
  const t = Math.min(1, speed / VEL_MAX_PASSEIO)
  const k = t * 0.09
  if (freando) return { sx: 1 - k, sy: 1 + k }
  return { sx: 1 + k, sy: 1 - k * 0.85 }
}

/** Posição vertical do pulo (px, negativa = para cima) — parábola de seno. */
export function posicaoPulo(progresso: number, alturaPx: number): number {
  const p = Math.max(0, Math.min(1, progresso))
  return -alturaPx * Math.sin(Math.PI * p)
}

/** Velocidade vertical instantânea do pulo (px/s) — p/ stretch no ar. */
export function velocidadePulo(progresso: number, alturaPx: number, duracaoMs: number): number {
  const p = Math.max(0.001, Math.min(0.999, progresso))
  const dur = Math.max(1, duracaoMs) / 1000
  return (-alturaPx * Math.PI * Math.cos(Math.PI * p)) / dur
}

/**
 * Rajada de vento lateral (px/s² equivalentes) — soma de senos com média
 * zero: deriva viva sem empurrar o trilho. `t` em ms.
 */
export function rajadaVento(tMs: number, semente = 0): number {
  const t = tMs / 1000 + semente
  return Math.sin(t * 0.9) * 7 + Math.sin(t * 2.3 + 1.7) * 3.2 + Math.sin(t * 4.7 + 0.4) * 1.1
}

/**
 * Pêndulo duplo aproximado (rad) — corpo sob a copa: primária lenta +
 * tremor das linhas. `t` em ms. Amplitude contida (±0.09 rad ≈ ±5°).
 */
export function penduloDuplo(tMs: number): number {
  const t = tMs / 1000
  return Math.sin(t * 2.4) * 0.065 + Math.sin(t * 5.9 + 1.2) * 0.022
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

/** Humores de consulta (NCM/NBS/cálculos) — ela vai até a gaveta e lê. */
export const HUMORES_CONSULTA = [
  'searching',
  'reading',
  'thinking',
  'calculating',
] as const

export function podeVagar(mood: string, fase: string): boolean {
  return fase === 'doca' && (HUMORES_VAGAR as readonly string[]).includes(mood)
}

export function podePular(mood: string, fase: string): boolean {
  return fase === 'doca' && (HUMORES_PULO as readonly string[]).includes(mood)
}

/** Consulta ativa (NCM/NBS/cálculos) na doca — hora de ir à gaveta. */
export function podeConsultar(mood: string, fase: string): boolean {
  return fase === 'doca' && (HUMORES_CONSULTA as readonly string[]).includes(mood)
}

/* ---------------- VIAGEM LONGA (ambientes que atravessam a sidebar) ---------
   Ambientes como `ronda`, `patrulha-lenta` ou `galopar` não são só pose do
   CSS: eles PEDEM ao passeio JS uma travessia real de borda a borda. Como o
   sorteio (store) é puro e o loop (rAF) é imperativo, a ponte é um sinal
   simples: `pedirViagemLonga()` → o próximo ciclo do loop consome com
   `consumirViagemLonga()` e mira a borda oposta via `alvoBorda()`. */

/** Ambientes que disparam travessia real (contrato com `PetAurum.tsx`). */
export const AMBIENTES_VIAGEM_LONGA: readonly string[] = [
  'ronda',
  'patrulha-lenta',
  'galopar',
  'zigue-zague',
  'correr-leve',
  'saltitar',
  'rodopiar',
  'sonambular',
  'cacar-moeda',
  'cacar-borboleta',
]

let viagemLongaPendente = 0

/** Marca N travessias de borda a borda (chamado pelo hook de ambientes). */
export function pedirViagemLonga(vezes = 1): void {
  viagemLongaPendente = Math.min(3, viagemLongaPendente + Math.max(1, vezes))
}

/** Consome um pedido pendente — retorna `true` se deve atravessar agora. */
export function consumirViagemLonga(): boolean {
  if (viagemLongaPendente <= 0) return false
  viagemLongaPendente -= 1
  return true
}

/** Mira a borda oposta à posição atual (travessia máxima, sem micro-tremor). */
export function alvoBorda(limites: LimitesTrilho, atual: number): number {
  if (limites.max - limites.min <= 0) return 0
  const distMin = Math.abs(atual - limites.min)
  const distMax = Math.abs(limites.max - atual)
  return distMin >= distMax ? limites.min : limites.max
}
