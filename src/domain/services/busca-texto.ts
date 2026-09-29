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
  const tokens = norm.split(' ')
  // Mantém tokens de 1 letra só quando são o único termo (ex.: "a" não ajuda).
  const uteis = tokens.filter((t) => t.length >= 2)
  return uteis.length ? [...new Set(uteis)] : tokens
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
