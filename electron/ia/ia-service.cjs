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
 * AI-FIRST + embutido nativo: `init` tenta o GGUF empacotado
 * (`recursos-ia/modelo/*.gguf` via extraResources) ou `AURUM_IA_MODEL`.
 * Decisões (`classificar`) exigem o modelo real — sem fallback silencioso
 * para mock: sem modelo, `classificarViaIa()` responde `ok:false` com o
 * motivo, e o status expõe `modo:'erro'`. O worker em modo lexical segue
 * ativo apenas para `buscar` (retrieval de candidatos, sem decisão).
 * Defina `AURUM_AI_FIRST=0` para o comportamento legado (mock permitido).
 *
 * Fora do Electron (renderer/web sem worker), não há modelo: `classificarViaIa()`
 * também responde `ok:false` — a camada de aplicação decide (web usa o
 * seletor local e sinaliza `mock:true`; testes usam esse caminho).
 */

const fs = require('node:fs')
const {
  resolverWorkerPath: resolverWorkerPathCompartilhado,
  resolverModeloEfetivo,
} = require('./caminhos-ia.cjs')

const TIMEOUT_MS = 30_000
const MODELO_ENV = 'AURUM_IA_MODEL'
/** AI-first padrão: decisões exigem o GGUF real. `AURUM_AI_FIRST=0` libera o mock legado. */
const AI_FIRST = (process.env.AURUM_AI_FIRST ?? '1') !== '0'

let proc = null
let appRef = null
let seq = 0
let pronto = false
let modoMock = true
let realPronto = false
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

  // Embutido nativo: env explícito primeiro, senão modelo empacotado
  // (recursos-ia/modelo/*.gguf via extraResources, resolvido por caminhos-ia).
  const candidatoEnv = process.env[MODELO_ENV] || ''
  let candidatoModelo = candidatoEnv.trim().length > 0 && fs.existsSync(candidatoEnv) ? candidatoEnv : null
  let formatoModelo = candidatoModelo ? 'gguf' : null
  if (!candidatoModelo) {
    try {
      const ef = typeof resolverModeloEfetivo === 'function' ? resolverModeloEfetivo(app) : null
      if (ef && ef.caminho && ef.formato === 'gguf' && fs.existsSync(ef.caminho)) {
        candidatoModelo = ef.caminho
        formatoModelo = 'gguf'
      } else if (ef && ef.formato === 'cifrado') {
        // Layout protegido 06-08 exige chave (safeStorage/env) + carga via
        // buffer — pendência UAT documentada.
        ultimoErro = `modelo cifrado sem carga em memória (UAT-06-08): ${ef.caminho}`
      }
    } catch (_) {
      // resolução nunca quebra o boot
    }
  }
  const querReal = !!candidatoModelo && formatoModelo === 'gguf'
  const avisoPrevio = ultimoErro
  try {
    if (querReal) {
      const r = await rpc('init', { mock: false, modelPath: candidatoModelo })
      if (r.ok && r.mock === false) {
        realPronto = true
        modoMock = false
        modeloPath = candidatoModelo
        ultimoErro = null
        return statusIa()
      }
      // Real falhou: sem fallback silencioso em AI-first.
      ultimoErro = String(r.erro ?? 'init real falhou')
      realPronto = false
      modeloPath = null
      if (!AI_FIRST) {
        const r2 = await rpc('init', { mock: true })
        modoMock = r2.mock !== false
        ultimoErro = `${ultimoErro}; usando mock legado (AURUM_AI_FIRST=0)`
        return statusIa()
      }
      // AI-first: mantém o worker vivo em modo lexical só para `buscar`;
      // decisões continuam bloqueadas até o modelo carregar.
      try {
        await rpc('init', { mock: true })
        modoMock = true
      } catch (_) { /* worker segue sem init */ }
      return statusIa()
    }
    // Sem GGUF: AI-first bloqueia decisões; legado permite mock.
    realPronto = false
    modeloPath = null
    if (!AI_FIRST) {
      const r2 = await rpc('init', { mock: true })
      modoMock = r2.mock !== false
      ultimoErro = avisoPrevio
      return statusIa()
    }
    ultimoErro = avisoPrevio ?? 'Modelo IA obrigatório ausente: recursos-ia/modelo/ailo-152m-v2-q4_k_m.gguf não encontrado.'
    try {
      await rpc('init', { mock: true })
      modoMock = true
    } catch (_) { /* worker segue sem init */ }
  } catch (e) {
    ultimoErro = e instanceof Error ? e.message : String(e)
    realPronto = false
    if (!AI_FIRST) modoMock = true
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
  const modo = !proc ? 'desligado' : realPronto ? 'modelo' : AI_FIRST ? 'erro' : modoMock ? 'mock' : 'modelo'
  return {
    pronto: pronto && (realPronto || !AI_FIRST),
    mock: !realPronto,
    modo,
    modelPath: modeloPath,
    workerPath: proc ? resolverWorkerPath() : null,
    pid,
    erro: ultimoErro,
  }
}

/**
 * Classificação via worker AI-FIRST. Exige o modelo real: sem `realPronto`,
 * responde `ok:false` (nunca mock silencioso). `buscar` lexical segue
 * disponível para montar candidatos.
 */
async function classificarViaIa(descricao, candidatos) {
  if (!proc || !pronto) {
    if (!AI_FIRST) {
      const sel = selecionarMockLocal(descricao, candidatos)
      return { ok: true, mock: true, fallback: 'main', candidatos: candidatos ?? [], ...sel, ms: 0 }
    }
    return { ok: false, mock: false, cmd: 'classificar', erro: ultimoErro ?? 'worker IA não iniciado', candidatos: candidatos ?? [] }
  }
  if (!realPronto) {
    if (!AI_FIRST) {
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
    return { ok: false, mock: false, cmd: 'classificar', erro: ultimoErro ?? 'Modelo IA obrigatório indisponível (modo=erro). Verifique recursos-ia/modelo/*.gguf + node-llama-cpp.', candidatos: candidatos ?? [] }
  }
  const r = await rpc('classificar', { descricao, candidatos })
  if (AI_FIRST && r.mock) {
    return { ok: false, mock: false, cmd: 'classificar', erro: `worker respondeu em modo local (esperado modelo real): ${r.motivo ?? 'mock'}`, candidatos: r.candidatos ?? candidatos ?? [] }
  }
  return r
}

/** Busca RAG (Top-k) via worker; sem worker, lista vazia com erro estruturado. */
async function buscarViaIa(consulta, k = 5) {
  if (!proc || !pronto) {
    return { ok: false, cmd: 'buscar', erro: 'worker IA não iniciado', candidatos: [] }
  }
  return rpc('buscar', { consulta, k })
}

/**
 * Tradução fiscal em tempo real via worker (dicionário, sem modelo).
 * Funciona mesmo sem GGUF (só exige o worker vivo para `buscar`).
 */
async function traduzirViaIa(texto, para = 'en') {
  if (!proc || !pronto) {
    return { ok: false, cmd: 'traduzir', erro: 'worker IA não iniciado', texto: String(texto ?? '') }
  }
  return rpc('traduzir', { texto, para })
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
  traduzirViaIa,
  encerrarIaService,
}
