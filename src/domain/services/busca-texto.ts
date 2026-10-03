/**
 * Busca textual da nomenclatura NCM — funções puras (sem IndexedDB).
 *
 * Problema: as descrições da nomenclatura oficial são fragmentos
 * hierárquicos (`0406.10.10` = "Mozarela", sem a palavra "queijo"). Uma busca
 * ingênua por `descricao` nunca acharia "queijo mozarela". Por isso a busca
 * opera sobre o **caminho completo** (capítulo → posição → subposição → item),
 * composto pelos ancestrais do código.
 *
 * Todas as comparações são insensíveis a acento, caixa e pontuação.
 */

/** Normaliza texto para comparação: minúsculas, sem acento, sem pontuação. */
export function normalizarBusca(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Quebra a consulta em tokens, descartando ruído curto/muito comum. */
export function tokenizarBusca(v: unknown): string[] {
  const norm = normalizarBusca(v)
  if (!norm) return []
  const tokens = norm.split(' ').filter((t) => t.length >= 2)
  return [...new Set(tokens)]
}

/** Palavras sem valor fiscal na busca (nunca decidem um match sozinhas). */
export const STOPWORDS_BUSCA = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'sem', 'em', 'no', 'na',
  'nos', 'nas', 'num', 'numa', 'nuns', 'numas', 'ao', 'aos', 'e', 'ou', 'um',
  'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'que', 'se', 'por', 'como',
  'tipo', 'produto', 'produtos', 'mercadoria', 'mercadorias', 'item', 'itens',
  'coisa', 'coisas', 'et', 'muito', 'pouco', 'grande', 'pequeno', 'novo',
  'usado', 'proprio', 'propria',
])

/**
 * Tokens relevantes da consulta: `tokenizarBusca` menos stopwords.
 * É isto que o RAG usa para casar — "ração PARA cães" vira ["racao","caes"],
 * em vez de exigir o literal "para" no texto oficial (que nunca existe).
 */
export function tokensRelevantes(v: unknown): string[] {
  const todos = tokenizarBusca(v)
  return todos.filter((t) => !STOPWORDS_BUSCA.has(t))
}

/** Prefixos hierárquicos de um código NCM (2 → 4 → 6 → 8 dígitos). */
export function prefixosHierarquia(codigo: string): string[] {
  const c = String(codigo ?? '').replace(/\D+/g, '')
  const out: string[] = []
  for (const tam of [2, 4, 6, 8]) {
    if (c.length >= tam) out.push(c.slice(0, tam))
  }
  return out
}

/**
 * Conjunto de tokens pré-computado para um texto normalizado.
 * Evita `split` repetido no hot loop do RAG (O(docs) por consulta).
 */
export function tokensDoTextoNorm(normTexto: string): string[] {
  if (!normTexto) return []
  return [...new Set(normTexto.split(' ').filter((t) => t.length >= 2))]
}

/** Cache de tokens por texto normalizado (consultas repetidas em lote/XML). */
const _cacheTokensNorm = new Map<string, string[]>()
export function tokensNormComCache(normTexto: string): string[] {
  const hit = _cacheTokensNorm.get(normTexto)
  if (hit) return hit
  const toks = tokensDoTextoNorm(normTexto)
  if (_cacheTokensNorm.size > 3000) _cacheTokensNorm.clear()
  _cacheTokensNorm.set(normTexto, toks)
  return toks
}

/**
 * Compõe o caminho hierárquico (descrições dos ancestrais, sem o próprio item).
 * `obterDescricao` recebe um prefixo e devolve a descrição crua ou `null`.
 */
export function comporCaminho(
  codigo: string,
  obterDescricao: (prefixo: string) => string | null | undefined,
): string[] {
  const c = String(codigo ?? '').replace(/\D+/g, '')
  const prefixos = prefixosHierarquia(c).filter((p) => p !== c)
  const caminho: string[] = []
  for (const p of prefixos) {
    const d = (obterDescricao(p) ?? '').trim()
    if (d && !caminho.includes(d)) caminho.push(d)
  }
  return caminho
}

/** Descrições genéricas que não identificam o produto sozinhas. */
const GENERICOS = new Set([
  'outros',
  'outro',
  'outras',
  'outra',
  'n e',
  'ne',
  'n e p',
])

function ehGenerica(normPropria: string): boolean {
  const limpa = normPropria.replace(/^[-–—\s]+/, '').trim()
  if (GENERICOS.has(limpa)) return true
  // "-- Outros", "- Outros queijos" não é genérico puro; só o "Outros" seco.
  return false
}

/**
 * Pontua um candidato (maior = melhor). Retorna `-1` quando não há match
 * (nem todos os tokens aparecem no caminho completo).
 */
export function pontuarCandidato(
  tokens: string[],
  normPropria: string,
  normCaminho: string,
): number {
  if (!tokens.length) return -1
  // Todos os tokens precisam aparecer em algum lugar do caminho completo.
  for (const t of tokens) {
    if (!normCaminho.includes(t)) return -1
  }
  const frase = tokens.join(' ')
  let score = 10
  if (normPropria.includes(frase)) score += 100
  else if (normCaminho.includes(frase)) score += 60
  else {
    const todosNaPropria = tokens.every((t) => normPropria.includes(t))
    if (todosNaPropria) score += 30
  }
  if (normPropria.startsWith(tokens[0])) score += 5
  if (ehGenerica(normPropria)) score -= 20
  return score
}

/** `true` quando a consulta parece ser um NCM (só dígitos, pontos e espaços). */
export function pareceCodigoNcm(v: unknown): boolean {
  const s = String(v ?? '').trim()
  return s.length > 0 && /^[\d.\s/-]+$/.test(s)
}

/* ---------------------------------- RAG proativo (2ª fase, tolerante) -- */

import { casaToken } from './vocabulario'

/** Cache do fuzzy: pares (q|o) já medidos (o RAG repete pares entre docs). */
const _cacheFuzzy = new Map<string, boolean>()
const _LIMITE_CACHE_FUZZY = 20000
function casaTokenComCache(q: string, o: string): boolean {
  if (q === o) return true
  const chave = `${q}|${o}`
  const hit = _cacheFuzzy.get(chave)
  if (hit !== undefined) return hit
  const r = casaToken(q, o)
  if (_cacheFuzzy.size >= _LIMITE_CACHE_FUZZY) _cacheFuzzy.clear()
  _cacheFuzzy.set(chave, r)
  return r
}

function tokensDoNorm(normTexto: string): string[] {
  return tokensNormComCache(normTexto)
}

/**
 * Pontuação tolerante (OR ponderado): retorna `-1` quando não há lastro
 * (nenhum match exato/radical, ou cobertura < 50%). Caso contrário pontua por
 * cobertura + bônus — sem zerar o candidato porque faltou 1 termo, mas sem
 * deixar match fraco empatar com match forte.
 *
 * É a 2ª fase do RAG: a 1ª (`pontuarCandidato`, AND estrito) garante precisão;
 * esta garante cobertura ("mais opções" em vez de lista vazia), mas só com
 * lastro mínimo.
 */
export function pontuarCandidatoParcial(
  tokens: string[],
  normPropria: string,
  normCaminho: string,
): number {
  if (!tokens.length) return -1
  const toksPropria = tokensDoNorm(normPropria)
  const toksCaminho = tokensDoNorm(normCaminho)
  const todosOficiais = [...new Set([...toksPropria, ...toksCaminho])]
  if (!todosOficiais.length) return -1

  let casados = 0
  let exatos = 0
  let casadosNaPropria = 0
  for (const q of tokens) {
    let achou: 'exato' | 'tolerante' | null = null
    let naPropria = false
    // 1) exato rápido (substring com lastro ≥4 já vale como exato)
    if (normCaminho.includes(q) && q.length >= 3) {
      // confirma que não foi "de" casando à toa: exige token oficial real
      const temToken = todosOficiais.some((o) => o === q || (Math.min(o.length, q.length) >= 4 && o.includes(q)))
      if (temToken) {
        achou = 'exato'
        if (normPropria.includes(q)) naPropria = true
        else {
          for (const o of toksPropria) {
            if (o === q || (Math.min(o.length, q.length) >= 4 && (o.includes(q) || q.includes(o)))) {
              naPropria = true
              break
            }
          }
        }
      }
    }
    if (!achou) {
      // 2) tolerante por token (radical / fuzzy, sem substring curta).
      // Pré-filtro por tamanho: oficial com |len diff| > 2 nunca casa no fuzzy
      // (teto máximo 2) — evita Levenshtein O(n·m) na maioria dos pares.
      for (const o of todosOficiais) {
        if (Math.abs(o.length - q.length) > 3 && q !== o) continue
        if (casaTokenComCache(q, o)) {
          achou = 'tolerante'
          if (toksPropriosTem(toksPropria, q)) naPropria = true
          break
        }
      }
    }
    if (achou) {
      casados += 1
      if (achou === 'exato') exatos += 1
      if (naPropria) casadosNaPropria += 1
    }
  }
  if (!casados) return -1
  // Lastro mínimo: sem nenhum exato e com cobertura < 75% (ex.: 1/4), não é
  // candidato — é ruído ("nave espacial..." não pode virar ração).
  const cobertura = casados / tokens.length
  if (exatos === 0 && cobertura < 0.75) return -1
  if (cobertura < 0.5) return -1

  // base 0–100 pela cobertura; item próprio vale o dobro do caminho
  let score = cobertura * 60 + (casadosNaPropria / tokens.length) * 40 + 10
  const frase = tokens.join(' ')
  if (normPropria.includes(frase)) score += 100
  else if (normCaminho.includes(frase)) score += 60
  if (tokens.length && normPropria.startsWith(tokens[0])) score += 5
  if (ehGenerica(normPropria)) score -= 20
  // cobertura parcial (<100%) perde parte do bônus mas continua ranqueável;
  // match só-tolerante (sem exato) perde mais ainda.
  if (cobertura < 1) score -= (1 - cobertura) * 25
  if (exatos === 0) score -= 15
  return Math.round(score * 100) / 100
}

function toksPropriosTem(toksPropria: string[], q: string): boolean {
  for (const p of toksPropria) {
    if (p === q) return true
    // casaToken direto aqui causaria recursão de import; usa radical local
    if (p.includes(q) || q.includes(p)) {
      if (Math.min(p.length, q.length) >= 4) return true
    }
  }
  return false
}
