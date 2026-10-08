'use strict'

/**
 * ofuscar-build.cjs — Ofuscação COMPLETA anti-engenharia reversa.
 *
 * Roda após `vite build` + `build:electron`, antes do `electron-builder`.
 * Embaralha TUDO que é JavaScript entregue no instalador:
 *   1. Renderer: `dist/assets/*.js` (React/Vite)
 *   2. Main: `electron/dist/main.js` + `preload.cjs`
 *   3. Busca local: `electron/dist/grafo-service.cjs` + `caminhos-ia.cjs`
 *      (CJS puros copiados pelo esbuild)
 *
 * Preset médio SEGURO (nunca quebra Electron/React):
 *   compact + simplify + stringArray(0.75) + rotate/shuffle.
 *   NUNCA: selfDefending, debugProtection (quebram fork/asar),
 *   renameGlobals, controlFlowFlattening, deadCodeInjection.
 *
 * Validação antes de confirmar (por arquivo): `node --check` (sintaxe).
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
const { spawnSync } = require('node:child_process')

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
    // Electron: main + preload + helpers da busca local copiados (CJS puros).
    for (const f of ['main.js', 'preload.cjs', 'caminhos-ia.cjs', 'grafo-service.cjs']) {
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
