/**
 * Motor CNAE → NBS em duas camadas (Phase 9 / 09-02).
 *
 * - Camada 1 (`regrasDoCnae`): regra do Simples para QUALQUER CNAE — Anexo
 *   Simples I–V, Situação, Fator R e vedação textual. Cobre os 1.090 da
 *   `db.cnae`; CNAE inexistente vira `cnae-desconhecido` (manual), nunca
 *   `sem regra` (invariante A do PLAN 09).
 * - Camada 2 (`enriquecerNbsDoCnae`): enriquecimento NBS só onde há link
 *   (`db.cnaeNbs`, 508 CNAEs). Cada NBS candidata passa pelo resolvedor
 *   oficial (`resolverClassificacoesNbs` + `calcularTributos` com
 *   `refPorAno`) — sem lastro no resolvedor vira `semLastro` (badge
 *   `sem-lastro-reforma`), NUNCA redução inventada.
 *
 * Cache: o veredito é cacheado POR NBS (chave `nbs|anoReferencia`, ~588
 * NBS únicas) — nunca por CNAE. Um CNAE com 98 NBS resolve cada NBS uma
 * única vez por ano; a 2ª consulta (do mesmo ou de outro CNAE que
 * compartilhe o NBS) reaproveita o cache.
 *
 * `ehBens`: divisão industrial/comercial (C 10–33, G 45–47) SEM NBS
 * aplicável → caminho explícito `bens→NCM`, badge distinto de
 * `sem-mapeamento-NBS`. Refinado contra a base real (09-01): 109 CNAEs
 * dessas divisões TÊM links (facção/serviços industriais, ex. 1340-5/01)
 * e seguem o fluxo normal de enriquecimento — só é bens quem não tem
 * nenhum link.
 *
 * `REF_DEFAULT` (19/9) é importado e NUNCA alterado aqui: é o fallback
 * 2033 e a base de `em-transicao` (anos 2028–2032 usam 2033 + flag,
 *   nunca número inventado).
 */

import { REF_DEFAULT } from '../constants'
import type {
  CnaeAnexo,
  Classificacao,
  ClassificacaoConsolidada,
  ResultadoCalculo,
} from '../entities'
import { fmtCnae, textoVedacaoCnae } from '@/infrastructure/base/normalizacao'
import { fmtNbs } from './format'
import {
  codigo7De,
  palavrasChaveNbsPorCnae,
  rotuloAnexoSimples,
  tetoConfiancaCnae,
} from './cnae'
import {
  pinsHipotesesPorCnae,
  verificarCoerenciaServico,
  type CoerenciaServico,
  type HipoteseLegal,
} from './verificacao-servicos'
import { calcularTributos } from './calculo'
import {
  buscarHipotesesLegais,
  resolverClassificacoesNbs,
} from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

/* ---------------------------------------------------------- ano de referência --- */

/** CBS plena de 2027 em % (fração 0,088 — LC 214/2025, ano de transição). */
export const CBS_REF_PADRAO = 8.8

/** Ano de referência padrão: regime pleno (REF_DEFAULT). */
export const ANO_REFERENCIA_PADRAO = 2033

/** Base de precificação dos vereditos (R$ 100 — números redondos, centavos exatos). */
export const BASE_OPERACAO_NBS = 100

/** Acima deste nº de candidatas o ranking é ambíguo (a UI oferece escolha). */
export const LIMIAR_AMBIGUIDADE_NBS = 3

export interface ReferenciaAnual {
  refIBS: number
  refCBS: number
  /** `true` nos anos de transição (usa 2033 + flag — nunca número inventado). */
  emTransicao: boolean
  rotulo: string
}

/**
 * Referência IBS/CBS por ano (PLAN 09 princípio 7 — ano explícito em todo veredito).
 *
 * - 2026 → ano-teste LC 214 (0,1% + 0,1%);
 * - 2027 → CBS plena (8,8%) + IBS em teste (0,1%);
 * - 2033 → regime pleno (`REF_DEFAULT` {19, 9});
 * - demais anos (2028–2032, transição IBS×ICMS/ISS) → valores 2033 com
 *   `emTransicao: true` (a UI carimba o aviso; nenhum número é inventado).
 */
export function refPorAno(anoReferencia: unknown): ReferenciaAnual {
  const ano = Number(anoReferencia)
  if (ano === 2026) {
    return { refIBS: 0.1, refCBS: 0.1, emTransicao: false, rotulo: '2026 — ano-teste (LC 214)' }
  }
  if (ano === 2027) {
    return {
      refIBS: 0.1,
      refCBS: CBS_REF_PADRAO,
      emTransicao: false,
      rotulo: '2027 — CBS plena + IBS em teste',
    }
  }
  if (ano === ANO_REFERENCIA_PADRAO) {
    return {
      refIBS: REF_DEFAULT.IBS,
      refCBS: REF_DEFAULT.CBS,
      emTransicao: false,
      rotulo: '2033 — regime pleno',
    }
  }
  const rotuloAno = Number.isFinite(ano) ? String(Math.trunc(ano)) : '?'
  return {
    refIBS: REF_DEFAULT.IBS,
    refCBS: REF_DEFAULT.CBS,
    emTransicao: true,
    rotulo: `${rotuloAno} — em transição (valores 2033, confirmar operação)`,
  }
}

/** Normaliza o ano pedido: inteiro válido ou o padrão 2033. */
export function normalizarAnoReferencia(anoReferencia: unknown): number {
  const ano = Number(anoReferencia)
  return Number.isFinite(ano) && ano > 0 ? Math.trunc(ano) : ANO_REFERENCIA_PADRAO
}

/* ---------------------------------------------------------- camada 1: regras --- */

/** Divisões CNAE de bens: C indústria (10–33) + G comércio (45–47). */
export const DIVISOES_BENS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 24 }, (_, i) => String(i + 10).padStart(2, '0')),
  '45',
  '46',
  '47',
])

/** `true` quando a divisão do CNAE é industrial/comercial (candidata a bens). */
export function ehDivisaoBens(cnae7: string): boolean {
  return typeof cnae7 === 'string' && cnae7.length === 7 && DIVISOES_BENS.has(cnae7.slice(0, 2))
}

export interface RegraCnaeOk {
  estado: 'ok'
  cnae7: string
  codigoFormatado: string
  descricao: string
  /** Anexos I–V do SIMPLES NACIONAL (nunca da LC 214/2025). */
  anexoSimples: string[]
  /** Rótulo sempre com o prefixo "Anexo Simples" (nunca "Anexo" seco). */
  rotuloAnexo: string
  situacao: CnaeAnexo['situacao']
  fatorR: boolean
  /** Vedação = Situação (sempre presente — invariante A). */
  vedacaoTextual: string[]
  /**
   * Divisão de bens (C/G) SEM NBS aplicável. `false` para serviços, para
   * bens COM link (facção industrial, ex. 1340-5/01) e para fora-508.
   */
  ehBens: boolean
  temMapeamentoNbs: boolean
  totalNbs: number
}

export interface RegraCnaeDesconhecida {
  /** CNAE fora dos 1.090 — classificar no modo manual, nunca `sem regra`. */
  estado: 'cnae-desconhecido'
  cnae7: string
  codigoFormatado: string
  mensagem: string
}

export type RegraCnae = RegraCnaeOk | RegraCnaeDesconhecida

const MENSAGEM_DESCONHECIDO =
  'CNAE ausente da tabela viva (1.090) — classifique no modo manual com o contador.'

async function contarLinks(cnae7: string, fallback: number): Promise<number> {
  try {
    return await db.cnaeNbs.where('cnae7').equals(cnae7).count()
  } catch {
    return fallback
  }
}

/**
 * Camada 1 — regra do CNAE, SEMPRE (1.090). Lê `db.cnae` com fallback para
 * `db.classificacoesConsolidadas`; nunca lança (falha de banco vira
 * `cnae-desconhecido` honesto, nunca `sem regra` silencioso).
 */
export async function regrasDoCnae(cnaeBruto: unknown): Promise<RegraCnae> {
  const cnae7 = codigo7De(cnaeBruto)
  const codigoFormatado = cnae7.length === 7 ? fmtCnae(cnae7) : String(cnaeBruto ?? '').trim()
  const desconhecida = (mensagem = MENSAGEM_DESCONHECIDO): RegraCnaeDesconhecida => ({
    estado: 'cnae-desconhecido',
    cnae7,
    codigoFormatado: codigoFormatado || String(cnaeBruto ?? '').trim(),
    mensagem,
  })
  if (cnae7.length !== 7) return desconhecida()

  let anexo: CnaeAnexo | null = null
  let tpl: ClassificacaoConsolidada | null = null
  try {
    anexo = (await db.cnae.get(cnae7)) ?? null
  } catch {
    anexo = null
  }
  try {
    tpl = (await db.classificacoesConsolidadas.get(cnae7)) ?? null
  } catch {
    tpl = null
  }
  if (!anexo && !tpl) return desconhecida()

  const anexoSimples = anexo?.anexos ?? tpl?.anexoSimples ?? []
  const situacao = anexo?.situacao ?? tpl?.situacao ?? 'Depende da atividade'
  const totalNbs = await contarLinks(cnae7, tpl?.nbsVinculadas.length ?? 0)
  const temMapeamentoNbs = totalNbs > 0
  // Bens = divisão industrial/comercial SEM NBS aplicável (refinado contra a
  // base real: divisão de bens COM link segue o fluxo de enriquecimento).
  const ehBens = ehDivisaoBens(cnae7) && !temMapeamentoNbs

  return {
    estado: 'ok',
    cnae7,
    codigoFormatado: anexo?.codigoFormatado ?? tpl?.codigoFormatado ?? fmtCnae(cnae7),
    descricao: anexo?.descricao ?? tpl?.descricao ?? '',
    anexoSimples,
    rotuloAnexo: rotuloAnexoSimples(anexoSimples),
    situacao,
    fatorR: anexo?.fatorR ?? tpl?.fatorR ?? false,
    vedacaoTextual: tpl?.vedacoes?.length
      ? [...tpl.vedacoes]
      : textoVedacaoCnae(situacao, anexoSimples),
    ehBens,
    temMapeamentoNbs,
    totalNbs,
  }
}

/* ---------------------------------------------------------- camada 2: vereditos --- */

/**
 * Veredito de UMA NBS no ano de referência (saída do resolvedor oficial +
 * precificação). `reducaoIBS/CBS` vêm EXCLUSIVAMENTE do `resumo` da
 * classificação resolvida — sem lastro (`regraGeral`) a redução é 0 e
 * `semLastro: true` (badge `sem-lastro-reforma`).
 */
export interface VereditoNbs {
  /** NBS 9 dígitos. */
  nbs: string
  /** Formato `X.XXXX.XX.XX`. */
  nbsFormatado: string
  descricao: string | null
  cst: string
  cClassTrib: string
  reducaoIBS: number
  reducaoCBS: number
  /** Precificação `calcularTributos(BASE, red, refPorAno(ano))`. */
  calculo: ResultadoCalculo
  baseLegal: string | null
  /** Anexo REAL da LC 214/2025 (nunca confundir com o Anexo Simples). */
  anexoLC214: string | null
  anoReferencia: number
  emTransicao: boolean
  /** `reducao > 0 || cst != 000 || cct != 000001`. */
  temBeneficio: boolean
  /** `true` quando o resolvedor caiu na regra geral (sem vínculo oficial). */
  semLastro: boolean
}

/** Chave do cache POR NBS: `nbs|anoReferencia` (nunca por CNAE). */
export const chaveCacheVeredito = (nbs: string, anoReferencia: number): string =>
  `${nbs}|${anoReferencia}`

/** Cache de vereditos POR NBS em memória (~588 entradas únicas). */
export const cacheVereditosNbs = new Map<string, VereditoNbs>()

/**
 * Contador do cache (auditoria/testes): `resolvidas` = misses (chamadas ao
 * resolvedor); `acertos` = hits. A 2ª consulta do mesmo NBS no mesmo ano
 * NÃO re-chama o resolvedor.
 */
export const estatisticasCacheCnaeNbs = { resolvidas: 0, acertos: 0 }

/** Limpa o cache e zera o contador (testes / troca de base). */
export function limparCacheVereditosNbs(): void {
  cacheVereditosNbs.clear()
  estatisticasCacheCnaeNbs.resolvidas = 0
  estatisticasCacheCnaeNbs.acertos = 0
}

const digitsNbs = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D+/g, '')
  return d.length === 9 ? d : ''
}

/**
 * Escolhe a classificação primária da NBS: maior benefício
 * (`max(redIBS, redCBS)`); empate → primeira da lista (ordenada por
 * `cst|cClassTrib` no resolvedor — determinística).
 */
export function escolherClassificacaoPrimaria(lista: Classificacao[]): Classificacao | null {
  if (!lista.length) return null
  let melhor = lista[0]
  let melhorRed = Math.max(melhor.resumo.percentualReducaoIBS, melhor.resumo.percentualReducaoCBS)
  for (const cl of lista.slice(1)) {
    const red = Math.max(cl.resumo.percentualReducaoIBS, cl.resumo.percentualReducaoCBS)
    if (red > melhorRed) {
      melhor = cl
      melhorRed = red
    }
  }
  return melhor
}

/**
 * Veredito de UMA NBS no ano de referência, com cache POR NBS.
 * Redução/benefício SÓ do resolvedor oficial — nunca inventados.
 */
export async function vereditoPorNbs(
  nbsBruta: unknown,
  anoReferencia: unknown = ANO_REFERENCIA_PADRAO,
  descricao: string | null = null,
): Promise<VereditoNbs> {
  const nbs = digitsNbs(nbsBruta)
  if (!nbs) throw new Error('NBS inválida (9 dígitos).')
  const ano = normalizarAnoReferencia(anoReferencia)
  const chave = chaveCacheVeredito(nbs, ano)
  const emCache = cacheVereditosNbs.get(chave)
  if (emCache) {
    estatisticasCacheCnaeNbs.acertos++
    return emCache
  }

  estatisticasCacheCnaeNbs.resolvidas++
  const resolvido = await resolverClassificacoesNbs(nbs)
  const primaria = escolherClassificacaoPrimaria(resolvido.lista)
  const ref = refPorAno(ano)
  const reducaoIBS = Number(primaria?.resumo.percentualReducaoIBS) || 0
  const reducaoCBS = Number(primaria?.resumo.percentualReducaoCBS) || 0
  const cst = primaria?.cst ?? '000'
  const cClassTrib = primaria?.cClassTrib ?? '000001'
  const veredito: VereditoNbs = {
    nbs,
    nbsFormatado: fmtNbs(nbs),
    descricao: descricao?.trim() ? descricao : (primaria?.descricao ?? null),
    cst,
    cClassTrib,
    reducaoIBS,
    reducaoCBS,
    calculo: calcularTributos(BASE_OPERACAO_NBS, reducaoIBS, reducaoCBS, ref.refIBS, ref.refCBS),
    baseLegal: primaria && !resolvido.regraGeral ? (primaria.baseLegal || null) : null,
    anexoLC214: primaria?.resumo.anexo ?? null,
    anoReferencia: ano,
    emTransicao: ref.emTransicao,
    temBeneficio: reducaoIBS > 0 || reducaoCBS > 0 || cst !== '000' || cClassTrib !== '000001',
    semLastro: resolvido.regraGeral,
  }
  cacheVereditosNbs.set(chave, veredito)
  return veredito
}

/* ---------------------------------------------------------- ranking 98-NBS --- */

export interface ItemRankingNbs {
  nbs: string
  score: number
  temBeneficio: boolean
  cct: string | null
}

export interface RankingNbs {
  maisProvavel: string | null
  ranking: ItemRankingNbs[]
  /** `n > LIMIAR_AMBIGUIDADE_NBS` — a UI oferece escolha da NBS. */
  ambiguo: boolean
}

const semAcento = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface CandidatoRankingNbs {
  nbs: string
  descricao: string | null
  cct: string | null
  temBeneficio: boolean
}

/**
 * Ranking por plausibilidade (PLAN 09-02/F): score = divisão CNAE↔grupo NBS
 * (palavras-chave do setor na descrição + pins curados de cct) + teto de
 * confiança da Situação (Phase 7) + `temBeneficio`. Puro e determinístico:
 * empate desempatado pelo menor NBS.
 */
export function ranquearNbs(
  cnae7: string,
  situacao: CnaeAnexo['situacao'],
  candidatos: CandidatoRankingNbs[],
): RankingNbs {
  const palavras = palavrasChaveNbsPorCnae(cnae7)
  const pins = pinsHipotesesPorCnae(cnae7)
  const teto = tetoConfiancaCnae(situacao)
  const ranking: ItemRankingNbs[] = candidatos.map((c) => {
    let score = teto + (c.temBeneficio ? 1 : 0)
    const desc = semAcento(c.descricao)
    if (palavras.length && palavras.some((p) => desc.includes(p))) score += 2
    if (c.cct && pins.includes(c.cct.replace(/\D+/g, ''))) score += 3
    return { nbs: c.nbs, score: Math.round(score * 100) / 100, temBeneficio: c.temBeneficio, cct: c.cct }
  })
  ranking.sort((a, b) => b.score - a.score || a.nbs.localeCompare(b.nbs))
  return {
    maisProvavel: ranking[0]?.nbs ?? null,
    ranking,
    ambiguo: ranking.length > LIMIAR_AMBIGUIDADE_NBS,
  }
}

/* ---------------------------------------------------------- enriquecimento --- */

export type EstadoNbsCnae = 'mapeado' | 'sem-mapeamento-NBS' | 'bens→NCM'

export interface EnriquecimentoNbs extends RankingNbs {
  estadoNbs: EstadoNbsCnae
  vereditos: VereditoNbs[]
  coerencia: CoerenciaServico
  hipoteses: HipoteseLegal[]
  anoReferencia: number
  emTransicao: boolean
}

async function buscarHipotesesBestEffort(texto: string, cnae7: string): Promise<HipoteseLegal[]> {
  try {
    return await buscarHipotesesLegais(texto, 3, { pinsCct: pinsHipotesesPorCnae(cnae7) })
  } catch {
    return []
  }
}

async function descricoesDoTemplate(
  cnae7: string,
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>()
  try {
    const tpl = await db.classificacoesConsolidadas.get(cnae7)
    for (const v of tpl?.nbsVinculadas ?? []) mapa.set(v.nbs, v.descricao)
  } catch {
    /* template é enriquecimento do enriquecimento — nunca bloqueia */
  }
  return mapa
}

/**
 * Camada 2 — enriquecimento NBS de UM CNAE com regra (só os 508).
 *
 * - `ehBens` → `{estadoNbs: 'bens→NCM'}` sem chamar o resolvedor;
 * - sem links → `{estadoNbs: 'sem-mapeamento-NBS'}` + hipóteses Phase 7;
 * - com links → um `VereditoNbs` por NBS (cache por NBS) + ranking.
 */
export async function enriquecerNbsDoCnae(
  regra: RegraCnaeOk,
  opts?: { anoReferencia?: number },
): Promise<EnriquecimentoNbs> {
  const ano = normalizarAnoReferencia(opts?.anoReferencia)
  const ref = refPorAno(ano)
  const texto = `${regra.codigoFormatado} ${regra.descricao}`.trim()

  if (regra.ehBens) {
    return {
      estadoNbs: 'bens→NCM',
      vereditos: [],
      maisProvavel: null,
      ranking: [],
      ambiguo: false,
      coerencia: 'sem-base',
      hipoteses: [],
      anoReferencia: ano,
      emTransicao: ref.emTransicao,
    }
  }

  let links: string[] = []
  try {
    const linhas = await db.cnaeNbs.where('cnae7').equals(regra.cnae7).toArray()
    links = [...new Set(linhas.map((l) => l.nbs).filter((n) => /^\d{9}$/.test(n)))]
  } catch {
    links = []
  }

  if (!links.length) {
    const hipoteses = await buscarHipotesesBestEffort(texto, regra.cnae7)
    return {
      estadoNbs: 'sem-mapeamento-NBS',
      vereditos: [],
      maisProvavel: null,
      ranking: [],
      ambiguo: false,
      coerencia: 'sem-base',
      hipoteses,
      anoReferencia: ano,
      emTransicao: ref.emTransicao,
    }
  }

  const descricoes = await descricoesDoTemplate(regra.cnae7)
  const vereditos: VereditoNbs[] = []
  for (const nbs of links) {
    vereditos.push(await vereditoPorNbs(nbs, ano, descricoes.get(nbs) ?? null))
  }
  vereditos.sort((a, b) => a.nbs.localeCompare(b.nbs))

  const rank = ranquearNbs(
    regra.cnae7,
    regra.situacao,
    vereditos.map((v) => ({ nbs: v.nbs, descricao: v.descricao, cct: v.cClassTrib, temBeneficio: v.temBeneficio })),
  )
  const hipoteses = await buscarHipotesesBestEffort(texto, regra.cnae7)
  const cctMaisProvavel = rank.maisProvavel
    ? (vereditos.find((v) => v.nbs === rank.maisProvavel)?.cClassTrib ?? null)
    : null

  return {
    estadoNbs: 'mapeado',
    vereditos,
    maisProvavel: rank.maisProvavel,
    ranking: rank.ranking,
    ambiguo: rank.ambiguo,
    coerencia: verificarCoerenciaServico(cctMaisProvavel, hipoteses),
    hipoteses,
    anoReferencia: ano,
    emTransicao: ref.emTransicao,
  }
}
