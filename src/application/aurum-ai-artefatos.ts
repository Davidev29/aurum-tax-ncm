/**
 * Aurum AI — artefatos-resumo cifrados (memória de sistema).
 *
 * A cada chat, a IA condensa o que aprendeu (perfil, assuntos recentes,
 * termos confirmados, correções) num **artefato resumido** que é
 * **cifrado em repouso (AES-GCM-256)** e **descriptografado só aqui dentro**,
 * na hora de responder um novo chat. Nenhum outro módulo vê a chave nem o
 * claro: para o resto do sistema o artefato é um envelope opaco.
 *
 * Modelo de ameaça (honesto, documentado):
 * - Protege contra: backup vazado, inspeção casual do SQLite/`meta`,
 *   logs e relatórios (o claro nunca sai deste módulo; `backup.ts` nem lê
 *   a store `meta`, então chave e artefatos ficam fora de qualquer export).
 * - NÃO protege contra: invasor com acesso total ao dispositivo + DevTools
 *   (a chave precisa morar no aparelho para o modo offline funcionar).
 *   Para resistência total existe o gancho `definirProvedorSegredoOS()`: o
 *   Electron pode plugar o keychain do SO (safeStorage) sem mexer nos
 *   call sites — aí a KEK sai do SQLite.
 *
 * Tudo é best-effort: sem WebCrypto ou sem banco, o chat segue sem artefato.
 */

import { normalizarBusca } from '@/domain/services/busca-texto'
import { extrairNucleoBusca } from '@/domain/services/detector-chat'
import { temSinalFiscal } from '@/domain/services/escopo-consulta'
import {
  carregarPerfilMemoria,
  emitenteIdAtual,
  listarFatosMemoria,
  type FatoAprendido,
  type PerfilMemoria,
} from './aurum-ai-memoria'

/* ---------------------------------------------------------- cripto -- */

export interface EnvelopeCifrado {
  /** Marcador de envelope (nunca o claro). */
  v: 1
  alg: 'AES-GCM-256'
  /** Nonce de 12 bytes, base64. */
  iv: string
  /** Ciphertext + tag GCM, base64. */
  data: string
}

const CHAVE_KEK = 'aurum_kek_artefatos_v1'
const IV_BYTES = 12

/** Gancho para o keychain do SO (Electron safeStorage). Opcional. */
export interface ProvedorSegredoOS {
  obter(): Promise<JsonWebKey | null>
  guardar(jwk: JsonWebKey): Promise<void>
}

let provedorOS: ProvedorSegredoOS | null = null

/** Pluga o cofre do SO. Só a IA usa — a chave nunca é logada nem exportada. */
export function definirProvedorSegredoOS(p: ProvedorSegredoOS | null): void {
  provedorOS = p
  chaveMemo = null
}

function subtle(): SubtleCrypto | null {
  try {
    const c = globalThis.crypto as Crypto | undefined
    return c?.subtle ?? null
  } catch {
    return null
  }
}

function bytesParaB64(bytes: Uint8Array): string {
  let s = ''
  const passo = 0x8000
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode(...bytes.subarray(i, i + passo))
  }
  if (typeof btoa === 'function') return btoa(s)
  // Fallback Node (testes): Buffer.
  const B = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer
  if (B) return B.from(s, 'binary').toString('base64')
  throw new Error('sem-base64')
}

function b64ParaBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === 'function') {
    const s = atob(b64)
    const out = new Uint8Array(new ArrayBuffer(s.length))
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  const B = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer
  if (B) return Uint8Array.from(B.from(b64, 'base64'))
  throw new Error('sem-base64')
}

function lerLocal(chave: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(chave) : null
  } catch {
    return null
  }
}

function gravarLocal(chave: string, valor: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(chave, valor)
  } catch {
    /* best-effort */
  }
}

async function lerMeta(chave: string): Promise<unknown | null> {
  try {
    const { db } = await import('@/infrastructure/db/schema')
    const row = await db.table('meta').get(chave).catch(() => null)
    return (row as { valor?: unknown } | null)?.valor ?? null
  } catch {
    return null
  }
}

async function gravarMeta(chave: string, valor: unknown): Promise<void> {
  try {
    const { db } = await import('@/infrastructure/db/schema')
    await db.table('meta').put({ chave, valor }).catch(() => null)
  } catch {
    /* best-effort */
  }
}

let chaveMemo: CryptoKey | null = null

/**
 * Chave mestra do dispositivo (KEK). Gerada uma vez (256 bits aleatórios),
 * memoizada em memória e persistida SÓ no cofre (SO ou `meta` dedicada).
 * Nunca entra em backup, relatório, log ou envelope.
 */
async function obterChave(): Promise<CryptoKey | null> {
  const sb = subtle()
  if (!sb) return null
  if (chaveMemo) return chaveMemo
  // 1) Cofre do SO, quando plugado (Electron futuro).
  if (provedorOS) {
    try {
      const jwk = await provedorOS.obter().catch(() => null)
      if (jwk) {
        chaveMemo = await sb.importKey('jwk', jwk, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
        return chaveMemo
      }
    } catch {
      /* cai para o cofre local */
    }
  }
  // 2) Cofre local dedicado (fora de backup/relatório por construção).
  try {
    const crua = ((await lerMeta(CHAVE_KEK).catch(() => null)) as JsonWebKey | null)
      ?? (JSON.parse(lerLocal(CHAVE_KEK) ?? 'null') as JsonWebKey | null)
    if (crua && crua.kty === 'oct') {
      chaveMemo = await sb.importKey('jwk', crua, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
      return chaveMemo
    }
  } catch {
    /* gera nova abaixo */
  }
  try {
    const nova = await sb.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
    const jwk = await sb.exportKey('jwk', nova)
    if (provedorOS) {
      await provedorOS.guardar(jwk).catch(() => null)
    }
    gravarLocal(CHAVE_KEK, JSON.stringify(jwk))
    await gravarMeta(CHAVE_KEK, jwk).catch(() => null)
    chaveMemo = nova
    return nova
  } catch {
    return null
  }
}

/** Cifra um texto curto (o artefato). Só este módulo cifra. */
export async function cifrarTexto(claro: string): Promise<EnvelopeCifrado | null> {
  try {
    const sb = subtle()
    const chave = await obterChave()
    if (!sb || !chave) return null
    const iv = new Uint8Array(IV_BYTES)
    globalThis.crypto.getRandomValues(iv)
    const buf = await sb.encrypt({ name: 'AES-GCM', iv }, chave, new TextEncoder().encode(claro))
    return { v: 1, alg: 'AES-GCM-256', iv: bytesParaB64(iv), data: bytesParaB64(new Uint8Array(buf)) }
  } catch {
    return null
  }
}

/** Decifra um envelope. Só este módulo decifra. Falha → null (sem throw). */
export async function decifrarTexto(env: unknown): Promise<string | null> {
  try {
    const sb = subtle()
    const chave = await obterChave()
    if (!sb || !chave) return null
    const e = env as Partial<EnvelopeCifrado>
    if (!e || e.v !== 1 || e.alg !== 'AES-GCM-256' || typeof e.iv !== 'string' || typeof e.data !== 'string') return null
    const buf = await sb.decrypt({ name: 'AES-GCM', iv: b64ParaBytes(e.iv) }, chave, b64ParaBytes(e.data))
    return new TextDecoder().decode(buf)
  } catch {
    // Envelope adulterado, chave trocada ou WebCrypto indisponível: sem claro.
    return null
  }
}

/** `true` quando algo parece envelope cifrado (para testes/auditoria). */
export function ehEnvelopeCifrado(v: unknown): boolean {
  const e = v as Partial<EnvelopeCifrado> | null
  return !!e && e.v === 1 && e.alg === 'AES-GCM-256' && typeof e.iv === 'string' && typeof e.data === 'string'
}

/* -------------------------------------------------------- artefato -- */

export interface ResumoAssunto {
  termo: string
  codigo: string | null
  tipo: 'ncm' | 'nbs' | null
  /** Peso do aprendizado (−5…+5). */
  peso: number
  quando: string
}

export interface CorrecaoResumo {
  termo: string
  codigoRejeitado: string
  quando: string
}

/** Conteúdo claro do artefato — nunca persistido sem cifra. */
export interface ArtefatoResumo {
  v: 1
  emitenteId: string
  atualizadoEm: string
  interacoes: number
  nome: string | null
  comoChamar: string | null
  assuntos: ResumoAssunto[]
  correcoes: CorrecaoResumo[]
  ultimoCodigoNcm: string | null
  ultimoCodigoNbs: string | null
  totalConversas: number
}

/** Visão descriptografada para o orquestrador (só a IA consome). */
export interface MemoriaSistema {
  assunto: string | null
  dominio: 'ncm' | 'nbs' | null
  codigoNcm: string | null
  codigoNbs: string | null
  nome: string | null
  /** 2–4 linhas curtas de contexto ("Último assunto: danone → NCM 0403.20.00"). */
  linhas: string[]
  /** Quando o artefato foi gerado (para depuração/auditoria). */
  atualizadoEm: string | null
}

function chaveArtefato(emitenteId: string): string {
  return `aurum_artefato_resumo__${emitenteId}`
}

export interface HistoricoSimples {
  papel: 'user' | 'assistant'
  texto: string
}

/**
 * Condensa um chat em resumo (puro e testável): últimos assuntos com sinal
 * fiscal + códigos classificados na sequência + correções recentes.
 * Nada de LLM aqui: é determinístico, barato e auditável.
 */
export function construirArtefato(
  historico: HistoricoSimples[],
  perfil: PerfilMemoria,
  fatos: FatoAprendido[],
  correcoes: CorrecaoResumo[],
  opts?: { emitenteId?: string; totalConversas?: number },
): ArtefatoResumo {
  const ultimas = historico.slice(-20)
  const porTermo = new Map<string, FatoAprendido>()
  for (const f of fatos) {
    const k = normalizarBusca(f.termo)
    if (k && !porTermo.has(k)) porTermo.set(k, f)
  }
  // Códigos em ordem cronológica (último vence) — aceita o formato da IA.
  let ultimoCodigoNcm: string | null = null
  let ultimoCodigoNbs: string | null = null
  for (const m of ultimas) {
    const f8 = m.texto.match(/\b\d{4}\.\d{2}\.\d{2}\b/)
    const p8 = m.texto.match(/\b\d{8}\b/)
    const a8 = f8?.[0] ?? p8?.[0] ?? null
    if (a8 && a8.replace(/\D+/g, '').length === 8) ultimoCodigoNcm = a8.replace(/\D+/g, '')
    const f9 = m.texto.match(/\b\d{3}\.\d{3}\.\d{3}\b/)
    const p9 = m.texto.match(/\b\d{9}\b/)
    const a9 = f9?.[0] ?? p9?.[0] ?? null
    if (a9 && a9.replace(/\D+/g, '').length === 9) ultimoCodigoNbs = a9.replace(/\D+/g, '')
  }
  // Assuntos: núcleos das falas do usuário com lastro fiscal (recentes primeiro).
  const assuntos: ResumoAssunto[] = []
  const vistos = new Set<string>()
  const falasUsuario = ultimas.filter((m) => m.papel === 'user').map((m) => m.texto)
  for (let i = falasUsuario.length - 1; i >= 0 && assuntos.length < 5; i--) {
    const fala = falasUsuario[i]
    if (/\d{8,9}/.test(fala)) continue
    const nuc = extrairNucleoBusca(fala)
    if (!nuc || nuc.length > 80) continue
    if (!temSinalFiscal(fala)) continue
    const k = normalizarBusca(nuc)
    if (!k || vistos.has(k)) continue
    vistos.add(k)
    const fato = porTermo.get(k)
    const fl = fala.toLowerCase()
    assuntos.push({
      termo: nuc.slice(0, 80),
      codigo: fato?.codigo ?? null,
      tipo: fato?.tipo ?? (/nbs|servi[cç]o|atividade|cnae|aula|curso/.test(fl) && !/ncm|produto|mercadoria/.test(fl) ? 'nbs' : 'ncm'),
      peso: fato?.peso ?? 0,
      quando: new Date().toISOString(),
    })
  }
  return {
    v: 1,
    emitenteId: opts?.emitenteId ?? emitenteIdAtual(),
    atualizadoEm: new Date().toISOString(),
    interacoes: Number(perfil.interacoes) || 0,
    nome: perfil.nome,
    comoChamar: perfil.comoChamar,
    assuntos,
    correcoes: correcoes.slice(0, 5),
    ultimoCodigoNcm,
    ultimoCodigoNbs,
    totalConversas: Number(opts?.totalConversas) || 0,
  }
}

function artefatoValido(v: unknown): v is ArtefatoResumo {
  const a = v as Partial<ArtefatoResumo> | null
  return !!a && a.v === 1 && Array.isArray(a.assuntos) && Array.isArray(a.correcoes)
}

// Throttle em memória: no máximo 1 gravação / 30s por emitente (a troca de
// conversa força com `forcar: true`).
const ultimoWrite = new Map<string, number>()
const JANELA_MS = 30000

/**
 * Regenera o artefato-resumo do emitente a partir do chat atual + perfil +
 * fatos + correções, cifra e persiste (só o envelope opaco é gravado).
 * Best-effort, nunca joga erro, nunca grava claro.
 */
export async function atualizarArtefatoResumido(
  historico: HistoricoSimples[],
  opts?: { forcar?: boolean; emitenteId?: string; totalConversas?: number },
): Promise<boolean> {
  try {
    const id = opts?.emitenteId ?? emitenteIdAtual()
    if (!opts?.forcar) {
      const ultimo = ultimoWrite.get(id) ?? 0
      if (Date.now() - ultimo < JANELA_MS) return false
    }
    if (!historico.some((m) => m.papel === 'user')) return false
    const [perfil, fatos] = await Promise.all([
      carregarPerfilMemoria(id).catch(() => ({ nome: null, comoChamar: null, interacoes: 0, atualizadoEm: null })),
      listarFatosMemoria(id, 20).catch(() => []),
    ])
    let correcoes: CorrecaoResumo[] = []
    try {
      const { db } = await import('@/infrastructure/db/schema')
      const fb = await db.table('ia_feedback').orderBy('quando').reverse().limit(10).toArray().catch(() => [])
      correcoes = (fb as { descricao?: unknown; decisao?: unknown; quando?: unknown }[])
        .filter((r) => typeof r?.decisao === 'string' && r.decisao)
        .slice(0, 5)
        .map((r) => ({
          termo: String(r.descricao ?? '').slice(0, 80),
          codigoRejeitado: String(r.decisao).replace(/\D+/g, ''),
          quando: String(r.quando ?? ''),
        }))
    } catch {
      correcoes = []
    }
    const artefato = construirArtefato(historico, perfil, fatos, correcoes, {
      emitenteId: id,
      totalConversas: opts?.totalConversas,
    })
    const env = await cifrarTexto(JSON.stringify(artefato))
    if (!env) return false
    const chave = chaveArtefato(id)
    gravarLocal(chave, JSON.stringify(env))
    await gravarMeta(chave, env).catch(() => null)
    ultimoWrite.set(id, Date.now())
    return true
  } catch {
    return false
  }
}

/**
 * Carrega e descriptografa o artefato do emitente. O claro existe SÓ no
 * retorno desta função, consumido apenas pelo orquestrador da IA.
 * Sem artefato / envelope inválido / chave trocada → null (chat segue normal).
 */
export async function carregarMemoriaSistema(emitenteId?: string): Promise<MemoriaSistema | null> {
  try {
    const id = emitenteId ?? emitenteIdAtual()
    const chave = chaveArtefato(id)
    let env: unknown = null
    try {
      const { db } = await import('@/infrastructure/db/schema')
      env = await db.table('meta').get(chave).then((r) => (r as { valor?: unknown } | null)?.valor ?? null).catch(() => null)
    } catch {
      env = null
    }
    if (!ehEnvelopeCifrado(env)) {
      try {
        env = JSON.parse(lerLocal(chave) ?? 'null')
      } catch {
        env = null
      }
    }
    if (!ehEnvelopeCifrado(env)) return null
    const claro = await decifrarTexto(env)
    if (!claro) return null
    let artefato: unknown = null
    try {
      artefato = JSON.parse(claro)
    } catch {
      return null
    }
    if (!artefatoValido(artefato)) return null
    const primeiro = artefato.assuntos[0] ?? null
    const linhas: string[] = []
    if (primeiro) {
      const cod = primeiro.codigo
        ? ` → ${primeiro.tipo === 'nbs' ? 'NBS' : 'NCM'} ${primeiro.codigo.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}`
        : ''
      linhas.push(`Último assunto: ${primeiro.termo}${cod}${primeiro.peso !== 0 ? ` (aprendizado ${primeiro.peso > 0 ? '+' : ''}${primeiro.peso})` : ''}`)
    }
    if (artefato.ultimoCodigoNcm && artefato.ultimoCodigoNcm !== primeiro?.codigo) {
      linhas.push(`Último NCM: ${artefato.ultimoCodigoNcm.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')}`)
    }
    if (artefato.correcoes.length) {
      linhas.push(`Correções a respeitar: ${artefato.correcoes.length} termo(s) com caminho rejeitado`)
    }
    return {
      assunto: primeiro?.termo ?? null,
      dominio: primeiro?.tipo ?? (artefato.ultimoCodigoNbs && !artefato.ultimoCodigoNcm ? 'nbs' : primeiro ? 'ncm' : null),
      codigoNcm: artefato.ultimoCodigoNcm,
      codigoNbs: artefato.ultimoCodigoNbs,
      nome: artefato.nome,
      linhas,
      atualizadoEm: artefato.atualizadoEm,
    }
  } catch {
    return null
  }
}

/**
 * Preenche os buracos do contexto do histórico com o artefato (novo chat,
 * conversa arquivada, reload). Nunca sobrescreve o que o histórico já diz:
 * o presente vence o passado.
 */
export function mesclarContextoComArtefato<
  T extends {
    ultimoCodigoNcm: string | null
    ultimoCodigoNbs: string | null
    ultimoAssunto: string | null
    ultimoDominio: 'ncm' | 'nbs' | null
  },
>(ctx: T, memoria?: MemoriaSistema | null): T {
  if (!memoria) return ctx
  return {
    ...ctx,
    ultimoCodigoNcm: ctx.ultimoCodigoNcm ?? memoria.codigoNcm,
    ultimoCodigoNbs: ctx.ultimoCodigoNbs ?? memoria.codigoNbs,
    ultimoAssunto: ctx.ultimoAssunto ?? memoria.assunto,
    ultimoDominio: ctx.ultimoDominio ?? memoria.dominio,
  }
}
