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
import { rmSync } from 'node:fs'
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
  // `electron`/`electron-updater` são fornecidos pelo runtime e nunca bundlados.
  // `@prisma/client` fica externo: motores nativos (`.node`) não podem ser
  // bundlados nem carregados de dentro do asar (ver `asarUnpack` no
  // package.json) — o main os carrega de `node_modules` no runtime.
  external: ['electron', 'electron-updater', '@prisma/client', '.prisma/client/*'],
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

  console.log('✔ Electron compilado com sucesso:')
  console.log(`   ${saidaMain}`)
  console.log(`   ${saidaPreload}`)
}

compilar().catch((erro) => {
  console.error('✖ Falha ao compilar o processo principal do Electron:')
  console.error(erro)
  process.exit(1)
})
