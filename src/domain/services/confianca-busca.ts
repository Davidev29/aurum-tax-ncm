/**
 * Busca automática — rótulos e calibragem de confiança.
 *
 * A classificação é 100% determinística (base embutida + dicionário curado +
 * resolvedor oficial). Este módulo centraliza os rótulos e a formatação de
 * confiança para que nenhuma tela invente variação.
 */
export const NOME_BUSCA_AUTOMATICA = 'Busca automática' as const

export const ROTULO_SUGERIDO_POR = 'Resultado automático' as const
export const ROTULO_FALLBACK = 'Busca automática · base local' as const
export const ROTULO_PREDICAO = 'Predição assistiva · busca automática' as const

export type NivelConfiancaBusca = 'alta' | 'media' | 'baixa'

/** Limiares calibrados da busca (precisão máxima, sem chute). */
export const LIMIAR_NAO_SEI = 0.2 as const
export const LIMIAR_ALTA = 0.75 as const
export const LIMIAR_MEDIA = 0.4 as const

/** Nível a partir do escore 0–1. */
export function nivelDeConfianca(valor: number): NivelConfiancaBusca {
  const n = Number(valor) || 0
  if (n >= LIMIAR_ALTA) return 'alta'
  if (n >= LIMIAR_MEDIA) return 'media'
  return 'baixa'
}

/**
 * Calibragem multi-fator da confiança. Combina evidências independentes em
 * vez de um único overlap: base textual, margem de desempate, vínculo oficial,
 * pin curado, coerência de capítulo e quantidade de tokens.
 */
export function calibrarConfiancaFinal(args: {
  baseTexto: number
  margem?: number
  temVinculo?: boolean
  temPin?: boolean
  capituloCoerente?: boolean
  tokens?: number
}): number {
  const base = Math.max(0, Math.min(1, Number(args.baseTexto) || 0))
  const margem = Math.max(0, Number(args.margem) || 0)
  const tokens = Math.max(0, Math.floor(Number(args.tokens) || 0))
  let score = base * 0.55
  score += Math.min(0.15, margem * 0.005)
  if (args.temVinculo) score += 0.15
  if (args.temPin) score += 0.12
  if (args.capituloCoerente) score += 0.05
  if (tokens >= 3) score += 0.05
  else if (tokens <= 1) score -= 0.1
  if (base >= 0.99 && (args.temVinculo || args.temPin)) score = Math.max(score, 0.87)
  if (base >= 0.99 && margem >= 1) score = Math.max(score, 0.85)
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
}

/** `0.735` → `"73,50%"` (pt-BR, 2 casas). */
export function fmtConfiancaBusca(valor: number): string {
  const pct = (Math.round(Number(valor) * 10000) / 100).toFixed(2).replace('.', ',')
  return `${pct}%`
}

/** Cor do selo/barra por nível (padrão visual único). */
export function corNivelConfianca(nivel: NivelConfiancaBusca): 'emerald' | 'amber' | 'red' {
  if (nivel === 'alta') return 'emerald'
  if (nivel === 'media') return 'amber'
  return 'red'
}
