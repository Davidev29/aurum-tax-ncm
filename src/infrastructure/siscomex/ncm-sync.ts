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
import { bridge } from '../bridge'
import {
  SISCOMEX_NCM_META_KEY,
  SISCOMEX_NCM_URLS,
  SISCOMEX_SYNC_CONFIG,
} from '@/domain/constants/siscomex-apis'
import { normalizarNomenclatura } from '../base/normalizacao'
import type { NomenclaturaNcm } from '@/domain/entities'

/** Resultado de uma verificação/sincronização da tabela NCM. */
export interface NcmSyncResultado {
  status: 'atualizado' | 'inalterado' | 'erro'
  mensagem: string
  /** Causa classificada (para a UI orientar o próximo passo). */
  codigoErro?: 'timeout' | 'rede' | 'cors' | 'tls' | 'http' | 'limite' | 'json' | null
  total?: number
  novos?: number
  alterados?: number
  extintos?: number
  vigencia?: string | null
  ato?: string | null
  duracaoMs: number
}

/** Metadados persistidos (store `meta`, chave `siscomex_ncm_sync`). */
export interface NcmSyncMeta {  ultimaVerificacao: string
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
 * Piso de sanidade da tabela oficial (linhas em `Nomenclaturas`).
 * A tabela real tem ~15 mil linhas; abaixo disso é resposta parcial/corrompida
 * — aplicar marcaria milhares de códigos como extintos por engano.
 */
export const MIN_LINHAS_TABELA_NCM = 1000

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
 * Classifica um erro de rede em causa provável + mensagem acionável em pt-BR.
 * Cobre os modos reais de falha em ambiente corporativo: CORS (o portal não
 * envia `Access-Control-Allow-Origin`, então o `fetch` direto do navegador
 * sempre cai em `Failed to fetch`), proxy/firewall que bloqueia o domínio,
 * certificado TLS interceptado (MITM), DNS, timeout em link lento e
 * rate-limit do portal.
 */
export function classificarErroRede(erro: unknown): { codigo: NonNullable<NcmSyncResultado['codigoErro']>; mensagem: string } {
  const nome = erro instanceof Error ? erro.name : ''
  const msg = erro instanceof Error ? erro.message : String(erro)
  const texto = `${nome} ${msg}`.toLowerCase()

  if (/abort|aborted|timeout|timed out|tempo esgotado/i.test(texto)) {
    return {
      codigo: 'timeout',
      mensagem:
        'Portal Siscomex demorou a responder (tempo esgotado). ' +
        'Em link lento tente de novo; se persistir, use "Testar conexão" ou importe o JSON manualmente.',
    }
  }
  if (/certificat|ssl|tls|unable to verify|self.signed|err_cert|cert_invalid|revocation/i.test(texto)) {
    return {
      codigo: 'tls',
      mensagem:
        'Conexão segura com o Siscomex foi rejeitada (certificado TLS — comum com proxy/antivírus corporativo que intercepta HTTPS). ' +
        'Fale com o TI para liberar portalunico.siscomex.gov.br ou importe o JSON baixado no navegador.',
    }
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(texto)) {
    return {
      codigo: 'cors',
      mensagem:
        'O navegador bloqueou a leitura direta do Portal Siscomex (CORS — o portal não libera acesso externo). ' +
        'No app desktop a sincronização usa o canal interno sem CORS; no navegador, baixe o JSON no portal e importe manualmente.',
    }
  }
  if (/econn|enotfound|enot|eai_again|econnrefused|econnreset|ehostunreach|enetunreach|dns|offline|internet/i.test(texto)) {
    return {
      codigo: 'rede',
      mensagem:
        'Sem acesso ao Portal Único Siscomex (rede/DNS/proxy/firewall). ' +
        'Verifique a internet, se o domínio portalunico.siscomex.gov.br é liberado no proxy/firewall, e tente de novo — ' +
        'ou importe o JSON baixado no navegador.',
    }
  }
  return {
    codigo: 'rede',
    mensagem: `Falha de rede ao alcançar o Siscomex (${msg || nome || 'erro desconhecido'}). Tente de novo ou importe o JSON manualmente.`,
  }
}

/** Erro HTTP com status (para não confundir com falha de rede). */
export class ErroHttpSiscomex extends Error {
  readonly status: number
  readonly retryAfterSeg: number | null
  constructor(status: number, retryAfterSeg: number | null = null) {
    super(`HTTP ${status}`)
    this.name = 'ErroHttpSiscomex'
    this.status = status
    this.retryAfterSeg = retryAfterSeg
  }
}

function mensagemHttp(status: number, retryAfterSeg: number | null): { codigo: NonNullable<NcmSyncResultado['codigoErro']>; mensagem: string } {
  if (status === 429) {
    const quando = retryAfterSeg ? ` (tente de novo em ~${retryAfterSeg}s)` : ' (tente de novo amanhã)'
    return {
      codigo: 'limite',
      mensagem: `Portal Siscomex limitou a taxa de consultas (HTTP 429)${quando}. A tabela local continua valendo — não há perda.`,
    }
  }
  if (status === 403) {
    return {
      codigo: 'http',
      mensagem:
        'Portal Siscomex negou o acesso direto (HTTP 403 — filtro de rede/WAF). ' +
        'Baixe o JSON no navegador e importe manualmente; a tabela local continua valendo.',
    }
  }
  if (status >= 500) {
    return {
      codigo: 'http',
      mensagem: `Portal Siscomex com instabilidade (HTTP ${status}). Aguarde alguns minutos e tente de novo — a tabela local continua valendo.`,
    }
  }
  return {
    codigo: 'http',
    mensagem: `Portal Siscomex respondeu HTTP ${status}. Tente de novo ou importe o JSON manualmente.`,
  }
}

/**
 * GET com fallback entre URLs oficiais, timeout e retry consciente:
 * - tenta as URLs em ordem (se uma falhar por rede, tenta a próxima);
 * - repete falhas de rede/timeout/5xx (com espera), NUNCA 429/4xx;
 * - respeita `Retry-After` do 429 sem re-tentar dentro da mesma execução.
 *
 * NOTA: sem `User-Agent` customizado de propósito — no navegador esse é um
 * header proibido (ignorado) e qualquer header não-safelisted forçaria
 * preflight CORS. O UA segue só no processo principal (canal IPC).
 */
async function fetchComRetry(
  tentativas: number = SISCOMEX_SYNC_CONFIG.maxTentativas,
  timeoutMs: number = SISCOMEX_SYNC_CONFIG.timeout,
): Promise<Response> {
  const urls = [...SISCOMEX_NCM_URLS]
  let ultimoErro: unknown = null

  for (let i = 0; i < tentativas; i++) {
    const url = urls[i % urls.length]
    if (i > 0) await new Promise((r) => setTimeout(r, SISCOMEX_SYNC_CONFIG.retryDelay))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let resposta: Response
    try {
      resposta = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      })
    } catch (erro) {
      clearTimeout(timer)
      ultimoErro = erro
      continue // próxima URL/tentativa
    }
    clearTimeout(timer)

    if (resposta.status === 429) {
      const ra = resposta.headers.get('retry-after')
      const segs = ra ? Number(String(ra).split(',')[0].trim()) : NaN
      throw new ErroHttpSiscomex(429, Number.isFinite(segs) && segs > 0 ? Math.min(segs, 3600) : null)
    }
    if (resposta.status >= 500 && i < tentativas - 1) {
      ultimoErro = new ErroHttpSiscomex(resposta.status)
      continue // instabilidade: tenta de novo
    }
    if (!resposta.ok) throw new ErroHttpSiscomex(resposta.status)
    return resposta
  }

  if (ultimoErro instanceof ErroHttpSiscomex) throw ultimoErro
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro ?? 'falha desconhecida'))
}

/** Converte qualquer falha de busca em erro final classificado. */
function erroFinal(erro: unknown): Error & { codigoErro: NonNullable<NcmSyncResultado['codigoErro']> } {
  if (erro instanceof ErroHttpSiscomex) {
    const m = mensagemHttp(erro.status, erro.retryAfterSeg)
    return Object.assign(new Error(m.mensagem), { codigoErro: m.codigo })
  }
  // Erros do canal IPC chegam como Error comum com "HTTP NNN" na mensagem
  // (props extras nem sempre atravessam o IPC) — reconstrói o HTTP.
  if (erro instanceof Error) {
    const mHttp = /HTTP\s+(\d{3})/i.exec(erro.message)
    if (mHttp) {
      const status = Number(mHttp[1])
      const mRa = /Retry-After:\s*([^\s,)]+)/i.exec(erro.message)
      const segs = mRa ? Number(String(mRa[1]).split(',')[0].trim()) : NaN
      const m = mensagemHttp(status, Number.isFinite(segs) && segs > 0 ? Math.min(segs, 3600) : null)
      return Object.assign(new Error(m.mensagem), { codigoErro: m.codigo })
    }
  }
  const m = classificarErroRede(erro)
  return Object.assign(new Error(m.mensagem), { codigoErro: m.codigo })
}

/**
 * Bridge ativo no momento da chamada (leitura dinâmica de `window.aurum` com
 * fallback ao import estático — facilita mocks em testes e cobre preload
 * tardio). Retorna `null` no navegador puro.
 */
function obterBridge(): typeof bridge {
  const dinamico = (globalThis as { window?: { aurum?: typeof bridge } }).window?.aurum
  return dinamico ?? bridge
}

/**
 * Baixa a tabela via processo principal (Electron, canal `rede:buscar-texto`
 * — fetch do Node, sem restrição de CORS). Devolve o texto + URL que
 * respondeu. Lança quando não há bridge — o chamador só chama com
 * `obterBridge()` ativo, ou cai no `fetch` direto no navegador puro.
 */
async function baixarTextoNcmViaBridge(): Promise<{ texto: string; url: string }> {
  const b = obterBridge()
  if (!b) throw new Error('Canal interno (IPC) indisponível — sem Electron.')
  let ultimoErro: unknown = null
  for (const url of SISCOMEX_NCM_URLS) {
    try {
      const r = await b.buscarTexto(url)
      if (r && typeof r.texto === 'string' && r.texto.length > 0) {
        return { texto: r.texto, url: r.urlFinal || url }
      }
      ultimoErro = new Error('Resposta vazia do canal interno (IPC).')
    } catch (erro) {
      ultimoErro = erro
      // 429/4xx do portal via IPC são definitivos — não adianta trocar de URL.
      if (erro instanceof Error && /HTTP\s+(429|403|404)/i.test(erro.message)) throw erro
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro ?? 'falha desconhecida'))
}

/** Valida o JSON bruto da tabela e extrai rótulos (comum aos transportes). */
async function validarTabelaNcmJson(json: Record<string, unknown>): Promise<{
  json: { Nomenclaturas: unknown[]; Data_Ultima_Atualizacao_NCM?: unknown; Ato?: unknown }
  hash: string
  vigencia: string | null
  ato: string | null
}> {
  if (!Array.isArray(json.Nomenclaturas) || !json.Nomenclaturas.length) {
    throw Object.assign(
      new Error('Tabela NCM vazia ou em formato inesperado no Portal Siscomex. Tente de novo ou importe o arquivo manualmente.'),
      { codigoErro: 'json' as const },
    )
  }
  if (json.Nomenclaturas.length < MIN_LINHAS_TABELA_NCM) {
    throw Object.assign(
      new Error(
        `Tabela NCM incompleta no Portal Siscomex (só ${json.Nomenclaturas.length} linhas — esperado milhares). ` +
        'Download parcial não foi aplicado para não marcar códigos como extintos por engano. Tente de novo.',
      ),
      { codigoErro: 'json' as const },
    )
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
 * Baixa a tabela oficial e devolve o JSON bruto + hash de conteúdo + rótulos.
 * Transporte: 1º canal IPC do Electron (sem CORS), 2º `fetch` direto
 * (navegador / proxy same-origin futuro). Falhas saem classificadas
 * (`codigoErro`) para a UI orientar o próximo passo.
 */
export async function buscarTabelaNcm(): Promise<{
  json: { Nomenclaturas: unknown[]; Data_Ultima_Atualizacao_NCM?: unknown; Ato?: unknown }
  hash: string
  vigencia: string | null
  ato: string | null
}> {
  // 1. Electron: processo principal (sem CORS) — caminho principal no desktop.
  if (obterBridge()) {
    try {
      const { texto } = await baixarTextoNcmViaBridge()
      let json: Record<string, unknown>
      try {
        json = JSON.parse(texto) as Record<string, unknown>
      } catch {
        throw Object.assign(
          new Error('Resposta inválida do Portal Siscomex (JSON esperado). Tente de novo ou importe o arquivo manualmente.'),
          { codigoErro: 'json' as const },
        )
      }
      return validarTabelaNcmJson(json)
    } catch (erro) {
      // Erro HTTP definitivo do portal via IPC (429/403/4xx/5xx): não faz
      // sentido cair no fetch direto (que ainda teria CORS) — classifica direto.
      if (erro instanceof Error && /HTTP\s+\d{3}/i.test(erro.message)) throw erroFinal(erro)
      if ((erro as { codigoErro?: unknown })?.codigoErro === 'json') throw erro
      // Falha de rede no IPC: tenta o fetch direto antes de desistir.
      try {
        const resposta = await fetchComRetry()
        return validarTabelaNcmJson((await resposta.json()) as Record<string, unknown>)
      } catch (erroFetch) {
        throw erroFinal(erroFetch)
      }
    }
  }
  // 2. Navegador puro: fetch direto (sujeito a CORS — vira codigo 'cors').
  let resposta: Response
  try {
    resposta = await fetchComRetry()
  } catch (erro) {
    throw erroFinal(erro)
  }
  let json: Record<string, unknown>
  try {
    json = (await resposta.json()) as Record<string, unknown>
  } catch {
    throw Object.assign(
      new Error('Resposta inválida do Portal Siscomex (JSON esperado). Tente de novo ou importe o arquivo manualmente.'),
      { codigoErro: 'json' as const },
    )
  }
  return validarTabelaNcmJson(json)
}

/** Etapa do diagnóstico de conexão exibida na UI. */
export interface EtapaDiagnostico {
  etapa: string
  ok: boolean
  detalhe: string
  ms: number
}

/**
 * Testa a conexão com o Portal Siscomex passo a passo (rápido, sem gravar
 * nada): canal Electron (sem CORS) → alcance → HTTP → tamanho → JSON válido.
 * Serve para distinguir "portal fora do ar" de "rede da máquina bloqueando"
 * na hora do suporte.
 */
export async function diagnosticarConexaoNcm(): Promise<{
  ok: boolean
  etapas: EtapaDiagnostico[]
  resumo: string
}> {
  const etapas: EtapaDiagnostico[] = []
  const push = (etapa: string, ok: boolean, detalhe: string, ms: number) => etapas.push({ etapa, ok, detalhe, ms })

  // Via IPC primeiro: no desktop o download nem passa pelo CORS do navegador.
  if (obterBridge()) {
    const tIpc = Date.now()
    try {
      const { texto, url } = await baixarTextoNcmViaBridge()
      push('Canal Electron', true, `Via processo principal (sem CORS) · ${url}`, Date.now() - tIpc)
      const tJ = Date.now()
      let total = 0
      let vigenciaTxt: string | null = null
      try {
        const json = JSON.parse(texto) as Record<string, unknown>
        total = Array.isArray(json.Nomenclaturas) ? json.Nomenclaturas.length : 0
        vigenciaTxt = typeof json.Data_Ultima_Atualizacao_NCM === 'string' ? json.Data_Ultima_Atualizacao_NCM : null
      } catch {
        push('JSON', false, 'Corpo não é o JSON da tabela oficial', Date.now() - tJ)
        return { ok: false, etapas, resumo: 'Resposta não é a tabela oficial. Tente de novo.' }
      }
      if (!total) {
        push('JSON', false, 'JSON sem a lista Nomenclaturas', Date.now() - tJ)
        return { ok: false, etapas, resumo: 'Resposta não é a tabela oficial. Tente de novo.' }
      }
      if (total < MIN_LINHAS_TABELA_NCM) {
        push('JSON', false, `Tabela parcial: só ${total} linhas (esperado milhares)`, Date.now() - tJ)
        return { ok: false, etapas, resumo: 'Tabela parcial — o sync recusaria aplicar. Tente de novo.' }
      }
      push('JSON', true, `${total.toLocaleString('pt-BR')} códigos · ${vigenciaTxt ?? 'vigência não informada'}`, Date.now() - tJ)
      return { ok: true, etapas, resumo: 'Conexão com o Portal Siscomex funcionando (via app desktop, sem CORS).' }
    } catch (erro) {
      const f = erroFinal(erro)
      push('Canal Electron', false, f.message, Date.now() - tIpc)
      // Erro HTTP definitivo via IPC (portal respondeu com 4xx/5xx): não há
      // por que tentar o fetch direto — encerra com o diagnóstico do portal.
      if (erro instanceof Error && /HTTP\s+(429|4\d\d|5\d\d)/i.test(erro.message)) {
        return { ok: false, etapas, resumo: f.message }
      }
      // Falha de rede no IPC: continua para o fetch direto abaixo.
    }
  }

  const t0 = Date.now()
  let resposta: Response
  try {
    resposta = await fetchComRetry(2, SISCOMEX_SYNC_CONFIG.timeoutDiagnostico)
    push('Alcance', true, 'Portal respondeu à conexão HTTPS', Date.now() - t0)
  } catch (erro) {
    const f = erroFinal(erro)
    push('Alcance', false, f.message, Date.now() - t0)
    return { ok: false, etapas, resumo: f.message }
  }

  const t1 = Date.now()
  if (!resposta.ok) {
    const m = mensagemHttp(resposta.status, null)
    push('HTTP', false, m.mensagem, Date.now() - t1)
    return { ok: false, etapas, resumo: m.mensagem }
  }
  push('HTTP', true, `HTTP ${resposta.status} OK`, Date.now() - t1)

  const t2 = Date.now()
  let texto: string
  try {
    texto = await resposta.text()
  } catch {
    push('Corpo', false, 'Conexão caiu durante o download', Date.now() - t2)
    return { ok: false, etapas, resumo: 'Conexão caiu durante o download. Tente de novo.' }
  }
  const kb = Math.round(new Blob([texto]).size / 1024)
  if (!texto.length) {
    push('Corpo', false, 'Resposta vazia do portal', Date.now() - t2)
    return { ok: false, etapas, resumo: 'Resposta vazia do portal. Tente de novo.' }
  }
  push('Corpo', true, `${kb.toLocaleString('pt-BR')} KB recebidos`, Date.now() - t2)

  const t3 = Date.now()
  let total = 0
  let vigenciaTxt: string | null = null
  try {
    const json = JSON.parse(texto) as Record<string, unknown>
    total = Array.isArray(json.Nomenclaturas) ? json.Nomenclaturas.length : 0
    vigenciaTxt = typeof json.Data_Ultima_Atualizacao_NCM === 'string' ? json.Data_Ultima_Atualizacao_NCM : null
  } catch {
    push('JSON', false, 'Corpo não é o JSON da tabela oficial', Date.now() - t3)
    return { ok: false, etapas, resumo: 'Resposta não é a tabela oficial. Tente de novo.' }
  }
  if (!total) {
    push('JSON', false, 'JSON sem a lista Nomenclaturas', Date.now() - t3)
    return { ok: false, etapas, resumo: 'Resposta não é a tabela oficial. Tente de novo.' }
  }
  if (total < MIN_LINHAS_TABELA_NCM) {
    push('JSON', false, `Tabela parcial: só ${total} linhas (esperado milhares)`, Date.now() - t3)
    return { ok: false, etapas, resumo: 'Tabela parcial — o sync recusaria aplicar. Tente de novo.' }
  }
  push('JSON', true, `${total.toLocaleString('pt-BR')} códigos · ${vigenciaTxt ?? 'vigência não informada'}`, Date.now() - t3)

  return { ok: true, etapas, resumo: 'Conexão com o Portal Siscomex funcionando.' }
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
    const codigo = (erro as { codigoErro?: NcmSyncResultado['codigoErro'] })?.codigoErro ?? null
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
    return { status: 'erro', mensagem: msg, codigoErro: codigo, duracaoMs: Date.now() - inicio }
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
    const codigo = (erro as { codigoErro?: NcmSyncResultado['codigoErro'] })?.codigoErro ?? null
    return { status: 'erro', mensagem: msg, codigoErro: codigo, duracaoMs: Date.now() - inicio }
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
