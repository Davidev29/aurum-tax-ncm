/**
 * verificar-pacote.mjs — Auditoria do INSTALADOR empacotado (pós electron-builder).
 *
 * Complementa `verificar-build.mjs` (que audita a árvore-fonte): aqui se confere
 * o que realmente embarcou em `release/<alvo>-unpacked/`:
 *   1. Cliente Prisma gerado DESembrulhado
 *      (`app.asar.unpacked/node_modules/.prisma/client/query_engine-windows.dll.node`).
 *      Sem ele, o `require('.prisma/client/default')` do `@prisma/client` falha e
 *      TODA operação `db:op` rejeita ("Error occurred in handler for 'db:op'",
 *      tabelas vazias, nenhuma consulta funciona) — foi exatamente o defeito do
 *      instalador 1.0.0.
 *   2. `app.asar` presente íntegro, com `dist/base/MANIFEST.json`,
 *      `dist/index.html`, `electron/dist/main.js`, `electron/dist/preload.cjs`
 *      e `package.json` no asar.
 *   3. Motor nativo do Prisma marcado `unpacked:true` no cabeçalho (carrega
 *      fora do asar, como o Electron exige).
 *
 * Uso:
 *   node scripts/verificar-pacote.mjs                  # audita release/*-unpacked
 *   node scripts/verificar-pacote.mjs <dir-desembrulhado>
 *
 * Exit 1 lista cada falha. Só `node:` — sem dependências.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(__dirname, '..')

const falhas = []
const avisos = []

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
function existe(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

/**
 * Lista os caminhos dentro de um `app.asar` lendo o cabeçalho Pickle/JSON
 * diretamente (formato Electron: Pickle{u32 tamanho} + Pickle{String json}).
 * Devolve `string[]` com barras `/` ou `null` quando ilegível. Sem dependências.
 */
function listarAsar(asarPath) {
  try {
    const fd = fs.openSync(asarPath, 'r')
    try {
      const cabeca = Buffer.alloc(16)
      if (fs.readSync(fd, cabeca, 0, 16, 0) !== 16) return null
      // Layout Electron (chromium-pickle): [u32=4][u32 S][u32 P][u32 L][json…],
      // onde S = tamanho do pickle do cabeçalho e L = tamanho do JSON.
      if (cabeca.readUInt32LE(0) !== 4) return null
      const tamanho = cabeca.readUInt32LE(4)
      if (!Number.isFinite(tamanho) || tamanho <= 8 || tamanho > 256 * 1024 * 1024) return null
      const resto = Buffer.alloc(tamanho)
      if (fs.readSync(fd, resto, 0, tamanho, 8) !== tamanho) return null
      const lenJson = resto.readUInt32LE(4)
      if (!Number.isFinite(lenJson) || lenJson <= 0 || 8 + lenJson > tamanho) return null
      const header = JSON.parse(resto.subarray(8, 8 + lenJson).toString('utf8'))
      const arquivos = []
      const entradas = new Map()
      const varrer = (no, prefixo) => {
        const arqs = (no && no.files) || {}
        for (const [nome, entrada] of Object.entries(arqs)) {
          const caminho = `${prefixo}/${nome}`
          if (entrada && entrada.files) varrer(entrada, caminho)
          else {
            arquivos.push(caminho)
            entradas.set(caminho, entrada)
          }
        }
      }
      varrer(header, '')
      return { arquivos, entradas }
    } finally {
      try {
        fs.closeSync(fd)
      } catch {
        /* best-effort */
      }
    }
  } catch {
    return null
  }
}

function acharDesembrulhado(alvo) {
  if (alvo) {
    const abs = path.resolve(alvo)
    if (!existe(abs)) fail(`diretório desembrulhado inexistente: ${alvo}`)
    return abs
  }
  const release = path.join(RAIZ, 'release')
  if (!existe(release)) {
    fail('pasta release/ ausente (rode electron-builder --dir ou --win antes)')
    return null
  }
  const candidatos = fs
    .readdirSync(release)
    .filter((f) => f.endsWith('-unpacked') && fs.statSync(path.join(release, f)).isDirectory())
  if (!candidatos.length) {
    fail('nenhum *-unpacked em release/ (rode electron-builder --dir --publish never)')
    return null
  }
  // Prefere win-unpacked (alvo do usuário), senão o primeiro.
  candidatos.sort((a, b) => (a.startsWith('win') ? -1 : 0) - (b.startsWith('win') ? -1 : 0))
  return path.join(release, candidatos[0])
}

function main() {
  const dir = acharDesembrulhado(process.argv[2])
  if (!dir) process.exit(1)
  console.log(`Aurum Tax NCM — auditoria do pacote empacotado\n  ${dir}`)

  console.log('\n[1/3] Cliente Prisma gerado (app.asar.unpacked)')
  const prismaEngine = path.join(
    dir, 'resources', 'app.asar.unpacked', 'node_modules', '.prisma', 'client',
    'query_engine-windows.dll.node',
  )
  const prismaIndex = path.join(
    dir, 'resources', 'app.asar.unpacked', 'node_modules', '.prisma', 'client', 'index.js',
  )
  if (!existe(prismaIndex)) fail(`cliente gerado ausente: ${path.relative(dir, prismaIndex)}`)
  else ok('cliente gerado presente (.prisma/client/index.js)')
  if (!existe(prismaEngine)) {
    fail(`motor Windows ausente: ${path.relative(dir, prismaEngine)} (tabelas falhariam no instalado)`)
  } else {
    const mb = (fs.statSync(prismaEngine).size / 1024 / 1024).toFixed(1)
    ok(`motor Windows desembrulhado (${mb} MB, carrega fora do asar)`)
  }

  console.log('\n[2/3] Conteúdo do asar (leitura direta do cabeçalho, sem dependências)')
  const asar = path.join(dir, 'resources', 'app.asar')
  let lista = null
  if (!existe(asar)) {
    fail('resources/app.asar ausente')
  } else {
    ok('app.asar presente')
    lista = listarAsar(asar)
    if (lista === null) {
      warn('cabeçalho do asar ilegível — checagem interna ignorada')
    } else {
      for (const dentro of ['/dist/base/MANIFEST.json', '/dist/index.html', '/electron/dist/main.js', '/electron/dist/preload.cjs', '/package.json']) {
        if (!lista.arquivos.includes(dentro)) fail(`app.asar sem ${dentro}`)
        else ok(`app.asar contém ${dentro}`)
      }
    }
  }

  console.log('\n[3/3] Motor nativo marcado unpacked no cabeçalho')
  if (lista === null) {
    warn('cabeçalho do asar ilegível — checagem do motor ignorada')
  } else {
    // O motor nativo consta no cabeçalho (com `unpacked:true`) e mora
    // fisicamente em app.asar.unpacked — é assim que o Electron o carrega.
    const chaveMotor = '/node_modules/.prisma/client/query_engine-windows.dll.node'
    const entradaMotor = lista.entradas.get(chaveMotor)
    if (!entradaMotor) {
      ok('motor nativo fora do asar (só desembrulhado, como esperado)')
    } else if (entradaMotor.unpacked === true) {
      ok('motor nativo marcado unpacked:true (carrega fora do asar, como esperado)')
    } else {
      fail('motor .node DENTRO do asar sem unpacked:true (não carrega — tabelas falhariam)')
    }
  }

  if (falhas.length) {
    console.error(`\n✖ PACOTE INCOMPLETO: ${falhas.length} falha(s) — NÃO distribua este instalador.`)
    process.exit(1)
  }
  if (avisos.length) console.log(`\n✔ PACOTE ÍNTEGRO com ${avisos.length} aviso(s) (tolerados).`)
  else console.log('\n✔ PACOTE ÍNTEGRO: banco + bases + main/preload no instalado.')
}

main()
