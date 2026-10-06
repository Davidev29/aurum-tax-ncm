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
const path = require('node:path')
let caminhosIa = null
try {
  caminhosIa = require('./caminhos-ia.cjs')
} catch (_) {
  caminhosIa = null
}
const {
  resolverWorkerPath: resolverWorkerPathCompartilhado,
  resolverModeloEfetivo,
} = caminhosIa || {}

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
let perfilModelo = null
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
  try {
    if (typeof resolverWorkerPathCompartilhado === 'function') {
      return resolverWorkerPathCompartilhado(appRef)
    }
  } catch (_) {
    // fallback abaixo
  }
  return null
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
        perfilModelo = r.perfil ?? null
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
    perfilModelo = null
    if (!AI_FIRST) {
      const r2 = await rpc('init', { mock: true })
      modoMock = r2.mock !== false
      ultimoErro = avisoPrevio
      return statusIa()
    }
    ultimoErro = avisoPrevio ?? 'Modelo IA obrigatório ausente: nenhum *.gguf em recursos-ia/modelo/ (troque o arquivo .gguf e reinicie).'
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
    perfil: perfilModelo,
    observandoModelo,
    ultimaTrocaModelo,
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
    return { ok: false, mock: false, cmd: 'classificar', erro: ultimoErro ?? 'Modelo IA obrigatório indisponível (modo=erro). Verifique o *.gguf em recursos-ia/modelo/ + node-llama-cpp.', candidatos: candidatos ?? [] }
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
 * Consulta o grafo fiscal (Phase 10-02 / GRAFO-02): FTS + expansão 2-hops com
 * caminho auditável (`via:grafo` em 10-05).
 *
 * Tenta o worker via rpc (`cmd 'grafo'` no `ia-worker.cjs`); sem worker vivo,
 * delega DIRETO ao `grafo-service.cjs` (caminho usado em testes do main e em
 * boot degradado). Sem `.lbug` → `{ ok:false, fallback:'lexical' }`.
 * NUNCA lança.
 */
async function grafoConsultarViaGrafo(opcoes = {}) {
  const o = (opcoes && typeof opcoes === 'object' ? opcoes : {})
  const args = {
    texto: String(o.texto ?? o.consulta ?? ''),
    k: Number(o.k) > 0 ? Number(o.k) : 5,
    ...(o.anoReferencia !== undefined && o.anoReferencia !== null ? { anoReferencia: Number(o.anoReferencia) } : {}),
    // Toggle DebugIA (10-03): 'fts-puro' pula o estágio vetorial no runtime.
    ...(o.modoVetor === 'fts-puro' ? { modoVetorForcado: 'fts-puro' } : {}),
  }
  if (!args.texto.trim()) {
    return { ok: false, fallback: 'lexical', erro: 'texto vazio' }
  }
  if (proc && pronto) {
    try {
      const r = await rpc('grafo', args)
      if (r && typeof r === 'object') return r
    } catch (_) {
      // worker falhou — cai para o direto abaixo (fail-closed, sem throw)
    }
  }
  try {
    const gs = require('./grafo-service.cjs')
    return await gs.grafoConsultar(args, { app: appRef })
  } catch (e) {
    return { ok: false, fallback: 'lexical', erro: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Conversa livre via worker (IA-06). Exige modelo real (`realPronto`):
 * sem modelo responde `ok:false` para o renderer cair no template
 * determinístico (fail-closed, nunca mock verbalizando).
 */
async function conversarViaIa(pergunta, opts = {}) {
  if (!proc || !pronto || !realPronto) {
    return { ok: false, mock: false, cmd: 'conversar', erro: ultimoErro ?? 'Modelo IA indisponível para conversa livre.' }
  }
  try {
    const r = await rpc('conversar', {
      pergunta: String(pergunta ?? ''),
      sistema: String(opts.sistema ?? ''),
      historico: Array.isArray(opts.historico) ? opts.historico.slice(-6) : [],
      think: opts.think === true,
      maxTokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : undefined,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : undefined,
    })
    return r
  } catch (e) {
    return { ok: false, mock: false, cmd: 'conversar', erro: e instanceof Error ? e.message : String(e) }
  }
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
  perfilModelo = null
  for (const [, p] of pendentes) clearTimeout(p.timer)
  pendentes.clear()
}

async function perfilModeloViaIa() {
  if (!proc || !pronto) return { ok: false, erro: 'worker IA não iniciado' }
  try {
    return await rpc('perfil', {})
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// Troca automática de modelo (hot-swap): apagou o .gguf e colocou outro, o
// sistema percebe sozinho — sem reiniciar o app.
// `observarModelo(app)` vigia `recursos-ia/modelo/` com `fs.watch`; ao
// detectar `*.gguf`/`modelo.json` novo/removido, aguarda o arquivo estabilizar
// (cópia de centenas de MB leva minutos) e recarrega o worker com o perfil da
// camada de compatibilidade. Desliga com `AURUM_IA_WATCH=0`.
// ---------------------------------------------------------------------------

let observadorModelo = null
let observandoModelo = false
let emRecargaModelo = false
let recargaModeloPendente = null
let timerRecargaModelo = null
let ultimaTrocaModelo = null

/** `true` para arquivos que disparam a troca (`*.gguf` + `modelo.json`). */
function ehArquivoDeModelo(nome) {
  const n = String(nome || '').toLowerCase().trim()
  if (!n || n.startsWith('.') || n.startsWith('~')) return false
  if (n.endsWith('.tmp') || n.endsWith('.part') || n.endsWith('.crdownload') || n.endsWith('.swp') || n.endsWith('.lock')) return false
  return n.endsWith('.gguf') || n === 'modelo.json'
}

function tamanhoArquivo(caminho) {
  try {
    return fs.statSync(caminho).size
  } catch (_) {
    return -1 // ausente (remoção também é troca válida)
  }
}

/**
 * Aguarda o arquivo estabilizar (2 leituras iguais de tamanho): evita carregar
 * um GGUF ainda em cópia. `ausente` estabiliza de imediato (remoção).
 * Retorna `true` (estável) ou `false` (teto excedido).
 */
function aguardarArquivoEstavel(caminho, intervaloMs = 1500, tetoMs = 300000) {
  return new Promise((resolve) => {
    const ini = Date.now()
    let anterior = tamanhoArquivo(caminho)
    if (anterior < 0) {
      resolve(true)
      return
    }
    const timer = setInterval(() => {
      const atual = tamanhoArquivo(caminho)
      if (atual < 0 || atual === anterior) {
        clearInterval(timer)
        resolve(true)
        return
      }
      anterior = atual
      if (Date.now() - ini > tetoMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, Math.max(250, intervaloMs))
    if (timer.unref) timer.unref()
  })
}

function avisoChecksumAusente(caminhoModelo, app) {
  try {
    if (!caminhoModelo || !caminhosIa || typeof caminhosIa.dirRecursosIa !== 'function') return null
    const base = path.basename(caminhoModelo)
    const arq = path.join(caminhosIa.dirRecursosIa(app), 'CHECKSUMS.txt')
    if (!fs.existsSync(arq)) return `CHECKSUMS.txt ausente — registre o SHA256 de ${base}`
    const txt = fs.readFileSync(arq, 'utf8')
    const tem = txt.split('\n').some((l) => {
      const t = l.trim()
      return t && !t.startsWith('#') && t.includes(base)
    })
    if (!tem) return `SHA de ${base} não registrado em CHECKSUMS.txt (rode certutil + atualize o arquivo)`
    return null
  } catch (_) {
    return null
  }
}

async function recarregarModeloAgora(app, motivo) {
  if (emRecargaModelo) {
    recargaModeloPendente = motivo
    return
  }
  emRecargaModelo = true
  try {
    do {
      recargaModeloPendente = null
      console.log(`[ia] troca de modelo detectada (${motivo}) — recarregando worker...`)
      encerrarIaService()
      const s = await iniciarIaService(app)
      ultimaTrocaModelo = new Date().toISOString()
      if (s.modelPath) {
        const aviso = avisoChecksumAusente(s.modelPath, app)
        console.log(`[ia] modelo efetivo: ${path.basename(s.modelPath)} modo=${s.modo}${s.perfil ? ` familia=${s.perfil.familia} ctx=${s.perfil.contextSize}` : ''}${aviso ? ` — AVISO: ${aviso}` : ''}`)
      } else {
        console.log(`[ia] nenhum modelo em recursos-ia/modelo/ (modo=${s.modo}) — coloque qualquer *.gguf para ativar`)
      }
    } while (recargaModeloPendente)
  } catch (e) {
    console.warn(`[ia] falha na troca automática de modelo: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    emRecargaModelo = false
  }
}

function agendarRecargaModelo(app, motivo) {
  try {
    if (timerRecargaModelo) clearTimeout(timerRecargaModelo)
  } catch (_) { /* ignora */ }
  timerRecargaModelo = setTimeout(() => {
    timerRecargaModelo = null
    void (async () => {
      try {
        let alvo = null
        try {
          if (caminhosIa && typeof caminhosIa.descobrirGgufEfetivo === 'function') {
            const achado = caminhosIa.descobrirGgufEfetivo(app)
            alvo = (achado && achado.caminho) || null
          }
        } catch (_) { alvo = null }
        if (alvo) {
          const estavel = await aguardarArquivoEstavel(alvo)
          if (!estavel) {
            console.warn(`[ia] ${path.basename(alvo)} não estabilizou — troca adiada (toque o arquivo para tentar de novo)`)
            return
          }
          if (alvo === modeloPath && realPronto) return // mesmo arquivo, nada a fazer
        } else {
          await new Promise((r) => setTimeout(r, 2000)) // remoção: pequena pausa anti-rajada
        }
        await recarregarModeloAgora(app, motivo)
      } catch (e) {
        console.warn(`[ia] falha ao agendar troca de modelo: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, 2500)
  if (timerRecargaModelo.unref) timerRecargaModelo.unref()
}

/**
 * Liga a vigia de `recursos-ia/modelo/`. Idempotente; retorna se está ativa.
 * Opt-out: `AURUM_IA_WATCH=0`.
 */
function observarModelo(app) {
  if (observadorModelo) return true
  try {
    if (String(process.env.AURUM_IA_WATCH ?? '1') === '0') {
      console.log('[ia] vigia de modelo desligada (AURUM_IA_WATCH=0)')
      return false
    }
  } catch (_) { /* ligada por padrão */ }
  let dir = null
  try {
    if (caminhosIa && typeof caminhosIa.caminhoDirModelo === 'function') {
      dir = caminhosIa.caminhoDirModelo(app)
    } else if (caminhosIa && typeof caminhosIa.dirRecursosIa === 'function') {
      dir = path.join(caminhosIa.dirRecursosIa(app), 'modelo')
    }
  } catch (_) { dir = null }
  if (!dir) return false
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    observadorModelo = fs.watch(dir, { persistent: false }, (_evento, nome) => {
      try {
        if (!ehArquivoDeModelo(nome)) return
        agendarRecargaModelo(app, `${_evento}:${nome}`)
      } catch (_) { /* vigia nunca quebra o app */ }
    })
    observadorModelo.on('error', (e) => {
      console.warn(`[ia] vigia de modelo falhou: ${e instanceof Error ? e.message : String(e)}`)
      try { observadorModelo.close() } catch (_) { /* ignora */ }
      observadorModelo = null
      observandoModelo = false
    })
    observandoModelo = true
    console.log(`[ia] troca automática de modelo ativa em ${dir} (apague/troque o *.gguf e aguarde)`)
    return true
  } catch (e) {
    console.warn(`[ia] sem vigia de modelo em ${dir}: ${e instanceof Error ? e.message : String(e)}`)
    observadorModelo = null
    observandoModelo = false
    return false
  }
}

/** Desliga a vigia (chamado no `before-quit`). */
function pararObservarModelo() {
  try {
    if (timerRecargaModelo) clearTimeout(timerRecargaModelo)
  } catch (_) { /* ignora */ }
  timerRecargaModelo = null
  try {
    if (observadorModelo) observadorModelo.close()
  } catch (_) { /* ignora */ }
  observadorModelo = null
  observandoModelo = false
}

/**
 * Escritor do overlay (Phase 10-05 / GRAFO-08): registra uso local
 * (`registrarUso({tipo, termo, codigo, emitente, peso})` com TTL 90d + teto
 * 5000 + demote). Só reordena (boost com teto) — nunca cria redução.
 * NUNCA lança.
 */
function registrarUsoGrafoViaGrafo(evento = {}) {
  try {
    const gs = require('./grafo-service.cjs')
    if (gs && typeof gs.registrarUso === 'function') {
      return gs.registrarUso(evento, { app: appRef })
    }
    return { ok: false, erro: 'grafo-service sem registrarUso' }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

module.exports = {
  iniciarIaService,
  statusIa,
  classificarViaIa,
  buscarViaIa,
  grafoConsultarViaGrafo,
  registrarUsoGrafoViaGrafo,
  conversarViaIa,
  encerrarIaService,
  perfilModeloViaIa,
  observarModelo,
  pararObservarModelo,
  ehArquivoDeModelo,
  aguardarArquivoEstavel,
}
