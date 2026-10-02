/**
 * Aurum AI — identidade, rótulos e calibragem de confiança.
 *
 * A IA chama-se **Aurum AI** em toda a superfície (Consulta, SPED, NF-e,
 * Lote, Calculadora). Este módulo centraliza o nome, os rótulos e a
 * formatação de confiança para que nenhuma tela invente variação
 * ("via IA", "Sugestão IA", "IA", "🤖" solto).
 *
 * Convenção:
 * - Selo curto: `SeloAurumAI` (UI) — "✨ Aurum AI" com brilho + pulso suave.
 * - Atribuição: "Sugerido por Aurum AI" — sempre que um NCM, redução ou
 *   hipótese vier do fallback (nunca do determinístico).
 * - Confiança: número 0–1 + nível `alta | media | baixa` + barra acessível.
 */

export const NOME_IA = 'Aurum AI' as const

export const ROTULO_SUGERIDO_POR = 'Sugerido por Aurum AI' as const

export const ROTULO_FALLBACK = 'Aurum AI · fallback offline' as const

export const ROTULO_PREDICAO = 'Predição assistiva · Aurum AI' as const

export type NivelConfiancaIa = 'alta' | 'media' | 'baixa'

/** Limiares calibrados do fallback (precisão máxima, sem chute). */
export const LIMIAR_NAO_SEI = 0.2 as const
export const LIMIAR_ALTA = 0.75 as const
export const LIMIAR_MEDIA = 0.4 as const

/**
 * Nivel a partir do escore 0–1.
 * - ≥0.75 → alta (âncora automática segura);
 * - ≥0.40 → media (exige conferência);
 * - ≥0.20 → baixa (hipótese fraca, exibe NÃO SEI quando sem margem);
 * - <0.20 → baixa + NÃO SEI.
 */
export function nivelDeConfianca(valor: number): NivelConfiancaIa {
  const n = Number(valor) || 0
  if (n >= LIMIAR_ALTA) return 'alta'
  if (n >= LIMIAR_MEDIA) return 'media'
  return 'baixa'
}

/** `0.735` → `"73,50%"` (pt-BR, 2 casas). */
export function fmtConfiancaAurumAI(valor: number): string {
  const pct = (Math.round(Number(valor) * 10000) / 100).toFixed(2).replace('.', ',')
  return `${pct}%`
}

/** Cor do selo/barra por nível (padrão visual único). */
export function corNivelConfianca(nivel: NivelConfiancaIa): 'emerald' | 'amber' | 'red' {
  if (nivel === 'alta') return 'emerald'
  if (nivel === 'media') return 'amber'
  return 'red'
}

/** Rótulo acessível da confiança ("Aurum AI · confiança alta 82,00%"). */
export function rotuloAcessivelConfianca(valor: number): string {
  const nivel = nivelDeConfianca(valor)
  return `${NOME_IA} · confiança ${nivel} ${fmtConfiancaAurumAI(valor)}`
}

/**
 * Bases lidas pela Aurum AI na predição completa (conjunto absoluto).
 * Exibido como "fontes" para auditoria e para dar visibilidade ao uso da IA.
 */
export const FONTES_AURUM_AI = [
  'Nomenclatura vigente (TEC)',
  'Vínculos oficiais da Reforma (CST × cClassTrib)',
  'Capítulos NCM + flags in natura (Art. 137) e alimentos (Art. 135)',
  'Anexo IX / diferimento (Art. 138)',
  'Vigência (NCM extinto · cClassTrib · revogação CFF)',
  'Reclassificação manual do usuário (quando existe)',
] as const

export type FonteAurumAI = (typeof FONTES_AURUM_AI)[number]
