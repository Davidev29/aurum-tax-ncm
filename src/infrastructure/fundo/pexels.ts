/**
 * Fundo animado do módulo Aurum AI via Pexels (imagens externas, opcional).
 *
 * - A chave de API fica EMBUTIDA no código (`CHAVE_API_PEXELS`) —
 *   não há campo no sistema para digitá-la.
 * - Sem chave (ou offline), o módulo usa um degradê animado local — nunca
 *   quebra e nunca trava a conversa.
 * - Cache de 24 h das URLs em `localStorage` para não estourar a cota.
 */

export interface FotoFundo {
  url: string
  alt: string
  autor: string
}

/** Cole aqui a chave de API do Pexels (conta criada só para esta finalidade). */
export const CHAVE_API_PEXELS = 'cEu7JBVY4nLkiskyzuCy8tDWi9CPS7ZlQwxhLdvvxPKFfhC0YIYqZZxh'

const CHAVE_QUERY = 'aurum:pexels-query'
const CHAVE_ANIMAR = 'aurum:pexels-animar'
const CHAVE_CACHE = 'aurum:pexels-cache'

const QUERY_PADRAO = 'natureza minimalista'

/** Chave efetiva: sempre a embutida no código. */
export function lerChavePexels(): string {
  return CHAVE_API_PEXELS.trim()
}

/** Mantido por compatibilidade — sem efeito (a chave vive no código). */
export function salvarChavePexels(_chave: string): void {
  void _chave
}

export function lerQueryPexels(): string {
  try {
    return localStorage.getItem(CHAVE_QUERY) || QUERY_PADRAO
  } catch {
    return QUERY_PADRAO
  }
}

export function salvarQueryPexels(query: string): void {
  try {
    const v = String(query ?? '').trim()
    if (!v) localStorage.removeItem(CHAVE_QUERY)
    else localStorage.setItem(CHAVE_QUERY, v)
  } catch {
    /* best-effort */
  }
}

export function lerAnimarPexels(): boolean {
  try {
    return localStorage.getItem(CHAVE_ANIMAR) !== '0'
  } catch {
    return true
  }
}

export function salvarAnimarPexels(animar: boolean): void {
  try {
    localStorage.setItem(CHAVE_ANIMAR, animar ? '1' : '0')
  } catch {
    /* best-effort */
  }
}

/** URL de busca (exportada para testes). */
export function urlBuscaPexels(query: string, porPagina = 6): string {
  const q = encodeURIComponent(String(query || QUERY_PADRAO).trim() || QUERY_PADRAO)
  return `https://api.pexels.com/v1/search?query=${q}&per_page=${Math.max(1, Math.min(10, porPagina))}&orientation=landscape&size=large`
}

/** Normaliza a resposta da API (exportada para testes). */
export function normalizarFotos(json: unknown): FotoFundo[] {
  const fotos = (json as { photos?: Array<{ src?: Record<string, string>; alt?: string; photographer?: string }> } | null)?.photos
  if (!Array.isArray(fotos)) return []
  return fotos
    .map((f) => ({
      url: String(f?.src?.large ?? f?.src?.landscape ?? ''),
      alt: String(f?.alt ?? 'Fundo do chat Aurum AI'),
      autor: String(f?.photographer ?? 'Pexels'),
    }))
    .filter((f) => f.url.startsWith('http'))
}

/**
 * Busca fotos no Pexels com timeout de 8 s. Falha → `[]` (o chamador usa
 * o degradê local). Nunca rejeita.
 */
export async function buscarFotosPexels(chave: string, query: string): Promise<FotoFundo[]> {
  const k = String(chave ?? '').trim()
  if (!k) return []
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), 8000)
    try {
      const resp = await fetch(urlBuscaPexels(query), {
        headers: { Authorization: k },
        signal: ctrl.signal,
      })
      if (!resp.ok) return []
      return normalizarFotos(await resp.json())
    } finally {
      window.clearTimeout(t)
    }
  } catch {
    return []
  }
}

interface CacheFundo {
  quando: number
  query: string
  fotos: FotoFundo[]
}

/** Lê o cache de 24 h (query precisa coincidir). */
export function lerCacheFundo(query: string): FotoFundo[] {
  try {
    const cru = localStorage.getItem(CHAVE_CACHE)
    if (!cru) return []
    const c = JSON.parse(cru) as CacheFundo
    if (!Array.isArray(c.fotos) || c.query !== query) return []
    if (Date.now() - Number(c.quando || 0) > 24 * 3600 * 1000) return []
    return c.fotos.filter((f) => typeof f?.url === 'string' && f.url.startsWith('http'))
  } catch {
    return []
  }
}

export function salvarCacheFundo(query: string, fotos: FotoFundo[]): void {
  try {
    const c: CacheFundo = { quando: Date.now(), query, fotos: fotos.slice(0, 10) }
    localStorage.setItem(CHAVE_CACHE, JSON.stringify(c))
  } catch {
    /* best-effort */
  }
}
