/**
 * verificar-build.mjs — Portão de saída da BUILD completa.
 *
 * Garante que a nova versão interpreta TODAS as bases e entrega IA embutida:
 *   1. Base tributária `public/base/`: 4 artefatos + MANIFEST com contagens
 *      oficiais (164 referência, 2335 NCM, 15156 nomenclatura, 1090 CNAE,
 *      122 NBS, 17 CST, 132 CST×cClassTrib).
 *   2. IA offline: `ncm-para-ia.json` (2335) + índice lexical + hash MANIFEST
 *      sincronizado + sinônimos + conhecimento curado + GGUF (~640MB) com
 *      SHA256 conferido contra `CHECKSUMS.txt`.
 *   3. Saídas compiladas: `dist/` (renderer) + `electron/dist/` (main/preload/IA).
 *   4. Anti-reversão: NENHUM `.map` em `dist/`/`electron/dist/` + marcador
 *      de ofuscação em TODOS os `.js` entregues.
 *
 * Uso:
 *   node scripts/verificar-build.mjs              # verifica tudo (pós-ofuscação)
 *   node scripts/verificar-build.mjs --pre        # só bases + IA (pré-vite, sem exigir dist/ofuscação)
 *
 * Exit 1 lista cada falha. É o último passo do `npm run build`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(__dirname, '..')

const ESPERADO = {
  referencia: 164,
  ncm: 2335,
  nomenclaturaMin: 15000,
  cnae: 1090,
  nbsMin: 100,
  cst: 17,
  cstClassTrib: 132,
}

const MARCADORES_OFUSC = ['__AURUM_BUILD_OFUSCADO__', '__AURUM_IA_OFUSCADO__']

let falhas = []
let avisos = []

function fail(msg) {
  falhas.push(msg)
  console.error(`  ✖ ${msg}`)
}
function warn(msg) {
  avisos.push(msg)
  console.warn(`  ⚠ ${msg}`)
}
function ok(msg) {
  console.log(`  ✔ ${msg}`)
}
function lerJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function ehOfuscado(conteudo) {
  return MARCADORES_OFUSC.some((m) => conteudo.includes(m))
}

function verificarBase() {
  console.log('\n[1/4] Base tributária (public/base/)')
  const dir = path.join(RAIZ, 'public', 'base')
  for (const f of ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json', 'cnae.json', 'MANIFEST.json']) {
    if (!fs.existsSync(path.join(dir, f))) fail(`public/base/${f} ausente (rode npm run base:completa)`)
  }
  if (falhas.length) return
  try {
    const ref = lerJson(path.join(dir, 'classificacao-tributaria.json'))
    const reforma = lerJson(path.join(dir, 'reforma.json'))
    const nomen = lerJson(path.join(dir, 'nomenclatura.json'))
    const cnae = lerJson(path.join(dir, 'cnae.json'))
    const manifest = lerJson(path.join(dir, 'MANIFEST.json'))
    const nRef = ref.itens?.length ?? 0
    const nNcm = reforma.ncm?.length ?? 0
    const nNbs = reforma.nbs?.length ?? 0
    const nCst = reforma.cst?.length ?? 0
    const nCct = reforma.cstClassTrib?.length ?? 0
    const nNomen = nomen.itens?.length ?? 0
    const nCnae = cnae.itens?.length ?? 0
    if (nRef !== ESPERADO.referencia) fail(`referência: ${nRef} (esperado ${ESPERADO.referencia})`)
    else ok(`referência: ${nRef} CST×cClassTrib`)
    if (nNcm !== ESPERADO.ncm) fail(`NCM: ${nNcm} (esperado ${ESPERADO.ncm})`)
    else ok(`NCM: ${nNcm} vínculos`)
    if (nCst !== ESPERADO.cst) fail(`CST: ${nCst} (esperado ${ESPERADO.cst})`)
    else ok(`CST: ${nCst}`)
    if (nCct !== ESPERADO.cstClassTrib) fail(`CST×cClassTrib: ${nCct} (esperado ${ESPERADO.cstClassTrib})`)
    else ok(`CST×cClassTrib: ${nCct}`)
    if (nNomen < ESPERADO.nomenclaturaMin) fail(`nomenclatura: ${nNomen} (mínimo ${ESPERADO.nomenclaturaMin})`)
    else ok(`nomenclatura: ${nNomen} itens`)
    if (nCnae !== ESPERADO.cnae) fail(`CNAE: ${nCnae} (esperado ${ESPERADO.cnae})`)
    else ok(`CNAE×Anexo: ${nCnae}`)
    if (nNbs < ESPERADO.nbsMin) fail(`NBS: ${nNbs} (mínimo ${ESPERADO.nbsMin})`)
    else ok(`NBS serviços: ${nNbs} vínculos`)
    const est = manifest.estatisticas ?? {}
    if (est.ncm !== ESPERADO.ncm || est.referencia !== ESPERADO.referencia) {
      fail(`MANIFEST inconsistente (ncm=${est.ncm}, referencia=${est.referencia})`)
    } else {
      ok(`MANIFEST: ${manifest.origem?.arquivos ? Object.keys(manifest.origem.arquivos).join('+') : 'ok'}`)
    }
  } catch (e) {
    fail(`leitura da base: ${e.message}`)
  }
}

function verificarIA() {
  console.log('\n[2/4] IA offline embutida (recursos-ia/)')
  const baseIa = path.join(RAIZ, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json')
  const indice = path.join(RAIZ, 'recursos-ia', 'indice-ncm', 'indice-lexical.json')
  const hashFile = path.join(RAIZ, 'recursos-ia', 'indice-ncm', '.manifest-hash')
  const sinon = path.join(RAIZ, 'recursos-ia', 'indice-ncm', 'sinonimos-gerados.json')
  const checksums = path.join(RAIZ, 'recursos-ia', 'CHECKSUMS.txt')
  if (!fs.existsSync(baseIa)) fail('ncm-para-ia.json ausente (rode preparar-dados-ia)')
  else {
    try {
      const j = lerJson(baseIa)
      if (j.itens?.length !== ESPERADO.ncm) fail(`ncm-para-ia: ${j.itens?.length} (esperado ${ESPERADO.ncm})`)
      else ok(`ncm-para-ia: ${j.itens.length} vínculos`)
    } catch (e) { fail(`ncm-para-ia ilegível: ${e.message}`) }
  }
  if (!fs.existsSync(indice)) fail('indice-lexical.json ausente (rode gerar-indice-ia --lexical)')
  else {
    try {
      const j = lerJson(indice)
      if (j.totalDocs !== ESPERADO.ncm) fail(`índice lexical: ${j.totalDocs} docs (esperado ${ESPERADO.ncm})`)
      else ok(`índice lexical: ${j.totalDocs} docs, ${(fs.statSync(indice).size / 1024).toFixed(0)} KB`)
    } catch (e) { fail(`índice lexical ilegível: ${e.message}`) }
  }
  if (!fs.existsSync(sinon)) fail('sinonimos-gerados.json ausente (rode gerar-indice-ia)')
  else ok('sinônimos single-source ok')
  if (!fs.existsSync(hashFile)) fail('.manifest-hash ausente (índice dessincronizado da base)')
  else ok('.manifest-hash presente (sincronia conferida no passo do hash)')
  // Conhecimento curado (fine-tuning simulado) — viaja no instalador via extraResources.
  const conDir = path.join(RAIZ, 'recursos-ia', 'conhecimento')
  for (const f of ['sinonimos.json', 'dicionario.json', 'marcas-siglas.json', 'erros-comuns.json', 'frases-modelo.json']) {
    if (!fs.existsSync(path.join(conDir, f))) fail(`conhecimento/${f} ausente`)
  }
  if (fs.existsSync(path.join(conDir, 'dicionario.json'))) ok('conhecimento curado ok (5+ JSONs)')
  // GGUF: obrigatório (qualquer *.gguf — modelo agnóstico), com SHA
  // conferido quando houver linha correspondente em CHECKSUMS.txt.
  const dirModelo = path.join(RAIZ, 'recursos-ia', 'modelo')
  let ggufs = []
  try {
    ggufs = fs.existsSync(dirModelo)
      ? fs.readdirSync(dirModelo).filter((f) => f.toLowerCase().endsWith('.gguf')).map((f) => path.join(dirModelo, f))
      : []
  } catch { ggufs = [] }
  const gguf = ggufs[0] ?? path.join(RAIZ, 'recursos-ia', 'modelo', 'modelo.gguf')
  if (!ggufs.length || !fs.existsSync(gguf)) {
    fail('GGUF ausente em recursos-ia/modelo/*.gguf — instalador sairia SEM IA real')
  } else {
    const bytes = fs.statSync(gguf).size
    if (bytes < 50 * 1024 * 1024) fail(`GGUF pequeno demais (${bytes} bytes — corrompido?)`)
    else ok(`GGUF: ${path.basename(gguf)} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    if (fs.existsSync(checksums)) {
      const txt = fs.readFileSync(checksums, 'utf8')
      const base = path.basename(gguf)
      const linha = txt.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && (l.includes(base) || l.includes('.gguf')))
      if (!linha) warn(`CHECKSUMS.txt sem linha para ${base} (registre o SHA do modelo atual)`)
      else {
        const esperado = linha.split(/\s+/)[0]
        if (!/^[0-9a-f]{64}$/i.test(esperado)) fail('CHECKSUMS.txt com hash inválido')
        else {
          const h = createHash('sha256')
          const fd = fs.openSync(gguf, 'r')
          const buf = Buffer.alloc(1024 * 1024)
          let n
          try {
            while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
          } finally { fs.closeSync(fd) }
          const real = h.digest('hex')
          if (real.toLowerCase() !== esperado.toLowerCase()) {
            fail(`SHA do GGUF diverge do CHECKSUMS.txt (real ${real.slice(0, 16)}… ≠ registrado ${esperado.slice(0, 16)}…) — atualize CHECKSUMS.txt`)
          } else ok('SHA do GGUF confere com CHECKSUMS.txt')
        }
      }
    } else fail('CHECKSUMS.txt ausente')
  }
}

async function verificarHashIndice() {
  try {
    const { calcularHashManifest } = await import('./gerar-indice-ia.mjs')
    const atual = calcularHashManifest(path.join(RAIZ, 'public', 'base'))
    const arq = path.join(RAIZ, 'recursos-ia', 'indice-ncm', '.manifest-hash')
    if (!atual) { warn('MANIFEST ilegível — hash do índice não conferido'); return }
    if (!fs.existsSync(arq)) return // já falhou acima
    const registrado = fs.readFileSync(arq, 'utf8').trim()
    if (registrado !== atual) {
      fail('índice IA dessincronizado da base (.manifest-hash ≠ hash atual) — rode gerar-indice-ia')
    } else ok('índice IA sincronizado com a base (hash MANIFEST)')
  } catch (e) {
    warn(`hash do índice não conferido: ${String(e.message).split('\n')[0]}`)
  }
}

function verificarSaidas() {
  console.log('\n[3/4] Saídas compiladas (dist/ + electron/dist/)')
  const indexHtml = path.join(RAIZ, 'dist', 'index.html')
  if (!fs.existsSync(indexHtml)) fail('dist/index.html ausente (rode vite build)')
  else ok('renderer dist/ ok')
  const assets = path.join(RAIZ, 'dist', 'assets')
  const jsRenderer = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : []
  if (!jsRenderer.length) fail('dist/assets/*.js ausentes')
  else ok(`renderer: ${jsRenderer.length} chunk(s) JS`)
  for (const f of ['main.js', 'preload.cjs', 'ia-worker.cjs', 'caminhos-ia.cjs', 'modelo-seguro.cjs', 'perfil-modelo.cjs']) {
    if (!fs.existsSync(path.join(RAIZ, 'electron', 'dist', f))) fail(`electron/dist/${f} ausente (rode build:electron)`)
  }
  if (!falhas.length) ok('electron/dist/ ok (main+preload+IA)')
}

function verificarOfuscacao() {
  console.log('\n[4/4] Anti-engenharia reversa (ofuscação + sem sourcemap)')
  const mapas = []
  const coletar = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      const st = fs.statSync(p)
      if (st.isDirectory()) { coletar(p); continue }
      if (f.endsWith('.map')) mapas.push(path.relative(RAIZ, p))
    }
  }
  coletar(path.join(RAIZ, 'dist'))
  coletar(path.join(RAIZ, 'electron', 'dist'))
  if (mapas.length) fail(`${mapas.length} sourcemap(s) vazando código-fonte: ${mapas.slice(0, 3).join(', ')}`)
  else ok('nenhum .map no pacote (fonte não vaza via mapa)')
  const alvos = []
  const assets = path.join(RAIZ, 'dist', 'assets')
  if (fs.existsSync(assets)) {
    for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      alvos.push(path.join(assets, f))
    }
  }
  for (const f of ['main.js', 'preload.cjs', 'ia-worker.cjs']) {
    const p = path.join(RAIZ, 'electron', 'dist', f)
    if (fs.existsSync(p)) alvos.push(p)
  }
  if (!alvos.length) { fail('nenhum JS para checar ofuscação'); return }
  const legiveis = []
  for (const p of alvos) {
    let c = ''
    try { c = fs.readFileSync(p, 'utf8') } catch { continue }
    if (!ehOfuscado(c)) legiveis.push(path.relative(RAIZ, p))
  }
  if (legiveis.length) {
    fail(`${legiveis.length} JS SEM ofuscação (legível p/ reversão): ${legiveis.slice(0, 4).join(', ')} — rode node scripts/ofuscar-build.cjs`)
  } else ok(`ofuscação presente em ${alvos.length} arquivo(s) JS (renderer + electron + IA)`)
}

async function main() {
  const pre = process.argv.includes('--pre')
  console.log('Aurum Tax NCM — verificação da BUILD completa' + (pre ? ' (modo --pre: bases + IA)' : ''))
  verificarBase()
  verificarIA()
  await verificarHashIndice()
  if (pre) {
    if (falhas.length) {
      console.error(`\n✖ BUILD INCOMPLETA (--pre): ${falhas.length} falha(s).`)
      process.exit(1)
    }
    console.log('\n✔ Bases + IA íntegras (pré-build).')
    return
  }
  verificarSaidas()
  verificarOfuscacao()
  if (falhas.length) {
    console.error(`\n✖ BUILD INCOMPLETA: ${falhas.length} falha(s) — instalador BLOQUEADO.`)
    falhas.forEach((f) => console.error(`   - ${f}`))
    process.exit(1)
  }
  if (avisos.length) console.log(`\n✔ BUILD COMPLETA com ${avisos.length} aviso(s) (tolerados).`)
  else console.log('\n✔ BUILD COMPLETA: bases + IA embutida + ofuscação total.')
}

main().catch((e) => {
  console.error(`\n✖ Verificação falhou: ${e.message}`)
  process.exit(1)
})
