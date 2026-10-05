/**
 * after-pack-ia.cjs — Hook `afterPack` do electron-builder (06-07 / IA-07).
 *
 * Registrado em `package.json` → `build.afterPack`. O electron-builder o
 * invoca com um contexto `{ appOutDir, outDir, arch, packager, ... }` após
 * empacotar cada alvo.
 *
 * O que verifica:
 *   1. Worker copiado (`electron/dist/ia-worker.cjs` + `caminhos-ia.cjs` +
 *      `perfil-modelo.cjs` [camada de compatibilidade]) — FALHA se ausente.
 *   2. Índice lexical RAG + `.manifest-hash` — FALHA se ausentes.
 *   3. Base `ncm-para-ia.json` (06-02) + `CHECKSUMS.txt` — FALHA se ausentes.
 *   4. GGUF em `recursos-ia/modelo/*.gguf` — OBRIGATÓRIO (AI-first; FALHA se
 *      ausente). AGNÓSTICO: qualquer nome `*.gguf` vale (trocar o arquivo =
 *      trocar o modelo; ver `electron/ia/perfil-modelo.cjs` + `modelo.json`).
 *   5. Se `appOutDir/resources/` já existir, confere que `extraResources`
 *      (`recursos-ia/...`) aterrissou — AVISA se não (não falha: layout varia
 *      por alfo NSIS/DMG/AppImage).
 *
 * Sem dependências (só `node:`). Nunca exige rede. Falhas duras lançam
 * `Error` (reprovam o pack); pendências offline viram `AVISO` no log.
 *
 * Uso manual (sem electron-builder, offline):
 *   node scripts/after-pack-ia.cjs
 */

const fs = require('node:fs')
const path = require('node:path')

const GGUF_LEGADO = 'Qwen3-0.6B-Q8_0.gguf'

/** Checagens duras: `[relativo-à-raiz, descrição]`. */
const OBRIGATORIOS = [
  ['electron/dist/ia-worker.cjs', 'worker IA copiado pelo esbuild'],
  ['electron/dist/caminhos-ia.cjs', 'módulo de caminhos IA copiado pelo esbuild'],
  ['electron/dist/perfil-modelo.cjs', 'camada de compatibilidade do modelo (copiada pelo esbuild)'],
  ['recursos-ia/dados-brutos/ncm-para-ia.json', 'base unificada 06-02 (2335 NCMs)'],
  ['recursos-ia/indice-ncm/indice-lexical.json', 'índice lexical RAG (fallback 06-03)'],
  ['recursos-ia/indice-ncm/.manifest-hash', 'hash semântico do MANIFEST (gatilho 06-03)'],
  ['recursos-ia/CHECKSUMS.txt', 'checksums dos artefatos IA'],
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

  // GGUF: OBRIGATÓRIO em produção (AI-first, modelo embutido nativo).
  // AGNÓSTICO: qualquer `*.gguf` em recursos-ia/modelo/ vale — trocar o
  // arquivo = trocar o modelo (camada de compatibilidade resolve o perfil).
  // Sem nenhum .gguf o instalador sairia sem IA real — falha o pack.
  const ggufs = listarGgufsModelo(raiz)
  if (!ggufs.length) {
    falhas.push(
      'recursos-ia/modelo/*.gguf — modelo IA embutido obrigatório (AI-first); coloque qualquer .gguf em recursos-ia/modelo/ antes do dist',
    )
    console.error('[afterPack:ia] FALTA: recursos-ia/modelo/*.gguf (modelo IA embutido obrigatório)')
  } else {
    for (const g of ggufs) {
      console.log(`[afterPack:ia] ok: recursos-ia/modelo/${g.arquivo} (${tamanho(g.abs)} bytes)`)
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
    ['electron/dist/ia-worker.cjs', null],
    ['electron/dist/modelo-seguro.cjs', 'helper de leitura cifrada em memória'],
    ['electron/dist/main.js', 'processo principal ofuscado (build completa)'],
    ['electron/dist/preload.cjs', 'preload ofuscado (build completa)'],
  ]) {
    const abs = path.join(raiz, rel)
    if (!existe(abs)) {
      if (oQue) console.warn(`[afterPack:ia] AVISO: ${rel} ausente (${oQue}; rode "node electron/esbuild.mjs").`)
      continue
    }
    if (rel.endsWith('ia-worker.cjs') || rel.endsWith('main.js') || rel.endsWith('preload.cjs')) {
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

  // Artefatos deliberadamente EXCLUÍDOS do instalador: confirma que o
  // `extraResources` não os puxa por acidente via glob amplo.
  // Modelo GGUF: EMBUTIDO nativamente via extraResources (package.json —
  // qualquer *.gguf + modelo.json do diretório recursos-ia/modelo/).
  const ggufsEmb = listarGgufsModelo(raiz)
  for (const g of ggufsEmb) {
    console.log(
      `[afterPack:ia] ok: modelo embutido nativamente (${tamanho(g.abs)} bytes -> resources/recursos-ia/modelo/${g.arquivo})`,
    )
  }
  for (const rel of ['recursos-ia/embedding']) {
    const abs = path.join(raiz, rel)
    let conteudo = []
    try {
      conteudo = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f !== '.gitkeep') : []
    } catch {
      conteudo = []
    }
    if (conteudo.length) {
      console.warn(
        `[afterPack:ia] AVISO: ${rel}/ contém ${conteudo.length} arquivo(s) local(is) ` +
          `(${conteudo.slice(0, 3).join(', ')}) — NÃO embarcados (ver extraResources no package.json).`,
      )
    }
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
