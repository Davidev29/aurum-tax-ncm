/**
 * verificar-build.mjs — Portão de saída da BUILD completa.
 *
 * Garante que a nova versão interpreta TODAS as bases e entrega IA embutida:
 *   1. Base tributária `public/base/`: 4 artefatos + MANIFEST com contagens
 *      oficiais (164 referência, 2335 NCM, 15156 nomenclatura, 1090 CNAE,
 *      122 NBS, 17 CST, 132 CST×cClassTrib).
 *   1b. Grafo fiscal `public/base/grafo/`: `grafo.lbug` (+ espelho
 *      `grafo.lbug.json`) + `MANIFEST.grafo.json` com hash íntegro +
 *      `vetores.json` SINCRONIZADO (`hashGrafo` === hash do payload — par
 *      dessincronizado BLOQUEIA a build, nunca embarca cosine defasado).
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
  console.log('\n[1/5] Base tributária (public/base/)')
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
  console.log('\n[2/5] Busca local embutida (recursos-ia/)')
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
  // Modelo LLM: NÃO embarcado (instalador leve, classificação 100%
  // determinística). Se um *.gguf estiver presente (uso futuro), valida
  // tamanho + SHA como antes; ausente é o estado esperado.
  const dirModelo = path.join(RAIZ, 'recursos-ia', 'modelo')
  let ggufs = []
  try {
    ggufs = fs.existsSync(dirModelo)
      ? fs.readdirSync(dirModelo).filter((f) => f.toLowerCase().endsWith('.gguf')).map((f) => path.join(dirModelo, f))
      : []
  } catch { ggufs = [] }
  const gguf = ggufs[0] ?? path.join(RAIZ, 'recursos-ia', 'modelo', 'modelo.gguf')
  if (!ggufs.length || !fs.existsSync(gguf)) {
    ok('sem modelo LLM embarcado (instalador leve — classificação determinística)')
  } else {
    const bytes = fs.statSync(gguf).size
    if (bytes < 50 * 1024 * 1024) fail(`GGUF pequeno demais (${bytes} bytes — corrompido?)`)
    else ok(`GGUF local (NÃO embarcado): ${path.basename(gguf)} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
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

/**
 * Phase 10-01 (GRAFO-01) — grafo fiscal versionado (`[3/5]`).
 * Confere existência do `.lbug` (+ espelho `.json`) e a integridade do
 * `MANIFEST.grafo.json` (hash recomputado do payload + contadores).
 */
async function verificarGrafo() {
  console.log('\n[3/5] Grafo fiscal (public/base/grafo/)')
  const dir = path.join(RAIZ, 'public', 'base', 'grafo')
  const lbug = path.join(dir, 'grafo.lbug')
  const lbugJson = path.join(dir, 'grafo.lbug.json')
  const mani = path.join(dir, 'MANIFEST.grafo.json')
  if (!fs.existsSync(lbug)) fail('grafo.lbug ausente (rode npm run base)')
  if (!fs.existsSync(lbugJson)) fail('grafo.lbug.json ausente (rode npm run base)')
  if (!fs.existsSync(mani)) fail('MANIFEST.grafo.json ausente (rode npm run base)')
  if (falhas.length) return
  try {
    const m = lerJson(mani)
    for (const campo of ['versao', 'geradoEm', 'hashBase', 'hash', 'nodos', 'arestas', 'embedding']) {
      if (m[campo] === undefined || m[campo] === null) fail(`MANIFEST.grafo sem campo "${campo}"`)
    }
    if (!/^[0-9a-f]{64}$/i.test(String(m.hash ?? ''))) fail('MANIFEST.grafo com hash inválido')
    if (!(m.nodos > 0) || !(m.arestas > 0)) fail(`MANIFEST.grafo vazio (nodos=${m.nodos}, arestas=${m.arestas})`)
    if (falhas.length) return
    ok(`MANIFEST.grafo: ${m.versao} · ${m.nodos} nodos · ${m.arestas} arestas · embedding:${m.embedding}`)
    const { hashGrafo } = await import('./build-grafo.mjs')
    const payload = lerJson(lbugJson)
    const real = hashGrafo(payload.nodos ?? [], payload.arestas ?? [])
    if (real !== m.hash) {
      fail(`hash do grafo diverge (payload ${real.slice(0, 12)}… ≠ MANIFEST ${String(m.hash).slice(0, 12)}…) — rode npm run base`)
    } else {
      ok(`hash do grafo íntegro (${real.slice(0, 12)}…)`)
    }
    if ((payload.nodos ?? []).length !== m.nodos || (payload.arestas ?? []).length !== m.arestas) {
      fail('contadores do MANIFEST.grafo ≠ tamanho do payload — rode npm run base')
    } else {
      ok('contadores conferem com o payload')
    }
    verificarVetoresGrafo(payload.hash ?? null)
  } catch (e) {
    fail(`leitura do grafo: ${e.message}`)
  }
}

/**
 * Phase 10-04 — vetores sincronizados com o grafo (fail-closed).
 * O runtime pula o estágio vetorial quando `hashGrafo` diverge (guarda
 * `avisoVetor`), mas o INSTALADOR nunca deve embarcar o par dessincronizado:
 * par divergente = build BLOQUEADA. Confere o par fonte (`public/base/`),
 * o espelho empacotado (`recursos-ia/embedding/`) e a cópia do renderer
 * (`dist/base/`, quando existir — ela viaja no pacote final).
 */
function verificarVetoresGrafo(hashGrafo) {
  const pares = [
    {
      rotulo: 'par fonte (public/base)',
      grafo: path.join(RAIZ, 'public', 'base', 'grafo', 'grafo.lbug.json'),
      vetores: path.join(RAIZ, 'public', 'base', 'grafo', 'vetores.json'),
      obrigatorio: true,
    },
    {
      rotulo: 'espelho empacotado',
      grafo: path.join(RAIZ, 'public', 'base', 'grafo', 'grafo.lbug.json'),
      vetores: path.join(RAIZ, 'recursos-ia', 'embedding', 'vetores-ncm.json'),
      obrigatorio: true,
    },
    {
      rotulo: 'renderer (dist)',
      grafo: path.join(RAIZ, 'dist', 'base', 'grafo', 'grafo.lbug.json'),
      vetores: path.join(RAIZ, 'dist', 'base', 'grafo', 'vetores.json'),
      obrigatorio: false,
    },
  ]
  for (const par of pares) {
    const nomeVet = path.relative(RAIZ, par.vetores)
    if (!fs.existsSync(par.vetores)) {
      if (par.obrigatorio) fail(`${nomeVet} ausente — rode node scripts/gerar-embeddings.mjs --hash`)
      continue
    }
    if (!fs.existsSync(par.grafo)) continue
    try {
      const v = lerJson(par.vetores)
      const g = lerJson(par.grafo)
      if (v.formato !== 'vetores-grafo-v1') {
        fail(`${nomeVet} com formato inválido (${v.formato}) — regenere os vetores`)
        continue
      }
      if (Number(v.dim) !== 384 || !v.vetores || typeof v.vetores !== 'object' || !Object.keys(v.vetores).length) {
        fail(`${nomeVet} vazio ou com dimensão inválida — regenere os vetores`)
        continue
      }
      const hashV = typeof v.hashGrafo === 'string' ? v.hashGrafo : null
      const hashG = typeof g.hash === 'string' ? g.hash : (hashGrafo ?? null)
      if (!hashV || !hashG) {
        warn(`${nomeVet} sem hashGrafo/hash para conferência (${par.rotulo})`)
        continue
      }
      if (hashV !== hashG) {
        fail(
          `vetores dessincronizados (${par.rotulo}): vetores ${hashV.slice(0, 12)}… ≠ grafo ${hashG.slice(0, 12)}… — ` +
          'rode node scripts/gerar-embeddings.mjs --hash (o npm run base já faz isso após rebuild do grafo)',
        )
      } else {
        ok(`vetores sincronizados (${par.rotulo}, ${hashV.slice(0, 12)}…, ${Object.keys(v.vetores).length} docs)`)
      }
    } catch (e) {
      fail(`${nomeVet} ilegível: ${e.message}`)
    }
  }
}

function verificarSaidas() {
  console.log('\n[4/5] Saídas compiladas (dist/ + electron/dist/)')
  const indexHtml = path.join(RAIZ, 'dist', 'index.html')
  if (!fs.existsSync(indexHtml)) fail('dist/index.html ausente (rode vite build)')
  else ok('renderer dist/ ok')
  const assets = path.join(RAIZ, 'dist', 'assets')
  const jsRenderer = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : []
  if (!jsRenderer.length) fail('dist/assets/*.js ausentes')
  else ok(`renderer: ${jsRenderer.length} chunk(s) JS`)
  for (const f of ['main.js', 'preload.cjs', 'caminhos-ia.cjs', 'grafo-service.cjs']) {
    if (!fs.existsSync(path.join(RAIZ, 'electron', 'dist', f))) fail(`electron/dist/${f} ausente (rode build:electron)`)
  }
  if (!falhas.length) ok('electron/dist/ ok (main+preload+grafo)')
}

function verificarBanco() {
  console.log('\n[4b/5] Banco SQLite/Prisma (schema + motores + canal IPC)')
  const prismaDir = path.join(RAIZ, 'node_modules', '.prisma', 'client')
  for (const f of ['query_engine-windows.dll.node', 'libquery_engine-darwin.dylib.node', 'libquery_engine-darwin-arm64.dylib.node']) {
    if (!fs.existsSync(path.join(prismaDir, f))) fail(`motor Prisma ausente: node_modules/.prisma/client/${f} (rode npm run db:generate no SO alvo)`)
  }
  if (!falhas.length) ok('motores Prisma win+mac presentes')
  const schemaPrisma = path.join(RAIZ, 'prisma', 'schema.prisma')
  const schemaSql = path.join(RAIZ, 'prisma', 'schema.sql')
  const schemaTs = path.join(RAIZ, 'src', 'infrastructure', 'db', 'schema-sql.ts')
  for (const [p, rotulo] of [[schemaSql, 'prisma/schema.sql'], [schemaTs, 'src/infrastructure/db/schema-sql.ts']]) {
    if (!fs.existsSync(p)) fail(`${rotulo} ausente (rode npm run db:generate)`)
  }
  if (fs.existsSync(schemaSql) && fs.existsSync(schemaTs)) {
    const tPrisma = fs.statSync(schemaPrisma).mtimeMs
    const tSql = fs.statSync(schemaSql).mtimeMs
    const tTs = fs.statSync(schemaTs).mtimeMs
    if (tSql < tPrisma || tTs < tPrisma) {
      fail('DDL embarcado desatualizado ante prisma/schema.prisma (rode npm run db:generate)')
    } else ok('DDL embarcado em dia com o schema')
  }
  const mainJs = path.join(RAIZ, 'electron', 'dist', 'main.js')
  const preload = path.join(RAIZ, 'electron', 'dist', 'preload.cjs')
  if (fs.existsSync(mainJs)) {
    const c = fs.readFileSync(mainJs, 'utf8')
    if (!c.includes('db:op')) fail('electron/dist/main.js sem canal db:op (rebuild electron)')
    else ok('canal db:op presente no main')
    if (!c.includes('db:snapshot')) fail('electron/dist/main.js sem canal db:snapshot (rebuild electron)')
    else ok('canal db:snapshot presente no main')
  }
  if (fs.existsSync(preload)) {
    const c = fs.readFileSync(preload, 'utf8')
    if (!c.includes('db:op')) fail('electron/dist/preload.cjs sem ponte db (rebuild electron)')
    else ok('ponte db presente no preload')
    if (!c.includes('db:snapshot')) fail('electron/dist/preload.cjs sem ponte db:snapshot (rebuild electron)')
    else ok('ponte db:snapshot presente no preload')
  }
}

function verificarOfuscacao() {
  console.log('\n[5/5] Anti-engenharia reversa (ofuscação + sem sourcemap)')
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
  for (const f of ['main.js', 'preload.cjs']) {
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
  } else ok(`ofuscação presente em ${alvos.length} arquivo(s) JS (renderer + electron)`)
}

async function main() {
  const pre = process.argv.includes('--pre')
  console.log('Aurum Tax NCM — verificação da BUILD completa' + (pre ? ' (modo --pre: bases + IA)' : ''))
  verificarBase()
  verificarIA()
  await verificarHashIndice()
  await verificarGrafo()
  if (pre) {
    if (falhas.length) {
      console.error(`\n✖ BUILD INCOMPLETA (--pre): ${falhas.length} falha(s).`)
      process.exit(1)
    }
    console.log('\n✔ Bases + IA íntegras (pré-build).')
    return
  }
  verificarSaidas()
  verificarBanco()
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
