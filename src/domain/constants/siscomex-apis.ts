/**
 * Fonte oficial da NCM vigente — Portal Único Siscomex (módulo Classif).
 *
 * A página `https://portalunico.siscomex.gov.br/classif/#/nomenclatura/tabela`
 * é um SPA; o dado que ela exibe vem do endpoint público abaixo (sem Captcha,
 * sem certificado — cf. página "Download NCM" da Receita Federal). O arquivo
 * é regenerado toda meia-noite e contém **apenas a tabela vigente**.
 *
 * URLs `blob:` que o navegador gera ao baixar o arquivo são temporárias da
 * sessão e não servem para atualização automática — o sistema consulta sempre
 * o endpoint público.
 */

export const SISCOMEX_NCM_URL =
  'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json'

/**
 * Variações do endpoint tentadas em ordem (fallback automático).
 * Ambas são oficiais e retornam o mesmo JSON; se a primeira falhar por
 * rede/proxy, a segunda é tentada antes de desistir.
 */
export const SISCOMEX_NCM_URLS = [
  SISCOMEX_NCM_URL,
  `${SISCOMEX_NCM_URL}?perfil=PUBLICO`,
] as const

export const SISCOMEX_PORTAL_URL = 'https://portalunico.siscomex.gov.br/classif/'

/** Chave de metadados da sincronização no SQLite (store `meta`). */
export const SISCOMEX_NCM_META_KEY = 'siscomex_ncm_sync'

/** Comportamento da sincronização (respeito ao rate-limit do Portal Único). */
export const SISCOMEX_SYNC_CONFIG = {
  /** Intervalo mínimo entre verificações (ms) — padrão: 24 horas */
  intervaloMinimo: 24 * 60 * 60 * 1000,
  /** Timeout por tentativa (ms) — o arquivo tem ~3 MB */
  timeout: 90_000,
  /** Timeout do diagnóstico de conexão (ms) — rápido para não travar a UI */
  timeoutDiagnostico: 20_000,
  /** User-Agent enviado nas requisições */
  userAgent: 'AurumTaxNCM/1.0 (sincronização NCM Siscomex)',
  /** Rodadas de tentativa no total (URLs × repetição; gentil: o portal limita taxa) */
  maxTentativas: 3,
  /** Delay entre tentativas (ms) */
  retryDelay: 10_000,
} as const
