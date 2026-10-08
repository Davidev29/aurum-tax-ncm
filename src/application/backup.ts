/**
 * Backup e restauração completos do banco local (SPEC §10.6).
 *
 * - **Backup** exporta as 27 stores + emitente num único JSON
 *   (`backup_aurum_tax_YYYY-MM-DD.json`).
 * - **Restauração** valida TUDO antes de apagar qualquer coisa (falha de
 *   validação = zero escrita, inclusive o emitente separado); depois reescreve
 *   em TRANSAÇÃO ÚNICA (`transacionar`: clears + lotes fatiados em 500 +
 *   emitente — tudo ou nada; sem clears concorrentes). `audit_log` é
 *   append-only: nunca sofre clear — só acrescenta. Backup parcial
 *   (`parcial: true`) bloqueia sem confirmação explícita.
 * - **Backup** exporta com manifesto `{ tabela: count | 'erro:<motivo>' }`:
 *   falha de leitura vira `[]` contabilizado (nunca silenciado).
 * - A store `classificacaoProduto` (tabelas CFF por DFe) é opcional no backup:
 *   backups antigos restauram sem ela; como é dado oficial ressincronizável,
 *   a ausência só oculta os selos de DFe até o próximo sync/importação.
 */
import { db } from '@/infrastructure/db/schema'
import { bridge } from '@/infrastructure/bridge'
import { validarRegistro } from '@/infrastructure/db/validacao'
import type { DbOp } from '@/infrastructure/db/db-protocolo'
import { executarOp, resolverDriver, type Registro } from '@/infrastructure/db/motor'
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

/** Manifesto do backup: por tabela, a quantidade exportada ou `erro:<motivo>`. */
export type ManifestoBackup = Record<string, number | string>

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
  /**
   * Manifesto de cobertura: `{ tabela: count | 'erro:<motivo>' }`. Tabela
   * que falhou na leitura exporta `[]` e registra o erro aqui — nenhuma
   * falha de leitura é silenciada.
   */
  manifesto?: ManifestoBackup
  /**
   * `true` quando alguma tabela falhou na leitura (backup incompleto). O
   * restore bloqueia sem confirmação explícita (`{ confirmarParcial: true }`).
   */
  parcial?: boolean
}

/**
 * Prefixos de `meta` que NUNCA entram no backup (segredo de dispositivo +
 * resumos sensíveis — ver teste `chat-artefatos.test.ts`).
 */
export const META_SENSIVEL_PREFIXOS = ['aurum_kek_', 'aurum_artefato_'] as const

export async function montarBackup(): Promise<Backup> {
  // Leitura por tabela com manifesto: falha de leitura vira `[]` + entrada
  // `erro:<motivo>` no manifesto (contabilizada, nunca silenciada) e marca
  // o backup como parcial.
  const manifesto: ManifestoBackup = {}
  const ler = async (nome: string, promessa: Promise<unknown[]>): Promise<unknown[]> => {
    try {
      const linhas = await promessa
      manifesto[nome] = linhas.length
      return linhas
    } catch (e) {
      manifesto[nome] = `erro:${e instanceof Error ? e.message : String(e)}`
      return []
    }
  }
  const [ncm, cst, cstClassTrib, referencia, nbs, cest, auditLog, ncmNomenclatura, empresas, produtos, cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, anexos, produtosDfe, iaFeedback] =
    await Promise.all([
      ler('ncm', db.ncm.toArray() as Promise<unknown[]>),
      ler('cst', db.cst.toArray() as Promise<unknown[]>),
      ler('cstClassTrib', db.cstClassTrib.toArray() as Promise<unknown[]>),
      ler('referencia', db.table('referencia').toArray() as Promise<unknown[]>),
      ler('nbs', db.table('nbs').toArray() as Promise<unknown[]>),
      ler('cest', db.table('cest').toArray() as Promise<unknown[]>),
      ler('audit_log', db.table('audit_log').toArray() as Promise<unknown[]>),
      ler('ncmNomenclatura', db.ncmNomenclatura.toArray() as Promise<unknown[]>),
      ler('empresas', db.empresas.toArray() as Promise<unknown[]>),
      ler('produtos', db.produtos.toArray() as Promise<unknown[]>),
      ler('cfop', db.cfop.toArray() as Promise<unknown[]>),
      ler('cstIcms', db.cstIcms.toArray() as Promise<unknown[]>),
      ler('cstPisCofins', db.cstPisCofins.toArray() as Promise<unknown[]>),
      ler('nfeNotas', db.nfeNotas.toArray() as Promise<unknown[]>),
      ler('reclassificacoesManuais', db.reclassificacoesManuais.toArray() as Promise<unknown[]>),
      ler('classificacaoProduto', db.classificacaoProduto.toArray() as Promise<unknown[]>),
      ler('anexos', db.table('anexos').toArray() as Promise<unknown[]>),
      ler('produtosDfe', db.table('produtosDfe').toArray() as Promise<unknown[]>),
      ler('ia_feedback', db.table('ia_feedback').toArray() as Promise<unknown[]>),
    ])
  const [metaBruta, cnae, consultasCnpj, conversasEmitente, cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa] =
    await Promise.all([
      ler('meta', db.meta.toArray() as Promise<unknown[]>),
      ler('cnae', db.cnae.toArray() as Promise<unknown[]>),
      ler('consultasCnpj', db.consultasCnpj.toArray() as Promise<unknown[]>),
      ler('conversasEmitente', db.conversasEmitente.toArray() as Promise<unknown[]>),
      ler('cnaeNbs', db.cnaeNbs.toArray() as Promise<unknown[]>),
      ler('lcNbs', db.lcNbs.toArray() as Promise<unknown[]>),
      ler('classificacoesConsolidadas', db.classificacoesConsolidadas.toArray() as Promise<unknown[]>),
      ler('grafometa', db.grafometa.toArray() as Promise<unknown[]>),
    ])
  // Chaves sensíveis (KEK/resumos) ficam fora do backup por construção.
  const meta = (metaBruta as Array<{ chave?: unknown }>).filter((r) => {
    const chave = r?.chave
    return typeof chave !== 'string' || !META_SENSIVEL_PREFIXOS.some((p) => chave.startsWith(p))
  })
  const metaEmitente = await db.meta.get(META_KEYS.EMITENTE)
  const parcial = Object.values(manifesto).some((v) => typeof v === 'string')
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
    manifesto,
    parcial,
  }
}

/**
 * Grava um backup previamente exportado (importação do arquivo).
 *
 * Backups parciais (`parcial: true` — alguma tabela falhou na leitura)
 * são BLOQUEADOS sem confirmação explícita: restaurar um backup furado por
 * cima da base atual apagaria dados sem volta. Passe
 * `{ confirmarParcial: true }` após confirmar com o usuário.
 */
export async function restaurarBackup(b: Backup, opts?: { confirmarParcial?: boolean }): Promise<void> {
  if (b.parcial && !opts?.confirmarParcial) {
    const tabelas = Object.entries(b.manifesto ?? {})
      .filter(([, v]) => typeof v === 'string')
      .map(([t]) => t)
    throw new Error(
      `Backup parcial${tabelas.length ? ` (falhou a leitura de: ${tabelas.join(', ')})` : ''}: a restauração apagaria a base atual com dados incompletos. Confirme explicitamente para prosseguir.`,
    )
  }
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
  // O emitente separado também é validado antes de apagar (antes, um
  // emitente inválido falhava no `put` final com o banco já reescrito).
  if (b.emitente !== null && b.emitente !== undefined) {
    validarRegistro('meta', { chave: META_KEYS.EMITENTE, valor: b.emitente, atualizadoEm: new Date().toISOString() })
  }

  // Snapshot pré-restore (best-effort): kill -9 no meio da reescrita deixaria
  // tabelas meio-restauradas sem ponto de retorno; o resultado é ignorado de
  // propósito — falha do snapshot NUNCA bloqueia o restore.
  await bridge?.db?.snapshotBanco?.()?.catch(() => null)

  // 2) Reescrita em TRANSAÇÃO ÚNICA (tudo ou nada): os 26 clears + todos os
  // lotes + emitente vão num `transacionar(ops)` — sem o `Promise.all` de
  // clears concorrentes de antes (concorrência de escritas sob WAL gerava
  // `SQLITE_BUSY` intermitente). `audit_log` é append-only: nunca sofre
  // clear — só acrescenta. Lotes fatiados em 500 (teto do canal IPC por op).
  const TAM_LOTE = 500
  const ops: DbOp[] = []
  // audit_log é append-only: nunca sofre clear — só acrescenta.
  const lojasLimpaveis = LOJA_BACKUP.filter((s) => s !== 'audit_log')
  for (const s of lojasLimpaveis) ops.push({ op: 'limpar', tabela: s })
  const enfileirar = (store: StoreName, itens: unknown[] | undefined) => {
    if (!Array.isArray(itens) || !itens.length) return
    const registros = itens as Registro[]
    for (let i = 0; i < registros.length; i += TAM_LOTE) {
      ops.push({ op: 'lote', tabela: store, registros: registros.slice(i, i + TAM_LOTE), modo: 'upsert' })
    }
  }

  enfileirar('ncm', b.ncm)
  enfileirar('cst', b.cst)
  enfileirar('cstClassTrib', b.cstClassTrib)
  enfileirar('referencia', b.referencia)
  enfileirar('nbs', b.nbs)
  enfileirar('cest', b.cest)
  enfileirar('ncmNomenclatura', b.nomenclatura)
  enfileirar('empresas', b.empresas)
  enfileirar('produtos', b.produtos)
  enfileirar('cfop', b.cfop)
  enfileirar('cstIcms', b.cstIcms)
  enfileirar('cstPisCofins', b.cstPisCofins)
  enfileirar('nfeNotas', b.nfeNotas)
  enfileirar('reclassificacoesManuais', b.reclassificacoesManuais)
  enfileirar('classificacaoProduto', b.classificacaoProduto)
  enfileirar('anexos', b.anexos)
  enfileirar('produtosDfe', b.produtosDfe)
  enfileirar('ia_feedback', b.iaFeedback)
  enfileirar('audit_log', b.auditLog)
  enfileirar('meta', b.meta)
  enfileirar('cnae', b.cnae)
  enfileirar('consultasCnpj', b.consultasCnpj)
  enfileirar('conversasEmitente', b.conversasEmitente)
  enfileirar('cnaeNbs', b.cnaeNbs)
  enfileirar('lcNbs', b.lcNbs)
  enfileirar('classificacoesConsolidadas', b.classificacoesConsolidadas)
  enfileirar('grafometa', b.grafometa)

  if (b.emitente) {
    ops.push({
      op: 'upsert',
      tabela: 'meta',
      registro: { chave: META_KEYS.EMITENTE, valor: b.emitente, atualizadoEm: new Date().toISOString() },
    })
  }

  const driver = resolverDriver()
  if (typeof driver.transacionar === 'function') {
    try {
      await driver.transacionar(ops)
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Só o main antigo (sem canal transacional) cai no sequencial abaixo;
      // falha real propaga (a transação já garantiu tudo-ou-nada).
      if (!/sem-transacao/.test(msg)) throw e
    }
  }
  // Fallback sequencial documentado (driver sem transação real — mesma ordem
  // da transação; falha propaga e o snapshot prévio permite recuperação).
  for (const op of ops) await executarOp(driver, op)
}

/** Valida estrutura mínima antes de restaurar. */
export function ehBackup(dado: unknown): dado is Backup {
  if (!dado || typeof dado !== 'object') return false
  const b = dado as Record<string, unknown>
  return typeof b.exportadoEm === 'string' && Array.isArray(b.ncm)
}
