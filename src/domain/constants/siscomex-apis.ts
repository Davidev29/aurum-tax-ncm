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

export const SISCOMEX_PORTAL_URL = 'https://portalunico.siscomex.gov.br/classif/'

/** Chave de metadados da sincronização no IndexedDB (store `meta`). */
export const SISCOMEX_NCM_META_KEY = 'siscomex_ncm_sync'

/** Comportamento da sincronização (respeito ao rate-limit do Portal Único). */
export const SISCOMEX_SYNC_CONFIG = {
  /** Intervalo mínimo entre verificações (ms) — padrão: 24 horas */
  intervaloMinimo: 24 * 60 * 60 * 1000,
  /** Timeout por tentativa (ms) — o arquivo tem ~3 MB */
  timeout: 90_000,
  /** User-Agent enviado nas requisições */
  userAgent: 'AurumTaxNCM/1.0 (sincronização NCM Siscomex)',
  /** Máximo de tentativas em caso de falha de rede (poucas: o portal limita taxa) */
  maxTentativas: 2,
  /** Delay entre tentativas (ms) */
  retryDelay: 10_000,
} as const
