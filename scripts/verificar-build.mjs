/**
 * verificar-build.mjs — Portão de saída da BUILD completa.
 *
 * Garante que a nova versão interpreta TODAS as bases fiscais e entrega o
 * código compilado protegido contra engenharia reversa:
 *   1. Base tributária `public/base/`: 7 artefatos + MANIFEST com contagens
 *      oficiais (164 referência, 2335 NCM, 15156 nomenclatura, 1090 CNAE,
 *      122 NBS, 17 CST, 132 CST×cClassTrib) + NBS 2.00 oficial
 *      (`nbs-nomenclatura.json` 3239 posições / 919 subitens) + DE-PARA
 *      NBS 1.1↔2.0 (`nbs-depara.json` 1391 linhas).
 *   2. Saídas compiladas: `dist/` (renderer) + `electron/dist/` (main/preload).
 *   3. Banco SQLite/Prisma: motores nativos, DDL embarcado e canais IPC.
 *   4. Anti-reversão: NENHUM `.map` em `dist/`/`electron/dist/` + marcador
 *      de ofuscação em TODOS os `.js` entregues.
 *
 * Uso:
 *   node scripts/verificar-build.mjs              # verifica tudo (pós-ofuscação)
 *   node scripts/verificar-build.mjs --pre        # só bases fiscais (pré-vite,
 *                                                  sem exigir dist/ofuscação)
 *
 * Exit 1 lista cada falha. É o último passo do `npm run build`.
 */

import fs from 'node:fs'
import path from 'node:path'
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
  // NBS 2.00 oficial (public/base/nbs-nomenclatura.json, via `npm run fontes:sync`)
  nbsOficialMin: 3000, // 3239 hoje (5 seções fora do artefato)
  nbsOficialFolhasMin: 900, // 919 subitens hoje
  // DE-PARA NBS 1.1 ↔ 2.0 (public/base/nbs-depara.json, via `npm run fontes:sync`)
  nbsDeparaMin: 1300, // 1391 linhas hoje
}

const MARCADORES_OFUSC = ['__AURUM_BUILD_OFUSCADO__']

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
  for (const f of ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json', 'cnae.json', 'nbs-nomenclatura.json', 'nbs-depara.json', 'MANIFEST.json']) {
    if (!fs.existsSync(path.join(dir, f))) fail(`public/base/${f} ausente (rode npm run base)`)
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
    // Artefatos NBS oficiais novos (nbs-nomenclatura / nbs-depara)
    if (fs.existsSync(path.join(dir, 'nbs-nomenclatura.json'))) {
      const nOf = lerJson(path.join(dir, 'nbs-nomenclatura.json'))?.itens?.length ?? 0
      if (nOf < ESPERADO.nbsOficialMin) fail(`NBS oficial: ${nOf} posições (mínimo ${ESPERADO.nbsOficialMin}) — rode npm run fontes:sync -- --only=nbs && npm run base`)
      else ok(`NBS oficial: ${nOf} posições (nomenclatura NBS 2.00)`)
      const nFolhas = (lerJson(path.join(dir, 'nbs-nomenclatura.json'))?.itens ?? []).filter((i) => i?.folha).length
      if (nFolhas < ESPERADO.nbsOficialFolhasMin) fail(`NBS oficial: ${nFolhas} subitens (mínimo ${ESPERADO.nbsOficialFolhasMin})`)
      else ok(`NBS oficial: ${nFolhas} subitens`)
    } else {
      fail('public/base/nbs-nomenclatura.json ausente (rode npm run fontes:sync && npm run base)')
    }
    if (fs.existsSync(path.join(dir, 'nbs-depara.json'))) {
      const nDep = lerJson(path.join(dir, 'nbs-depara.json'))?.itens?.length ?? 0
      if (nDep < ESPERADO.nbsDeparaMin) fail(`DE-PARA NBS: ${nDep} linhas (mínimo ${ESPERADO.nbsDeparaMin}) — rode npm run fontes:sync -- --only=depara && npm run base`)
      else ok(`DE-PARA NBS 1.1→2.0: ${nDep} linhas`)
    } else {
      fail('public/base/nbs-depara.json ausente (rode npm run fontes:sync && npm run base)')
    }
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

function verificarSaidas() {
  console.log('\n[2/4] Saídas compiladas (dist/ + electron/dist/)')
  const indexHtml = path.join(RAIZ, 'dist', 'index.html')
  if (!fs.existsSync(indexHtml)) fail('dist/index.html ausente (rode vite build)')
  else ok('renderer dist/ ok')
  const assets = path.join(RAIZ, 'dist', 'assets')
  const jsRenderer = fs.existsSync(assets) ? fs.readdirSync(assets).filter((f) => f.endsWith('.js')) : []
  if (!jsRenderer.length) fail('dist/assets/*.js ausentes')
  else ok(`renderer: ${jsRenderer.length} chunk(s) JS`)
  for (const f of ['main.js', 'preload.cjs']) {
    if (!fs.existsSync(path.join(RAIZ, 'electron', 'dist', f))) fail(`electron/dist/${f} ausente (rode build:electron)`)
  }
  if (!falhas.length) ok('electron/dist/ ok (main+preload)')
}

function verificarBanco() {
  console.log('\n[3/4] Banco SQLite/Prisma (schema + motores + canal IPC)')
  const prismaDir = path.join(RAIZ, 'node_modules', '.prisma', 'client')
  for (const f of ['query_engine-windows.dll.node', 'libquery_engine-darwin.dylib.node', 'libquery_engine-darwin-arm64.dylib.node']) {
    if (!fs.existsSync(path.join(prismaDir, f))) fail(`motor Prisma ausente: node_modules/.prisma/client/${f} (rode npm run db:generate no SO alvo)`)
  }
  if (!falhas.length) ok('motores Prisma win+mac presentes')
  // Portão anti-regressão do instalador: o cliente gerado (`node_modules/.prisma/`,
  // diretório com ponto) é EXCLUÍDO do asar por padrão pelo electron-builder —
  // sem entrada explícita em `build.files`, o app instalado perde o módulo
  // `.prisma/client/default` e TODA operação `db:op` rejeita ("Error occurred in
  // handler for 'db:op'", tabelas vazias, nenhuma consulta funciona).
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8'))
    const files = (pkg.build && pkg.build.files) || []
    const temPrisma = files.some((f) => {
      if (typeof f === 'string') return f.includes('.prisma')
      if (f && typeof f === 'object') {
        return [f.from, f.to, ...(Array.isArray(f.filter) ? f.filter : [])].some(
          (x) => typeof x === 'string' && x.includes('.prisma'),
        )
      }
      return false
    })
    if (!temPrisma) fail('build.files sem entrada node_modules/.prisma/** (o instalador embarcaria sem o cliente gerado — todas as tabelas falhariam)')
    else ok('build.files inclui o cliente Prisma gerado (.prisma)')
    const unpack = (pkg.build && pkg.build.asarUnpack) || []
    const desembrulhaPrisma = unpack.some((u) => typeof u === 'string' && u.includes('.prisma'))
    if (!desembrulhaPrisma) fail('build.asarUnpack sem node_modules/.prisma/** (o motor .node não carrega de dentro do asar)')
    else ok('asarUnpack desembrulha o motor nativo (.prisma)')
  } catch (e) {
    fail(`leitura do package.json (portão do instalador): ${e.message}`)
  }
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
  console.log('Aurum Tax NCM — verificação da BUILD completa' + (pre ? ' (modo --pre: bases fiscais)' : ''))
  verificarBase()
  if (pre) {
    if (falhas.length) {
      console.error(`\n✖ BUILD INCOMPLETA (--pre): ${falhas.length} falha(s).`)
      process.exit(1)
    }
    console.log('\n✔ Bases fiscais íntegras (pré-build).')
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
  if (avisos.length) console.log(`\n✔ BUILD COMPLETA: bases fiscais + ofuscação (${avisos.length} aviso(s) tolerados).`)
  else console.log('\n✔ BUILD COMPLETA: bases fiscais + ofuscação.')
}

main().catch((e) => {
  console.error(`\n✖ Verificação falhou: ${e.message}`)
  process.exit(1)
})
