/**
 * Banco local — SQLite via Prisma (substitui Dexie/IndexedDB v14).
 *
 * Banco NOVO, sem migração de dados legados (decisão do projeto): o seed das
 * bases oficiais acontece em `base-service.ts` como antes, e os dados de
 * usuário começam vazios.
 *
 * API pública preservada 1:1 para não tocar nos ~45 consumidores:
 * `db.<tabela>` (get/put/add/update/delete/clear/count/toArray/bulkPut/
 * limit/where/orderBy), `db.table(nome)`, `db.delete()/open()/close()/isOpen()`,
 * `db.transaction(...)`, `db.verno`, `bulkPut()` em lotes de 500 com
 * progresso e `contarTodos()`.
 *
 * Roteamento (ver `motor.ts`):
 * - Electron renderer → IPC para o main (`electron/main/db.ts`, Prisma em
 *   `<userData>/aurum.db`);
 * - Node com driver registrado (Vitest via `tests/setup.ts`, scripts) →
 *   Prisma direto;
 * - navegador puro → memória (dev web).
 *
 * Validação (ver `validacao.ts` + schema Prisma em `prisma/schema.prisma`):
 * toda escrita é validada antes de gravar, em todos os drivers; o main
 * revalida o que chega via IPC.
 */
import { STORES } from '@/domain/constants'
import type {
  AnexoNcm,
  AuditLog,
  ClassificacaoConsolidada,
  ClassificacaoProdutoSistema,
  CnaeAnexo,
  CnaeNbsLink,
  ConsultaCnpj,
  Empresa,
  LcNbsRelation,
  NomenclaturaNcm,
  Produto,
  ProdutoDfe,
  ReclassificacaoManual,
  TabelaAuxiliarSimples,
  TabelaCest,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNbs,
  VinculoNcm,
  ReferenciaCClassTrib,
} from '@/domain/entities'
import type { NotaXml } from '../nfe/tipos'
import { TODAS_STORES } from './db-protocolo'
import { Colecao, Tabela, resolverDriver } from './motor'
import type { ModoLote } from './db-protocolo'

/** Versão do schema SQLite (banco novo — sem cadeia de migração Dexie). */
export const SQLITE_SCHEMA_VERSAO = 1

/** Feedback "Não é esse" da Sugestão IA (antes: Dexie `ia_feedback`). */
export interface IaFeedback {
  id?: number
  quando: string
  descricao: string
  via: string
  decisao: string | null
  confianca: number
  motivo?: string | null
  mock?: boolean
}

/** Conversa da Aurum AI gravada no perfil do emitente (antes: Dexie v12). */
export interface ConversaEmitente {
  conversaId: string
  emitenteId: string
  empresaAtivaId: number | null
  titulo: string
  mensagens: Array<{ papel: 'user' | 'assistant'; texto: string; quando: string }>
  updatedAt: string
  createdAt: string
}

/** Registro genérico da store `meta`. */
export interface MetaRecord {
  chave: string
  valor?: unknown
  data?: string
  arquivo?: string
  total?: number
  quando?: string
  atualizadoEm?: string
}

/** Carimbo do grafo fiscal local (antes: Dexie `grafometa` v14). */
export interface GrafoMeta {
  /** Chave única — sempre `'atual'` (um carimbo por banco). */
  id: string
  hash: string
  versao: string
  nodos: number
  arestas: number
  geradoEm: string
}

/* -------------------------------------------------------------------------- */
/* Banco                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fachada do banco local (SQLite). Mesma superfície do `AurumDatabase` do
 * Dexie para os consumidores não mudarem; por dentro delega ao driver
 * resolvido em `motor.ts` (IPC / Prisma / memória).
 */
class BancoLocal {
  /** Versão do schema (paridade com o `verno` do Dexie). */
  readonly verno = SQLITE_SCHEMA_VERSAO

  ncm = new Tabela<VinculoNcm, string>('ncm')
  nbs = new Tabela<VinculoNbs, string>('nbs')
  cst = new Tabela<TabelaCst, string>('cst')
  cstClassTrib = new Tabela<TabelaCstClassTrib, string>('cstClassTrib')
  referencia = new Tabela<ReferenciaCClassTrib, string>('referencia')
  ncmNomenclatura = new Tabela<NomenclaturaNcm, string>('ncmNomenclatura')
  empresas = new Tabela<Empresa, number>('empresas')
  produtos = new Tabela<Produto, number>('produtos')
  meta = new Tabela<MetaRecord, string>('meta')
  cfop = new Tabela<TabelaAuxiliarSimples, string>('cfop')
  cstIcms = new Tabela<TabelaAuxiliarSimples, string>('cstIcms')
  cstPisCofins = new Tabela<TabelaAuxiliarSimples, string>('cstPisCofins')

  /** Notas fiscais importadas de XML (itens + análise embutidos). */
  nfeNotas = new Tabela<NotaXml, number>('nfeNotas')

  /** Reclassificações manuais do usuário por NCM (chave `ncm`). */
  reclassificacoesManuais = new Tabela<ReclassificacaoManual, string>('reclassificacoesManuais')

  /** Classificação de Produtos por DFe (CFF — permitido × negado por sistema). */
  classificacaoProduto = new Tabela<ClassificacaoProdutoSistema, string>('classificacaoProduto')

  /** Anexos por NCM/NBS (CFF `anexos`, formato real da API). */
  anexos = new Tabela<AnexoNcm, string>('anexos')

  /** Catálogo de produtos por DFe (CFF `ConsultaClassificacaoProduto`, formato real). */
  produtosDfe = new Tabela<ProdutoDfe, string>('produtosDfe')

  /** Log imutável de auditoria (append-only, nunca atualizado pela UI). */
  auditLog = new Tabela<AuditLog, number>('audit_log')

  /** CEST — tabela informativa (7 dígitos, opcional por produto). */
  cest = new Tabela<TabelaCest, string>('cest')

  /** Feedback "Não é esse" da Sugestão IA. */
  iaFeedback = new Tabela<IaFeedback, number>('ia_feedback')

  /** CNAE × Anexo Simples (arquivo vivo). */
  cnae = new Tabela<CnaeAnexo, string>('cnae')

  /** Cache de consultas por CNPJ (BrasilAPI + TTL). */
  consultasCnpj = new Tabela<ConsultaCnpj, string>('consultasCnpj')
  conversasEmitente = new Tabela<ConversaEmitente, string>('conversasEmitente')

  /** Links CNAE → NBS da fonte ponte. */
  cnaeNbs = new Tabela<CnaeNbsLink, number>('cnaeNbs')
  /** Relações LC 116 → NBS da fonte ponte. */
  lcNbs = new Tabela<LcNbsRelation, number>('lcNbs')
  /** Templates consolidados por CNAE (chave `cnae7`). */
  classificacoesConsolidadas = new Tabela<ClassificacaoConsolidada, string>('classificacoesConsolidadas')

  /** Carimbo do grafo fiscal local (chave `id`, sempre `'atual'`). */
  grafometa = new Tabela<GrafoMeta, string>('grafometa')

  /** Tabelas existentes (paridade `db.tables` do Dexie — sempre as 27). */
  get tables(): Array<{ name: string }> {
    return TODAS_STORES.map((name) => ({ name }))
  }

  /** Acesso genérico por nome de store (paridade `db.table()` do Dexie). */
  table<T extends object = Record<string, unknown>, K extends string | number = string | number>(
    nome: string,
  ): Tabela<T, K> {
    return new Tabela<T, K>(nome)
  }

  /** O SQLite-arquivo está sempre "aberto" (paridade `db.isOpen()`). */
  isOpen(): boolean {
    return true
  }

  /** Garante conexão (no SQLite é no-op; paridade `db.open()`). */
  async open(): Promise<void> {
    resolverDriver()
  }

  /** Fecha a conexão Node (testes); no renderer/IPC é no-op. */
  async close(): Promise<void> {
    const d = resolverDriver()
    await d.fechar?.()
  }

  /**
   * Apaga TODAS as stores (paridade `db.delete()` do Dexie nos testes).
   * Nunca usado pelo app em produção — só reset de testes.
   */
  async delete(): Promise<void> {
    await resolverDriver().apagarTudo([...TODAS_STORES])
  }

  /**
   * Bloco transacional (paridade `db.transaction()` do Dexie).
   * Cada statement SQLite já é atômico; aqui a função executa direto.
   * O único chamador (`excluirEmpresa`) já tem fallback sem transação.
   */
  async transaction(_modo: string, _tabelas: unknown[], fn: () => Promise<void> | void): Promise<void> {
    await fn()
  }

  /** Alias snake_case → camelCase (o Dexie injetava `this[storeName]`). */
  get audit_log(): Tabela<AuditLog, number> {
    return this.auditLog
  }

  get ia_feedback(): Tabela<IaFeedback, number> {
    return this.iaFeedback
  }
}

export const db = new BancoLocal()

/* -------------------------------------------------------------------------- */
/* Compat: acesso defensivo por nome (backup/restauração, contadores)           */
/* -------------------------------------------------------------------------- */

const TABELAS_POR_NOME: Record<string, Tabela<Record<string, unknown>, string | number>> = {
  [STORES.NCM]: db.ncm as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.NBS]: db.nbs as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CST]: db.cst as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CSTCT]: db.cstClassTrib as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.REFERENCIA]: db.referencia as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.NCMNOM]: db.ncmNomenclatura as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.EMPRESAS]: db.empresas as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.PRODUTOS]: db.produtos as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.META]: db.meta as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CFOP]: db.cfop as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CSTICMS]: db.cstIcms as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CSTPISCOFINS]: db.cstPisCofins as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.NFENOTAS]: db.nfeNotas as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.RECLASS]: db.reclassificacoesManuais as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CLASSPROD]: db.classificacaoProduto as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.AUDIT]: db.auditLog as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CEST]: db.cest as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.IAFEEDBACK]: db.iaFeedback as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.ANEXOS]: db.anexos as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.PRODUTOSDFE]: db.produtosDfe as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CNAE]: db.cnae as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CONSULTAS_CNPJ]: db.consultasCnpj as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CONVERSAS_EMITENTE]: db.conversasEmitente as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CNAE_NBS]: db.cnaeNbs as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.LC_NBS]: db.lcNbs as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.CLASS_CONSOLIDADA]: db.classificacoesConsolidadas as unknown as Tabela<Record<string, unknown>, string | number>,
  [STORES.GRAFOMETA]: db.grafometa as unknown as Tabela<Record<string, unknown>, string | number>,
}

/* -------------------------------------------------------------------------- */
/* Helpers tipados                                                               */
/* -------------------------------------------------------------------------- */

/** Grava em lotes de 500, reportando progresso (SPEC R1.5). */
export async function bulkPut<T extends object, K extends string | number>(
  tabela: Tabela<T, K>,
  itens: T[],
  onProgress?: ((feito: number, total: number) => void) | { modo?: ModoLote },
  opts?: { modo?: ModoLote },
): Promise<void> {
  const progresso = typeof onProgress === 'function' ? onProgress : undefined
  const modo = (typeof onProgress === 'object' ? onProgress.modo : undefined) ?? opts?.modo ?? 'upsert'
  const TAM = 500
  const total = itens.length
  for (let i = 0; i < total; i += TAM) {
    await tabela.bulkPut(itens.slice(i, i + TAM) as T[], { modo })
    progresso?.(Math.min(i + TAM, total), total)
  }
}

/** Atalho para escritas só-insere pós-`clear()` (seeds): pula duplicadas. */
export const INSERIR = { modo: 'inserir' } as const

export async function contarTodos(): Promise<Record<string, number>> {
  // Nunca rejeita — tabela com falha conta como 0 (paridade com o Dexie).
  const contar = (nome: string): Promise<number> => {
    try {
      const t = TABELAS_POR_NOME[nome]
      if (!t) return Promise.resolve(0)
      return t.count().catch(() => 0)
    } catch {
      return Promise.resolve(0)
    }
  }
  const [
    ncm, nbs, cst, cstClassTrib, referencia, ncmNomenclatura, empresas, produtos,
    cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, auditLog, cest, iaFeedback,
    anexos, produtosDfe, cnae, consultasCnpj, conversasEmitente,
    cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa, meta,
  ] = await Promise.all([
    contar(STORES.NCM),
    contar(STORES.NBS),
    contar(STORES.CST),
    contar(STORES.CSTCT),
    contar(STORES.REFERENCIA),
    contar(STORES.NCMNOM),
    contar(STORES.EMPRESAS),
    contar(STORES.PRODUTOS),
    contar(STORES.CFOP),
    contar(STORES.CSTICMS),
    contar(STORES.CSTPISCOFINS),
    contar(STORES.NFENOTAS),
    contar(STORES.RECLASS),
    contar(STORES.CLASSPROD),
    contar(STORES.AUDIT),
    contar(STORES.CEST),
    contar(STORES.IAFEEDBACK),
    contar(STORES.ANEXOS),
    contar(STORES.PRODUTOSDFE),
    contar(STORES.CNAE),
    contar(STORES.CONSULTAS_CNPJ),
    contar(STORES.CONVERSAS_EMITENTE),
    contar(STORES.CNAE_NBS),
    contar(STORES.LC_NBS),
    contar(STORES.CLASS_CONSOLIDADA),
    contar(STORES.GRAFOMETA),
    contar(STORES.META),
  ])
  return {
    ncm, nbs, cst, cstClassTrib, referencia, ncmNomenclatura, empresas, produtos,
    cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, auditLog, cest, iaFeedback,
    anexos, produtosDfe, cnae, consultasCnpj, conversasEmitente,
    cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa, meta,
  }
}

export type { Colecao, Tabela }
