/**
 * Agregações para as novas seções de visualização da tela SPED Fiscal.
 *
 * Espelha `src/application/nfe-insights.ts`, adaptado ao modelo do SPED:
 * somente saídas, data em `dd/mm/aaaa` (ou ISO) e valores por item
 * (`vlItem`, `ibs`, `cbs`, `vlIcms`, `vlPis`, `vlCofins`).
 *
 * Funções puras, sem Chart.js — testáveis em `tests/sped-insights.test.ts`.
 */
import type { ResultadoItem, ResultadoResumo } from '@/infrastructure/sped/tipos'

export interface PontoMensalSped {
  mes: string
  rotulo: string
  base: number
  trib: number
  antigo: number
  qtd: number
}

export interface LinhaSped {
  chave: string
  rotulo: string
  sub?: string
  base: number
  trib: number
  qtd: number
}

export interface IndicadoresSped {
  qtd: number
  ticketMedio: number
  maiorItem: { codigo: string; descricao: string; valor: number } | null
  carga: number
  ncmsDistintos: number
  regraGeral: number
  manuais: number
  base: number
  trib: number
}

const arred = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

const rotuloMes = (mes: string): string => `${mes.slice(5, 7)}/${mes.slice(2, 4)}`

/** Normaliza `dd/mm/aaaa` ou `aaaa-mm-dd` para `aaaa-mm`. */
export function normalizarMes(data: string): string | null {
  const d = String(data ?? '').trim()
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d)
  if (m) return `${m[3]}-${m[2]}`
  m = /^(\d{4})-(\d{2})-\d{2}/.exec(d)
  if (m) return `${m[1]}-${m[2]}`
  return null
}

type ItemMin = {
  data?: string | null
  vlItem?: number | null
  totalOperacao?: number | null
  totalTributos?: number | null
  ibs?: number | null
  cbs?: number | null
  vlIcms?: number | null
  totalIcms?: number | null
  vlPis?: number | null
  vlCofins?: number | null
  ncm?: string | null
  cfop?: string | null
  descricaoProduto?: string | null
  descricao?: string | null
  codItem?: string | null
  codigo?: string | null
  classificacao?: { cst?: string | null; cClassTrib?: string | null } | null
  anexo?: string | null
  regraGeral?: boolean | null
  manual?: boolean | null
  cstIcms?: string | null
}

const baseDo = (it: ItemMin): number =>
  Number(it?.vlItem) || Number(it?.totalOperacao) || 0

const descDo = (it: ItemMin): string =>
  String(it?.descricaoProduto ?? it?.descricao ?? '')

/** Evolução mensal das saídas — base, IBS+CBS e regime antigo. */
export function evolucaoMensalSped(itens: ItemMin[], limite = 12): PontoMensalSped[] {
  const mapa = new Map<string, PontoMensalSped>()
  for (const it of itens ?? []) {
    const mes = normalizarMes(String(it?.data ?? ''))
    if (!mes) continue
    let p = mapa.get(mes)
    if (!p) {
      p = { mes, rotulo: rotuloMes(mes), base: 0, trib: 0, antigo: 0, qtd: 0 }
      mapa.set(mes, p)
    }
    p.base = arred(p.base + baseDo(it))
    p.trib = arred(p.trib + (Number(it?.totalTributos) || 0))
    p.antigo = arred(
      p.antigo + (Number(it?.vlIcms) || Number(it?.totalIcms) || 0) +
        (Number(it?.vlPis) || 0) + (Number(it?.vlCofins) || 0),
    )
    p.qtd++
  }
  return [...mapa.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1)).slice(-Math.max(1, limite))
}

/** Confronto regime antigo (ICMS+PIS+COFINS) × novo (IBS+CBS). */
export function confrontoRegimesSped(itens: ItemMin[]): {
  antigo: number
  novo: number
  icms: number
  pisCofins: number
  ibs: number
  cbs: number
  delta: number
  variacaoPct: number | null
} {
  let icms = 0
  let pisCofins = 0
  let ibs = 0
  let cbs = 0
  for (const it of itens ?? []) {
    icms += Number(it?.vlIcms) || Number(it?.totalIcms) || 0
    pisCofins += (Number(it?.vlPis) || 0) + (Number(it?.vlCofins) || 0)
    ibs += Number(it?.ibs) || 0
    cbs += Number(it?.cbs) || 0
  }
  icms = arred(icms)
  pisCofins = arred(pisCofins)
  ibs = arred(ibs)
  cbs = arred(cbs)
  const antigo = arred(icms + pisCofins)
  const novo = arred(ibs + cbs)
  const delta = arred(novo - antigo)
  return { antigo, novo, icms, pisCofins, ibs, cbs, delta, variacaoPct: antigo > 0 ? (delta / antigo) * 100 : null }
}

/** Distribuição por anexo/benefício da Reforma. */
export function distribuicaoPorAnexoSped(itens: ItemMin[]): LinhaSped[] {
  const mapa = new Map<string, LinhaSped>()
  for (const it of itens ?? []) {
    const anexo = String(it?.anexo ?? 'isento') || 'isento'
    let l = mapa.get(anexo)
    if (!l) {
      l = { chave: anexo, rotulo: anexo, base: 0, trib: 0, qtd: 0 }
      mapa.set(anexo, l)
    }
    l.base = arred(l.base + baseDo(it))
    l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
    l.qtd++
  }
  return [...mapa.values()].sort((a, b) => b.trib - a.trib)
}

/** Top CST da Reforma por tributos. */
export function topCstSped(itens: ItemMin[], limite = 6): LinhaSped[] {
  const mapa = new Map<string, LinhaSped>()
  for (const it of itens ?? []) {
    const cst = String(it?.classificacao?.cst ?? '—') || '—'
    const cct = String(it?.classificacao?.cClassTrib ?? '—') || '—'
    const chave = `${cst}·${cct}`
    let l = mapa.get(chave)
    if (!l) {
      l = { chave, rotulo: `CST ${cst}`, sub: cct, base: 0, trib: 0, qtd: 0 }
      mapa.set(chave, l)
    }
    l.base = arred(l.base + baseDo(it))
    l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
    l.qtd++
  }
  return [...mapa.values()].sort((a, b) => b.trib - a.trib).slice(0, limite)
}

/** Top CST ICMS (regime anterior) por valor — útil no modo resumo. */
export function topCstIcmsSped(itens: ItemMin[], limite = 8): LinhaSped[] {
  const mapa = new Map<string, LinhaSped>()
  for (const it of itens ?? []) {
    const cst = String(it?.cstIcms ?? '').trim() || '—'
    let l = mapa.get(cst)
    if (!l) {
      l = { chave: cst, rotulo: `CST ${cst}`, base: 0, trib: 0, qtd: 0 }
      mapa.set(cst, l)
    }
    l.base = arred(l.base + baseDo(it))
    l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
    l.qtd++
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

/** Top CFOP por valor de operação. */
export function topCfopSped(itens: ItemMin[], limite = 6): LinhaSped[] {
  const mapa = new Map<string, LinhaSped>()
  for (const it of itens ?? []) {
    const cfop = String(it?.cfop ?? '').trim() || '—'
    let l = mapa.get(cfop)
    if (!l) {
      l = { chave: cfop, rotulo: `CFOP ${cfop}`, base: 0, trib: 0, qtd: 0 }
      mapa.set(cfop, l)
    }
    l.base = arred(l.base + baseDo(it))
    l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
    l.qtd++
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

/** Top NCMs por valor de operação. */
export function topNcmSped(itens: ItemMin[], limite = 8): LinhaSped[] {
  const mapa = new Map<string, LinhaSped>()
  for (const it of itens ?? []) {
    const ncm = String(it?.ncm ?? '').replace(/\D/g, '') || '—'
    let l = mapa.get(ncm)
    if (!l) {
      l = { chave: ncm, rotulo: ncm, sub: descDo(it).slice(0, 48), base: 0, trib: 0, qtd: 0 }
      mapa.set(ncm, l)
    }
    l.base = arred(l.base + baseDo(it))
    l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
    l.qtd++
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

/** Indicadores executivos do arquivo (modo itens). */
export function indicadoresSped(itens: ResultadoItem[]): IndicadoresSped {
  let base = 0
  let trib = 0
  let maior: IndicadoresSped['maiorItem'] = null
  const ncms = new Set<string>()
  let regraGeral = 0
  let manuais = 0
  for (const it of itens ?? []) {
    const v = Number(it?.vlItem) || 0
    base += v
    trib += Number(it?.totalTributos) || 0
    if (!maior || v > maior.valor) {
      maior = { codigo: String(it?.codItem ?? ''), descricao: String(it?.descricaoProduto ?? ''), valor: v }
    }
    const ncm = String(it?.ncm ?? '').replace(/\D/g, '')
    if (ncm) ncms.add(ncm)
    if (it?.regraGeral) regraGeral++
    if (it?.manual || it?.classificacao?.manual) manuais++
  }
  const qtd = itens?.length ?? 0
  return {
    qtd,
    ticketMedio: qtd > 0 ? base / qtd : 0,
    maiorItem: qtd > 0 ? maior : null,
    carga: base > 0 ? (trib / base) * 100 : 0,
    ncmsDistintos: ncms.size,
    regraGeral,
    manuais,
    base: arred(base),
    trib: arred(trib),
  }
}

/** Indicadores do modo resumo (grupos CST ICMS × CFOP). */
export function indicadoresResumoSped(linhas: ResultadoResumo[]): {
  grupos: number
  notas: number
  base: number
  trib: number
  carga: number
  icms: number
} {
  let notas = 0
  let base = 0
  let trib = 0
  let icms = 0
  for (const l of linhas ?? []) {
    notas += Number(l?.qtdNotas) || 0
    base += Number(l?.totalOperacao) || 0
    trib += Number(l?.totalTributos) || 0
    icms += Number(l?.totalIcms) || 0
  }
  base = arred(base)
  trib = arred(trib)
  return { grupos: linhas?.length ?? 0, notas, base, trib, carga: base > 0 ? (trib / base) * 100 : 0, icms: arred(icms) }
}

export type { ResultadoItem, ResultadoResumo }
