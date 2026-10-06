import Dexie, { type Table, type Transaction } from 'dexie'
import {
  DB_NAME,
  DB_VERSION,
  STORES,
} from '@/domain/constants'
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
import { buildDocs, toBool, toNum } from '../base/normalizacao'

/** Feedback "Não é esse" da Sugestão IA (Phase 6 / 06-06, Dexie v9). */
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

/** Conversa da Aurum AI gravada no perfil do emitente (Phase 8 / 08-05).
 * Chaveada por emitenteId (nunca pela empresa ativa): a mesma conversa
 * segue visível indiferente do cliente/empresa logado. */
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

/**
 * Metadados do grafo fiscal local (Phase 10-01 / GRAFO-01, Dexie v14).
 * Espelha `public/base/grafo/MANIFEST.grafo.json`: o grafo é índice
 * derivado, então aqui vive só o carimbo (hash/versão/contadores) —
 * os nós/arestas ficam no `.lbug` lido pelo worker IA (10-02).
 */
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
/* Migração v2 → v3                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Registro cru gravado pela versão legada (`index.html`, `DB_VERSION = 2`).
 *
 * A v1 persistia os indicadores com os nomes do JSON de origem
 * (`ind_gIBSCBS`, `ind_RedutorBC`, …) e gravava `docs` com os valores crus do
 * arquivo (`'Sim'`/`'Não'`/`1`), enquanto o schema atual usa nomes canônicos
 * e booleanos. Como o banco legado usa os **mesmos keyPaths**, o Dexie apenas
 * acrescenta os índices novos sem perder dados — e esta migração normaliza o
 * conteúdo linha a linha.
 */
type Registro = Record<string, unknown>

const presente = (v: unknown): boolean => v !== undefined && v !== null

/** Copia o campo legado para o nome novo apenas quando o novo não existe. */
function renomear(
  reg: Registro,
  legado: string,
  novo: string,
  converter: (v: unknown) => unknown,
): void {
  if (!presente(reg[novo])) reg[novo] = converter(reg[legado])
}

const textoOuNulo = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s ? s : null
}

function migrarCstLegado(reg: Registro): Registro {
  renomear(reg, 'ind_gIBSCBS', 'indIBSCBS', toBool)
  renomear(reg, 'ind_gIBSCBSMono', 'indIBSCBSMono', toBool)
  renomear(reg, 'ind_gRed', 'indReducao', toBool)
  renomear(reg, 'ind_gDif', 'indDiferimento', toBool)
  renomear(reg, 'ind_gTransfCred', 'indTransferenciaCredito', toBool)
  for (const k of [
    'indIBSCBS',
    'indIBSCBSMono',
    'indReducao',
    'indDiferimento',
    'indTransferenciaCredito',
  ]) {
    reg[k] = toBool(reg[k])
  }
  reg.descricao = String(reg.descricao ?? '')
  reg.docs = buildDocs((reg.docs ?? null) as Registro | null)
  for (const k of [
    'ind_gIBSCBS',
    'ind_gIBSCBSMono',
    'ind_gRed',
    'ind_gDif',
    'ind_gTransfCred',
  ]) {
    delete reg[k]
  }
  return reg
}

function migrarCstClassTribLegado(reg: Registro): Registro {
  renomear(reg, 'ind_RedutorBC', 'indRedutorBC', toNum)
  renomear(reg, 'ind_gTribRegular', 'indTribRegular', toNum)
  renomear(reg, 'ind_CredPres', 'indCredPres', toNum)
  for (const k of [
    'pRedIBS',
    'pRedCBS',
    'indRedutorBC',
    'indTribRegular',
    'indCredPres',
    'indMono',
    'indMonoReten',
    'indMonoRet',
    'indMonoDif',
  ]) {
    reg[k] = toNum(reg[k])
  }
  for (const k of [
    'lcRedacao',
    'lcRef',
    'tipoAliquota',
    'creditoPara',
    'inicioVigencia',
    'fimVigencia',
    'atualizadoEm',
  ]) {
    reg[k] = textoOuNulo(reg[k])
  }
  reg.nome = String(reg.nome ?? '')
  reg.descricao = String(reg.descricao ?? '')
  for (const k of ['ind_RedutorBC', 'ind_gTribRegular', 'ind_CredPres', 'descricaoCst', 'LC 214/25']) {
    delete reg[k]
  }
  return reg
}

function migrarNcmLegado(reg: Registro): Registro {
  for (const k of ['reducao', 'aliquotaIBS', 'aliquotaCBS']) reg[k] = toNum(reg[k])
  if (!presente(reg.documentos)) reg.documentos = ''
  reg.descricao = String(reg.descricao ?? '')
  reg.baseLegal = String(reg.baseLegal ?? '')
  // Detalhes pré-normalização: hoje são reconstruídos pelo join 3NF.
  for (const k of ['cstDetalhes', 'cstClassTribDetalhes', 'referencia', 'resumo']) delete reg[k]
  return reg
}

/**
 * Normaliza as linhas gravadas pela versão 2 do banco (SPEC §1.2).
 * Idempotente: só age sobre campos legados que ainda não foram renomeados.
 */
export async function migrarBancoLegado(trans: Transaction): Promise<void> {
  const regras: Array<[string, (r: Registro) => Registro]> = [
    [STORES.CST, migrarCstLegado],
    [STORES.CSTCT, migrarCstClassTribLegado],
    [STORES.NCM, migrarNcmLegado],
  ]
  for (const [tabela, regra] of regras) {
    const linhas = await trans.table<Registro>(tabela).toArray()
    const migradas = linhas.map(regra)
    await trans.table<Registro>(tabela).bulkPut(migradas)
  }
}

/**
 * Base de dados local (Dexie/IndexedDB).
 *
 * Mantém os **mesmos nomes de object store** da v1 (SPEC §1.2) para que
 * backups e a lógica de importação continuem válidos, mas o schema é declarado
 * de forma tipada e com índices explícitos para as buscas do núcleo.
 */
export class AurumDatabase extends Dexie {
  ncm!: Table<VinculoNcm, string>
  nbs!: Table<VinculoNbs, string>
  cst!: Table<TabelaCst, string>
  cstClassTrib!: Table<TabelaCstClassTrib, string>
  referencia!: Table<ReferenciaCClassTrib, string>
  ncmNomenclatura!: Table<NomenclaturaNcm, string>
  empresas!: Table<Empresa, number>
  produtos!: Table<Produto, number>
  meta!: Table<MetaRecord, string>
  cfop!: Table<TabelaAuxiliarSimples, string>
  cstIcms!: Table<TabelaAuxiliarSimples, string>
  cstPisCofins!: Table<TabelaAuxiliarSimples, string>

  /** Notas fiscais importadas de XML (itens + análise embutidos). */
  nfeNotas!: Table<NotaXml, number>

  /** Reclassificações manuais do usuário por NCM (keyPath `ncm`). */
  reclassificacoesManuais!: Table<ReclassificacaoManual, string>

  /** Classificação de Produtos por DFe (CFF — permitido × negado por sistema). */
  classificacaoProduto!: Table<ClassificacaoProdutoSistema, string>

  /** Anexos por NCM/NBS (CFF `anexos`, formato real da API). */
  anexos!: Table<AnexoNcm, string>

  /** Catálogo de produtos por DFe (CFF `ConsultaClassificacaoProduto`, formato real). */
  produtosDfe!: Table<ProdutoDfe, string>

  /** Log imutável de auditoria (append-only, nunca atualizado pela UI). */
  auditLog!: Table<AuditLog, number>

  /** CEST — tabela informativa (7 dígitos, opcional por produto). */
  cest!: Table<TabelaCest, string>

  /** Feedback "Não é esse" da Sugestão IA (Dexie v9, Phase 6 / 06-06). */
  iaFeedback!: Table<IaFeedback, number>

  /** CNAE × Anexo Simples (Phase 7, arquivo vivo). */
  cnae!: Table<CnaeAnexo, string>

  /** Cache de consultas por CNPJ (Phase 7, BrasilAPI + TTL). */
  consultasCnpj!: Table<ConsultaCnpj, string>
  conversasEmitente!: Table<ConversaEmitente, string>

  /** Links CNAE → NBS da fonte ponte (Phase 9, Dexie v13). */
  cnaeNbs!: Table<CnaeNbsLink, number>
  /** Relações LC 116 → NBS da fonte ponte (Phase 9, Dexie v13). */
  lcNbs!: Table<LcNbsRelation, number>
  /** Templates consolidados por CNAE (Phase 9, Dexie v13, keyPath `cnae7`). */
  classificacoesConsolidadas!: Table<ClassificacaoConsolidada, string>

  /** Carimbo do grafo fiscal local (Phase 10-01, Dexie v14, keyPath `id`). */
  grafometa!: Table<GrafoMeta, string>

  constructor() {
    super(DB_NAME)
    // v6: schema anterior (sem `classificacaoProduto`). Mantido para a
    // migração de bancos legados não perder dados ao subir para a v7.
    this.version(6)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
      })
      .upgrade((trans) => migrarBancoLegado(trans))
    // v8 congelada (Phase 5): sem `ia_feedback`. Mantida para que bancos
    // já em v8 migrem para v9 sem perder `audit_log`/`reclassificacoesManuais`.
    this.version(8).stores({
      [STORES.NCM]: 'id, codigo, cst, cClassTrib',
      [STORES.NBS]: 'id, codigo, cClassTrib',
      [STORES.CST]: 'codigo',
      [STORES.CSTCT]: 'id, cst, cClassTrib',
      [STORES.REFERENCIA]: 'id, cst, cClassTrib',
      [STORES.NCMNOM]: 'codigo, descricao',
      [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
      [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
      [STORES.META]: 'chave',
      [STORES.CFOP]: 'codigo',
      [STORES.CSTICMS]: 'codigo',
      [STORES.CSTPISCOFINS]: 'codigo',
      [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
      [STORES.RECLASS]: 'ncm',
      [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
      [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
      [STORES.CEST]: 'codigo, ncm',
    })
    // v9 (Phase 6 / 06-06): adiciona `ia_feedback`; demais stores intactas.
    // Congelada: bancos em v9 sobem para v10 sem perder dados.
    this.version(9)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
      })
    // v10 (bases CFF reais): adiciona `anexos` + `produtosDfe`; demais intactas.
    // Congelada: bancos em v10 sobem para v11 sem perder dados.
    this.version(10)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
        [STORES.ANEXOS]: 'id, codigo, nroAnexo',
        [STORES.PRODUTOSDFE]: 'id, sistema, codClassProd',
      })
    // v11 (Phase 7 Serviços): adiciona `cnae` + `consultasCnpj`; demais intactas.
    this.version(11)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
        [STORES.ANEXOS]: 'id, codigo, nroAnexo',
        [STORES.PRODUTOSDFE]: 'id, sistema, codClassProd',
        [STORES.CNAE]: 'codigo7, descricao',
        [STORES.CONSULTAS_CNPJ]: 'cnpj',
      })
    // v12 (Phase 8 / 08-05): adiciona `conversasEmitente`; demais intactas.
    // Congelada: bancos em v12 sobem para v13 sem perder dados.
    this.version(12)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cst, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
        [STORES.ANEXOS]: 'id, codigo, nroAnexo',
        [STORES.PRODUTOSDFE]: 'id, sistema, codClassProd',
        [STORES.CNAE]: 'codigo7, descricao',
        [STORES.CONSULTAS_CNPJ]: 'cnpj',
        [STORES.CONVERSAS_EMITENTE]: 'conversaId, emitenteId, updatedAt',
      })
    // v13 (Phase 9 / 09-01): adiciona `cnaeNbs` + `lcNbs` +
    // `classificacoesConsolidadas` (ponte CNAE → NBS); demais intactas.
    // Congelada: bancos em v13 sobem para v14 sem perder dados.
    // Migração aditiva: nenhum `clear()`, nenhum dado existente é tocado.
    this.version(13)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
        [STORES.ANEXOS]: 'id, codigo, nroAnexo',
        [STORES.PRODUTOSDFE]: 'id, sistema, codClassProd',
        [STORES.CNAE]: 'codigo7, descricao',
        [STORES.CONSULTAS_CNPJ]: 'cnpj',
        [STORES.CONVERSAS_EMITENTE]: 'conversaId, emitenteId, updatedAt',
        [STORES.CNAE_NBS]: '++id, cnae7, nbs, [cnae7+nbs]',
        [STORES.LC_NBS]: '++id, lc, nbs, cct, [lc+nbs]',
        [STORES.CLASS_CONSOLIDADA]: 'cnae7',
      })
    // v14 (Phase 10 / 10-01): adiciona `grafometa` (carimbo do grafo
    // fiscal); demais intactas. Migração aditiva: nenhum `clear()`.
    this.version(DB_VERSION)
      .stores({
        [STORES.NCM]: 'id, codigo, cst, cClassTrib',
        [STORES.NBS]: 'id, codigo, cClassTrib',
        [STORES.CST]: 'codigo',
        [STORES.CSTCT]: 'id, cst, cClassTrib',
        [STORES.REFERENCIA]: 'id, cst, cClassTrib',
        [STORES.NCMNOM]: 'codigo, descricao',
        [STORES.EMPRESAS]: '++id, razaoSocial, cnpj',
        [STORES.PRODUTOS]: '++id, empresaId, ncm, codigo, cstReforma',
        [STORES.META]: 'chave',
        [STORES.CFOP]: 'codigo',
        [STORES.CSTICMS]: 'codigo',
        [STORES.CSTPISCOFINS]: 'codigo',
        [STORES.NFENOTAS]: '++id, empresaId, dataEmissao, direcao, emitCnpj, chave, &[empresaId+chave]',
        [STORES.RECLASS]: 'ncm',
        [STORES.CLASSPROD]: 'id, sistema, cClassTrib',
        [STORES.AUDIT]: '++id, quando, tabela, chave, autor',
        [STORES.CEST]: 'codigo, ncm',
        [STORES.IAFEEDBACK]: '++id, quando, via, decisao',
        [STORES.ANEXOS]: 'id, codigo, nroAnexo',
        [STORES.PRODUTOSDFE]: 'id, sistema, codClassProd',
        [STORES.CNAE]: 'codigo7, descricao',
        [STORES.CONSULTAS_CNPJ]: 'cnpj',
        [STORES.CONVERSAS_EMITENTE]: 'conversaId, emitenteId, updatedAt',
        [STORES.CNAE_NBS]: '++id, cnae7, nbs, [cnae7+nbs]',
        [STORES.LC_NBS]: '++id, lc, nbs, cct, [lc+nbs]',
        [STORES.CLASS_CONSOLIDADA]: 'cnae7',
        [STORES.GRAFOMETA]: 'id, hash, versao',
      })
    // Aliases snake_case -> camelCase (Dexie injeta this[storeName]).
    this.auditLog ??= this.table(STORES.AUDIT) as unknown as typeof this.auditLog
    this.iaFeedback ??= this.table(STORES.IAFEEDBACK) as unknown as typeof this.iaFeedback
  }
}

export const db = new AurumDatabase()

/* -------------------------------------------------------------------------- */
/* Helpers tipados                                                             */
/* -------------------------------------------------------------------------- */

/** Grava em lotes de 500, reportando progresso (SPEC R1.5). */
export async function bulkPut<T, K>(
  tabela: Table<T, K>,
  itens: T[],
  onProgress?: (feito: number, total: number) => void,
): Promise<void> {
  const TAM = 500
  const total = itens.length
  for (let i = 0; i < total; i += TAM) {
    await tabela.bulkPut(itens.slice(i, i + TAM) as never[])
    onProgress?.(Math.min(i + TAM, total), total)
  }
}

export async function contarTodos(): Promise<Record<string, number>> {
  // Leitura defensiva: `db.table(nome)` funciona mesmo quando o alias
  // camelCase não existe (stores snake_case) ou o banco ainda não abriu.
  // Nunca rejeita — tabela ausente/fechada conta como 0.
  const contar = (nome: string): Promise<number> => {
    try {
      if (!db.isOpen()) return Promise.resolve(0)
      const t = db.table(nome)
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
    cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa,
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
  ])
  return {
    ncm, nbs, cst, cstClassTrib, referencia, ncmNomenclatura, empresas, produtos,
    cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, auditLog, cest, iaFeedback,
    anexos, produtosDfe, cnae, consultasCnpj, conversasEmitente,
    cnaeNbs, lcNbs, classificacoesConsolidadas, grafometa,
  }
}
