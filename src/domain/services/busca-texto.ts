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

/** Normaliza texto para comparação: minúsculas, sem acento, sem pontuação.
 * Tags HTML/XML (`<i>Gallus</i>`, `<sub>`) da TEC viram espaço — nunca tokens. */
export function normalizarBusca(v: unknown): string {
  return String(v ?? '')
    .replace(/<[^>]*>/g, ' ')
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
  // Ruído de consulta comercial sem lastro fiscal (aparecem em todo lugar da TEC).
  'in', 'via', 'ex',
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
/** Prefixos hierárquicos de um código NCM, incluindo níveis 5 e 7 da TEC.
 *
 * 5 ("0207.1 - De aves...") e 7 ("0713.33.1 - Preto") carregam as distinções
 * decisivas de ~1.900 NCMs de 8 dígitos: ignorá-los fazia a busca perder
 * tokens únicos ("feijão preto", "reprodução"). Também é a ordem usada por
 * `comporCaminho`. */
export function prefixosHierarquia(codigo: string): string[] {
  const c = String(codigo ?? '').replace(/\D+/g, '')
  const out: string[] = []
  for (const tam of [2, 4, 5, 6, 7, 8]) {
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

/** Cache de SETS de tokens (hot loop de pontuação usa `has`/`some`). */
const _cacheTokensSet = new Map<string, Set<string>>()
function tokensSetComCache(normTexto: string): Set<string> {
  const hit = _cacheTokensSet.get(normTexto)
  if (hit) return hit
  const set = new Set(tokensDoTextoNorm(normTexto))
  if (_cacheTokensSet.size > 3000) _cacheTokensSet.clear()
  _cacheTokensSet.set(normTexto, set)
  return set
}

/** Compõe o caminho hierárquico (descrições dos ancestrais, sem o próprio item).
 * As descrições saem LIMPAS (sem tags `<i>`/`<sub>`, hífens/bullets de nível —
 * a TEC usa hífens para marcar separação e o breadcrumb exibiria a sujeira).
 * `obterDescricao` recebe um prefixo e devolve a descrição crua ou `null`. */
export function comporCaminho(
  codigo: string,
  obterDescricao: (prefixo: string) => string | null | undefined,
): string[] {
  const c = String(codigo ?? '').replace(/\D+/g, '')
  const prefixos = prefixosHierarquia(c).filter((p) => p !== c)
  const caminho: string[] = []
  for (const p of prefixos) {
    const d = limparTextoFiscal((obterDescricao(p) ?? '').trim())
    if (d && !caminho.includes(d)) caminho.push(d)
  }
  return caminho
}

/**
 * Descrições genéricas que não identificam o produto sozinhas.
 * Só o "seco" é genérico: "-- Outros" já normaliza para `outros`, enquanto
 * "Outros queijos" normaliza para `outros queijos` e NÃO cai aqui.
 */
const GENERICOS = new Set([
  'outros',
  'outro',
  'outras',
  'outra',
  'demais',
  'diversos',
  'diversas',
  'partes',
  'n e',
  'ne',
  'n e p',
])

function ehGenerica(normPropria: string): boolean {
  const limpa = normPropria.trim()
  if (!limpa) return false
  if (GENERICOS.has(limpa)) return true
  // "demais partes", "diversos produtos" — genérico por composição total.
  const partes = limpa.split(' ')
  return partes.length === 2 && partes.every((p) => GENERICOS.has(p))
}

/**
 * Frase (tokens.join(' ')) alinhada às palavras do texto normalizado.
 * `includes` puro deixava "ovo" pegar "ovos" (capítulo inteiro aceso);
 * `(?:^|\s)ovo(?=\s|$)` só casa a palavra exata.
 */
const _cacheFraseRegex = new Map<string, RegExp>()
function contemFraseTokens(normTexto: string, frase: string): boolean {
  let rx = _cacheFraseRegex.get(frase)
  if (!rx) {
    const escapada = frase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rx = new RegExp(`(?:^|\\s)${escapada}(?:$|\\s)`)
    if (_cacheFraseRegex.size > 1000) _cacheFraseRegex.clear()
    _cacheFraseRegex.set(frase, rx)
  }
  return rx.test(normTexto)
}

/**
 * Match tolerante por token: exato no set, senão radical/typo via `casaToken`.
 * Substring curta SEM fronteira de palavra era a porta de entrada de ruído
 * ("ave" em "gavetas"): aqui o token inteiro casa, não letras no meio.
 */
/**
 * Prefixo no início com lastro por tamanho:
 * - >=4 chars de consulta: aceita diferença até 2 ("queij"→"queijos");
 * - 3 chars de consulta: aceita diferença até 1 ("ovo"→"ovos"; "sal"→"salsa" não).
 * Substring solta fora do início nunca vale.
 */
function casaPrefixo(q: string, o: string): boolean {
  if (o.startsWith(q)) return o.length - q.length <= (q.length >= 4 ? 2 : 1)
  if (q.startsWith(o)) return q.length - o.length <= (o.length >= 4 ? 2 : 1)
  return false
}

function casaTokenEmSet(tokensOficiais: Set<string>, q: string): boolean {
  if (tokensOficiais.has(q)) return true
  if (q.length < 3) return false
  for (const o of tokensOficiais) {
    if (Math.abs(o.length - q.length) <= 2) {
      if (casaPrefixo(q, o)) return true
      if (q.length >= 4 && casaTokenComCache(q, o)) return true
    } else if (q.length >= 4 && radicalMatch(q, o)) {
      // radical com qualquer diferença ("semente" ⊂ "sementeira": radical
      // comum "sement") — o radical não sofre a restrição ||len diff|| ≤ 2
      return true
    }
  }
  return false
}

/**
 * Match por radical com qualquer diferença de tamanho (tolerância de
 * MORFEMA, não de grafia): "semente"/"sementeira" → "sement"/"semente" ⊂
 * startsWith. Cobertura: "arroz"/"arrozais", "catalogo"/"catalogos".
 * Não é substring — os dois lados precisam de radical próprio ≥ 4.
 */
function radicalMatch(q: string, o: string): boolean {
  if (q.length < 4 || o.length < 4) return false
  const rQ = radicalizar(q)
  const rO = radicalizar(o)
  if (rQ.length < 4 || rO.length < 4) return false
  return rQ === rO || rO.startsWith(rQ) || rQ.startsWith(rO)
}

/**
 * Pontua um candidato (maior = melhor). Retorna `-1` quando não há match
 * (nem todos os tokens aparecem como TOKEN no caminho completo).
 */
export function pontuarCandidato(
  tokens: string[],
  normPropria: string,
  normCaminho: string,
): number {
  if (!tokens.length) return -1
  // Todos os tokens precisam estar presentes (set exato ou casaToken>=4).
  const toksCaminho = tokensSetComCache(normCaminho)
  for (const t of tokens) {
    if (!casaTokenEmSet(toksCaminho, t)) return -1
  }
  const frase = tokens.join(' ')
  let score = 10
  if (contemFraseTokens(normPropria, frase)) score += 100
  else if (contemFraseTokens(normCaminho, frase)) score += 60
  else {
    const todosNaPropria = tokens.every((t) => casaTokenEmSet(tokensSetComCache(normPropria), t))
    if (todosNaPropria) score += 30
  }
  if (tokens.length && normPropria.startsWith(tokens[0])) score += 5
  if (ehGenerica(normPropria)) score -= 20
  return score
}

/** `true` quando a consulta parece ser um NCM (só dígitos, pontos e espaços). */
export function pareceCodigoNcm(v: unknown): boolean {
  const s = String(v ?? '').trim()
  return s.length > 0 && /^[\d.\s/-]+$/.test(s)
}

/* ---------------------------------- RAG proativo (2ª fase, tolerante) -- */

import { casaToken, radicalizar } from './vocabulario'
import { limparTextoFiscal } from './texto-fiscal'

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
  const toksPropriaSet = tokensSetComCache(normPropria)
  const toksCaminhoSet = tokensSetComCache(normCaminho)
  const todosOficiais = [...new Set([...toksPropria, ...toksCaminho])]
  if (!todosOficiais.length) return -1

  let casados = 0
  let exatos = 0
  let casadosNaPropria = 0
  for (const q of tokens) {
    let achou: 'exato' | 'tolerante' | null = null
    let naPropria = false
    // 1) token exato do documento (exige >=2 chars) — sem substring solta;
    //    "ovo" não casa mais "fOtOVOltaicos", "sal" exige a palavra "sal".
    if (toksCaminhoSet.has(q)) {
      achou = 'exato'
      naPropria = toksPropriaSet.has(q)
    } else if (q.length >= 3) {
      // 2) tolerante por token (radical / fuzzy; prefixo só no início).
      for (const o of todosOficiais) {
        if (o.length >= 3 && casaPrefixo(q, o)) {
          achou = 'exato'
          naPropria = casaTokenEmSet(toksPropriaSet, q)
          break
        }
        if (Math.abs(o.length - q.length) <= 2) {
          if (casaTokenComCache(q, o)) {
            achou = 'tolerante'
            naPropria = casaTokenEmSet(toksPropriaSet, q)
            break
          }
        } else if (q.length >= 4 && radicalMatch(q, o)) {
          achou = 'tolerante'
          naPropria = casaTokenEmSet(toksPropriaSet, q)
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
  if (contemFraseTokens(normPropria, frase)) score += 100
  else if (contemFraseTokens(normCaminho, frase)) score += 60
  if (tokens.length && normPropria.startsWith(tokens[0])) score += 5
  if (ehGenerica(normPropria)) score -= 20
  // cobertura parcial (<100%) perde parte do bônus mas continua ranqueável;
  // match só-tolerante (sem exato) perde mais ainda.
  if (cobertura < 1) score -= (1 - cobertura) * 25
  if (exatos === 0) score -= 15
  return Math.round(score * 100) / 100
}
