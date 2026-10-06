/**
 * Overlay de aprendizado local — escritores do renderer (Phase 10-05 / GRAFO-08).
 *
 * - `registrarUsoLocal`: escolha em `<select>` (lote/consulta), `ia_feedback` ±
 *   e CNAE via CNPJ alimentam o overlay via `bridge.ia.registrarUsoGrafo`
 *   (Electron, arquivo `%APPDATA%/grafo/aprendizado.json` com TTL 90d + teto
 *   5000 + demote) com fallback `localStorage` (web/testes, mesma poda).
 * - `agendarJobOverlay`: job incremental ao abrir + ocioso (<1s via
 *   `requestIdleCallback`/`setTimeout`, nunca rebuild diário — só poda
 *   TTL + teto, <1s).
 * - `porQueSugeriu`: texto `base + seu uso` (`boost: uso_local`) para a UI.
 *
 * O overlay SÓ reordena (boost com teto 0.3 em `calcularBoost`) — nunca cria
 * redução; o resolvedor tem veto total. NUNCA lança.
 */

import { bridge } from '@/infrastructure/bridge'
import { hashEmitente, removerPII } from '@/ai/guards'

export interface EventoUsoGrafo {
  tipo: string
  termo?: string | null
  codigo?: string | null
  emitente?: string | null
  peso?: number
}

const CHAVE_LOCAL = 'aurum_grafo_overlay_v1'
const MAX_LOCAL = 5000
const TTL_MS = 90 * 24 * 60 * 60 * 1000

interface ArestaLocal {
  de: string
  para: string
  tipo: string
  origem: string
  peso: number
  criadoEm: string
  feedback?: string
  emitente?: string
  termo?: string
}

function agoraIso(): string {
  try {
    return new Date().toISOString()
  } catch {
    return '2026-01-01T00:00:00.000Z'
  }
}

function lerLocal(): ArestaLocal[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(CHAVE_LOCAL)
    if (!raw) return []
    const doc = JSON.parse(raw) as { arestas?: ArestaLocal[] }
    return Array.isArray(doc.arestas) ? doc.arestas.filter((a) => a && typeof a === 'object') : []
  } catch {
    return []
  }
}

function salvarLocal(arestas: ArestaLocal[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ versao: 1, arestas: arestas.slice(0, MAX_LOCAL) }))
  } catch {
    /* armazenamento cheio/bloqueado: ignora */
  }
}

function podarLocal(arestas: ArestaLocal[], agora: number): ArestaLocal[] {
  const vigentes = arestas.filter((a) => {
    try {
      if (!a?.criadoEm) return true
      const t = new Date(a.criadoEm).getTime()
      if (!Number.isFinite(t)) return true
      return agora - t <= TTL_MS
    } catch {
      return true
    }
  })
  if (vigentes.length <= MAX_LOCAL) return vigentes
  const comIndice = vigentes.map((a, i) => ({ a, i }))
  comIndice.sort((x, y) => {
    const tx = x.a.criadoEm ? new Date(x.a.criadoEm).getTime() : 0
    const ty = y.a.criadoEm ? new Date(y.a.criadoEm).getTime() : 0
    if (ty !== tx) return ty - tx
    return y.i - x.i
  })
  return comIndice.slice(0, MAX_LOCAL).map((x) => x.a)
}

/**
 * Registra uso (escolha `<select>`, feedback ±, CNAE via CNPJ).
 * Tenta o canal Electron primeiro; sem canal, guarda no `localStorage`.
 * NUNCA lança, NUNCA bloqueia a UI.
 */
export function registrarUsoLocal(evento: EventoUsoGrafo): void {
  try {
    const e: EventoUsoGrafo = {
      tipo: String(evento?.tipo || 'NCM-ESCOLHIDO').slice(0, 40),
      // C-008: termo sem PII, emitente como hash — nunca CNPJ cru no overlay/IPC
      ...(evento?.termo ? { termo: removerPII(String(evento.termo)).slice(0, 120) } : {}),
      ...(evento?.codigo ? { codigo: String(evento.codigo).slice(0, 20) } : {}),
      ...(evento?.emitente ? { emitente: hashEmitente(evento.emitente) } : {}),
      ...(evento?.peso !== undefined ? { peso: Number(evento.peso) || 0 } : {}),
    }
    if (!e.codigo) return
    // Electron: arquivo só-na-máquina (grafo-service `registrarUso`).
    try {
      const fn = bridge?.ia?.registrarUsoGrafo
      if (typeof fn === 'function') {
        void fn.call(bridge!.ia, e).catch(() => undefined)
      }
    } catch {
      /* segue para o fallback local */
    }
    // Fallback local (web/testes): espelho podado em `localStorage`.
    try {
      const dig = String(e.codigo).replace(/\D+/g, '')
      const para = dig.length === 8 ? `NCM:${dig}` : dig.length === 9 ? `NBS:${dig}` : dig.length === 7 ? `CNAE:${dig}` : `Codigo:${dig}`
      const de = e.termo
        ? `Termo:${String(e.termo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().slice(0, 80)}`
        : e.emitente
          ? `Emitente:${e.emitente}`
          : `Uso:${e.tipo}`
      const ehDemote = /negativo|rejeit/i.test(e.tipo) || Number(e.peso) < 0
      const aresta: ArestaLocal = {
        de,
        para,
        tipo: e.tipo,
        origem: 'uso_local',
        peso: ehDemote ? 0 : Math.abs(Number(e.peso) || 0.1),
        criadoEm: agoraIso(),
        ...(ehDemote ? { feedback: 'negativo' } : {}),
        ...(e.emitente ? { emitente: e.emitente } : {}),
        ...(e.termo ? { termo: String(e.termo).slice(0, 120) } : {}),
      }
      const atual = lerLocal()
      if (ehDemote) {
        for (const a of atual) {
          if (String(a.para).replace(/\D+/g, '') === dig) a.feedback = 'negativo'
        }
      }
      atual.push(aresta)
      salvarLocal(podarLocal(atual, Date.now()))
    } catch {
      /* fallback nunca quebra */
    }
  } catch {
    /* nunca lança */
  }
}

/** Atalhos tipados para os três escritores (lote/consulta, feedback, CNPJ). */
export function registrarEscolhaUso(termo: string, codigo: string, peso = 0.1): void {
  registrarUsoLocal({ tipo: 'NCM-ESCOLHIDO', termo, codigo, peso })
}

export function registrarFeedbackUso(descricao: string, codigo: string | null, positivo: boolean): void {
  if (!codigo) return
  registrarUsoLocal({
    tipo: positivo ? 'NCM-ESCOLHIDO' : 'feedback-negativo',
    termo: descricao,
    codigo,
    peso: positivo ? 0.1 : -0.1,
  })
}

export function registrarCnaeUso(cnae7: string, cnpjEmitente?: string | null): void {
  const dig = String(cnae7 ?? '').replace(/\D+/g, '')
  if (dig.length !== 7) return
  registrarUsoLocal({ tipo: 'CNAE-CARTEIRA', codigo: dig, emitente: cnpjEmitente ?? null, peso: 0.1 })
}

let jobAgendado = false

/**
 * Job incremental do overlay: poda TTL + teto em <1s, ao abrir + ocioso.
 * Usa `requestIdleCallback` quando disponível, senão `setTimeout(0)`.
 * Nunca rebuilda o grafo; nunca lança; idempotente por sessão.
 */
export function agendarJobOverlay(): void {
  try {
    if (jobAgendado) return
    jobAgendado = true
    const executar = () => {
      try {
        const t0 = Date.now()
        const atual = lerLocal()
        const podado = podarLocal(atual, Date.now())
        if (podado.length !== atual.length) salvarLocal(podado)
        void (Date.now() - t0)
      } catch {
        /* job nunca quebra o app */
      }
    }
    const ric = (globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void
    }).requestIdleCallback
    if (typeof ric === 'function') {
      try {
        ric(() => executar(), { timeout: 800 })
        return
      } catch {
        /* cai no setTimeout */
      }
    }
    setTimeout(executar, 0)
  } catch {
    /* nunca lança */
  }
}

/**
 * Texto "por que sugeriu" (`base + seu uso`, com `boost: uso_local`).
 * Puro — a UI exibe junto ao badge `via:grafo`.
 */
export function porQueSugeriu(
  caminho: string[] | null | undefined,
  boost: 'uso_local' | null | undefined,
  boostValor?: number,
): string | null {
  if (!caminho?.length) return null
  const base = `base: ${caminho.join(' → ')}`
  if (boost === 'uso_local' && Number(boostValor) > 0) {
    return `${base} + seu uso (boost: uso_local +${Number(boostValor)})`
  }
  return base
}
