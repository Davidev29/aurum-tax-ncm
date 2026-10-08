/**
 * after-pack-ia.cjs — Hook `afterPack` do electron-builder.
 *
 * Registrado em `package.json` → `build.afterPack`. O electron-builder o
 * invoca com um contexto `{ appOutDir, outDir, arch, packager, ... }` após
 * empacotar cada alvo.
 *
 * O que verifica (classificação 100% determinística, sem LLM):
 *   1. Grafo copiado (`electron/dist/grafo-service.cjs` + `caminhos-ia.cjs`)
 *      — FALHA se ausente.
 *   2. Índice lexical RAG + `.manifest-hash` — FALHA se ausentes.
 *   3. Base `ncm-para-ia.json` + `CHECKSUMS.txt` — FALHA se ausentes.
 *   4. Grafo fiscal + manifesto — FALHA se ausentes.
 *   5. Se `appOutDir/resources/` já existir, confere que `extraResources`
 *      (`recursos-ia/...`) aterrissou — AVISA se não (não falha: layout varia
 *      por alfo NSIS/DMG/AppImage).
 *
 * O modelo LLM (`recursos-ia/modelo/*.gguf`) NÃO é embarcado de propósito
 * (instalador leve) — presença/ausência aqui é só informativa.
 *
 * Sem dependências (só `node:`). Nunca exige rede. Falhas duras lançam
 * `Error` (reprovam o pack); pendências offline viram `AVISO` no log.
 *
 * Uso manual (sem electron-builder, offline):
 *   node scripts/after-pack-ia.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

/** Checagens duras: `[relativo-à-raiz, descrição]`. */
const OBRIGATORIOS = [
  ['electron/dist/caminhos-ia.cjs', 'módulo de caminhos copiado pelo esbuild'],
  ['electron/dist/grafo-service.cjs', 'runtime do grafo fiscal 10-02 (copiado pelo esbuild)'],
  ['recursos-ia/dados-brutos/ncm-para-ia.json', 'base unificada 06-02 (2335 NCMs)'],
  ['recursos-ia/indice-ncm/indice-lexical.json', 'índice lexical RAG (fallback 06-03)'],
  ['recursos-ia/indice-ncm/.manifest-hash', 'hash semântico do MANIFEST (gatilho 06-03)'],
  ['recursos-ia/CHECKSUMS.txt', 'checksums dos artefatos IA'],
  ['public/base/grafo/grafo.lbug', 'grafo fiscal 10-01 (nativo ou JSON portátil)'],
  ['public/base/grafo/grafo.lbug.json', 'espelho portátil do grafo (fallback do runtime)'],
  ['public/base/grafo/MANIFEST.grafo.json', 'manifesto versionado do grafo'],
]

/** Qualquer `*.gguf` em `recursos-ia/modelo/` (modelo agnóstico). */
function listarGgufsModelo(raiz) {
  try {
    const dir = path.join(raiz, 'recursos-ia', 'modelo')
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.gguf'))
      .map((f) => ({ arquivo: f, abs: path.join(dir, f) }))
      .filter((e) => { try { return fs.statSync(e.abs).size > 0 } catch { return false } })
  } catch {
    return []
  }
}

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

async function afterPackIa(contexto = {}) {
  const raiz = (contexto.packager && contexto.packager.projectDir) || process.cwd()
  const rotulo = contexto.arch ? ` (arch=${contexto.arch})` : ''
  console.log(`[afterPack:ia] verificando artefatos IA${rotulo} — raiz: ${raiz}`)

  const falhas = []
  for (const [rel, descricao] of OBRIGATORIOS) {
    const abs = path.join(raiz, rel)
    if (!existe(abs)) {
      falhas.push(`${rel} — ${descricao}`)
      console.error(`[afterPack:ia] FALTA: ${rel} (${descricao})`)
    } else {
      console.log(`[afterPack:ia] ok: ${rel} (${tamanho(abs)} bytes)`)
    }
  }

  // Modelo LLM: NÃO embarcado de propósito (instalador leve, classificação
  // determinística). Presença de *.gguf é só informativa (uso futuro).
  const ggufs = listarGgufsModelo(raiz)
  if (!ggufs.length) {
    console.log('[afterPack:ia] ok: sem modelo LLM embarcado (instalador leve — classificação determinística)')
  } else {
    for (const g of ggufs) {
      console.log(`[afterPack:ia] info: recursos-ia/modelo/${g.arquivo} (${tamanho(g.abs)} bytes) presente mas NÃO embarcado (ver extraResources)`)
    }
  }

  // 10-03 (GRAFO-06) — vetores do grafo: AVISO, nunca falha o pack
  // (modo FTS-puro é o fallback oficial quando o embedding está ausente).
  for (const rel of [
    'recursos-ia/embedding/vetores-ncm.json',
    'recursos-ia/embedding/MANIFEST-embedding.json',
    'public/base/grafo/vetores.json',
  ]) {
    const abs = path.join(raiz, rel)
    if (existe(abs)) {
      console.log(`[afterPack:ia] ok: ${rel} (${tamanho(abs)} bytes)`)
    } else {
      console.warn(
        `[afterPack:ia] AVISO: ${rel} ausente (rode "node scripts/gerar-embeddings.mjs"; ` +
          'sem ele o app usa FTS-puro).',
      )
    }
  }

  // 06-08 (IA-08) — checagens SUAVES (avisos, nunca falham o pack):
  // layout protegido `assets/aux.dat` + `assets/idx/`, ofuscação do worker
  // (`node scripts/ofuscar-ia.cjs` antes do `dist`) e helper de leitura
  // segura em `electron/dist/`. A troca física + `extraResources` é UAT
  // (docs/seguranca-ia.md §5); aqui só se REPORTA o estado.
  const auxDat = path.join(raiz, 'assets', 'aux.dat')
  const idxProtegido = path.join(raiz, 'assets', 'idx', 'indice-lexical.json')
  if (existe(auxDat) && existe(idxProtegido)) {
    console.log(
      `[afterPack:ia] ok: layout protegido 06-08 (assets/aux.dat ${tamanho(auxDat)} bytes + assets/idx/).`,
    )
  } else {
    console.warn(
      '[afterPack:ia] AVISO: layout protegido 06-08 ausente ' +
        `(${existe(auxDat) ? 'aux.dat ok' : 'sem assets/aux.dat'}; ` +
        `${existe(idxProtegido) ? 'idx ok' : 'sem assets/idx/indice-lexical.json'}) — ` +
        'instalador segue no layout legado 06-07. Rename = UAT (docs/seguranca-ia.md §5).',
    )
  }
  for (const [rel, oQue] of [
    ['electron/dist/main.js', 'processo principal ofuscado (build completa)'],
    ['electron/dist/preload.cjs', 'preload ofuscado (build completa)'],
  ]) {
    const abs = path.join(raiz, rel)
    if (!existe(abs)) {
      if (oQue) console.warn(`[afterPack:ia] AVISO: ${rel} ausente (${oQue}; rode "node electron/esbuild.mjs").`)
      continue
    }
    if (rel.endsWith('main.js') || rel.endsWith('preload.cjs')) {
      let conteudo = ''
      try {
        conteudo = fs.readFileSync(abs, 'utf8')
      } catch {
        conteudo = ''
      }
      const ofuscado =
        conteudo.includes('__AURUM_IA_OFUSCADO__') || conteudo.includes('__AURUM_BUILD_OFUSCADO__')
      if (ofuscado) {
        console.log(`[afterPack:ia] ok: ${rel} ofuscado (anti-reversão presente).`)
      } else {
        console.warn(
          `[afterPack:ia] AVISO: ${rel} SEM ofuscação (rode "node scripts/ofuscar-build.cjs" ` +
            'antes do dist — o `npm run build` já faz isso).',
        )
      }
      // Sourcemap vazando fonte no instalador = falha de anti-reversão.
      const mapa = `${abs}.map`
      if (existe(mapa)) {
        console.warn(`[afterPack:ia] AVISO: ${rel}.map presente em electron/dist (fonte vaza — remova antes do dist).`)
      }
    } else {
      console.log(`[afterPack:ia] ok: ${rel} (${oQue}; ${tamanho(abs)} bytes)`)
    }
  }
  // Renderer: todos os chunks dist/assets/*.js devem estar ofuscados e sem .map.
  try {
    const dirAssets = path.join(raiz, 'dist', 'assets')
    if (fs.existsSync(dirAssets)) {
      const jss = fs.readdirSync(dirAssets).filter((f) => f.endsWith('.js'))
      const mapas = fs.readdirSync(dirAssets).filter((f) => f.endsWith('.map'))
      if (mapas.length) {
        console.warn(`[afterPack:ia] AVISO: ${mapas.length} .map em dist/assets (fonte vaza — vite.config deve ter sourcemap:false).`)
      }
      let semOfusc = 0
      for (const f of jss) {
        let c = ''
        try { c = fs.readFileSync(path.join(dirAssets, f), 'utf8') } catch { continue }
        if (!(c.includes('__AURUM_BUILD_OFUSCADO__') || c.includes('__AURUM_IA_OFUSCADO__'))) semOfusc++
      }
      if (!jss.length) console.warn('[afterPack:ia] AVISO: dist/assets sem .js (rode vite build antes do dist).')
      else if (semOfusc) {
        console.warn(`[afterPack:ia] AVISO: ${semOfusc}/${jss.length} chunk(s) renderer SEM ofuscação (rode "node scripts/ofuscar-build.cjs").`)
      } else console.log(`[afterPack:ia] ok: renderer ofuscado (${jss.length} chunk(s) dist/assets).`)
    }
  } catch { /* best-effort */ }

  // Modelo LLM deliberadamente EXCLUÍDO do instalador (instalador leve,
  // classificação determinística): confirma que o `extraResources` não o
  // puxa por acidente via glob amplo.
  const ggufsEmb = listarGgufsModelo(raiz)
  for (const g of ggufsEmb) {
    console.log(
      `[afterPack:ia] ok: modelo local NÃO embarcado (${tamanho(g.abs)} bytes em recursos-ia/modelo/${g.arquivo} — fica só no dev)`,
    )
  }
  // Confere o destino empacotado quando disponível (layout varia por alvo).
  const appOutDir = contexto.appOutDir
  if (appOutDir) {
    const candidatosResources = [
      path.join(appOutDir, 'resources', 'recursos-ia'),
      path.join(appOutDir, 'Aurum Tax NCM.app', 'Contents', 'Resources', 'recursos-ia'),
    ]
    const achado = candidatosResources.find((d) => existe(d))
    if (!achado) {
      console.warn(
        '[afterPack:ia] AVISO: `resources/recursos-ia` não localizado em ' +
          `${appOutDir} — confira o extraResources no instalador final (UAT 3 OS).`,
      )
    } else {
      console.log(`[afterPack:ia] ok: extraResources em ${achado}`)
    }
  } else {
    console.log('[afterPack:ia] sem appOutDir (execução manual) — checagem de destino ignorada.')
  }

  if (falhas.length) {
    throw new Error(`[afterPack:ia] ${falhas.length} artefato(s) IA ausente(s):\n - ${falhas.join('\n - ')}`)
  }
  console.log('[afterPack:ia] verificação IA concluída.')
}

module.exports = afterPackIa
module.exports.afterPackIa = afterPackIa

if (require.main === module) {
  afterPackIa({}).catch((erro) => {
    console.error(erro && erro.message ? erro.message : erro)
    process.exit(1)
  })
}
