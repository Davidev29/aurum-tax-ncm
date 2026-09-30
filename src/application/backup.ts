/**
 * Backup e restauração completos do banco local (SPEC §10.6).
 *
 * - **Backup** exporta as 9 stores de dados + emitente num único JSON
 *   (`backup_aurum_tax_YYYY-MM-DD.json`).
 * - **Restauração** limpa as mesmas stores e regrava somente os arrays não
 *   vazios; a store `meta` não é tocada (a v1 também não limpava, o que é
 *   documentado como `[⚠] L2059` — aqui preservamos o comportamento para não
 *   perder o registro de importação embutida).
 * - A store `classificacaoProduto` (tabelas CFF por DFe) é opcional no backup:
 *   backups antigos restauram sem ela; como é dado oficial ressincronizável,
 *   a ausência só oculta os selos de DFe até o próximo sync/importação.
 */
import { db } from '@/infrastructure/db/schema'
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
}

export async function montarBackup(): Promise<Backup> {
  const [ncm, cst, cstClassTrib, referencia, nbs, cest, auditLog, ncmNomenclatura, empresas, produtos, cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto] =
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
    ])
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
  }
}

/** Grava um backup previamente exportado (importação do arquivo). */
export async function restaurarBackup(b: Backup): Promise<void> {
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
  await gravar('audit_log', b.auditLog)

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
