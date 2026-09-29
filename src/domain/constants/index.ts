/**
 * Constantes de domínio — valores fixos compartilhados por toda a aplicação.
 * Espelham SPEC-LOGICA-NEGOCIO §1.1.
 */

/** Nome/versão do IndexedDB legado (paridade com a v1). */
export const DB_NAME = 'aurum_tax_ncm_v1'
/** Versão do IndexedDB. A v6 adiciona `reclassificacoesManuais` (NCM → regra do usuário). */
export const DB_VERSION = 6

/** Itens por página nas listagens. */
export const PAGE_SIZE = 10

/** Chave de sessão da empresa ativa no localStorage. */
export const SESSION_KEY = 'aurum_empresa_ativa_id'

/** Chave do tema no localStorage (`dark` | `light`). */
export const TEMA_KEY = 'tema'

/** Banner de "modo visualização" dispensado por sessão. */
export const BANNER_KEY = 'banner_dismissed'

/** Alíquotas de referência padrão de IBS/CBS (%). */
export const REF_DEFAULT = { IBS: 17.7, CBS: 8.8 } as const

/** Limite de linhas das tabelas de dados (SPED/lote). */
export const ROWS_LIMIT = 200

/** Máximo de sugestões nos diferentes combo-box. */
export const SUGGEST_LIMITS = {
  consulta: 15,
  formulario: 20,
  buscaNomenclatura: 30,
  calcProdutos: 8,
  calcNcm: 5,
} as const

/** Totais de renderização por painel. */
export const RENDER_LIMITS = {
  aliquotaZero: 50,
  topProdutos: 15,
  nomenclaturaPorCapitulo: 50,
  rotuloNcm: 30,
} as const

/** Documentos fiscais suportados pela tabela de CST. */
export const DOCUMENTOS = [
  'NFe',
  'NFCe',
  'CTe',
  'CTeOS',
  'BPe',
  'BPeTM',
  'NF3e',
  'NFCom',
  'NFSe',
] as const

export type Documento = (typeof DOCUMENTOS)[number]

/** Nomes de object stores (SPEC §1.2). */
export const STORES = {
  NCM: 'ncm',
  NBS: 'nbs',
  CST: 'cst',
  CSTCT: 'cstClassTrib',
  REFERENCIA: 'referencia',
  NCMNOM: 'ncmNomenclatura',
  EMPRESAS: 'empresas',
  PRODUTOS: 'produtos',
  META: 'meta',
  CFOP: 'cfop',
  CSTICMS: 'cstIcms',
  CSTPISCOFINS: 'cstPisCofins',
  NFENOTAS: 'nfeNotas',
  RECLASS: 'reclassificacoesManuais',
} as const

export type StoreName = (typeof STORES)[keyof typeof STORES]

/** Chaves da store `meta`. */
export const META_KEYS = {
  EMITENTE: 'emitente',
  SEED: 'seed_v2_done',
  IMPORTACAO: 'importacao',
  IMPORTACAO_NOMENCLATURA: 'importacao_nomenclatura',
} as const

/** Par de CST/cClassTrib da regra geral. */
export const REGRA_GERAL = { cst: '000', cClassTrib: '000001' } as const

/** Linha da legislação de referência. */
export const LINK_LC214 = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'

/** Decreto nº 12.955/2026 — regulamenta a CBS. */
export const LINK_DECRETO_12955 =
  'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm'

/** Resolução CGIBS nº 6/2026 — regulamenta o IBS (PDF oficial). */
export const LINK_RES_CGIBS_6 =
  'https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf'

/** Portal da Conformidade Fácil (CFF). */
export const LINK_PORTAL_CFF = 'https://dfe-portal.svrs.rs.gov.br/Cff'
