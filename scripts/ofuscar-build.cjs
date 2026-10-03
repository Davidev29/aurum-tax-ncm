'use strict'

/**
 * ofuscar-build.cjs — Ofuscação COMPLETA anti-engenharia reversa.
 *
 * Roda após `vite build` + `build:electron`, antes do `electron-builder`.
 * Embaralha TUDO que é JavaScript entregue no instalador:
 *   1. Renderer: `dist/assets/*.js` (React/Vite)
 *   2. Main: `electron/dist/main.js` + `preload.cjs`
 *   3. IA: `electron/dist/ia-worker.cjs` (delega ao `ofuscar-ia.cjs` leve
 *      quando o pacote real falta; aqui usa o preset médio real)
 *
 * Preset médio SEGURO (nunca quebra Electron/React):
 *   compact + simplify + stringArray(0.75) + rotate/shuffle.
 *   NUNCA: selfDefending, debugProtection (quebram fork/asar),
 *   renameGlobals, controlFlowFlattening, deadCodeInjection.
 *
 * Validação antes de confirmar (por arquivo):
 *   - `node --check` (sintaxe);
 *   - worker IA: smoke real (buscar "frango vivo" + classificar).
 * Falha em qualquer arquivo = RESTAURA o original e exit 1.
 * O build nunca é deixado quebrado.
 *
 * Uso:
 *   node scripts/ofuscar-build.cjs              # ofusca tudo in-place
 *   node scripts/ofuscar-build.cjs --check      # só valida estado atual
 *   node scripts/ofuscar-build.cjs --renderer-only
 *   node scripts/ofuscar-build.cjs --electron-only
 */

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, fork } = require('node:child_process')

const RAIZ = path.resolve(__dirname, '..')
const DIR_RENDERER = path.join(RAIZ, 'dist', 'assets')
const DIR_ELECTRON = path.join(RAIZ, 'electron', 'dist')

const MARCADOR = '__AURUM_BUILD_OFUSCADO__'

function temFlag(nome) {
  return process.argv.slice(2).includes(nome)
}

function listarAlvos() {
  const soRenderer = temFlag('--renderer-only')
  const soElectron = temFlag('--electron-only')
  const alvos = []
  if (!soElectron) {
    // Renderer: só chunks JS (CSS/HTML ficam como estão — sem lógica).
    if (fs.existsSync(DIR_RENDERER)) {
      for (const f of fs.readdirSync(DIR_RENDERER)) {
        if (f.endsWith('.js')) alvos.push({ tipo: 'renderer', caminho: path.join(DIR_RENDERER, f) })
      }
    }
  }
  if (!soRenderer) {
    // Electron: main + preload + helpers IA copiados (CJS puros).
    for (const f of ['main.js', 'preload.cjs', 'ia-worker.cjs', 'caminhos-ia.cjs', 'modelo-seguro.cjs']) {
      const p = path.join(DIR_ELECTRON, f)
      if (fs.existsSync(p)) alvos.push({ tipo: f === 'renderer' ? 'x' : 'electron', caminho: p })
    }
  }
  return alvos
}

function checarSintaxe(arquivo) {
  const r = spawnSync(process.execPath, ['--check', arquivo], { encoding: 'utf8' })
  return { ok: r.status === 0, saida: ((r.stdout || '') + (r.stderr || '')).trim().slice(0, 300) }
}

/** Smoke real só para o worker IA (renderer/main não têm entry testável sem janela). */
function smokeWorker(caminhoWorker, tempoLimiteMs = 25000) {
  return new Promise((resolve) => {
    const detalhe = { etapas: [] }
    let finalizado = false
    function concluir(ok, erro) {
      if (finalizado) return
      finalizado = true
      clearTimeout(timer)
      try { filho.kill() } catch (_) { /* best-effort */ }
      resolve({ ok, erro, detalhe })
    }
    let filho
    try {
      filho = fork(caminhoWorker, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    } catch (e) {
      concluir(false, `fork falhou: ${e && e.message ? e.message : e}`)
      return
    }
    const timer = setTimeout(() => concluir(false, 'timeout do smoke (>25s)'), tempoLimiteMs)
    const pendentes = new Map()
    let proximoId = 1
    function enviar(cmd, extra) {
      return new Promise((res) => {
        const id = proximoId++
        pendentes.set(id, { res })
        filho.send({ id, cmd, ...(extra || {}) })
      })
    }
    filho.on('message', (msg) => {
      void (async () => {
        try {
          if (msg && msg.cmd === 'pronto' && msg.id == null) {
            detalhe.etapas.push('pronto')
            const ini = await enviar('init', { mock: true })
            if (!ini.ok) throw new Error(`init mock falhou: ${ini.erro || '?'}`)
            detalhe.etapas.push('init-mock')
            const bus = await enviar('buscar', { consulta: 'frango vivo para abate', k: 5 })
            if (!bus.ok || !Array.isArray(bus.candidatos) || !bus.candidatos.length) {
              throw new Error(`buscar sem candidatos: ${bus.erro || '?'}`)
            }
            detalhe.etapas.push(`buscar:top1=${bus.candidatos[0] && bus.candidatos[0].codigo}`)
            const cla = await enviar('classificar', { descricao: 'frango vivo para abate' })
            if (!cla.ok || !cla.codigo) throw new Error(`classificar falhou: ${cla.erro || '?'}`)
            detalhe.etapas.push(`classificar:${cla.codigo}`)
            await enviar('encerrar', {})
            detalhe.etapas.push('encerrar')
            concluir(true, null)
          } else if (msg && msg.id != null && pendentes.has(msg.id)) {
            pendentes.get(msg.id).res(msg)
            pendentes.delete(msg.id)
          }
        } catch (e) {
          concluir(false, e && e.message ? e.message : String(e))
        }
      })()
    })
    filho.on('error', (e) => concluir(false, `erro worker: ${e && e.message ? e.message : e}`))
    filho.on('exit', (code) => {
      if (!finalizado && detalhe.etapas.length < 4) {
        concluir(false, `worker saiu cedo (code=${code}) após [${detalhe.etapas.join(', ')}]`)
      }
    })
  })
}

async function ofuscarArquivo(caminho, obfuscator) {
  const original = fs.readFileSync(caminho, 'utf8')
  if (original.includes(MARCADOR)) return { pulado: true, bytesAntes: original.length, bytesDepois: original.length }
  const bytesAntes = Buffer.byteLength(original, 'utf8')
  let ofuscado
  try {
    const res = obfuscator.obfuscate(original, {
      compact: true,
      simplify: true,
      stringArray: true,
      stringArrayThreshold: 0.75,
      rotateStringArray: true,
      shuffleStringArray: true,
      splitStrings: false,
      renameGlobals: false,
      selfDefending: false,
      debugProtection: false,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      unicodeEscapeSequence: false,
    })
    ofuscado = String(res.getObfuscatedCode())
  } catch (e) {
    throw new Error(`obfuscator falhou em ${path.basename(caminho)}: ${e && e.message ? e.message : e}`)
  }
  if (!ofuscado.includes(MARCADOR)) ofuscado = `/*${MARCADOR}*/\n${ofuscado}`
  fs.writeFileSync(caminho, ofuscado, 'utf8')
  const sint = checarSintaxe(caminho)
  if (!sint.ok) {
    fs.writeFileSync(caminho, original, 'utf8')
    throw new Error(`sintaxe inválida após ofuscar ${path.basename(caminho)}: ${sint.saida} (original restaurado)`)
  }
  // Worker IA exige smoke funcional além da sintaxe.
  if (path.basename(caminho) === 'ia-worker.cjs') {
    const smoke = await smokeWorker(caminho)
    if (!smoke.ok) {
      fs.writeFileSync(caminho, original, 'utf8')
      throw new Error(`smoke IA falhou após ofuscar: ${smoke.erro} (original restaurado)`)
    }
  }
  return { pulado: false, bytesAntes, bytesDepois: Buffer.byteLength(ofuscado, 'utf8') }
}

async function main() {
  const soCheck = temFlag('--check')
  const alvos = listarAlvos()
  if (!alvos.length) {
    console.error('[ofuscar-build] nenhum alvo JS encontrado (rode vite build + build:electron antes).')
    process.exit(1)
  }
  console.log(`[ofuscar-build] alvos: ${alvos.length} arquivo(s)`)

  if (soCheck) {
    let fails = 0
    for (const a of alvos) {
      const conteudo = fs.readFileSync(a.caminho, 'utf8')
      const sint = checarSintaxe(a.caminho)
      const ofusc = conteudo.includes(MARCADOR) || conteudo.includes('__AURUM_IA_OFUSCADO__')
      console.log(`  ${ofusc ? 'OFUSCADO' : 'LEGÍVEL ' } ${sint.ok ? 'syntax-ok' : 'SYNTAX-FAIL'} ${path.relative(RAIZ, a.caminho)}`)
      if (!sint.ok) fails++
    }
    process.exit(fails ? 1 : 0)
  }

  let obfuscator = null
  try {
    // eslint-disable-next-line global-require
    obfuscator = require('javascript-obfuscator')
  } catch (_) {
    obfuscator = null
  }
  if (!obfuscator) {
    console.error('[ofuscar-build] javascript-obfuscator NÃO instalado — rode `npm install` (devDependency obrigatória).')
    console.error('[ofuscar-build] Nenhum arquivo foi tocado. Build SEM ofuscação = build INSEGURO.')
    process.exit(1)
  }

  let totalAntes = 0
  let totalDepois = 0
  let pulados = 0
  for (const a of alvos) {
    const rel = path.relative(RAIZ, a.caminho)
    try {
      const r = await ofuscarArquivo(a.caminho, obfuscator)
      totalAntes += r.bytesAntes
      totalDepois += r.bytesDepois
      if (r.pulado) {
        pulados++
        console.log(`  skip (já ofuscado): ${rel}`)
      } else {
        console.log(`  ok: ${rel} (${r.bytesAntes} → ${r.bytesDepois} bytes)`)
      }
    } catch (e) {
      console.error(`  FAIL: ${rel}: ${e && e.message ? e.message : e}`)
      process.exit(1)
    }
  }
  console.log(`[ofuscar-build] PASS: ${alvos.length - pulados} ofuscado(s), ${pulados} já ofuscado(s). ${totalAntes} → ${totalDepois} bytes.`)
  console.log('[ofuscar-build] Validação: node --check em todos + smoke do worker IA. Build pronto para electron-builder.')
}

main().catch((e) => {
  console.error(`[ofuscar-build] erro fatal: ${e && e.message ? e.message : e}`)
  process.exit(1)
})
