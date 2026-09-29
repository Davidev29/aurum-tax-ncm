/**
 * Endpoints da Conformidade Fácil (CFF) — Produção
 * Fonte: https://dfe-portal.svrs.rs.gov.br/Cff
 *
 * Estes são os endpoints oficiais para consulta de classificação tributária,
 * crédito presumido, anexos, indicadores de locais de operação e
 * tabelas de classificação de produtos (NFCom, NFAg, NF3e, NFGas).
 */

export const CFF_API_BASE = 'https://cff.svrs.rs.gov.br/api/v1/consultas'

export interface CffEndpoint {
  servico: string
  versao: string
  url: string
  descricao: string
  // Chave usada no banco local para armazenar metadados da última sincronização
  metaKey: string
  // Nome do arquivo JSON que seria gerado localmente (para referência)
  arquivoLocal: string
}

export const CFF_ENDPOINTS: CffEndpoint[] = [
  {
    servico: 'Classificação Tributária',
    versao: '1.00',
    url: `${CFF_API_BASE}/classTrib`,
    descricao: 'Referência oficial de CST × cClassTrib (LC 214/2025)',
    metaKey: 'cff_sync_classTrib',
    arquivoLocal: 'classificacao-tributaria.json',
  },
  {
    servico: 'Crédito Presumido',
    versao: '1.00',
    url: `${CFF_API_BASE}/credPresumido`,
    descricao: 'Regras de crédito presumido IBS/CBS',
    metaKey: 'cff_sync_credPresumido',
    arquivoLocal: 'credito-presumido.json',
  },
  {
    servico: 'Anexos',
    versao: '1.00',
    url: `${CFF_API_BASE}/anexos`,
    descricao: 'Anexos da LC 214 (alíquotas zero, reduções, diferimentos)',
    metaKey: 'cff_sync_anexos',
    arquivoLocal: 'anexos.json',
  },
  {
    servico: 'Indicadores dos Locais de Operação',
    versao: '1.00',
    url: `${CFF_API_BASE}/indOper`,
    descricao: 'Indicadores de operação por UF/local',
    metaKey: 'cff_sync_indOper',
    arquivoLocal: 'ind-oper.json',
  },
  {
    servico: 'Tabela de Classificação de Produtos NFCom',
    versao: '1.00',
    url: `${CFF_API_BASE}/ConsultaClassificacaoProduto?sistema=NFCom`,
    descricao: 'Classificação de produtos para NFCom',
    metaKey: 'cff_sync_classProd_NFCom',
    arquivoLocal: 'classificacao-produto-nfcom.json',
  },
  {
    servico: 'Tabela de Classificação de Produtos NFAg',
    versao: '1.00',
    url: `${CFF_API_BASE}/ConsultaClassificacaoProduto?sistema=NFAg`,
    descricao: 'Classificação de produtos para NFAg',
    metaKey: 'cff_sync_classProd_NFAg',
    arquivoLocal: 'classificacao-produto-nfag.json',
  },
  {
    servico: 'Tabela de Classificação de Produtos NF3e',
    versao: '1.00',
    url: `${CFF_API_BASE}/ConsultaClassificacaoProduto?sistema=NF3e`,
    descricao: 'Classificação de produtos para NF3e',
    metaKey: 'cff_sync_classProd_NF3e',
    arquivoLocal: 'classificacao-produto-nf3e.json',
  },
  {
    servico: 'Tabela de Classificação de Produtos NFGas',
    versao: '1.00',
    url: `${CFF_API_BASE}/ConsultaClassificacaoProduto?sistema=NFGas`,
    descricao: 'Classificação de produtos para NFGas',
    metaKey: 'cff_sync_classProd_NFGas',
    arquivoLocal: 'classificacao-produto-nfgas.json',
  },
]

/** Mapeamento rápido por metaKey para lookup */
export const CFF_ENDPOINTS_BY_KEY: Record<string, CffEndpoint> = Object.fromEntries(
  CFF_ENDPOINTS.map((e) => [e.metaKey, e]),
)

/** Sistemas da ConsultaClassificacaoProduto CFF (tabelas por DFe). */
export const SISTEMAS_CFF = ['NFCom', 'NFAg', 'NF3e', 'NFGas'] as const

export type SistemaCff = (typeof SISTEMAS_CFF)[number]

/** Extrai o sistema (`NFCom|NFAg|NF3e|NFGas`) da URL/metaKey do endpoint. */
export const sistemaDoEndpoint = (url: string, metaKey: string): string | null => {
  const m = /sistema=([A-Za-z0-9]+)/.exec(url) ?? /classProd_([A-Za-z0-9]+)/.exec(metaKey)
  const s = m?.[1] ?? null
  return s && (SISTEMAS_CFF as readonly string[]).includes(s) ? s : null
}

/** Configuração do comportamento de sincronização */
export const CFF_SYNC_CONFIG = {
  /** Intervalo mínimo entre verificações (ms) — padrão: 24 horas */
  intervaloMinimo: 24 * 60 * 60 * 1000,
  /** Timeout por requisição (ms) */
  timeout: 30_000,
  /** User-Agent enviado nas requisições */
  userAgent: 'AurumTaxNCM/1.0 (sincronização CFF)',
  /** Se true, faz a verificação em background sem bloquear a UI */
  background: true,
  /** Máximo de tentativas em caso de falha de rede */
  maxTentativas: 3,
  /** Delay entre tentativas (ms) */
  retryDelay: 5_000,
} as const

/** Chaves de metadados usadas na store `meta` do IndexedDB */
export const CFF_META_KEYS = {
  ULTIMA_VERIFICACAO: 'cff_ultima_verificacao',
  VERSAO_BASE: 'cff_versao_base',
  STATUS_SINC: 'cff_status_sincronizacao',
} as const