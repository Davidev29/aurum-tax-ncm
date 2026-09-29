import { META_KEYS, REF_DEFAULT } from '@/domain/constants'
import type {
  NomenclaturaNcm,
  ReferenciaCClassTrib,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNcm,
} from '@/domain/entities'
import { lerArquivoBase } from '../bridge'
import { bulkPut, db, type MetaRecord } from '../db/schema'
import { invalidarCacheBuscaTexto } from './classificacao-repo'
import {
  normalizarCst,
  normalizarCstClassTrib,
  normalizarNcm,
  normalizarNomenclatura,
  normalizarNbs,
  normalizarReferencia,
} from './normalizacao'

export type Progresso = (etapa: string, pct: number) => void

export type FormatoBase =
  | { formato: 'nomenclatura'; total: number }
  | { formato: 'reforma'; total: number }
  | { formato: 'referencia'; total: number }

export interface StatusBase {
  ncm: number
  cst: number
  cstClassTrib: number
  referencia: number
  nomenclatura: number
  nbs: number
  ultimaImportacao: MetaRecord | null
  ultimaNomenclatura: MetaRecord | null
  embutida: boolean
}

interface Manifest {
  schema: number
  geradoEm: string
  estatisticas: Record<string, number>
  arquivos: { arquivo: string; bytes: number; sha256: string }[]
}

/**
 * Detecção de formato — primeiro teste vence (SPEC R5.2).
 *
 * Além dos JSON oficiais brutos, reconhece os artefatos já normalizados da
 * base embutida (`{ tipo, itens }` / `{ tipo, ncm }`), que os normalizadores
 * também sabem reaplicar sem perda.
 */
export function detectarFormato(json: unknown): FormatoBase['formato'] | 'desconhecido' {
  if (!json || typeof json !== 'object') return 'desconhecido'
  const j = json as Record<string, unknown>
  if (Array.isArray(j.Nomenclaturas) || (j.tipo === 'nomenclatura' && Array.isArray(j.itens)))
    return 'nomenclatura'
  if (Array.isArray(j.NCM) || Array.isArray(j.ncm)) return 'reforma'
  const lista =
    (Array.isArray(j) ? j : null) ??
    (j.tipo === 'classificacao-tributaria' && Array.isArray(j.itens)
      ? (j.itens as unknown[])
      : null)
  const primeiro = lista?.[0] as Record<string, unknown> | undefined
  if (primeiro && ('Código da Situação Tributária' in primeiro || 'cst' in primeiro))
    return 'referencia'
  return 'desconhecido'
}

/* -------------------------------------------------------------------------- */
/* Importação em tempo de execução (formatos originais oficiais)               */
/* -------------------------------------------------------------------------- */

export async function importarBase(
  json: unknown,
  nomeArquivo: string,
  onProgress: Progresso,
): Promise<FormatoBase> {
  if (!json || typeof json !== 'object') throw new Error('JSON inválido.')
  const formato = detectarFormato(json)
  const agora = new Date().toISOString()

  if (formato === 'nomenclatura') {
    onProgress('Mapeando nomenclatura', 5)
    const itens = normalizarNomenclatura(json)
    if (!itens.length) throw new Error('Base de nomenclatura sem itens válidos.')
    onProgress('Limpando nomenclatura', 5)
    await db.ncmNomenclatura.clear()
    onProgress('Gravando nomenclatura', 15)
    await bulkPut(db.ncmNomenclatura, itens, (f, t) =>
      onProgress('Gravando nomenclatura', 15 + Math.round((f / t) * 80)),
    )
    await db.meta.put({
      chave: META_KEYS.IMPORTACAO_NOMENCLATURA,
      data: agora,
      arquivo: nomeArquivo,
      total: itens.length,
    })
    invalidarCacheBuscaTexto()
    onProgress('Finalizado', 100)
    return { formato, total: itens.length }
  }

  if (formato === 'reforma') {
    const j = json as Record<string, unknown>
    const ncmBruto = (Array.isArray(j.NCM) ? j.NCM : Array.isArray(j.ncm) ? j.ncm : []) as unknown[]
    if (!ncmBruto.length) throw new Error('Formato não reconhecido.')
    const tab = (j.tabelasAuxiliares ?? {}) as Record<string, unknown>

    onProgress('Mapeando vinculações NCM', 3)
    const ncm = normalizarNcm(ncmBruto)
    // Tabelas auxiliares: chave do formato bruto (`tabelasAuxiliares`) ou a
    // chave canônica do artefato já normalizado da base embutida.
    const cst = normalizarCst(tab.cst ?? j.cst)
    const cstct = normalizarCstClassTrib(tab.cstClassTrib ?? j.cstClassTrib)
    const nbs = normalizarNbs(j.NBS ?? j.nbs)

    onProgress('Limpando base', 3)
    await Promise.all([db.ncm.clear(), db.cst.clear(), db.cstClassTrib.clear()])

    if (cst.length) {
      onProgress('Gravando CST', 8)
      await bulkPut(db.cst, cst)
    }
    if (cstct.length) {
      onProgress('Gravando cClassTrib', 18)
      await bulkPut(db.cstClassTrib, cstct)
    }
    onProgress('Gravando NCM', 28)
    await bulkPut(db.ncm, ncm, (f, t) =>
      onProgress('Gravando NCM', 28 + Math.round((f / t) * 70)),
    )
    if (nbs.length) await bulkPut(db.nbs, nbs)

    await db.meta.put({ chave: META_KEYS.IMPORTACAO, data: agora, arquivo: nomeArquivo })
    onProgress('Finalizado', 100)
    return { formato, total: ncm.length }
  }

  if (formato === 'referencia') {
    onProgress('Mapeando referência tributária', 10)
    const itens = normalizarReferencia(json)
    if (!itens.length) throw new Error('Referência sem registros válidos.')
    onProgress('Limpando referência', 15)
    await db.referencia.clear()
    onProgress('Gravando referência', 30)
    await bulkPut(db.referencia, itens, (f, t) =>
      onProgress('Gravando referência', 30 + Math.round((f / t) * 65)),
    )
    await db.meta.put({ chave: 'importacao_referencia', data: agora, arquivo: nomeArquivo, total: itens.length })
    onProgress('Finalizado', 100)
    return { formato, total: itens.length }
  }

  throw new Error('Formato não reconhecido.')
}

/* -------------------------------------------------------------------------- */
/* Base embutida (semeação automática)                                         */
/* -------------------------------------------------------------------------- */

interface ArquivoRef {
  schema: number
  tipo: string
  meta: Record<string, unknown>
}

export const ARQUIVOS_BASE = [
  'MANIFEST.json',
  'classificacao-tributaria.json',
  'reforma.json',
  'nomenclatura.json',
] as const

/**
 * A base está **completa** quando tem vínculos NCM **e** a referência oficial
 * (`classificacao_tributaria.json`), que é o que habilita anexos, documentos e
 * chips de redução.
 *
 * O banco legado (v2) foi criado antes da store `referencia` existir: ele tem
 * NCMs, mas nenhuma referência — e é justamente esse estado que manda ressemear
 * a base embutida na primeira abertura com a nova versão.
 */
export async function baseCompleta(): Promise<boolean> {
  const [ncm, referencia] = await Promise.all([db.ncm.count(), db.referencia.count()])
  return ncm > 0 && referencia > 0
}

/**
 * Semeia a base embutida no pacote — é o que torna o `classificacao_tributaria.json`
 * "anexado" ao sistema: nada de importação manual, o banco nasce completo.
 */
export async function semearBaseEmbutida(
  onProgress: Progresso = () => {},
  forcar = false,
): Promise<StatusBase> {
  if ((await baseCompleta()) && !forcar) return statusBase()

  onProgress('Lendo manifesto da base', 4)
  let manifest: Manifest | null = null
  try {
    manifest = JSON.parse(await lerArquivoBase('MANIFEST.json')) as Manifest
  } catch {
    manifest = null
  }

  onProgress('Carregando classificação tributária', 10)
  const refJson = JSON.parse(await lerArquivoBase('classificacao-tributaria.json')) as ArquivoRef & {
    itens: unknown[]
  }
  const referencia: ReferenciaCClassTrib[] = normalizarReferencia(refJson.itens)

  onProgress('Carregando vinculações NCM', 25)
  const reformaJson = JSON.parse(await lerArquivoBase('reforma.json')) as ArquivoRef & {
    cst: unknown[]
    cstClassTrib: unknown[]
    ncm: unknown[]
    nbs: unknown[]
  }
  const cst = normalizarCst(reformaJson.cst)
  const cstct = normalizarCstClassTrib(reformaJson.cstClassTrib)
  const ncm = normalizarNcm(reformaJson.ncm)
  const nbs = normalizarNbs(reformaJson.nbs)

  onProgress('Carregando nomenclatura vigente', 40)
  const nomenJson = JSON.parse(await lerArquivoBase('nomenclatura.json')) as ArquivoRef & {
    itens: unknown
  }
  const nomenclatura: NomenclaturaNcm[] = normalizarNomenclatura(nomenJson)

  onProgress('Limpando base anterior', 45)
  await Promise.all([
    db.ncm.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.ncmNomenclatura.clear(),
  ])

  const agora = new Date().toISOString()
  const reg = (pctBase: number, span: number) => (f: number, t: number) =>
    onProgress('Gravando', pctBase + Math.round((f / Math.max(t, 1)) * span))

  onProgress('Gravando referência', 46)
  await bulkPut(db.referencia, referencia, reg(46, 6))
  onProgress('Gravando CST', 52)
  await bulkPut(db.cst, cst)
  onProgress('Gravando cClassTrib', 56)
  await bulkPut(db.cstClassTrib, cstct)
  onProgress('Gravando vinculações NCM', 60)
  await bulkPut(db.ncm, ncm, reg(60, 20))
  onProgress('Gravando nomenclatura', 80)
  await bulkPut(db.ncmNomenclatura, nomenclatura, reg(80, 18))
  if (nbs.length) await bulkPut(db.nbs, nbs)

  await db.meta.put({
    chave: META_KEYS.IMPORTACAO,
    data: agora,
    arquivo: (reformaJson.meta?.arquivoOrigem as string) ?? 'base embutida',
    total: ncm.length,
  })
  await db.meta.put({
    chave: META_KEYS.IMPORTACAO_NOMENCLATURA,
    data: agora,
    arquivo: (nomenJson.meta?.arquivoOrigem as string) ?? 'base embutida',
    total: nomenclatura.length,
  })
  await db.meta.put({
    chave: 'base_embutida',
    valor: {
      geradoEm: manifest?.geradoEm ?? null,
      estatisticas: manifest?.estatisticas ?? null,
      alquotas: REF_DEFAULT,
    },
    quando: agora,
  })

  invalidarCacheBuscaTexto()
  onProgress('Finalizado', 100)
  return statusBase()
}

export async function statusBase(): Promise<StatusBase> {
  const [ncm, cst, cstClassTrib, referencia, nomenclatura, nbs, ultima, ultimaNom] =
    await Promise.all([
      db.ncm.count(),
      db.cst.count(),
      db.cstClassTrib.count(),
      db.referencia.count(),
      db.ncmNomenclatura.count(),
      db.nbs.count(),
      db.meta.get(META_KEYS.IMPORTACAO),
      db.meta.get(META_KEYS.IMPORTACAO_NOMENCLATURA),
    ])
  const embutida = await db.meta.get('base_embutida')
  return {
    ncm,
    cst,
    cstClassTrib,
    referencia,
    nomenclatura,
    nbs,
    ultimaImportacao: ultima ?? null,
    ultimaNomenclatura: ultimaNom ?? null,
    embutida: Boolean(embutida),
  }
}

/** Apaga apenas a base importada (SPEC R10.12). */
export async function apagarBaseImportada(): Promise<void> {
  await Promise.all([
    db.ncm.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.ncmNomenclatura.clear(),
    db.nbs.clear(),
    db.classificacaoProduto.clear(),
    db.meta.delete(META_KEYS.IMPORTACAO),
    db.meta.delete(META_KEYS.IMPORTACAO_NOMENCLATURA),
    db.meta.delete('base_embutida'),
  ])
  invalidarCacheBuscaTexto()
}

export type { VinculoNcm, TabelaCst, TabelaCstClassTrib }
