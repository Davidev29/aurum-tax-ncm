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
 *   hipótese vier da IA (nunca do determinístico).
 * - Confiança: número 0–1 + nível `alta | media | baixa` + barra acessível.
 */

export const NOME_IA = 'Aurum AI' as const

export const ROTULO_SUGERIDO_POR = 'Sugerido por Aurum AI' as const

export const ROTULO_FALLBACK = 'Aurum AI · modelo embutido' as const

export const ROTULO_PREDICAO = 'Predição assistiva · Aurum AI' as const

export type NivelConfiancaIa = 'alta' | 'media' | 'baixa'

/** Limiares calibrados da IA (precisão máxima, sem chute). */
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

/**
 * Calibragem multi-fator da confiança (meta: ≥0.85 nos casos claros,
 * excluídas as exceções/hipóteses a verificar).
 *
 * Combina evidências independentes em vez de um único overlap:
 * - `baseTexto` (0–1): cobertura textual da consulta no candidato;
 * - `margem` (≥0): distância textual do topo ao 2º (desempate);
 * - `temVinculo`: vínculo oficial da Reforma (fato > hipótese);
 * - `temPin`: pin do dicionário curado (conhecimento > inferência);
 * - `capituloCoerente`: capítulo do candidato entre os prioritários;
 * - `tokens`: nº de tokens úteis (contexto comprova especificidade).
 *
 * Pesos calibrados para que o caso claro (2+ tokens, vínculo ou pin,
 * margem folgada) ancore em ≥0.85, o caso médio fique em 0.40–0.84 e o
 * fraco caia para NÃO SEI (<0.20). Hipótese a verificar tem teto 0.60
 * aplicado pelo chamador — aqui NÃO entra exceção.
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
  // Componente textual responde por 55%; o resto é evidência convergente.
  let score = base * 0.55
  // Margem de desempate: folga clara vale até +0.15.
  score += Math.min(0.15, margem * 0.005)
  // Vínculo oficial: fato convergente (+0.15).
  if (args.temVinculo) score += 0.15
  // Pin curado: conhecimento humano convergente (+0.12).
  if (args.temPin) score += 0.12
  // Capítulo coerente com os sinais (+0.05).
  if (args.capituloCoerente) score += 0.05
  // Contexto rico (3+ tokens) comprova especificidade (+0.05);
  // contexto mínimo (1 token) penaliza (−0.10) — sem contexto, sem afirmação.
  if (tokens >= 3) score += 0.05
  else if (tokens <= 1) score -= 0.1
  // Cobertura total (base 1.0) com qualquer evidência convergente ancora alto.
  if (base >= 0.99 && (args.temVinculo || args.temPin)) score = Math.max(score, 0.87)
  if (base >= 0.99 && margem >= 1) score = Math.max(score, 0.85)
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
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
