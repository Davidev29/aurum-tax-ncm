'use strict'

/**
 * modelo-seguro.cjs — Leitura do modelo IA cifrado (06-08 / IA-08).
 *
 * Companheiro CJS do `scripts/criptografar-modelo-ia.mjs` (mesmo formato:
 * `MAGIC(8="AURUMIA1") || IV(12) || ciphertext || TAG(16)`, AES-256-GCM).
 * Carregado pelo `ia-worker.cjs` via `require()` com try/catch — a ausência
 * deste arquivo NUNCA quebra o worker (cai para o GGUF legado).
 *
 *   - `lerModeloSeguro({caminho?, chave?})` → `Promise<Buffer>`: descipta
 *     por STREAM (chunks de 1 MB) e devolve o GGUF EM MEMÓRIA. NUNCA grava
 *     plaintext em disco (não há nenhum `writeFile` neste módulo — auditável
 *     por `grep -n "write\|createWrite" electron/ia/modelo-seguro.cjs`).
 *   - Chave: parâmetro explícito (main repassa a de `safeStorage`) ou env
 *     `AURUM_IA_KEY_HEX`/`AURUM_IA_KEY`/`AURUM_IA_KEY_B64` (dev). NUNCA
 *     commitada, nunca logada.
 *   - `resolverModeloEfetivo(app)`: prefere o layout protegido
 *     (`assets/aux.dat`) e cai para o legado (`recursos-ia/modelo/*.gguf`),
 *     via `caminhos-ia.cjs` (fonte única de caminhos).
 *
 * Sem dependências além de `node:`. Funciona copiado em `electron/dist/`
 * (o esbuild o copia junto ao worker — ver `electron/esbuild.mjs`).
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const MAGIC = Buffer.from('AURUMIA1', 'ascii')
const IV_LEN = 12
const TAG_LEN = 16
const ALG = 'aes-256-gcm'
const CHUNK = 1024 * 1024

let caminhos = null
try {
  caminhos = require('./caminhos-ia.cjs')
} catch (_) {
  caminhos = null
}

/** `true` se o arquivo tem o MAGIC do contêiner cifrado. */
function estaCifrado(caminho) {
  try {
    const fd = fs.openSync(caminho, 'r')
    try {
      const head = Buffer.alloc(MAGIC.length)
      const n = fs.readSync(fd, head, 0, head.length, 0)
      return n === MAGIC.length && head.equals(MAGIC)
    } finally {
      fs.closeSync(fd)
    }
  } catch (_) {
    return false
  }
}

/** Chave de 32 bytes via env (dev/build). Retorna `null` se ausente. */
function chaveDeEnv() {
  const hex = process.env.AURUM_IA_KEY_HEX || process.env.AURUM_IA_KEY || null
  if (hex && /^[0-9a-fA-F]{64}$/.test(String(hex).trim())) {
    return Buffer.from(String(hex).trim(), 'hex')
  }
  const b64 = process.env.AURUM_IA_KEY_B64 || null
  if (b64) {
    const b = Buffer.from(String(b64).trim(), 'base64')
    if (b.length === 32) return b
  }
  return null
}

/** Há alguma chave disponível (env)? O main pode injetar via parâmetro. */
function temChaveDisponivel() {
  return chaveDeEnv() !== null
}

/**
 * Resolve `{caminho, formato}` do modelo efetivo:
 * `cifrado` (`assets/aux.dat`) → `gguf` (legado) → `{caminho:null,...}`.
 */
function resolverModeloEfetivo(app) {
  if (caminhos && typeof caminhos.resolverModeloEfetivo === 'function') {
    return caminhos.resolverModeloEfetivo(app)
  }
  // Fallback sem caminhos-ia: heurística local (dev).
  const raiz = path.resolve(__dirname, '..', '..')
  const aux = path.join(raiz, 'assets', 'aux.dat')
  if (fs.existsSync(aux)) return { caminho: aux, formato: 'cifrado' }
  const gguf = path.join(raiz, 'recursos-ia', 'modelo', 'ailo-152m-v2-q4_k_m.gguf')
  if (fs.existsSync(gguf)) return { caminho: gguf, formato: 'gguf' }
  return { caminho: null, formato: null }
}

/**
 * Descriptografa o modelo para MEMÓRIA (stream de 1 MB/chunks).
 * Rejeita chave errada (auth tag GCM) e MAGIC inválido.
 */
function lerModeloSeguro(opcoes) {
  const opts = opcoes || {}
  return new Promise((resolve, reject) => {
    let alvo = opts.caminho || null
    if (!alvo) {
      const ef = resolverModeloEfetivo(opts.app)
      alvo = ef.caminho
      if (!alvo) {
        reject(new Error('nenhum modelo encontrado (assets/aux.dat nem GGUF legado)'))
        return
      }
      if (ef.formato !== 'cifrado') {
        reject(new Error(`modelo em ${alvo} não é cifrado (formato=${ef.formato})`))
        return
      }
    }
    const chave = opts.chave || chaveDeEnv()
    if (!chave || chave.length !== 32) {
      reject(new Error('sem chave de 32 bytes (passe {chave} ou defina AURUM_IA_KEY_HEX)'))
      return
    }
    let st
    try {
      st = fs.statSync(alvo)
    } catch (_) {
      reject(new Error(`modelo cifrado ausente: ${alvo}`))
      return
    }
    if (st.size < MAGIC.length + IV_LEN + TAG_LEN + 1) {
      reject(new Error('aux.dat pequeno demais para ser válido'))
      return
    }
    const fd = fs.openSync(alvo, 'r')
    function fechar() {
      try { fs.closeSync(fd) } catch (_) { /* best-effort */ }
    }
    try {
      const magic = Buffer.alloc(MAGIC.length)
      fs.readSync(fd, magic, 0, magic.length, 0)
      if (!magic.equals(MAGIC)) {
        fechar()
        reject(new Error('MAGIC inválido (não é um aux.dat AURUMIA1)'))
        return
      }
      const iv = Buffer.alloc(IV_LEN)
      fs.readSync(fd, iv, 0, iv.length, MAGIC.length)
      const tag = Buffer.alloc(TAG_LEN)
      fs.readSync(fd, tag, 0, tag.length, st.size - TAG_LEN)
      const decipher = crypto.createDecipheriv(ALG, chave, iv)
      decipher.setAuthTag(tag)
      const partes = []
      const buf = Buffer.alloc(CHUNK)
      let pos = MAGIC.length + IV_LEN
      const fim = st.size - TAG_LEN
      while (pos < fim) {
        const want = Math.min(CHUNK, fim - pos)
        const n = fs.readSync(fd, buf, 0, want, pos)
        if (n <= 0) break
        pos += n
        const out = decipher.update(buf.subarray(0, n))
        if (out.length) partes.push(out)
      }
      partes.push(decipher.final())
      fechar()
      resolve({ bytes: Buffer.concat(partes), caminho: alvo, formato: 'cifrado' })
    } catch (e) {
      fechar()
      reject(e)
    }
  })
}

module.exports = {
  MAGIC,
  estaCifrado,
  chaveDeEnv,
  temChaveDisponivel,
  resolverModeloEfetivo,
  lerModeloSeguro,
}
