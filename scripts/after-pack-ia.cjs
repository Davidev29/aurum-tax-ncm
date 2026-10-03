/**
 * after-pack-ia.cjs — Hook `afterPack` do electron-builder (06-07 / IA-07).
 *
 * Registrado em `package.json` → `build.afterPack`. O electron-builder o
 * invoca com um contexto `{ appOutDir, outDir, arch, packager, ... }` após
 * empacotar cada alvo.
 *
 * O que verifica:
 *   1. Worker copiado (`electron/dist/ia-worker.cjs` + `caminhos-ia.cjs`) — FALHA se ausente.
 *   2. Índice lexical RAG + `.manifest-hash` — FALHA se ausentes.
 *   3. Base `ncm-para-ia.json` (06-02) + `CHECKSUMS.txt` — FALHA se ausentes.
 *   4. GGUF `ailo-152m-v2-q4_k_m.gguf` — OBRIGATÓRIO (AI-first; FALHA se ausente).
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

const GGUF = 'ailo-152m-v2-q4_k_m.gguf'

/** Checagens duras: `[relativo-à-raiz, descrição]`. */
const OBRIGATORIOS = [
  ['electron/dist/ia-worker.cjs', 'worker IA copiado pelo esbuild'],
  ['electron/dist/caminhos-ia.cjs', 'módulo de caminhos IA copiado pelo esbuild'],
  ['recursos-ia/dados-brutos/ncm-para-ia.json', 'base unificada 06-02 (2335 NCMs)'],
  ['recursos-ia/indice-ncm/indice-lexical.json', 'índice lexical RAG (fallback 06-03)'],
  ['recursos-ia/indice-ncm/.manifest-hash', 'hash semântico do MANIFEST (gatilho 06-03)'],
  ['recursos-ia/CHECKSUMS.txt', 'checksums dos artefatos IA'],
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
  // Sem o modelo o instalador sairia sem IA real — falha o pack.
  const gguf = path.join(raiz, 'recursos-ia', 'modelo', GGUF)
  if (!existe(gguf)) {
    falhas.push(
      `recursos-ia/modelo/${GGUF} — modelo IA embutido obrigatório (AI-first); coloque o .gguf em recursos-ia/modelo/ antes do dist`,
    )
    console.error(`[afterPack:ia] FALTA: recursos-ia/modelo/${GGUF} (modelo IA embutido obrigatório)`)
  } else {
    console.log(`[afterPack:ia] ok: recursos-ia/modelo/${GGUF} (${tamanho(gguf)} bytes)`)
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
  ]) {
    const abs = path.join(raiz, rel)
    if (!existe(abs)) {
      if (oQue) console.warn(`[afterPack:ia] AVISO: ${rel} ausente (${oQue}; rode "node electron/esbuild.mjs").`)
      continue
    }
    if (rel.endsWith('ia-worker.cjs')) {
      let conteudo = ''
      try {
        conteudo = fs.readFileSync(abs, 'utf8')
      } catch {
        conteudo = ''
      }
      if (conteudo.includes('__AURUM_IA_OFUSCADO__')) {
        console.log('[afterPack:ia] ok: worker ofuscado (marcador 06-08 presente).')
      } else {
        console.warn(
          '[afterPack:ia] AVISO: worker SEM ofuscação (rode "node scripts/ofuscar-ia.cjs" ' +
            'antes do dist — UAT com javascript-obfuscator para o preset médio).',
        )
      }
    } else {
      console.log(`[afterPack:ia] ok: ${rel} (${oQue}; ${tamanho(abs)} bytes)`)
    }
  }

  // Artefatos deliberadamente EXCLUÍDOS do instalador: confirma que o
  // `extraResources` não os puxa por acidente via glob amplo.
  // Modelo GGUF: EMBUTIDO nativamente via extraResources (package.json).
  const ggufEmb = path.join(raiz, 'recursos-ia', 'modelo', GGUF)
  if (existe(ggufEmb)) {
    console.log(
      `[afterPack:ia] ok: modelo embutido nativamente (${tamanho(ggufEmb)} bytes -> resources/recursos-ia/modelo/${GGUF})`,
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
