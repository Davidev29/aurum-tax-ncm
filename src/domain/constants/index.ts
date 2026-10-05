/**
 * Constantes de domínio — valores fixos compartilhados por toda a aplicação.
 * Espelham SPEC-LOGICA-NEGOCIO §1.1.
 */

/** Nome/versão do IndexedDB legado (paridade com a v1). */
export const DB_NAME = 'aurum_tax_ncm_v1'
/** Versão do IndexedDB. A v10 adiciona `anexos` + `produtos_dfe` (formatos reais CFF). */
export const DB_VERSION = 12

/** Itens por página nas listagens. */
export const PAGE_SIZE = 10

/** Chave de sessão da empresa ativa no localStorage. */
export const SESSION_KEY = 'aurum_empresa_ativa_id'

/** Chave do tema no localStorage (`dark` | `light`). */
export const TEMA_KEY = 'tema'

/** Banner de "modo visualização" dispensado por sessão. */
export const BANNER_KEY = 'banner_dismissed'

/** Alíquotas de referência padrão de IBS/CBS (%). */
export const REF_DEFAULT = { IBS: 19, CBS: 9 } as const

/**
 * Proveniência das alíquotas de referência.
 *
 * Parâmetro legal móvel: estes percentuais DEVEM ser confrontados com o ato
 * vigente (LC 214/2025 e regulamentação) antes de cada entrega fiscal — o
 * valor histórico da SPEC era 17.70/8.80 (total 26.5%). Todo cálculo do
 * sistema usa este ponto único (stores + relatórios), e a tela Calculadora
 * permite editar por sessão; aqui fica o carimbo exibido na UI.
 */
export const REF_FONTE = {
  fonte: 'Parâmetro editável — confirmar contra o ato vigente (LC 214/2025 e regulamentação)',
  soma: 28,
} as const

/** Limite de linhas das tabelas de dados (SPED/lote). */
export const ROWS_LIMIT = 200

/** Máximo de sugestões nos diferentes combo-box. */
export const SUGGEST_LIMITS = {
  consulta: 15,
  formulario: 20,
  buscaNomenclatura: 30,
  buscaTexto: 30,
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
  CLASSPROD: 'classificacaoProduto',
  /** Anexos por NCM/NBS (CFF `anexos`, formato real). */
  ANEXOS: 'anexos',
  /** Catálogo de produtos por DFe (CFF `ConsultaClassificacaoProduto`, formato real). */
  PRODUTOSDFE: 'produtosDfe',
  AUDIT: 'audit_log',
  CEST: 'cest',
  /** Feedback "Não é esse" da Sugestão IA (Phase 6 / 06-06, Dexie v9). */
  IAFEEDBACK: 'ia_feedback',
  /** CNAE × Anexo Simples + Fator R (Phase 7, arquivo vivo `CNAE X ANEXO.json`). */
  CNAE: 'cnae',
  /** Cache de consultas por CNPJ (Phase 7, BrasilAPI + TTL 30 dias). */
  CONSULTAS_CNPJ: 'consultasCnpj',
  /** Conversas da Aurum AI por emitente (Phase 8, memória longo prazo). */
  CONVERSAS_EMITENTE: 'conversasEmitente',
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

/**
 * Regra geral dos SERVIÇOS (Phase 7): mesmo par da regra geral de bens —
 * tributação integral (alíquota cheia) quando o NBS não tem vínculo na base.
 * Alias explícito para que a tela Serviços nunca importe semântica de NCM.
 */
export const REGRA_GERAL_NBS = { cst: '000', cClassTrib: '000001' } as const

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

/** Emenda Constitucional nº 132/2023 — base constitucional da Reforma. */
export const LINK_EC132 =
  'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm'

/** Lei Complementar nº 227/2026 — altera a LC 214/2025. */
export const LINK_LC227 = 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm'

/**
 * Índice oficial de decretos federais (Portal da Legislação — Planalto).
 * Ponto de partida passado pelo usuário para navegar por todos os decretos.
 */
export const LINK_PORTAL_DECRETOS_PLANALTO =
  'https://www4.planalto.gov.br/legislacao/portal-legis/legislacao-1/decretos1/decretos-1'

/** Receita Federal — página oficial da legislação da Reforma do Consumo. */
export const LINK_RFB_LEGISLACAO_REFORMA =
  'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/legislacao'

/**
 * Portal SEFAZLEGIS — legislação tributária do Estado do Ceará
 * (decretos do RICMS, leis estaduais, normas de execução).
 */
export const LINK_SEFAZLEGIS_CE = 'https://sefazlegis.sefaz.ce.gov.br/portal#/'

/** SEFAZ-CE — página de legislação tributária e informativos quinzenais. */
export const LINK_SEFAZCE_LEGISLACAO = 'https://www.ce.gov.br/sefaz/legislacao-tributaria'

/** Re-exporta constantes da API CFF */
export * from './cff-apis'
