/**
 * Agregações para as seções de visualização do módulo XML (NF-e/NFC-e).
 *
 * Funções puras sobre as notas já filtradas em tela — sem acesso a banco,
 * sem Chart.js, testáveis em `tests/nfe-insights.test.ts`.
 */
import { divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import type { NotaXml } from '@/infrastructure/nfe/tipos'

export interface PontoMensal {
  mes: string
  rotulo: string
  baseEntradas: number
  baseSaidas: number
  tribEntradas: number
  tribSaidas: number
  antigoEntradas: number
  antigoSaidas: number
  qtdEntradas: number
  qtdSaidas: number
}

export interface LinhaAnexo {
  anexo: string
  base: number
  trib: number
  itens: number
}

export interface LinhaRanking {
  chave: string
  rotulo: string
  sub?: string
  base: number
  trib: number
  qtd: number
}

export interface IndicadoresXml {
  qtd: number
  ticketMedio: number
  ticketEntradas: number
  ticketSaidas: number
  maiorNota: { numero: string; valor: number; emitente: string } | null
  cargaEntradas: number
  cargaSaidas: number
  cargaGeral: number
  ncmsDistintos: number
  totalItens: number
  qtdDivergentes: number
  qtdComXml: number
  taxaAproveitamento: number
}

const arred = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

const rotuloMes = (mes: string): string => {
  const m = mes.slice(5, 7)
  const a = mes.slice(2, 4)
  return /^\d{4}-\d{2}$/.test(mes) ? `${m}/${a}` : mes
}

type ItemMinimo = {
  vlTotal?: number | null
  ibs?: number | null
  cbs?: number | null
  totalTributos?: number | null
  vlIcms?: number | null
  vPis?: number | null
  vCofins?: number | null
  ncm?: string | null
  cfop?: string | null
  descricao?: string | null
  codProd?: string | null
  classificacao?: { cst?: string | null; cClassTrib?: string | null } | null
  anexo?: string | null
}

type NotaMinima = {
  dataEmissao?: string | null
  direcao?: string | null
  valorTotal?: number | null
  totalTributos?: number | null
  numero?: string | null
  emitNome?: string | null
  itensAnalisados?: ItemMinimo[] | null
}

/** Evolução mês a mês — base e tributos separados por direção + regime antigo. */
export function evolucaoMensal(notas: NotaMinima[], limite = 12): PontoMensal[] {
  const mapa = new Map<string, PontoMensal>()
  const obter = (mes: string): PontoMensal => {
    let p = mapa.get(mes)
    if (!p) {
      p = {
        mes, rotulo: rotuloMes(mes),
        baseEntradas: 0, baseSaidas: 0, tribEntradas: 0, tribSaidas: 0,
        antigoEntradas: 0, antigoSaidas: 0, qtdEntradas: 0, qtdSaidas: 0,
      }
      mapa.set(mes, p)
    }
    return p
  }
  for (const n of notas ?? []) {
    const mes = String(n?.dataEmissao ?? '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(mes)) continue
    const p = obter(mes)
    const base = Number(n?.valorTotal) || 0
    const trib = Number(n?.totalTributos) || 0
    let antigo = 0
    for (const it of n?.itensAnalisados ?? []) {
      antigo += (Number(it?.vlIcms) || 0) + (Number(it?.vPis) || 0) + (Number(it?.vCofins) || 0)
    }
    if (n?.direcao === 'entrada') {
      p.baseEntradas = arred(p.baseEntradas + base)
      p.tribEntradas = arred(p.tribEntradas + trib)
      p.antigoEntradas = arred(p.antigoEntradas + antigo)
      p.qtdEntradas++
    } else if (n?.direcao === 'saida') {
      p.baseSaidas = arred(p.baseSaidas + base)
      p.tribSaidas = arred(p.tribSaidas + trib)
      p.antigoSaidas = arred(p.antigoSaidas + antigo)
      p.qtdSaidas++
    }
  }
  return [...mapa.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1)).slice(-Math.max(1, limite))
}

/** Totais do confronto regime antigo (ICMS+PIS+COFINS) × novo (IBS+CBS). */
export function confrontoRegimes(notas: NotaMinima[]): {
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
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      icms += Number(it?.vlIcms) || 0
      pisCofins += (Number(it?.vPis) || 0) + (Number(it?.vCofins) || 0)
      ibs += Number(it?.ibs) || 0
      cbs += Number(it?.cbs) || 0
    }
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

/** Distribuição dos itens por anexo/benefício da Reforma. */
export function distribuicaoPorAnexo(notas: NotaMinima[]): LinhaAnexo[] {
  const mapa = new Map<string, LinhaAnexo>()
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      const anexo = String(it?.anexo ?? 'isento') || 'isento'
      let l = mapa.get(anexo)
      if (!l) {
        l = { anexo, base: 0, trib: 0, itens: 0 }
        mapa.set(anexo, l)
      }
      l.base = arred(l.base + (Number(it?.vlTotal) || 0))
      l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
      l.itens++
    }
  }
  return [...mapa.values()].sort((a, b) => b.trib - a.trib)
}

/** Top CST da Reforma (sistema) por tributos. */
export function topCstReforma(notas: NotaMinima[], limite = 6): LinhaRanking[] {
  const mapa = new Map<string, LinhaRanking>()
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      const cst = String(it?.classificacao?.cst ?? '—') || '—'
      const cct = String(it?.classificacao?.cClassTrib ?? '—') || '—'
      const chave = `${cst}·${cct}`
      let l = mapa.get(chave)
      if (!l) {
        l = { chave, rotulo: `CST ${cst}`, sub: cct, base: 0, trib: 0, qtd: 0 }
        mapa.set(chave, l)
      }
      l.base = arred(l.base + (Number(it?.vlTotal) || 0))
      l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
      l.qtd++
    }
  }
  return [...mapa.values()].sort((a, b) => b.trib - a.trib).slice(0, limite)
}

/** Top CFOP por valor de operação. */
export function topCfop(notas: NotaMinima[], limite = 6): LinhaRanking[] {
  const mapa = new Map<string, LinhaRanking>()
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      const cfop = String(it?.cfop ?? '').trim() || '—'
      let l = mapa.get(cfop)
      if (!l) {
        l = { chave: cfop, rotulo: `CFOP ${cfop}`, base: 0, trib: 0, qtd: 0 }
        mapa.set(cfop, l)
      }
      l.base = arred(l.base + (Number(it?.vlTotal) || 0))
      l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
      l.qtd++
    }
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

/** Top NCMs por valor de operação. */
export function topNcm(notas: NotaMinima[], limite = 8): LinhaRanking[] {
  const mapa = new Map<string, LinhaRanking>()
  for (const n of notas ?? []) {
    for (const it of n?.itensAnalisados ?? []) {
      const ncm = String(it?.ncm ?? '').replace(/\D/g, '') || '—'
      let l = mapa.get(ncm)
      if (!l) {
        l = { chave: ncm, rotulo: ncm, sub: String(it?.descricao ?? '').slice(0, 48), base: 0, trib: 0, qtd: 0 }
        mapa.set(ncm, l)
      }
      l.base = arred(l.base + (Number(it?.vlTotal) || 0))
      l.trib = arred(l.trib + (Number(it?.totalTributos) || 0))
      l.qtd++
    }
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base).slice(0, limite)
}

/** Bucket da prontidão para um item. */
export type BucketProntidao = 'conferem' | 'divergentes' | 'semXml'

/**
 * Classifica um item para a Prontidão dos XMLs.
 *
 * Item com tributação escolhida por você (`manual`) conta como **validado** e
 * vai para `conferem`: você comparou No XML × legislação e decidiu — nada
 * resta "a comparar". A divergência factual XML × sistema continua registrada
 * no detalhe da nota (o núcleo `divergenciaXmlSistema` não muda).
 */
export function bucketProntidaoItem(item: {
  manual?: boolean | null
  classificacao?: { manual?: unknown | null; cst?: string | null; cClassTrib?: string | null } | null
  cstIbsCbs?: string | null
  cClassTribIbsCbs?: string | null
  vIbsItem?: number | null
  vCbsItem?: number | null
  ibs?: number | null
  cbs?: number | null
}): { temXml: boolean; manual: boolean; bucket: BucketProntidao } {
  const d = divergenciaXmlSistema(item)
  const manual = item?.manual === true || item?.classificacao?.manual != null
  return {
    temXml: d.temXml,
    manual,
    bucket: manual ? 'conferem' : !d.temXml ? 'semXml' : d.diverge ? 'divergentes' : 'conferem',
  }
}

/** Resumo das divergências XML × sistema (por item). */
export function resumoDivergencias(notas: NotaXml[] | NotaMinima[]): {
  totalItens: number
  comXml: number
  divergentes: number
  conferem: number
  semXml: number
  taxaConferencia: number | null
} {
  let totalItens = 0
  let comXml = 0
  let divergentes = 0
  for (const n of notas ?? []) {
    for (const it of (n?.itensAnalisados ?? []) as Parameters<typeof divergenciaXmlSistema>[0][]) {
      totalItens++
      const d = divergenciaXmlSistema(it)
      if (d.temXml) {
        comXml++
        if (d.diverge) divergentes++
      }
    }
  }
  const conferem = comXml - divergentes
  const semXml = totalItens - comXml
  return {
    totalItens, comXml, divergentes, conferem, semXml,
    taxaConferencia: comXml > 0 ? (conferem / comXml) * 100 : null,
  }
}

/** Indicadores executivos do filtro atual (tickets, cargas, maior nota). */
export function indicadoresXml(notas: NotaMinima[]): IndicadoresXml {
  let base = 0
  let baseE = 0
  let baseS = 0
  let tribE = 0
  let tribS = 0
  let qtdE = 0
  let qtdS = 0
  let maior: IndicadoresXml['maiorNota'] = null
  const ncms = new Set<string>()
  let totalItens = 0
  for (const n of notas ?? []) {
    const v = Number(n?.valorTotal) || 0
    base += v
    const t = Number(n?.totalTributos) || 0
    if (n?.direcao === 'entrada') {
      baseE += v
      tribE += t
      qtdE++
    } else if (n?.direcao === 'saida') {
      baseS += v
      tribS += t
      qtdS++
    }
    if (!maior || v > maior.valor) {
      maior = { numero: String(n?.numero ?? '—') || '—', valor: v, emitente: String(n?.emitNome ?? '') || '—' }
    }
    for (const it of n?.itensAnalisados ?? []) {
      totalItens++
      const ncm = String(it?.ncm ?? '').replace(/\D/g, '')
      if (ncm) ncms.add(ncm)
    }
  }
  const qtd = notas?.length ?? 0
  const div = resumoDivergencias((notas ?? []) as unknown as NotaXml[])
  const aproveitaveis = qtdE
  return {
    qtd,
    ticketMedio: qtd > 0 ? base / qtd : 0,
    ticketEntradas: qtdE > 0 ? baseE / qtdE : 0,
    ticketSaidas: qtdS > 0 ? baseS / qtdS : 0,
    maiorNota: qtd > 0 ? maior : null,
    cargaEntradas: baseE > 0 ? (tribE / baseE) * 100 : 0,
    cargaSaidas: baseS > 0 ? (tribS / baseS) * 100 : 0,
    cargaGeral: base > 0 ? ((tribE + tribS) / base) * 100 : 0,
    ncmsDistintos: ncms.size,
    totalItens,
    qtdDivergentes: div.divergentes,
    qtdComXml: div.comXml,
    taxaAproveitamento: qtd > 0 ? (aproveitaveis / qtd) * 100 : 0,
  }
}
