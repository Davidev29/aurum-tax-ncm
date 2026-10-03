/**
 * Falas da hora da Aurinha — carinho espontâneo com o relógio atual.
 *
 * A pet aparece do nada, em tempos aleatórios, sempre carismática e
 * divertida, elogiando o humano e lendo a hora do relógio (`new Date()`).
 *
 * Desenho (mesmo padrão dos outros módulos da pet):
 * - 100% puro e testável: sorteio com `rand` injetável, render com `Date`
 *   injetável — determinístico nos testes, aleatório na vida real.
 * - Sem repetir o template anterior imediato (não fica mecânica).
 * - Toda frase contém `{hora}` — contrato: o balão SEMPRE mostra a hora.
 * - O hook em `PetAurum.tsx` (`useFalasHoraDaAurinha`) agenda os disparos
 *   em intervalos irregulares e só fala quando a pet está livre.
 */

import type { PetMood } from './pet'

/** Intervalo entre falas da hora (ms) — irregular de propósito. */
export const INTERVALO_FALA_HORA_MIN = 45_000
export const INTERVALO_FALA_HORA_MAX = 115_000

/** Sorteia o próximo intervalo (ms) — puro para teste. */
export function sortearIntervaloFalaHora(rand: () => number = Math.random): number {
  const r = Math.min(0.9999, Math.max(0, rand()))
  return Math.round(INTERVALO_FALA_HORA_MIN + r * (INTERVALO_FALA_HORA_MAX - INTERVALO_FALA_HORA_MIN))
}

/** Lê o relógio atual no formato carinhoso `14h05`. */
export function formatarHoraRelogio(agora: Date = new Date()): string {
  const hh = String(agora.getHours()).padStart(2, '0')
  const mm = String(agora.getMinutes()).padStart(2, '0')
  return `${hh}h${mm}`
}

/** Saudação carismática conforme o turno — compõe o `{turno}`. */
export function saudacaoPorTurno(hora: number): string {
  if (hora < 6) return 'Boa madrugada'
  if (hora < 12) return 'Bom dia'
  if (hora < 18) return 'Boa tarde'
  return 'Boa noite'
}

/**
 * Catálogo de falas — TODAS carismáticas, divertidas e elogiando o humano.
 * `{hora}` = hora atual, `{turno}` = saudação do turno. Contrato: todo
 * template contém `{hora}` (o balão sempre lê o relógio).
 */
export const FRASES_HORA: readonly string[] = [
  'São {hora} e você continua arrasando, hein?!',
  '{turno}! Já são {hora} e você brilhando mais que minha lupinha!',
  'Olha o relógio: {hora}! Hora perfeita pra um gênio como você!',
  '{hora} em ponto e eu aqui torcendo por você!',
  'São {hora}! Até meu rabinho balança de orgulho de você!',
  '{turno}! São {hora} — bora que hoje é seu dia!',
  'Passei só pra dizer: são {hora} e você é o melhor humano do mundo!',
  'São {hora}! Farejei sucesso vindo aí pra você!',
  '{hora}! Que tal uma pausa pro café dos campeões?',
  'Reloginho diz {hora} e meu coração diz: você é demais!',
  'São {hora}! Com essa dedicação, nem a Receita te segura!',
  '{turno}! São {hora} e eu já sei: você vai conquistar tudo!',
  'São {hora} e a lupinha confirma: humano 10 de 10!',
  'Tic-tac, são {hora}! Continua assim que tá lindo!',
  'São {hora}! Se NCM fosse elogio, o seu seria o mais raro!',
  '{hora} cravadas! Pausa pra comemorar o quanto você é incrível!',
  'São {hora} e eu aqui: ron-ron-ron de alegria por ter você!',
  'Olha lá: {hora}! Hora de brilhar, meu humano favorito!',
  'São {hora}! Hihi, você trabalha tão bem que até eu quero aplaudir!',
  '{turno}! São {hora} e o dia fica melhor com você por aqui!',
  'São {hora}! Dica da Aurinha: sorria, que você fica ainda mais fera!',
  'São {hora}! Se eu tivesse um biscoito, dividia com você agora!',
] as const

/** Humores alegres que combinam com o elogio (a pet nunca reclama da hora). */
export const HUMORES_FALA_HORA: readonly PetMood[] = ['happy', 'love', 'celebrating', 'waving'] as const

export function sortearHumorFalaHora(rand: () => number = Math.random): PetMood {
  const i = Math.floor(rand() * HUMORES_FALA_HORA.length) % HUMORES_FALA_HORA.length
  return HUMORES_FALA_HORA[i]!
}

/** Preenche `{hora}` e `{turno}` com o relógio atual. */
export function renderizarFalaHora(template: string, agora: Date = new Date()): string {
  const hora = formatarHoraRelogio(agora)
  const turno = saudacaoPorTurno(agora.getHours())
  return template.split('{hora}').join(hora).split('{turno}').join(turno)
}

/**
 * Sorteia o template evitando repetir o anterior imediato.
 * `rand` injetável mantém determinismo nos testes.
 */
export function sortearTemplateHora(
  anterior: string | null,
  rand: () => number = Math.random,
): string {
  if (FRASES_HORA.length === 0) throw new Error('sem falas da hora cadastradas')
  if (FRASES_HORA.length === 1) return FRASES_HORA[0]!
  const r = Math.min(0.999999, Math.max(0, rand()))
  let indice = Math.floor(r * FRASES_HORA.length) % FRASES_HORA.length
  let tentativas = 0
  while (FRASES_HORA[indice] === anterior && tentativas < 4) {
    indice = (indice + 1) % FRASES_HORA.length
    tentativas += 1
  }
  return FRASES_HORA[indice]!
}

/** Sorteia template + já renderiza com a hora atual. */
export function sortearFalaHora(
  agora: Date = new Date(),
  anterior: string | null = null,
  rand: () => number = Math.random,
): string {
  return renderizarFalaHora(sortearTemplateHora(anterior, rand), agora)
}
