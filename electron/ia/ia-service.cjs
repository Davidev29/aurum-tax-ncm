'use strict'

/**
 * ia-service.cjs — Lado principal (main process) da IA offline (06-05 / IA-05).
 *
 * Derivado de `electron/spike/ia-spike-main.ts`: spawn do worker
 * (`electron/ia/ia-worker.cjs`, copiado para `electron/dist/` pelo esbuild)
 * via `utilityProcess.fork()` pós-`whenReady()` + round-trip IPC com
 * correlação por `id`, timeout e kill de segurança em `before-quit`.
 *
 * Este arquivo é BUNDLADO dentro de `electron/dist/main.js` (não é forkado);
 * só `ia-worker.cjs` é external/copiado. `electron` e `node-llama-cpp` ficam
 * externos no build (ver `electron/esbuild.mjs`).
 *
 * Tracer 06-05: `init` em modo mock por padrão (sem GGUF no repo). Se
 * `AURUM_IA_MODEL` apontar para um `.gguf` existente, tenta o caminho real;
 * qualquer falha cai para o mock com `mock:true` sinalizado no status.
 *
 * Fallback: se o worker não puder ser criado (ex.: renderer/web sem
 * Electron), `classificarViaIa()` responde com o seletor mock local e
 * `mock:true, fallback:'main'` — a UI nunca trava esperando o modelo.
 */

const fs = require('node:fs')
const {
  resolverWorkerPath: resolverWorkerPathCompartilhado,
} = require('./caminhos-ia.cjs')

const TIMEOUT_MS = 30_000
const MODELO_ENV = 'AURUM_IA_MODEL'

let proc = null
let appRef = null
let seq = 0
let pronto = false
let modoMock = true
let modeloPath = null
let ultimoErro = null
const pendentes = new Map()

function proximoId() {
  seq += 1
  return seq
}

/** Seletor mock local (fallback quando o worker está ausente). */
function selecionarMockLocal(descricao, candidatos) {
  const toks = (String(descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) => t.toLowerCase())
  const conjunto = new Set(toks)
  let melhor = null
  let melhorPontos = 0
  for (const c of candidatos || []) {
    const ct = (String(c.descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) => t.toLowerCase())
    let pontos = 0
    for (const t of ct) if (conjunto.has(t)) pontos += 1
    if (pontos > melhorPontos) {
      melhorPontos = pontos
      melhor = c
    }
  }
  const teto = Math.max(1, toks.length)
  const confianca = Math.round((melhorPontos / teto) * 100) / 100
  if (!melhor || confianca < 0.2) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente' }
  }
  return { codigo: melhor.codigo, confianca, motivo: 'mock-overlap' }
}

/**
 * Resolve o caminho do worker em dev e empacotado.
 * Delega ao módulo compartilhado `caminhos-ia.cjs` (06-07): dev
 * `electron/dist/ia-worker.cjs` (copiado pelo esbuild) ou fonte
 * `electron/ia/ia-worker.cjs`; empacotado, junto ao bundle via
 * `process.resourcesPath`/`app.asar.unpacked`, com fallback e log.
 */
function resolverWorkerPath() {
  return resolverWorkerPathCompartilhado(appRef)
}

function ligarRoteador(worker, aoPronto) {
  worker.on('message', (msg) => {
    const m = (msg && typeof msg === 'object' && 'data' in msg ? msg.data : msg) || {}
    if (!m || typeof m !== 'object') return
    if (m.cmd === 'pronto' && (m.id === null || m.id === undefined)) {
      aoPronto(m)
      return
    }
    const pend = typeof m.id === 'number' ? pendentes.get(m.id) : undefined
    if (pend) {
      clearTimeout(pend.timer)
      pendentes.delete(m.id)
      pend.resolver(m)
    }
  })
}

/** Envia um comando e aguarda a resposta correlacionada por `id`. */
function rpc(cmd, carga = {}) {
  return new Promise((resolver, rejeitar) => {
    if (!proc) {
      rejeitar(new Error('worker IA não iniciado'))
      return
    }
    const id = proximoId()
    const timer = setTimeout(() => {
      pendentes.delete(id)
      rejeitar(new Error(`timeout (${TIMEOUT_MS}ms) no comando "${cmd}"`))
    }, TIMEOUT_MS)
    pendentes.set(id, { resolver, timer })
    try {
      proc.postMessage({ id, cmd, ...carga })
    } catch (erro) {
      clearTimeout(timer)
      pendentes.delete(id)
      rejeitar(erro instanceof Error ? erro : new Error(String(erro)))
    }
  })
}

/**
 * Inicia o worker pós-`whenReady()`. Idempotente: chamadas repetidas
 * devolvem o status atual sem recriar o processo.
 */
async function iniciarIaService(app) {
  if (proc) return statusIa()
  appRef = app
  const { utilityProcess } = require('electron')
  const workerPath = resolverWorkerPath()
  proc = utilityProcess.fork(workerPath)

  pronto = await new Promise((resolver) => {
    const timer = setTimeout(() => resolver(false), TIMEOUT_MS)
    ligarRoteador(proc, () => {
      clearTimeout(timer)
      resolver(true)
    })
  })
  if (!pronto) {
    ultimoErro = 'timeout esperando "pronto" do worker IA'
    try { proc.kill() } catch (_) { /* ignora */ }
    proc = null
    return statusIa()
  }

  // Tracer: mock por padrão; caminho real só com GGUF explícito e existente.
  const candidatoModelo = process.env[MODELO_ENV] || ''
  const querReal = candidatoModelo.trim().length > 0 && fs.existsSync(candidatoModelo)
  try {
    const r = await rpc('init', querReal ? { mock: false, modelPath: candidatoModelo } : { mock: true })
    if (r.ok) {
      modoMock = r.mock !== false
      modeloPath = modoMock ? null : candidatoModelo
      ultimoErro = null
    } else {
      // GGUF/modelo falhou: degrada para mock em vez de quebrar a UI.
      const r2 = await rpc('init', { mock: true })
      modoMock = r2.mock !== false
      modeloPath = null
      ultimoErro = String(r.erro ?? 'init real falhou; usando mock')
    }
  } catch (e) {
    ultimoErro = e instanceof Error ? e.message : String(e)
    modoMock = true
  }
  return statusIa()
}

function statusIa() {
  let pid = null
  try {
    pid = proc && typeof proc.pid === 'number' ? proc.pid : null
  } catch (_) {
    pid = null
  }
  return {
    pronto,
    mock: modoMock,
    modo: !proc ? 'desligado' : modoMock ? 'mock' : 'modelo',
    modelPath: modeloPath,
    workerPath: proc ? resolverWorkerPath() : null,
    pid,
    erro: ultimoErro,
  }
}

/**
 * Classificação via worker. Sem worker vivo, responde com o mock local
 * (`fallback:'main'`) — a UI nunca trava.
 */
async function classificarViaIa(descricao, candidatos) {
  if (!proc || !pronto) {
    const sel = selecionarMockLocal(descricao, candidatos)
    return { ok: true, mock: true, fallback: 'main', candidatos: candidatos ?? [], ...sel, ms: 0 }
  }
  try {
    const r = await rpc('classificar', { descricao, candidatos })
    return r
  } catch (e) {
    const sel = selecionarMockLocal(descricao, candidatos)
    return {
      ok: true, mock: true, fallback: 'main',
      candidatos: candidatos ?? [], ...sel, ms: 0,
      erro: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Busca RAG (Top-k) via worker; sem worker, lista vazia com erro estruturado. */
async function buscarViaIa(consulta, k = 5) {
  if (!proc || !pronto) {
    return { ok: false, cmd: 'buscar', erro: 'worker IA não iniciado', candidatos: [] }
  }
  return rpc('buscar', { consulta, k })
}

/**
 * Encerra o worker: pede `encerrar` (best-effort, sem await longo) e aplica
 * kill de segurança. Chamado em `before-quit` — deve ser síncrono e total.
 */
function encerrarIaService() {
  try {
    if (proc) proc.postMessage({ id: proximoId(), cmd: 'encerrar' })
  } catch (_) {
    // worker já morto — o kill abaixo confirma
  }
  try {
    if (proc) proc.kill()
  } catch (_) {
    // já encerrado
  }
  proc = null
  pronto = false
  for (const [, p] of pendentes) clearTimeout(p.timer)
  pendentes.clear()
}

module.exports = {
  iniciarIaService,
  statusIa,
  classificarViaIa,
  buscarViaIa,
  encerrarIaService,
}
