/**
 * Valores monetários PT-BR à prova de falhas (chat Aurum AI).
 *
 * Puro, sem I/O. Cobre: "R$ 500.000,00", "500 mil", "500k", "1 milhão",
 * "1,5 mi", "1.2M", "500.000", "faturamento de 2 milhões", "RBT12 500 mil
 * e receita 40 mil". "Anexo III", NCM e "%" nunca viram dinheiro.
 */

export type AnexoId = 'I' | 'II' | 'III' | 'IV' | 'V'

export interface ValorExtraido {
  valor: number
  bruto: string
  inicio: number
  fim: number
}

export interface SlotsSimples {
  anexo: AnexoId | null
  rbt12: number | null
  receitaMes: number | null
  folha12: number | null
  rba: number | null
  valorBase: number | null
}

const RX_NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d+)?)`
const RX_SUF = String.raw`(bilh[õo]es|bilh[ãa]o|bi\b|milh[õo]es|milh[ãa]o|mil\b|mi\b|k\b|M\b)`

function normSimples(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function multSufixo(sufRaw: string | undefined): number {
  const raw = String(sufRaw ?? '')
  const s = normSimples(raw).trim()
  if (!s) return 1
  if (s === 'k' || s === 'mil') return 1e3
  if (s === 'mi' || s.startsWith('milh')) return 1e6
  if (s === 'm') return raw === 'M' ? 1e6 : 1 // guarda anti "mês": só M maiúsculo multiplica
  if (s === 'bi' || s.startsWith('bilh')) return 1e9
  return 1
}

function parseNumeroBR(s: string, temSufixo: boolean): number {
  const t = String(s ?? '').trim()
  if (!t) return NaN
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'))
  if (temSufixo) return Number(t)
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''))
  const m = t.match(/^(\d+)\.(\d+)$/)
  if (m) return m[2].length === 3 ? Number(m[1] + m[2]) : Number(t)
  return Number(t)
}

function mascararNaoDinheiro(texto: string): string {
  return String(texto ?? ' ')
    .replace(/anexo\s*(i{1,3}|iv|v|[1-5]|primeiro|segundo|terceiro|quarto|quinto)/gi, ' ')
    .replace(/\b\d{4}\.\d{2}\.\d{2}\b/g, ' ')
    .replace(/\b\d{8,9}\b/g, ' ')
    .replace(/(\d[\d.,]*)\s*%/g, ' ')
    // "12" do rótulo RBT12 e "12 m/meses" (período) nunca são dinheiro:
    // sem isso, "RBT12 500 mil" gerava receita fantasma de R$ 12.
    .replace(/rbt\s*12/gi, 'RBT')
    .replace(/\b12\s*m(eses?)?\b/gi, ' ')
}

const RX_VALOR_GLOBAL = new RegExp(String.raw`(?:R\$\s*)?${RX_NUM}\s*${RX_SUF}?`, 'gi')

export function extrairTodosValores(texto: string): ValorExtraido[] {
  const base = mascararNaoDinheiro(texto)
  const out: ValorExtraido[] = []
  let m: RegExpExecArray | null
  RX_VALOR_GLOBAL.lastIndex = 0
  while ((m = RX_VALOR_GLOBAL.exec(base)) !== null) {
    // m[1] = número, m[2] = sufixo (últimos grupos da regex global)
    const num = m[1] ?? ''
    const suf = m[2] ?? ''
    // "mil" colado sem espaço em "500mil"? A regex já cobre via \s*.
    // Guarda: match vazio ou só "R$" não vale.
    if (!num) {
      if (m[0].length === 0) RX_VALOR_GLOBAL.lastIndex++
      continue
    }
    const n = parseNumeroBR(num, !!suf)
    const v = n * multSufixo(suf)
    if (Number.isFinite(v) && v > 0) {
      out.push({ valor: Math.round(v * 100) / 100, bruto: m[0], inicio: m.index, fim: m.index + m[0].length })
    }
    if (m[0].length === 0) RX_VALOR_GLOBAL.lastIndex++
  }
  return out
}

/** Último valor do texto (compatível com o antigo extrairValor). */
export function extrairValorRobusto(texto: string): number | null {
  const todos = extrairTodosValores(texto)
  return todos.length ? todos[todos.length - 1].valor : null
}

const LBL_RBT12 = String.raw`(?:rbt\s*12|\brbt\b|receita\s*bruta|faturamento(?:\s*(?:bruto|anual|12\s*m(?:eses?)?|acumulad[oa]))?)`
const LBL_RECEITA = String.raw`(?:receita(?:\s*(?:do\s*m[eê]s|mensal|atual))?|faturamento\s*(?:do\s*m[eê]s|mensal))`
const LBL_FOLHA = String.raw`(?:folha(?:\s*de\s*(?:pagamento|sal[aá]rios))?(?:\s*(?:12\s*m(?:eses?)?|12|anual))?|massa\s*salarial|sal[aá]rios?\s*12)`
const LBL_RBA = String.raw`(?:\brba\b|rba\s*12|receita\s*bruta\s*anual)`
const LBL_BASE = String.raw`(?:base|valor(?:\s*base)?|total)`

function pegaAncorado(texto: string, lbl: string): number | null {
  const t = String(texto ?? ' ')
  const rx1 = new RegExp(`${lbl}\\s*(?:(?:de|do|da|no|em|:|=|-|—|→)\\s*)?(?:R\\$\\s*)?${RX_NUM}\\s*${RX_SUF}?`, 'i')
  const rx2 = new RegExp(`(?:R\\$\\s*)?${RX_NUM}\\s*${RX_SUF}?\\s*(?:de\\s+)?${lbl}`, 'i')
  for (const rx of [rx1, rx2]) {
    const m = t.match(rx)
    if (m) {
      const num = m[m.length - 2] ?? ''
      const suf = m[m.length - 1] ?? ''
      const v = parseNumeroBR(num, !!suf) * multSufixo(suf)
      if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100
    }
  }
  return null
}

export function extrairAnexoRobusto(texto: string): AnexoId | null {
  const t = normSimples(texto)
  let m = t.match(/anexo\s*(iv|v|i{1,3}|[1-5]|primeiro|segundo|terceiro|quarto|quinto)/)
  if (m) {
    const v = m[1].toLowerCase()
    const mapa: Record<string, AnexoId> = {
      i: 'I', ii: 'II', iii: 'III', iv: 'IV', v: 'V',
      '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
      primeiro: 'I', segundo: 'II', terceiro: 'III', quarto: 'IV', quinto: 'V',
    }
    return mapa[v] ?? null
  }
  m = t.match(/(primeiro|segundo|terceiro|quarto|quinto|[1-5])\s*(?:º|o)?\s*anexo/)
  if (m) {
    const mapa: Record<string, AnexoId> = {
      primeiro: 'I', segundo: 'II', terceiro: 'III', quarto: 'IV', quinto: 'V',
      '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    }
    return mapa[m[1].toLowerCase()] ?? null
  }
  return null
}

/**
 * Extrai os slots do Simples com desambiguação fixa (sem chute):
 * ancorado por rótulo vence; receita qualificada nunca é roubada pelo
 * faturamento genérico; sobras sem rótulo vão por ordem (RBT12, receita).
 */
export function extrairSlotsSimples(texto: string): SlotsSimples {
  const t = String(texto ?? ' ')
  const receitaMes = pegaAncorado(t, LBL_RECEITA)
  let rbt12 = pegaAncorado(t, LBL_RBT12)
  // "faturamento genérico" só vira RBT12 se a receita já não foi ancorada.
  if (rbt12 == null && receitaMes == null) {
    const todos = extrairTodosValores(t)
    if (todos.length >= 1) rbt12 = todos[0].valor
  }
  let receitaFinal = receitaMes
  if (receitaFinal == null) {
    const todos = extrairTodosValores(t)
    const livres = todos.map((x) => x.valor).filter((v) => v !== rbt12)
    if (livres.length >= 1) receitaFinal = livres[rbt12 == null ? 1 : 0] ?? livres[0] ?? null
    // Caso "RBT12 500 mil e receita 40 mil": o 2º número é a receita.
    if (rbt12 != null && livres.length === 0) {
      const todos2 = extrairTodosValores(t)
      if (todos2.length >= 2) receitaFinal = todos2[1].valor
    }
  }
  return {
    anexo: extrairAnexoRobusto(t),
    rbt12,
    receitaMes: receitaFinal,
    folha12: pegaAncorado(t, LBL_FOLHA),
    rba: pegaAncorado(t, LBL_RBA),
    valorBase: pegaAncorado(t, LBL_BASE),
  }
}
