/**
 * after-pack.cjs — Hook `afterPack` do electron-builder.
 *
 * Registrado em `package.json` → `build.afterPack`. O electron-builder o
 * invoca com um contexto `{ appOutDir, outDir, arch, packager, ... }` após
 * empacotar cada alvo.
 *
 * O que verifica (classificação 100% determinística, sem IA):
 *   1. Artefatos essenciais: `electron/dist/main.js`, `electron/dist/preload.cjs`
 *      e `dist/base/MANIFEST.json` — FALHA se ausentes.
 *   2. Ofuscação (`__AURUM_BUILD_OFUSCADO__`) em main/preload e nos chunks
 *      do renderer — AVISA se faltar (não falha o pack).
 *   3. Ausência de sourcemaps (`.map`) em `electron/dist/` e `dist/assets/`
 *      — AVISA se algum vazar (não falha o pack).
 *
 * Sem dependências (só `node:`). Nunca exige rede. Falhas duras lançam
 * `Error` (reprovam o pack); pendências offline viram `AVISO` no log.
 *
 * Uso manual (sem electron-builder, offline):
 *   node scripts/after-pack.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const MARCADOR = '__AURUM_BUILD_OFUSCADO__'

/** Checagens duras: `[relativo-à-raiz, descrição]`. */
const OBRIGATORIOS = [
  ['electron/dist/main.js', 'processo principal compilado pelo esbuild'],
  ['electron/dist/preload.cjs', 'preload compilado pelo esbuild'],
  ['dist/base/MANIFEST.json', 'manifesto da base fiscal embutida (vite build)'],
]

function existe(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function tamanho(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return -1
  }
}

function ofuscado(conteudo) {
  return conteudo.includes(MARCADOR)
}

function checarOfuscacao(caminho, rel, avisos) {
  if (!existe(caminho)) return
  if (rel.endsWith('.js') || rel.endsWith('.cjs')) {
    let conteudo = ''
    try {
      conteudo = fs.readFileSync(caminho, 'utf8')
    } catch {
      conteudo = ''
    }
    if (ofuscado(conteudo)) {
      console.log(`[afterPack] ok: ${rel} ofuscado (anti-reversão presente).`)
    } else {
      avisos.push(`${rel} sem ofuscação`)
      console.warn(`[afterPack] AVISO: ${rel} SEM ofuscação (rode "node scripts/ofuscar-build.cjs" antes do dist — o npm run build já faz isso).`)
    }
  }
  const mapa = `${caminho}.map`
  if (existe(mapa)) {
    avisos.push(`${rel}.map presente`)
    console.warn(`[afterPack] AVISO: ${rel}.map presente (fonte vaza — remova antes do dist).`)
  }
}

async function afterPack(contexto = {}) {
  const raiz = (contexto.packager && contexto.packager.projectDir) || process.cwd()
  const rotulo = contexto.arch ? ` (arch=${contexto.arch})` : ''
  console.log(`[afterPack] verificando artefatos${rotulo} — raiz: ${raiz}`)

  const falhas = []
  const avisos = []
  for (const [rel, descricao] of OBRIGATORIOS) {
    const abs = path.join(raiz, rel)
    if (!existe(abs)) {
      falhas.push(`${rel} — ${descricao}`)
      console.error(`[afterPack] FALTA: ${rel} (${descricao})`)
    } else {
      console.log(`[afterPack] ok: ${rel} (${tamanho(abs)} bytes)`)
    }
  }

  for (const rel of ['electron/dist/main.js', 'electron/dist/preload.cjs']) {
    checarOfuscacao(path.join(raiz, rel), rel, avisos)
  }

  // Renderer: todos os chunks dist/assets/*.js devem estar ofuscados e sem .map.
  try {
    const dirAssets = path.join(raiz, 'dist', 'assets')
    if (existe(dirAssets)) {
      const jss = fs.readdirSync(dirAssets).filter((f) => f.endsWith('.js'))
      const mapas = fs.readdirSync(dirAssets).filter((f) => f.endsWith('.map'))
      if (mapas.length) {
        avisos.push(`${mapas.length} .map em dist/assets`)
        console.warn(`[afterPack] AVISO: ${mapas.length} .map em dist/assets (fonte vaza — vite.config deve ter sourcemap:false).`)
      }
      let semOfusc = 0
      for (const f of jss) {
        let c = ''
        try {
          c = fs.readFileSync(path.join(dirAssets, f), 'utf8')
        } catch {
          continue
        }
        if (!ofuscado(c)) semOfusc++
      }
      if (!jss.length) {
        avisos.push('dist/assets sem .js')
        console.warn('[afterPack] AVISO: dist/assets sem .js (rode vite build antes do dist).')
      } else if (semOfusc) {
        avisos.push(`${semOfusc}/${jss.length} chunks renderer sem ofuscação`)
        console.warn(`[afterPack] AVISO: ${semOfusc}/${jss.length} chunk(s) renderer SEM ofuscação (rode "node scripts/ofuscar-build.cjs").`)
      } else {
        console.log(`[afterPack] ok: renderer ofuscado (${jss.length} chunk(s) dist/assets).`)
      }
    }
  } catch {
    /* best-effort */
  }

  if (falhas.length) {
    throw new Error(`[afterPack] ${falhas.length} artefato(s) ausente(s):\n - ${falhas.join('\n - ')}`)
  }
  console.log(`[afterPack] verificação concluída${avisos.length ? ` (${avisos.length} aviso(s))` : ''}.`)
}

module.exports = afterPack
module.exports.afterPack = afterPack

if (require.main === module) {
  afterPack({}).catch((erro) => {
    console.error(erro && erro.message ? erro.message : erro)
    process.exit(1)
  })
}
