/**
 * esbuild.mjs
 * ===========
 * Compila o processo principal (`electron/main.ts`) e o preload
 * (`electron/preload.ts`) para JavaScript CommonJS dentro de `electron/dist/`.
 *
 * Uso: npm run build:electron
 *
 * Saídas:
 *   - electron/dist/main.js      (formato CJS — "main" do package.json)
 *   - electron/dist/preload.cjs  (extensão .cjs explícita, sem ambiguidade)
 *
 * Observações:
 *   - `platform: 'node'` + `format: 'cjs'` dispensam banner de `require`
 *     (o formato CommonJS já fornece `require`, `__dirname`, `module`);
 *   - `electron` fica externo nos dois bundles (é fornecido pelo runtime);
 *   - minify ligado + sourcemap desligado (anti-reversão; debug via `dev`).
 */

import { build } from 'esbuild'
import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raizElectron = path.dirname(fileURLToPath(import.meta.url))
const pastaSaida = path.join(raizElectron, 'dist')

/**
 * Opções idênticas para main e preload.
 * BUILD anti-reversão: minify ligado + sem sourcemap. A ofuscação pesada
 * (stringArray) roda em `scripts/ofuscar-build.cjs` sobre o dist gerado.
 * @type {import('esbuild').BuildOptions}
 */
const opcoesComuns = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  charset: 'utf8',
  sourcemap: false,
  minify: true,
  legalComments: 'none',
  // `electron`/`electron-updater` são fornecidos pelo runtime; `node-llama-cpp`
  // (nativo + ESM-only) e o futuro stack vetorial NUNCA são bundlados —
  // o worker IA os carrega via `import()` dinâmico (achado C2 do spike).
  external: ['electron', 'electron-updater', 'node-llama-cpp', '@xenova/transformers', 'vectra'],
}

async function compilar() {
  // Limpa a pasta de saída para não acumular bundles antigos.
  rmSync(pastaSaida, { recursive: true, force: true })

  const saidaMain = path.join(pastaSaida, 'main.js')
  const saidaPreload = path.join(pastaSaida, 'preload.cjs')

  await build({
    ...opcoesComuns,
    entryPoints: [path.join(raizElectron, 'main.ts')],
    outfile: saidaMain,
  })

  await build({
    ...opcoesComuns,
    entryPoints: [path.join(raizElectron, 'preload.ts')],
    outfile: saidaPreload,
  })

  // Worker IA (06-05): forkado em runtime via `utilityProcess.fork()` —
  // deve ser COPIADO, nunca bundlado (o fork precisa de um arquivo real).
  // `caminhos-ia.cjs` (06-07) vai junto: o worker o carrega via
  // `require('./caminhos-ia.cjs')` relativo, tanto na fonte (`electron/ia/`)
  // quanto no `dist/`. (`ia-service.cjs`, ao contrário, é BUNDLADO no
  // main.js — o esbuild resolve o `require` dele para dentro do bundle.)
  const workerOrigem = path.join(raizElectron, 'ia', 'ia-worker.cjs')
  const workerDestino = path.join(pastaSaida, 'ia-worker.cjs')
  copyFileSync(workerOrigem, workerDestino)
  const caminhosOrigem = path.join(raizElectron, 'ia', 'caminhos-ia.cjs')
  const caminhosDestino = path.join(pastaSaida, 'caminhos-ia.cjs')
  copyFileSync(caminhosOrigem, caminhosDestino)
  // Modelo seguro (06-08): helper CJS da leitura cifrada em memória —
  // copiado como o worker (o `require('./modelo-seguro.cjs')` do worker
  // resolve no `dist/`; ausência em packs antigos NÃO quebra o worker,
  // que faz try/catch no require e cai para o GGUF legado).
  const seguroOrigem = path.join(raizElectron, 'ia', 'modelo-seguro.cjs')
  const seguroDestino = path.join(pastaSaida, 'modelo-seguro.cjs')
  copyFileSync(seguroOrigem, seguroDestino)
  // Camada de compatibilidade (modelo agnóstico): perfil-modelo.cjs vai junto
  // ao worker (require relativo funciona na fonte e no dist).
  const perfilOrigem = path.join(raizElectron, 'ia', 'perfil-modelo.cjs')
  const perfilDestino = path.join(pastaSaida, 'perfil-modelo.cjs')
  copyFileSync(perfilOrigem, perfilDestino)

  console.log('✔ Electron compilado com sucesso:')
  console.log(`   ${saidaMain}`)
  console.log(`   ${saidaPreload}`)
  console.log(`   ${workerDestino} (copiado, sem bundle)`)
  console.log(`   ${caminhosDestino} (copiado, sem bundle)`)
  console.log(`   ${seguroDestino} (copiado, sem bundle — 06-08)`)
  console.log(`   ${perfilDestino} (copiado, sem bundle — camada de compatibilidade)`)
}

compilar().catch((erro) => {
  console.error('✖ Falha ao compilar o processo principal do Electron:')
  console.error(erro)
  process.exit(1)
})
