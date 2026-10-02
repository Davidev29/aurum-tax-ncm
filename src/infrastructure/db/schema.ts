import Dexie, { type Table, type Transaction } from 'dexie'
import {
  DB_NAME,
  DB_VERSION,
  STORES,
} from '@/domain/constants'
import type {
  AnexoNcm,
  AuditLog,
  ClassificacaoProdutoSistema,
  Empresa,
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
      })
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
  const [
    ncm, nbs, cst, cstClassTrib, referencia, ncmNomenclatura, empresas, produtos,
    cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, auditLog, cest, iaFeedback,
    anexos, produtosDfe,
  ] = await Promise.all([
    db.ncm.count(),
    db.nbs.count(),
    db.cst.count(),
    db.cstClassTrib.count(),
    db.referencia.count(),
    db.ncmNomenclatura.count(),
    db.empresas.count(),
    db.produtos.count(),
    db.cfop.count(),
    db.cstIcms.count(),
    db.cstPisCofins.count(),
    db.nfeNotas.count(),
    db.reclassificacoesManuais.count(),
    db.classificacaoProduto.count(),
    db.auditLog.count().catch(() => 0),
    db.cest.count().catch(() => 0),
    db.iaFeedback.count().catch(() => 0),
    db.anexos.count().catch(() => 0),
    db.produtosDfe.count().catch(() => 0),
  ])
  return {
    ncm, nbs, cst, cstClassTrib, referencia, ncmNomenclatura, empresas, produtos,
    cfop, cstIcms, cstPisCofins, nfeNotas, reclassificacoesManuais, classificacaoProduto, auditLog, cest, iaFeedback,
    anexos, produtosDfe,
  }
}
