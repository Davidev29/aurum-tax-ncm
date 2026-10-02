'use strict'

/**
 * ia-spike-worker.cjs — Spike IA-00 (Phase 6, plan 06-00).
 *
 * Worker MÍNIMO para validar `utilityProcess` + protocolo IPC antes de
 * comprometer o plano com `node-llama-cpp`.
 *
 * Funciona em dois runtimes (mesmo protocolo `{id, cmd, ...}` → `{id, ok, ...}`):
 *   1. `utilityProcess.fork()` do Electron — via `process.parentPort`;
 *   2. `child_process.fork()` do Node puro — via `process.send/on('message')`.
 *
 * Comandos: `init` | `classificar` | `encerrar`.
 *
 * `init` com `{mock: true}` NÃO carrega GGUF real (nenhum modelo disponível
 * offline no ambiente do spike) — mede apenas boot + ciclo de vida + IPC.
 * Com `{mock: false, modelPath}` o worker tenta `require('node-llama-cpp')`
 * e registra o erro de forma estruturada (esperado: módulo ausente no spike).
 *
 * Sem dependências. Sem rede. Sem acesso a disco além de leitura opcional
 * do GGUF (que falha de forma controlada quando o arquivo não existe).
 */

const MODELO_SIMBOLICO = 'mock-spike-v0'

let modelo = null

function agoraMs() {
  return Number(process.hrtime.bigint() / 1000000n)
}

function ramMB() {
  return Math.round((process.memoryUsage().rss / 1048576) * 100) / 100
}

/** Canal de transporte unificado (utilityProcess ↔ fork). */
function canal() {
  if (typeof process !== 'undefined' && process.parentPort) {
    const pp = process.parentPort
    return {
      tipo: 'utilityProcess',
      enviar: (msg) => pp.postMessage(msg),
      ouvir: (cb) => pp.on('message', (ev) => cb(ev && 'data' in ev ? ev.data : ev)),
    }
  }
  return {
    tipo: 'fork',
    enviar: (msg) => {
      if (typeof process.send === 'function') process.send(msg)
    },
    ouvir: (cb) => process.on('message', cb),
  }
}

/**
 * Seletor mock determinístico: escolhe o candidato com maior sobreposição
 * de tokens com a descrição; abaixo do limiar retorna NÃO SEI.
 * (Substituído pelo LLM real em 06-04/06-05.)
 */
function selecionarMock(descricao, candidatos) {
  const toks = (String(descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) =>
    t.toLowerCase(),
  )
  const conjunto = new Set(toks)
  let melhor = null
  let melhorPontos = 0
  for (const c of candidatos || []) {
    const ct = (String(c.descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) =>
      t.toLowerCase(),
    )
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

async function tratar(msg) {
  const tIni = agoraMs()
  const { id, cmd } = msg || {}
  try {
    if (cmd === 'init') {
      if (msg && msg.mock !== false) {
        modelo = { mock: true, nome: MODELO_SIMBOLICO, iniciadoEm: Date.now() }
        return {
          id,
          ok: true,
          cmd,
          mock: true,
          msLoad: agoraMs() - tIni,
          ramMB: ramMB(),
          transporte: canalTipo,
        }
      }
      // Caminho real (espera-se falha controlada no spike: sem GGUF/sem dep).
      const fs = require('node:fs')
      const alvo = String((msg && msg.modelPath) || '')
      if (!alvo || !fs.existsSync(alvo)) {
        return { id, ok: false, cmd, erro: `GGUF não encontrado: "${alvo || '(vazio)'}"` }
      }
      let llamaModulo
      try {
        llamaModulo = require('node-llama-cpp')
      } catch (e) {
        return {
          id,
          ok: false,
          cmd,
          erro: `node-llama-cpp indisponível no worker: ${e && e.message ? e.message : e}`,
        }
      }
      const llama = await llamaModulo.getLlama()
      const model = await llama.loadModel({ modelPath: alvo })
      modelo = { mock: false, model }
      return { id, ok: true, cmd, mock: false, msLoad: agoraMs() - tIni, ramMB: ramMB() }
    }

    if (cmd === 'classificar') {
      if (!modelo) return { id, ok: false, cmd, erro: 'modelo não inicializado (envie init)' }
      if (modelo.mock) {
        const sel = selecionarMock(msg.descricao, msg.candidatos)
        return {
          id,
          ok: true,
          cmd,
          mock: true,
          codigo: sel.codigo,
          confianca: sel.confianca,
          motivo: sel.motivo,
          ms: agoraMs() - tIni,
          ramMB: ramMB(),
        }
      }
      return { id, ok: false, cmd, erro: 'inferência real fora do escopo do spike' }
    }

    if (cmd === 'encerrar') {
      const resposta = { id, ok: true, cmd, ramMB: ramMB() }
      if (modelo && modelo.model && typeof modelo.model.dispose === 'function') {
        try {
          await modelo.model.dispose()
        } catch (_) {
          /* ignora: spike */
        }
      }
      modelo = null
      return resposta
    }

    return { id: id ?? null, ok: false, cmd: cmd ?? null, erro: `comando desconhecido: "${cmd}"` }
  } catch (e) {
    return { id: id ?? null, ok: false, cmd: cmd ?? null, erro: String((e && e.message) || e) }
  }
}

const { tipo: canalTipo, enviar, ouvir } = canal()

ouvir((msg) => {
  void tratar(msg).then((res) => {
    enviar(res)
    if (msg && msg.cmd === 'encerrar') {
      // Dá vazão ao ack antes de sair; o main também faz kill de segurança.
      setTimeout(() => process.exit(0), 50)
    }
  })
})

// Pronto: informa o boot (útil para medir tempo de spawn→pronto).
enviar({ id: null, ok: true, cmd: 'pronto', pid: process.pid, transporte: canalTipo, ramMB: ramMB() })
