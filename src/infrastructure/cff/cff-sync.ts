/**
 * Serviço de sincronização com a API Conformidade Fácil (CFF).
 *
 * Responsabilidades:
 * - Verificar periodicamente se há atualizações nos endpoints CFF
 * - Baixar e normalizar os dados
 * - Atualizar o IndexedDB local quando houver mudanças
 * - Gerenciar metadados de sincronização (timestamps, hashes, versões)
 */

import { db } from '../db/schema'
import type { Table } from 'dexie'
import {
  CFF_ENDPOINTS,
  CFF_SYNC_CONFIG,
  CFF_META_KEYS,
  sistemaDoEndpoint,
  type CffEndpoint,
} from '@/domain/constants/cff-apis'
import { normalizarClassificacaoProduto, normalizarReferencia } from '../base/normalizacao'
import type { ClassificacaoProdutoSistema, ReferenciaCClassTrib } from '@/domain/entities'

/** Resultado de uma verificação/sincronização de um endpoint */
export interface SyncResultado {
  endpoint: CffEndpoint
  status: 'atualizado' | 'inalterado' | 'erro' | 'ignorado' | 'certificado'
  mensagem: string
  registros?: number
  hashAnterior?: string
  hashNovo?: string
  duracaoMs: number
}

/** Erro de autenticação mTLS — endpoint exige certificado digital ICP-Brasil. */
export class ErroCertificadoCff extends Error {
  readonly httpStatus: number
  constructor(httpStatus: number) {
    super(
      `Endpoint exige certificado digital ICP-Brasil (HTTP ${httpStatus}). ` +
        'Baixe o JSON no portal da Conformidade Fácil com o certificado e importe manualmente.',
    )
    this.name = 'ErroCertificadoCff'
    this.httpStatus = httpStatus
  }
}

export const ehErroCertificado = (e: unknown): boolean =>
  e instanceof ErroCertificadoCff || /certificado digital/i.test(e instanceof Error ? e.message : String(e))

/** Metadados de sincronização armazenados no banco */
export interface CffSyncMeta {
  chave: string
  valor: {
    ultimaVerificacao: string
    hash?: string
    etag?: string
    lastModified?: string
    totalRegistros?: number
    versao?: string
  }
  quando: string
}

/**
 * Calcula hash SHA-256 de uma string (para detectar mudanças no conteúdo)
 */
async function calcularHash(conteudo: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(conteudo)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Faz uma requisição HTTP com timeout e retry
 */
async function fetchComRetry(
  url: string,
  opcoes: RequestInit = {},
  tentativas = CFF_SYNC_CONFIG.maxTentativas,
): Promise<Response> {
  let ultimoErro: Error | null = null

  for (let i = 0; i < tentativas; i++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), CFF_SYNC_CONFIG.timeout)

    try {
      const resposta = await fetch(url, {
        ...opcoes,
        signal: controller.signal,
        headers: {
          'User-Agent': CFF_SYNC_CONFIG.userAgent,
          Accept: 'application/json',
          ...opcoes.headers,
        },
      })
      clearTimeout(timeoutId)
      return resposta
    } catch (erro) {
      clearTimeout(timeoutId)
      ultimoErro = erro instanceof Error ? erro : new Error(String(erro))

      if (i < tentativas - 1) {
        await new Promise((r) => setTimeout(r, CFF_SYNC_CONFIG.retryDelay))
      }
    }
  }

  throw ultimoErro ?? new Error('Falha na requisição após todas as tentativas')
}

/**
 * Verifica se deve sincronizar baseado no intervalo mínimo
 */
export async function deveSincronizar(): Promise<boolean> {
  const meta = await db.meta.get(CFF_META_KEYS.ULTIMA_VERIFICACAO)
  if (!meta?.valor) return true

  const valor = meta.valor as Record<string, unknown>
  const ultimaVerificacao = new Date(valor.ultimaVerificacao as string).getTime()
  const agora = Date.now()
  return agora - ultimaVerificacao >= CFF_SYNC_CONFIG.intervaloMinimo
}

/**
 * Atualiza o timestamp da última verificação
 */
export async function registrarVerificacao(): Promise<void> {
  await db.meta.put({
    chave: CFF_META_KEYS.ULTIMA_VERIFICACAO,
    valor: { ultimaVerificacao: new Date().toISOString() },
    quando: new Date().toISOString(),
  })
}

/**
 * Busca dados de um endpoint CFF
 */
export async function buscarEndpoint(endpoint: CffEndpoint): Promise<{
  dados: unknown
  hash: string
  etag?: string
  lastModified?: string
}> {
  const resposta = await fetchComRetry(endpoint.url)

  if (resposta.status === 401 || resposta.status === 403) {
    throw new ErroCertificadoCff(resposta.status)
  }

  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${resposta.statusText}`)
  }

  const texto = await resposta.text()
  const hash = await calcularHash(texto)
  const dados = JSON.parse(texto)

  return {
    dados,
    hash,
    etag: resposta.headers.get('etag') ?? undefined,
    lastModified: resposta.headers.get('last-modified') ?? undefined,
  }
}

/**
 * Normaliza os dados da Classificação Tributária (endpoint principal)
 * Os outros endpoints têm estruturas diferentes e precisam de normalizadores próprios
 */
function normalizarClassificacaoTributaria(dados: unknown): ReferenciaCClassTrib[] {
  // A API retorna um array direto ou um objeto com propriedade 'itens'/'data'
  const array = Array.isArray(dados)
    ? dados
    : (dados as Record<string, unknown>)?.itens ??
      (dados as Record<string, unknown>)?.data ??
      []

  return normalizarReferencia(array)
}

/**
 * Atualiza a store de referência (cst × cClassTrib) no IndexedDB
 */
async function atualizarReferencia(
  itens: ReferenciaCClassTrib[],
  metaKey: string,
  hash: string,
  etag?: string,
  lastModified?: string,
): Promise<number> {
  await db.referencia.clear()
  await bulkPut(db.referencia, itens)

  await db.meta.put({
    chave: metaKey,
    valor: {
      ultimaVerificacao: new Date().toISOString(),
      hash,
      etag,
      lastModified,
      totalRegistros: itens.length,
    },
    quando: new Date().toISOString(),
  })

  return itens.length
}

/**
 * Atualiza a store de classificação de produtos de um sistema
 * (`classificacaoProduto`) — o "permitido × negado" por DFe.
 * Substitui integralmente as linhas do sistema (tabela oficial completa).
 */
async function atualizarClassificacaoProduto(
  itens: ClassificacaoProdutoSistema[],
  sistema: string,
  metaKey: string,
  hash: string,
  etag?: string,
  lastModified?: string,
): Promise<number> {
  await db.classificacaoProduto.where('sistema').equals(sistema).delete()
  await bulkPut(db.classificacaoProduto, itens)

  const negados = itens.filter((i) => i.permitido === false).length
  await db.meta.put({
    chave: metaKey,
    valor: {
      ultimaVerificacao: new Date().toISOString(),
      hash,
      etag,
      lastModified,
      totalRegistros: itens.length,
      totalNegados: negados,
      sistema,
      origem: 'cff-sync',
    },
    quando: new Date().toISOString(),
  })

  return itens.length
}

/**
 * Importação manual do JSON da ConsultaClassificacaoProduto (baixado no portal
 * com certificado digital). Mesmo normalizador/persistência do sync automático.
 */
export async function importarClassificacaoProduto(
  sistema: string,
  json: unknown,
): Promise<{ sistema: string; total: number; negados: number }> {
  const texto = JSON.stringify(json)
  const hash = await calcularHash(texto)
  const itens = normalizarClassificacaoProduto(json, sistema)
  if (!itens.length) throw new Error(`Nenhuma linha válida para ${sistema} no JSON informado.`)
  const metaKey = `cff_sync_classProd_${sistema}`
  await atualizarClassificacaoProduto(itens, sistema, metaKey, hash)
  return {
    sistema,
    total: itens.length,
    negados: itens.filter((i) => i.permitido === false).length,
  }
}

/**
 * Bloqueios por sistema para um cClassTrib: `permitido === false` em cada
 * tabela sincronizada/importada. Retorna só os sistemas com dados locais.
 */
export async function obterBloqueiosPorSistema(
  cClassTrib: string,
): Promise<Array<{ sistema: string; permitido: boolean | null; sincronizadoEm: string }>> {
  const cct = String(cClassTrib ?? '').padStart(6, '0').slice(-6)
  if (!cct) return []
  const linhas = await db.classificacaoProduto.where('cClassTrib').equals(cct).toArray()
  return linhas.map((l) => ({
    sistema: l.sistema,
    permitido: l.permitido,
    sincronizadoEm: l.sincronizadoEm,
  }))
}

/**
 * Bloqueios de vários cClassTribs de uma vez (uma consulta por chamada).
 * Retorna `cClassTrib → bloqueios`.
 */
export async function obterBloqueiosParaCcts(
  ccts: string[],
): Promise<Record<string, Array<{ sistema: string; permitido: boolean | null; sincronizadoEm: string }>>> {
  const unicos = [...new Set(ccts.map((c) => String(c ?? '').padStart(6, '0').slice(-6)).filter(Boolean))]
  if (!unicos.length) return {}
  const linhas = await db.classificacaoProduto.where('cClassTrib').anyOf(unicos).toArray()
  const out: Record<string, Array<{ sistema: string; permitido: boolean | null; sincronizadoEm: string }>> = {}
  for (const l of linhas) {
    ;(out[l.cClassTrib] ??= []).push({
      sistema: l.sistema,
      permitido: l.permitido,
      sincronizadoEm: l.sincronizadoEm,
    })
  }
  return out
}

/**
 * Cobertura local das tabelas por sistema: quais sistemas têm dados (via sync
 * ou importação manual) e de quando são.
 */
export async function listarCoberturaClassProd(): Promise<
  Array<{ sistema: string; total: number; negados: number; sincronizadoEm: string | null }>
> {
  const todas = await db.classificacaoProduto.toArray()
  const porSistema = new Map<string, ClassificacaoProdutoSistema[]>()
  for (const l of todas) {
    const arr = porSistema.get(l.sistema) ?? []
    arr.push(l)
    porSistema.set(l.sistema, arr)
  }
  return [...porSistema.entries()].map(([sistema, linhas]) => ({
    sistema,
    total: linhas.length,
    negados: linhas.filter((l) => l.permitido === false).length,
    sincronizadoEm: linhas.reduce<string | null>(
      (max, l) => (max === null || l.sincronizadoEm > max ? l.sincronizadoEm : max),
      null,
    ),
  }))
}
async function bulkPut<T>(
  tabela: Table<T, string>,
  itens: T[],
): Promise<void> {
  const TAM = 500
  for (let i = 0; i < itens.length; i += TAM) {
    await tabela.bulkPut(itens.slice(i, i + TAM) as never[])
  }
}

/**
 * Sincroniza um endpoint específico
 */
export async function sincronizarEndpoint(endpoint: CffEndpoint): Promise<SyncResultado> {
  const inicio = Date.now()

  try {
    // Busca meta anterior para comparação
    const metaAnterior = await db.meta.get(endpoint.metaKey)
    const valorAnterior = metaAnterior?.valor as Record<string, unknown> | undefined
    const hashAnterior = valorAnterior?.hash as string | undefined

    // Faz a requisição
    const { dados, hash, etag, lastModified } = await buscarEndpoint(endpoint)

    // Se hash não mudou, não precisa atualizar
    if (hashAnterior && hashAnterior === hash) {
      return {
        endpoint,
        status: 'inalterado',
        mensagem: 'Conteúdo idêntico à última sincronização',
        hashAnterior,
        hashNovo: hash,
        duracaoMs: Date.now() - inicio,
      }
    }

    // Normaliza conforme o tipo de endpoint
    let registros = 0

    if (endpoint.servico === 'Classificação Tributária') {
      const itens = normalizarClassificacaoTributaria(dados)
      registros = await atualizarReferencia(itens, endpoint.metaKey, hash, etag, lastModified)
    } else if (endpoint.metaKey.startsWith('cff_sync_classProd_')) {
      // Tabelas por DFe (NFCom/NFAg/NF3e/NFGas): permitido × negado por sistema
      const sistema = sistemaDoEndpoint(endpoint.url, endpoint.metaKey) ?? 'desconhecido'
      const itens = normalizarClassificacaoProduto(dados, sistema)
      registros = await atualizarClassificacaoProduto(itens, sistema, endpoint.metaKey, hash, etag, lastModified)
    } else {
      // Para outros endpoints, por enquanto apenas armazenamos o JSON bruto
      // TODO: implementar normalizadores específicos para cada endpoint
      await db.meta.put({
        chave: endpoint.metaKey,
        valor: {
          ultimaVerificacao: new Date().toISOString(),
          hash,
          etag,
          lastModified,
          dadosBrutos: dados,
        },
        quando: new Date().toISOString(),
      })
      registros = Array.isArray(dados) ? dados.length : 1
    }

    return {
      endpoint,
      status: 'atualizado',
      mensagem: `${registros} registros sincronizados`,
      registros,
      hashAnterior,
      hashNovo: hash,
      duracaoMs: Date.now() - inicio,
    }
  } catch (erro) {
    const precisaCert = ehErroCertificado(erro)
    const msg = erro instanceof Error ? erro.message : String(erro)
    // Persiste a tentativa para a UI mostrar "certificado"/"erro" com data,
    // sem apagar a última sincronização válida (mantém hash/totalRegistros).
    try {
      const anterior = await db.meta.get(endpoint.metaKey)
      const valorAnterior = (anterior?.valor as Record<string, unknown> | undefined) ?? {}
      await db.meta.put({
        chave: endpoint.metaKey,
        valor: {
          ...valorAnterior,
          ultimaTentativa: new Date().toISOString(),
          ultimoErro: msg,
          precisaCert,
        },
        quando: new Date().toISOString(),
      })
    } catch {
      // Meta é informativa — nunca pode quebrar o resultado do sync.
    }
    if (precisaCert) {
      return {
        endpoint,
        status: 'certificado',
        mensagem: msg,
        duracaoMs: Date.now() - inicio,
      }
    }
    return {
      endpoint,
      status: 'erro',
      mensagem: `Falha na sincronização: ${msg}`,
      duracaoMs: Date.now() - inicio,
    }
  }
}

/**
 * Executa sincronização completa de todos os endpoints CFF
 */
export async function sincronizarTudo(
  onProgress?: (etapa: string, pct: number, resultadoAtual?: SyncResultado) => void,
): Promise<SyncResultado[]> {
  const resultados: SyncResultado[] = []
  const total = CFF_ENDPOINTS.length

  onProgress?.('Iniciando sincronização CFF', 0)

  for (let i = 0; i < total; i++) {
    const endpoint = CFF_ENDPOINTS[i]
    const pctBase = Math.round((i / total) * 100)

    onProgress?.(`Verificando: ${endpoint.servico}`, pctBase)

    const resultado = await sincronizarEndpoint(endpoint)
    resultados.push(resultado)

    onProgress?.(`${endpoint.servico}: ${resultado.status}`, pctBase, resultado)

    // Pequena pausa entre endpoints para não sobrecarregar a API
    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Registra timestamp geral da verificação
  await registrarVerificacao()

  onProgress?.('Sincronização concluída', 100)

  return resultados
}

/**
 * Revogações detectadas no JSON bruto do endpoint CFF `anexos` (quando
 * sincronizado). Best-effort: sem marcador explícito, lista vazia.
 */
export async function obterRevogacoesCff(): Promise<import('@/domain/services/revogacao').Revogacao[]> {
  try {
    const { extrairRevogacoesAnexos } = await import('@/domain/services/revogacao')
    const meta = await db.meta.get('cff_sync_anexos')
    const valor = meta?.valor as Record<string, unknown> | undefined
    const brutos = valor?.dadosBrutos
    if (!brutos) return []
    return extrairRevogacoesAnexos(brutos)
  } catch {
    return []
  }
}
/**
 * Obtém status de todas as sincronizações
 */
export async function obterStatusSincronizacao(): Promise<{
  ultimaVerificacaoGeral: string | null
  endpoints: Array<{
    endpoint: CffEndpoint
    ultimaSinc: string | null
    hash: string | null
    totalRegistros: number | null
    totalNegados?: number | null
    sistema?: string | null
    precisaCert: boolean
    ultimoErro: string | null
    ultimaTentativa: string | null
    status: 'nunca' | 'ok' | 'erro' | 'certificado'
  }>
}> {
  const geral = await db.meta.get(CFF_META_KEYS.ULTIMA_VERIFICACAO)
  const valorGeral = geral?.valor as Record<string, unknown> | undefined

  const endpoints = await Promise.all(
    CFF_ENDPOINTS.map(async (e) => {
      const meta = await db.meta.get(e.metaKey)
      const valor = meta?.valor as Record<string, unknown> | undefined
      const precisaCert = valor?.precisaCert === true
      const temDados = (valor?.totalRegistros as number | undefined) != null || (valor?.hash as string | undefined) != null
      return {
        endpoint: e,
        ultimaSinc: (valor?.ultimaVerificacao as string) ?? null,
        hash: (valor?.hash as string) ?? null,
        totalRegistros: (valor?.totalRegistros as number) ?? null,
        totalNegados: (valor?.totalNegados as number) ?? null,
        sistema: ((valor?.sistema as string) ?? sistemaDoEndpoint(e.url, e.metaKey)),
        precisaCert,
        ultimoErro: (valor?.ultimoErro as string) ?? null,
        ultimaTentativa: (valor?.ultimaTentativa as string) ?? null,
        status: !meta
          ? ('nunca' as const)
          : precisaCert && !temDados
            ? ('certificado' as const)
            : temDados
              ? ('ok' as const)
              : ('erro' as const),
      }
    }),
  )

  return {
    ultimaVerificacaoGeral: (valorGeral?.ultimaVerificacao as string) ?? null,
    endpoints,
  }
}

/**
 * Força uma sincronização ignorando o intervalo mínimo
 */
export async function forcarSincronizacao(
  onProgress?: (etapa: string, pct: number, resultadoAtual?: SyncResultado) => void,
): Promise<SyncResultado[]> {
  return sincronizarTudo(onProgress)
}