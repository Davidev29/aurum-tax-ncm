/**
 * Sincronização da NCM vigente com o Portal Único Siscomex (módulo Classif).
 *
 * Responsabilidades:
 * - Baixar a tabela oficial (`download/json`, sem Captcha/certificado)
 * - Detectar mudanças pelo hash canônico do conteúdo (o rótulo
 *   `Data_Ultima_Atualizacao_NCM` muda mesmo sem alteração — não conta)
 * - Aplicar diff: novos entram, alterados atualizam, sumidos são marcados
 *   como extintos (`dataFim`/`atoFim`) em vez de apagados — o download só traz
 *   a tabela vigente, e o histórico alimenta os avisos "NCM extinto"
 * - Persistir metadados (vigência, ato, hash, diff) para a UI
 */

import { db, bulkPut } from '../db/schema'
import {
  SISCOMEX_NCM_META_KEY,
  SISCOMEX_NCM_URL,
  SISCOMEX_SYNC_CONFIG,
} from '@/domain/constants/siscomex-apis'
import { normalizarNomenclatura } from '../base/normalizacao'
import type { NomenclaturaNcm } from '@/domain/entities'

/** Resultado de uma verificação/sincronização da tabela NCM. */
export interface NcmSyncResultado {
  status: 'atualizado' | 'inalterado' | 'erro'
  mensagem: string
  total?: number
  novos?: number
  alterados?: number
  extintos?: number
  vigencia?: string | null
  ato?: string | null
  duracaoMs: number
}

/** Metadados persistidos (store `meta`, chave `siscomex_ncm_sync`). */
export interface NcmSyncMeta {
  ultimaVerificacao: string
  vigencia?: string | null
  ato?: string | null
  hash?: string
  totalRegistros?: number
  novos?: number
  alterados?: number
  extintos?: number
  ultimoErro?: string | null
  ultimaTentativa?: string | null
}

/**
 * SHA-256 hex de uma string.
 */
async function calcularHash(conteudo: string): Promise<string> {
  const data = new TextEncoder().encode(conteudo)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Serialização canônica das Nomenclaturas para hash de conteúdo: ordenadas por
 * código, só campos de negócio. O cabeçalho (`Data_Ultima_Atualizacao_NCM`)
 * muda a cada dia mesmo sem alteração — ficar fora do hash evita churn.
 */
function canonicoNomenclaturas(itens: unknown): string {
  const lista = Array.isArray((itens as { Nomenclaturas?: unknown })?.Nomenclaturas)
    ? ((itens as { Nomenclaturas: unknown[] }).Nomenclaturas as Record<string, unknown>[])
    : []
  const linhas = lista.map((n) => JSON.stringify([
    String(n.Codigo ?? ''),
    String(n.Descricao ?? ''),
    String(n.Data_Inicio ?? ''),
    String(n.Data_Fim ?? ''),
    String(n.Tipo_Ato_Ini ?? ''),
    String(n.Numero_Ato_Ini ?? ''),
    String(n.Ano_Ato_Ini ?? ''),
    String((n as Record<string, unknown>).Tipo_Ato_Fim ?? ''),
    String((n as Record<string, unknown>).Numero_Ato_Fim ?? ''),
    String((n as Record<string, unknown>).Ano_Ato_Fim ?? ''),
  ]))
  linhas.sort()
  return `[${linhas.join(',')}]`
}

/**
 * GET com timeout e retry curto (o portal limita taxa — no máximo 2 tentativas).
 */
async function fetchComRetry(url: string, tentativas = SISCOMEX_SYNC_CONFIG.maxTentativas): Promise<Response> {
  let ultimoErro: Error | null = null
  for (let i = 0; i < tentativas; i++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SISCOMEX_SYNC_CONFIG.timeout)
    try {
      const resposta = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': SISCOMEX_SYNC_CONFIG.userAgent,
          Accept: 'application/json',
        },
      })
      clearTimeout(timer)
      return resposta
    } catch (erro) {
      clearTimeout(timer)
      ultimoErro = erro instanceof Error ? erro : new Error(String(erro))
      if (i < tentativas - 1) await new Promise((r) => setTimeout(r, SISCOMEX_SYNC_CONFIG.retryDelay))
    }
  }
  const abortado = /abort/i.test(ultimoErro?.name ?? '') || /aborted/i.test(ultimoErro?.message ?? '')
  throw new Error(
    abortado
      ? 'Portal Siscomex demorou a responder (timeout de 90 s). Tente de novo.'
      : 'Sem conexão com o Portal Único Siscomex. Verifique a internet e tente de novo.',
  )
}

/**
 * Baixa a tabela oficial e devolve o JSON bruto + hash de conteúdo + rótulos.
 */
export async function buscarTabelaNcm(): Promise<{
  json: { Nomenclaturas: unknown[]; Data_Ultima_Atualizacao_NCM?: unknown; Ato?: unknown }
  hash: string
  vigencia: string | null
  ato: string | null
}> {
  const resposta = await fetchComRetry(SISCOMEX_NCM_URL)
  if (resposta.status === 429) {
    throw new Error('Portal Siscomex limitou a taxa de consultas (HTTP 429). Aguarde e tente de novo amanhã.')
  }
  if (!resposta.ok) {
    throw new Error(`Portal Siscomex indisponível (HTTP ${resposta.status}). Tente de novo.`)
  }
  let json: Record<string, unknown>
  try {
    json = (await resposta.json()) as Record<string, unknown>
  } catch {
    throw new Error('Resposta inválida do Portal Siscomex (JSON esperado).')
  }
  if (!Array.isArray(json.Nomenclaturas) || !json.Nomenclaturas.length) {
    throw new Error('Tabela NCM vazia ou em formato inesperado no Portal Siscomex.')
  }
  const vigencia = typeof json.Data_Ultima_Atualizacao_NCM === 'string' ? json.Data_Ultima_Atualizacao_NCM : null
  const ato = typeof json.Ato === 'string' ? json.Ato : null
  return {
    json: json as { Nomenclaturas: unknown[]; Data_Ultima_Atualizacao_NCM?: unknown; Ato?: unknown },
    hash: await calcularHash(canonicoNomenclaturas(json)),
    vigencia,
    ato,
  }
}

/**
 * Aplica o diff remoto → local na store `ncmNomenclatura`.
 *
 * - Novos: entram.
 * - Presentes: atualizam (descrição, datas, atos).
 * - Ausentes no remoto: marcados como extintos (`dataFim`/`atoFim`) — nunca
 *   apagados, pois o download só contém a vigente e o histórico alimenta os
 *   avisos "⛔ NCM extinto" dos cartões.
 */
export async function aplicarTabelaNcm(
  json: unknown,
  vigencia: string | null,
  ato: string | null,
  hash: string,
): Promise<{ total: number; novos: number; alterados: number; extintos: number }> {
  const remoto = normalizarNomenclatura(json)
  if (!remoto.length) throw new Error('Tabela NCM sem itens válidos.')
  const porCodigo = new Map(remoto.map((n) => [n.codigo, n]))

  const locais = await db.ncmNomenclatura.toArray()
  const locaisPorCodigo = new Map(locais.map((n) => [n.codigo, n]))

  let novos = 0
  let alterados = 0
  const final: NomenclaturaNcm[] = [...remoto]
  for (const r of remoto) {
    const l = locaisPorCodigo.get(r.codigo)
    if (!l) {
      novos++
    } else if (
      l.descricao !== r.descricao ||
      (l.dataFim ?? null) !== (r.dataFim ?? null) ||
      (l.dataInicio ?? null) !== (r.dataInicio ?? null) ||
      (l.ato ?? null) !== (r.ato ?? null)
    ) {
      alterados++
    }
  }

  // Sumidos do download = removidos da vigente → marca extinto com a data/ato
  // da vigência remota (ex.: "Vigente em 29/09/2026" / "Resolução Gecex nº 926/2026").
  let extintos = 0
  for (const l of locais) {
    if (!porCodigo.has(l.codigo)) {
      if (!l.dataFim) {
        extintos++
        final.push({ ...l, dataFim: vigencia ?? new Date().toLocaleDateString('pt-BR'), atoFim: l.atoFim ?? ato })
      } else {
        final.push(l)
      }
    }
  }

  await db.ncmNomenclatura.clear()
  await bulkPut(db.ncmNomenclatura, final)

  const agora = new Date().toISOString()
  await db.meta.put({
    chave: SISCOMEX_NCM_META_KEY,
    valor: {
      ultimaVerificacao: agora,
      vigencia,
      ato,
      hash,
      totalRegistros: final.length,
      novos,
      alterados,
      extintos,
      ultimoErro: null,
    } satisfies NcmSyncMeta,
    quando: agora,
  })

  return { total: final.length, novos, alterados, extintos }
}

/**
 * Verifica se passou o intervalo mínimo desde a última verificação.
 */
export async function deveSincronizarNcm(): Promise<boolean> {
  const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
  const valor = meta?.valor as NcmSyncMeta | undefined
  if (!valor?.ultimaVerificacao) return true
  return Date.now() - new Date(valor.ultimaVerificacao).getTime() >= SISCOMEX_SYNC_CONFIG.intervaloMinimo
}

/**
 * Sincronização completa: baixa, compara hash e aplica diff quando mudou.
 */
export async function sincronizarNomenclatura(): Promise<NcmSyncResultado> {
  const inicio = Date.now()
  try {
    const { json, hash, vigencia, ato } = await buscarTabelaNcm()
    const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
    const anterior = meta?.valor as NcmSyncMeta | undefined

    if (anterior?.hash && anterior.hash === hash) {
      const agora = new Date().toISOString()
      await db.meta.put({
        chave: SISCOMEX_NCM_META_KEY,
        valor: { ...anterior, ultimaVerificacao: agora, vigencia: vigencia ?? anterior.vigencia, ato: ato ?? anterior.ato },
        quando: agora,
      })
      return {
        status: 'inalterado',
        mensagem: 'Tabela NCM idêntica à última sincronização',
        total: anterior.totalRegistros,
        vigencia: vigencia ?? anterior.vigencia,
        ato: ato ?? anterior.ato,
        duracaoMs: Date.now() - inicio,
      }
    }

    const diff = await aplicarTabelaNcm(json, vigencia, ato, hash)
    const partes = [
      diff.novos ? `${diff.novos} novo(s)` : null,
      diff.alterados ? `${diff.alterados} alterado(s)` : null,
      diff.extintos ? `${diff.extintos} extinto(s)` : null,
    ].filter(Boolean)
    return {
      status: 'atualizado',
      mensagem: partes.length ? `${diff.total} códigos (${partes.join(', ')})` : `${diff.total} códigos sincronizados`,
      ...diff,
      vigencia,
      ato,
      duracaoMs: Date.now() - inicio,
    }
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    try {
      const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
      const anterior = (meta?.valor as NcmSyncMeta | undefined) ?? ({} as NcmSyncMeta)
      const agora = new Date().toISOString()
      await db.meta.put({
        chave: SISCOMEX_NCM_META_KEY,
        valor: { ...anterior, ultimaTentativa: agora, ultimoErro: msg },
        quando: agora,
      })
    } catch {
      // Meta é informativa — nunca quebra o resultado.
    }
    return { status: 'erro', mensagem: msg, duracaoMs: Date.now() - inicio }
  }
}

/**
 * Importação manual do JSON baixado no portal (mesmo pipeline do sync).
 * Cobre o arquivo que o navegador salva (o `blob:` da sessão não é reutilizável).
 */
export async function importarTabelaNcmJson(json: unknown): Promise<NcmSyncResultado> {
  const inicio = Date.now()
  const obj = json as Record<string, unknown>
  if (!obj || !Array.isArray(obj.Nomenclaturas) || !obj.Nomenclaturas.length) {
    return { status: 'erro', mensagem: 'Arquivo sem a lista `Nomenclaturas` da tabela oficial.', duracaoMs: Date.now() - inicio }
  }
  const vigencia = typeof obj.Data_Ultima_Atualizacao_NCM === 'string' ? obj.Data_Ultima_Atualizacao_NCM : null
  const ato = typeof obj.Ato === 'string' ? obj.Ato : null
  try {
    const hash = await calcularHash(canonicoNomenclaturas(obj))
    const diff = await aplicarTabelaNcm(obj, vigencia, ato, hash)
    return {
      status: 'atualizado',
      mensagem: `${diff.total} códigos importados` +
        (diff.extintos ? ` (${diff.extintos} marcado(s) como extinto(s))` : ''),
      ...diff,
      vigencia,
      ato,
      duracaoMs: Date.now() - inicio,
    }
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro)
    return { status: 'erro', mensagem: msg, duracaoMs: Date.now() - inicio }
  }
}

/**
 * Status atual para a UI (nunca sincronizado quando sem meta).
 */
export async function obterStatusNcm(): Promise<{
  ultimaVerificacao: string | null
  vigencia: string | null
  ato: string | null
  totalRegistros: number | null
  novos: number | null
  alterados: number | null
  extintos: number | null
  ultimoErro: string | null
  status: 'nunca' | 'ok' | 'erro'
}> {
  const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
  const v = meta?.valor as NcmSyncMeta | undefined
  if (!v) {
    return {
      ultimaVerificacao: null, vigencia: null, ato: null, totalRegistros: null,
      novos: null, alterados: null, extintos: null, ultimoErro: null, status: 'nunca',
    }
  }
  return {
    ultimaVerificacao: v.ultimaVerificacao ?? null,
    vigencia: v.vigencia ?? null,
    ato: v.ato ?? null,
    totalRegistros: v.totalRegistros ?? null,
    novos: v.novos ?? null,
    alterados: v.alterados ?? null,
    extintos: v.extintos ?? null,
    ultimoErro: v.ultimoErro ?? null,
    status: v.ultimoErro && v.totalRegistros == null ? 'erro' : 'ok',
  }
}
