/**
 * Backup e restauração completos do banco local (SPEC §10.6).
 *
 * - **Backup** exporta as 27 stores + emitente num único JSON
 *   (`backup_aurum_tax_YYYY-MM-DD.json`).
 * - **Restauração** valida TUDO antes de apagar qualquer coisa (falha de
 *   validação = zero escrita); depois limpa as stores e regrava somente os
 *   arrays não vazios. `audit_log` é append-only: nunca sofre clear — só
 *   acrescenta.
 * - A store `classificacaoProduto` (tabelas CFF por DFe) é opcional no backup:
 *   backups antigos restauram sem ela; como é dado oficial ressincronizável,
 *   a ausência só oculta os selos de DFe até o próximo sync/importação.
 */
import { db } from '@/infrastructure/db/schema'
import { bridge } from '@/infrastructure/bridge'
import { validarRegistro } from '@/infrastructure/db/validacao'
import { META_KEYS, type StoreName } from '@/domain/constants'
import type { Emitente } from '@/domain/entities'

const LOJA_BACKUP: StoreName[] = [
  'ncm',
  'cst',
  'cstClassTrib',
  'referencia',
  'nbs',
  'cest',
  'audit_log',
  'ncmNomenclatura',
  'empresas',
  'produtos',
  'cfop',
  'cstIcms',
  'cstPisCofins',
  'nfeNotas',
  'reclassificacoesManuais',
  'classificacaoProduto',
  'anexos',
  'produtosDfe',
  'ia_feedback',
  'meta',
  'cnae',
  'consultasCnpj',
  'conversasEmitente',
  'cnaeNbs',
  'lcNbs',
  'classificacoesConsolidadas',
  'grafometa',
]

export interface Backup {
  exportadoEm: string
  ncm: unknown[]
  cst: unknown[]
  cstClassTrib: unknown[]
  referencia?: unknown[]
  nbs?: unknown[]
  cest?: unknown[]
  auditLog?: unknown[]
  nomenclatura: unknown[]
  empresas: unknown[]
  produtos: unknown[]
  emitente: Emitente | null
  cfop: unknown[]
  cstIcms: unknown[]
  cstPisCofins: unknown[]
  nfeNotas: unknown[]
  reclassificacoesManuais?: unknown[]
  classificacaoProduto?: unknown[]
  anexos?: unknown[]
  produtosDfe?: unknown[]
  /** Feedback IA — opcional para backups antigos. */
  iaFeedback?: unknown[]
  /** Cobertura total (27 stores): metadados, CNAE/ponte e dados de usuário. */
  meta?: unknown[]
  cnae?: unknown[]
  consultasCnpj?: unknown[]
  conversasEmitente?: unknown[]
  cnaeNbs?: unknown[]
  lcNbs?: unknown[]
  classificacoesConsolidadas?: unknown[]
  grafometa?: unknown[]
}

/**
 * Prefixos de `meta` que NUNCA entram no backup (segredo de dispositivo +
 * resumos sensíveis — ver teste `chat-artefatos.test.ts`).
 */
export const META_SENSIVEL_PREFIXOS = ['aurum_kek_', 'aurum_artefato_'] as const

export async function montarBackup(): Promise<Backup> {
  const [ncm, cst, cstClassTrib, referencia, nbs, cest, auditLog, ncmNomenclatura, empresas, produtos, cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, anexos, produtosDfe, iaFeedback] =
    await Promise.all([
      db.ncm.toArray(),
      db.cst.toArray(),
      db.cstClassTrib.toArray(),
      db.table('referencia').toArray().catch(() => []),
      db.table('nbs').toArray().catch(() => []),
      db.table('cest').toArray().catch(() => []),
      db.table('audit_log').toArray().catch(() => []),
      db.ncmNomenclatura.toArray(),
      db.empresas.toArray(),
      db.produtos.toArray(),
      db.cfop.toArray(),
      db.cstIcms.toArray(),
      db.cstPisCofins.toArray(),
      db.nfeNotas.toArray(),
      db.reclassificacoesManuais.toArray().catch(() => []),
      db.classificacaoProduto.toArray().catch(() => []),
      db.table('anexos').toArray().catch(() => []),
      db.table('produtosDfe').toArray().catch(() => []),
      db.table('ia_feedback').toArray().catch(() => []),
    ])
  const [metaBruta, cnae, consultasCnpj, conversasEmitente, cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa] =
    await Promise.all([
      db.meta.toArray().catch(() => []),
      db.cnae.toArray().catch(() => []),
      db.consultasCnpj.toArray().catch(() => []),
      db.conversasEmitente.toArray().catch(() => []),
      db.cnaeNbs.toArray().catch(() => []),
      db.lcNbs.toArray().catch(() => []),
      db.classificacoesConsolidadas.toArray().catch(() => []),
      db.grafometa.toArray().catch(() => []),
    ])
  // Chaves sensíveis (KEK/resumos) ficam fora do backup por construção.
  const meta = (metaBruta as Array<{ chave?: unknown }>).filter((r) => {
    const chave = r?.chave
    return typeof chave !== 'string' || !META_SENSIVEL_PREFIXOS.some((p) => chave.startsWith(p))
  })
  const metaEmitente = await db.meta.get(META_KEYS.EMITENTE)
  return {
    exportadoEm: new Date().toISOString(),
    ncm,
    cst,
    cstClassTrib,
    referencia,
    nbs,
    cest,
    auditLog,
    nomenclatura: ncmNomenclatura,
    empresas,
    produtos,
    emitente: (metaEmitente?.valor as Emitente | undefined) ?? null,
    cfop,
    cstIcms,
    cstPisCofins,
    nfeNotas,
    reclassificacoesManuais,
    classificacaoProduto,
    anexos,
    produtosDfe,
    iaFeedback,
    meta,
    cnae,
    consultasCnpj,
    conversasEmitente,
    cnaeNbs,
    lcNbs,
    classificacoesConsolidadas,
    grafometa,
  }
}

/** Grava um backup previamente exportado (importação do arquivo). */
export async function restaurarBackup(b: Backup): Promise<void> {
  // 1) Valida TUDO antes de apagar qualquer coisa: falha aqui = zero escrita
  // (antes, um registro inválido no meio do arquivo deixava o banco
  // meio-apagado). Backups antigos sem as novas chaves passam (arrays vazios).
  const plano: Array<[StoreName, unknown[] | undefined]> = [
    ['ncm', b.ncm],
    ['cst', b.cst],
    ['cstClassTrib', b.cstClassTrib],
    ['referencia', b.referencia],
    ['nbs', b.nbs],
    ['cest', b.cest],
    ['audit_log', b.auditLog],
    ['ncmNomenclatura', b.nomenclatura],
    ['empresas', b.empresas],
    ['produtos', b.produtos],
    ['cfop', b.cfop],
    ['cstIcms', b.cstIcms],
    ['cstPisCofins', b.cstPisCofins],
    ['nfeNotas', b.nfeNotas],
    ['reclassificacoesManuais', b.reclassificacoesManuais],
    ['classificacaoProduto', b.classificacaoProduto],
    ['anexos', b.anexos],
    ['produtosDfe', b.produtosDfe],
    ['ia_feedback', b.iaFeedback],
    ['meta', b.meta],
    ['cnae', b.cnae],
    ['consultasCnpj', b.consultasCnpj],
    ['conversasEmitente', b.conversasEmitente],
    ['cnaeNbs', b.cnaeNbs],
    ['lcNbs', b.lcNbs],
    ['classificacoesConsolidadas', b.classificacoesConsolidadas],
    ['grafometa', b.grafometa],
  ]
  for (const [store, itens] of plano) {
    if (!Array.isArray(itens) || !itens.length) continue
    for (const item of itens) validarRegistro(store, item)
  }

  // Snapshot pré-restore (best-effort): kill -9 no meio da reescrita deixaria
  // tabelas meio-restauradas sem ponto de retorno; o resultado é ignorado de
  // propósito — falha do snapshot NUNCA bloqueia o restore.
  await bridge?.db?.snapshotBanco?.()?.catch(() => null)

  // audit_log é append-only: nunca sofre clear — só acrescenta.
  const lojasLimpaveis = LOJA_BACKUP.filter((s) => s !== 'audit_log')
  await Promise.all(lojasLimpaveis.map((s) => db.table(s).clear()))

  const gravar = async (store: StoreName, itens: unknown[] | undefined) => {
    if (Array.isArray(itens) && itens.length) {
      await db.table(store).bulkPut(itens as never[])
    }
  }

  await gravar('ncm', b.ncm)
  await gravar('cst', b.cst)
  await gravar('cstClassTrib', b.cstClassTrib)
  await gravar('referencia', b.referencia)
  await gravar('nbs', b.nbs)
  await gravar('cest', b.cest)
  await gravar('ncmNomenclatura', b.nomenclatura)
  await gravar('empresas', b.empresas)
  await gravar('produtos', b.produtos)
  await gravar('cfop', b.cfop)
  await gravar('cstIcms', b.cstIcms)
  await gravar('cstPisCofins', b.cstPisCofins)
  await gravar('nfeNotas', b.nfeNotas)
  await gravar('reclassificacoesManuais', b.reclassificacoesManuais)
  await gravar('classificacaoProduto', b.classificacaoProduto)
  await gravar('anexos', b.anexos)
  await gravar('produtosDfe', b.produtosDfe)
  await gravar('ia_feedback', b.iaFeedback)
  await gravar('audit_log', b.auditLog)
  await gravar('meta', b.meta)
  await gravar('cnae', b.cnae)
  await gravar('consultasCnpj', b.consultasCnpj)
  await gravar('conversasEmitente', b.conversasEmitente)
  await gravar('cnaeNbs', b.cnaeNbs)
  await gravar('lcNbs', b.lcNbs)
  await gravar('classificacoesConsolidadas', b.classificacoesConsolidadas)
  await gravar('grafometa', b.grafometa)

  if (b.emitente) {
    await db.meta.put({ chave: META_KEYS.EMITENTE, valor: b.emitente, atualizadoEm: new Date().toISOString() })
  }
}

/** Valida estrutura mínima antes de restaurar. */
export function ehBackup(dado: unknown): dado is Backup {
  if (!dado || typeof dado !== 'object') return false
  const b = dado as Record<string, unknown>
  return typeof b.exportadoEm === 'string' && Array.isArray(b.ncm)
}
