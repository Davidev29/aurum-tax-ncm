/* ---------------------------------------------------------------------------
   Formatação, máscaras e parsers — paridade bit a bit com a v1 (SPEC §10.4).
   --------------------------------------------------------------------------- */

/** Remove tudo que não é dígito. */
export const norm = (v: unknown): string => String(v ?? '').replace(/\D+/g, '')

/** `AAAA.BB.CC` somente quando houver exatamente 8 dígitos. */
export const fmtNcm = (v: unknown): string => {
  const d = norm(v)
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d
}

/** `AAA.BBB.CCC` somente quando houver exatamente 9 dígitos (NBS). */
export const fmtNbs = (v: unknown): string => {
  const d = norm(v)
  return d.length === 9 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}` : d
}

/** Máscara progressiva de NBS (`AAA.BBB.CCC`, 9 dígitos). */
export const fmtNbsMask = (v: unknown): string => {
  const d = norm(v).slice(0, 9)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
}

/** Máscara progressiva de CNPJ. */
export const fmtCnpj = (v: unknown): string => {
  const d = norm(v).slice(0, 14)
  if (!d) return ''
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

export const fmtMoeda = (v: unknown): string =>
  FMT_BRL_CACHE.format(Number(v) || 0)

/** Instâncias cacheadas: evita alocar `Intl.NumberFormat` por chamada (chat/tabelas). */
const FMT_BRL_CACHE = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const FMT_INT_CACHE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const FMT_NUM3_CACHE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })

/**
 * Formatador de moeda eficiente para a conversa direta (fine-tuning v6).
 * - Reusa `Intl.NumberFormat` singleton (sem alocação por chamada).
 * - Fast-path para number finito; `null/NaN/Infinity/''` → `quandoVazio`.
 * - `-0` normalizado para `R$ 0,00`.
 */
export const fmtMoedaEficiente = (v: unknown, quandoVazio = '—'): string => {
  if (v == null || v === '') return quandoVazio
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return quandoVazio
  const norm = Object.is(n, -0) ? 0 : n
  try {
    return FMT_BRL_CACHE.format(norm)
  } catch {
    return fmtBRL(norm)
  }
}

export const fmtNum = (v: unknown): string => FMT_NUM3_CACHE.format(Number(v) || 0)

export const fmtPct = (v: unknown): string =>
  v == null || v === ''
    ? '—'
    : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/** Percentual com 2 casas e vírgula, sem símbolo (usado em cargas). */
export const fmtCarga = (v: unknown): string =>
  `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`

/** Inteiro com separador de milhar: `1234` → `"1.234"`. */
export const fmtInt = (v: unknown): string => FMT_INT_CACHE.format(Number(v) || 0)

/** `R$ 1.234,56` sem depender de `Intl` (paridade exata com a v1). */
export const fmtBRL = (v: unknown): string => {
  const n = Number(v) || 0
  const neg = n < 0
  const totalCent = Math.round(Math.abs(n) * 100)
  const inteiro = Math.floor(totalCent / 100)
  const cent = totalCent % 100
  // Loop de milhar sem `Intl` nem regex lookahead (fallback offline/SSR).
  const dig = String(inteiro)
  let milhar = ''
  let c = 0
  for (let i = dig.length - 1; i >= 0; i--) {
    milhar = dig[i] + milhar
    c++
    if (c % 3 === 0 && i > 0) milhar = '.' + milhar
  }
  return `${neg ? '-' : ''}R$ ${milhar},${String(cent).padStart(2, '0')}`
}

export const clamp = (n: number, mn: number, mx: number): number =>
  Math.min(mx, Math.max(mn, n))

export const uid = (): string =>
  `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export const hexToRgb = (h: string | null | undefined): [number, number, number] => {
  const s = String(h || '#0f215c').replace('#', '')
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0').slice(0, 6)
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 220) {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...a: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

/* --- máscaras de digitação ------------------------------------------------ */

export const MASK = {
  ncm: (v: unknown): string => {
    const d = norm(v).slice(0, 8)
    if (d.length <= 4) return d
    if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`
    return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
  },
  nbs: fmtNbsMask,
  cnpj: fmtCnpj,
  cfop: (v: unknown): string => norm(v).slice(0, 4),
  cst: (v: unknown): string => norm(v).slice(0, 3),
  cstPis: (v: unknown): string => norm(v).slice(0, 2),
  qtd: (v: unknown): string => {
    const s = String(v).replace(/[^\d,.]/g, '').replace(/\./g, ',')
    const partes = s.split(',')
    if (partes.length > 2) return `${partes[0]},${partes.slice(1).join('').slice(0, 3)}`
    return partes[0] + (partes.length > 1 ? `,${partes[1].slice(0, 3)}` : '')
  },
  moeda: (v: unknown): string => {
    const original = String(v ?? '')
    if (!original.trim()) return ''
    const neg = /^\s*-/.test(original)
    const semSinal = original.replace(/-/g, '')
    // Mantém só dígitos, ponto e vírgula (remove "R$", espaços e letras).
    const limpo = semSinal.replace(/[^0-9.,]/g, '')
    if (!limpo) return ''
    // A primeira vírgula é o separador decimal; o resto é lixo de digitação.
    const idx = limpo.indexOf(',')
    let intRaw: string
    let decRaw: string | null
    if (idx >= 0) {
      intRaw = limpo.slice(0, idx).replace(/\D/g, '')
      decRaw = limpo
        .slice(idx + 1)
        .replace(/\D/g, '')
        .slice(0, 2)
    } else {
      intRaw = limpo.replace(/\D/g, '')
      decRaw = null
    }
    intRaw = intRaw.replace(/^0+(?=\d)/, '')
    if (!intRaw) intRaw = '0'
    // Milhar sem Number() para não perder precisão em valores grandes.
    const intFmt = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    const prefixo = `${neg ? '-' : ''}R$ `
    return decRaw === null ? `${prefixo}${intFmt}` : `${prefixo}${intFmt},${decRaw}`
  },
} as const

export type MaskKey = keyof typeof MASK

/**
 * Formata um valor numérico para exibição inicial em campo monetário:
 * `50` → `"R$ 50,00"`, `1234.56` → `"R$ 1.234,56"`.
 * Campos vazios/zerados devem decidir fora (ex.: `v ? formatar : ''`).
 */
export const formatarMoedaInput = (v: unknown): string => {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * `"R$ 1.234,56"` → `1234.56` · `"50"` → `50` · `"50,5"` → `50.5`.
 *
 * Formato brasileiro: com vírgula, pontos são milhar; sem vírgula,
 * `"5.000"` (padrão milhar) vira `5000` e `"50.5"` (ponto decimal
 * avulso/colado) vira `50.5` por tolerância.
 */
export const parseMoeda = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = String(v ?? '').trim()
  if (!s) return 0
  s = s.replace(/R\$/gi, '').trim()
  if (!s || s === '-' || s === ',' || s === '.') return 0
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    const t = s.replace(/[^0-9.\-]/g, '')
    if (!t || t === '-') return 0
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
      s = t.replace(/\./g, '')
    } else {
      const partes = t.split('.')
      if (partes.length > 2) {
        const dec = partes.pop()
        s = `${partes.join('')}.${dec}`
      } else {
        s = t
      }
    }
  }
  s = s.replace(/[^0-9.\-]/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** `"1.234,56"` → `1234.56` (formato brasileiro, SPEC §10.4). */
export const parseQtd = (v: unknown): number => {
  const s = String(v ?? '').replace(/\./g, '').replace(',', '.')
  return Number(s) || 0
}

/** Normaliza cabeçalho de planilha: minúsculas, sem acento, sem não-alfanuméricos. */
export const normalizeHeader = (h: unknown): string =>
  String(h ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\W+/g, '')

/** Escapa texto destinado a HTML/CSV. */
export const esc = (v: unknown): string =>
  v == null
    ? ''
    : String(v).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
      )
