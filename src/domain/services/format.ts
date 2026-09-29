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
  (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const fmtNum = (v: unknown): string =>
  (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })

export const fmtPct = (v: unknown): string =>
  v == null || v === ''
    ? '—'
    : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

/** Percentual com 2 casas e vírgula, sem símbolo (usado em cargas). */
export const fmtCarga = (v: unknown): string =>
  `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`

/** Inteiro com separador de milhar: `1234` → `"1.234"`. */
export const fmtInt = (v: unknown): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(v) || 0)

/** `R$ 1.234,56` sem depender de `Intl` (paridade exata com a v1). */
export const fmtBRL = (v: unknown): string => {
  const n = Number(v) || 0
  const neg = n < 0
  const abs = Math.abs(n)
  const inteiro = Math.floor(abs)
  const cent = Math.round((abs - inteiro) * 100)
  const milhar = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(inteiro)
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
    const d = String(v).replace(/\D/g, '').slice(0, 15)
    if (!d) return ''
    return `R$ ${(Number(d) / 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  },
} as const

export type MaskKey = keyof typeof MASK

/** `"R$ 1.234,56"` → `1234.56`. */
export const parseMoeda = (v: unknown): number => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d ? Number(d) / 100 : 0
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
