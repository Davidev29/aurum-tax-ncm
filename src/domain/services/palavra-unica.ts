/**
 * Trava de especificidade sem lastro — palavra única sem contexto.
 *
 * Problema: com uma única palavra (ex.: "chocolate") e sem nenhum refino
 * (destinação/composição/uso), a IA escolhia o NCM mais específico que casava
 * ("Chocolate branco", 1704.90.10) em vez do genérico ("Chocolate") — ou seja,
 * atribuía qualidade/complemento (branco, recheado, ao leite…) sem nenhuma
 * entrada que comprovasse o qualificador. O mesmo valia para verbo isolado
 * (ex.: "plantar" virando "semente para semeadura" sem contexto).
 *
 * Regra (vale para o determinístico e para o fallback Aurum AI):
 * - entrada minimalista = 1 único token relevante no conjunto
 *   (descrição + destinação + composição + uso) e nenhum refino preenchido;
 * - com entrada minimalista, a IA NUNCA decide por um NCM cujo item próprio
 *   carrega qualificador não comprovado quando existe concorrente genérico
 *   (sem extras) com lastro — prefere o genérico ("retorna só ele");
 * - se vários genéricos empatam (ex.: "Chocolate" recheado × não recheado),
 *   a IA sugere o primeiro genérico como hipótese provisória baixa ancorada
 *   (a verificar com 1–2 detalhes) — NÃO SEI fica só para o sem-lastro;
 * - verbo provável no infinitivo sem lastro literal na base também é NÃO SEI
 *   (a ação não comprova o produto);
 * - com 2+ tokens ou refino preenchido ("chocolate branco", "chocolate" +
 *   composição "branco"), a especificidade ESTÁ comprovada e a trava não se
 *   aplica.
 *
 * Exceções (conhecimento curado, não inferência):
 * - pin do dicionário comercial (`dict: true`, ex.: "parmesao" → 0406.90.10):
 *   termo de 1 palavra só existe no dicionário quando INEQUÍVOCO sozinho, por
 *   curadoria — a trava não o bloqueia.
 *
 * Tudo aqui é puro (sem IndexedDB) para ser usado nos dois motores e nos
 * testes.
 */

import { normalizarBusca, STOPWORDS_BUSCA } from './busca-texto'
import { casaToken } from './vocabulario'

/** Motivos auditáveis da trava (aparecem na trilha/DebugIA). */
export const MOTIVO_PALAVRA_UNICA_QUALIFICADOR = 'palavra-unica-qualificador-nao-comprovado' as const
export const MOTIVO_PALAVRA_UNICA_VERBO = 'palavra-unica-verbo-sem-contexto' as const
export const MOTIVO_PALAVRA_UNICA_EMPATE = 'palavra-unica-empate-sem-contexto' as const

/** Rótulos genéricos que não identificam o produto sozinhos (ignorados). */
const GENERICOS_PROPRIOS = new Set(['outro', 'outros', 'outra', 'outras'])

/**
 * Tokens substantivos do item próprio do NCM (descrição pura, sem caminho).
 * Remove stopwords ("para", "ou", "em"…) e genéricos ("outros") — o que sobra
 * é o que distingue o produto ("chocolate", "branco", "recheados").
 */
export function tokensSubstantivosDescricaoPropria(descricaoPropria: unknown): string[] {
  const norm = normalizarBusca(descricaoPropria)
  if (!norm) return []
  return [
    ...new Set(
      norm
        .split(' ')
        .filter((t) => t.length >= 2 && !STOPWORDS_BUSCA.has(t) && !GENERICOS_PROPRIOS.has(t)),
    ),
  ]
}

/**
 * Qualificadores do NCM sem comprovação na entrada: tokens do item próprio
 * que não casam (nem exato, nem radical/fuzzy via `casaToken`) com nenhum
 * token da entrada (relevantes + expandidos/sinônimos).
 *
 * Ex.: "Chocolate branco" para entrada {chocolate} → ["branco"].
 * Ex.: "Chocolate" para entrada {chocolate} → [] (genérico).
 */
export function qualificadoresNaoComprovados(
  descricaoPropria: unknown,
  tokensEntrada: string[],
): string[] {
  const proprios = tokensSubstantivosDescricaoPropria(descricaoPropria)
  if (!proprios.length) return []
  const entrada = (tokensEntrada ?? []).map((t) => String(t ?? '')).filter(Boolean)
  if (!entrada.length) return [...proprios]
  return proprios.filter((p) => !entrada.some((q) => casaToken(q, p)))
}

/** `true` quando o item próprio é genérico para a entrada (sem extras). */
export function ehGenericoPara(descricaoPropria: unknown, tokensEntrada: string[]): boolean {
  return qualificadoresNaoComprovados(descricaoPropria, tokensEntrada).length === 0
}

/**
 * Substantivos/produtos que terminam em -ar/-er/-ir mas NÃO são verbos.
 * Sem esta allowlist, "celular", "açúcar" ou "freezer" sozinhos seriam
 * tratados como ação e pediriam contexto à toa. A lista é incremental:
 * ao encontrar um falso positivo, adicione aqui (teste em
 * `tests/ia/palavra-unica.test.ts`).
 */
const SUBSTANTIVOS_TERMINADOS_EM_AR_ER_IR = new Set([
  'celular',
  'acucar',
  'blazer',
  'laser',
  'radar',
  'banner',
  'boxer',
  'freezer',
  'cooler',
  'nectar',
  'caviar',
  'manjar',
  'pomar',
  'sonar',
  'colar de perolas',
])

/**
 * Heurística conservadora de verbo no infinitivo ("plantar", "correr",
 * "congelar"): token longo terminado em -ar/-er/-ir, fora da allowlist de
 * substantivos. Com palavra única, verbo sem lastro literal na base não
 * comprova produto — a IA deve pedir contexto em vez de inferir o
 * substantivo ("plantar" ≠ "semente" comprovada).
 */
export function ehVerboProvavel(token: unknown): boolean {
  const t = normalizarBusca(token)
  if (!t || t.includes(' ') || t.length < 5) return false
  if (SUBSTANTIVOS_TERMINADOS_EM_AR_ER_IR.has(t)) return false
  return /(ar|er|ir)$/.test(t)
}
