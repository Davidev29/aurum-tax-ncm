/**
 * make-icon.mjs — gera `build/icon.icns` (macOS) a partir de `build/icon.png`.
 *
 * Uso: `npm run icon` (ou `node scripts/make-icon.mjs`).
 *
 * Sem dependências externas: monta o contêiner ICNS manualmente com o PNG de
 * 512×512 como entrada `ic09` (PNG-comprimido, aceito pelo macOS 10.7+; o
 * Finder escala para os tamanhos menores). Para um iconset completo
 * (16→1024), regenere com `iconutil` num Mac e substitua o arquivo — o
 * `package.json` (`mac.icon`) continua apontando para `build/icon.icns`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PNG = path.join(RAIZ, 'build', 'icon.png')
const ICNS = path.join(RAIZ, 'build', 'icon.icns')

function lerDimensoesPng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error('PNG inválido (IHDR ausente)')
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const png = fs.readFileSync(PNG)
const { w, h } = lerDimensoesPng(png)
if (w !== 512 || h !== 512) {
  console.warn(`[make-icon] AVISO: icon.png é ${w}×${h} (esperado 512×512); ic09 exige 512×512. Abortando.`)
  process.exit(1)
}

// Entrada ic09: tipo + comprimento total (cabeçalho de 8 bytes + dados) + PNG.
const entrada = Buffer.alloc(8 + png.length)
entrada.write('ic09', 0, 'ascii')
entrada.writeUInt32BE(8 + png.length, 4)
png.copy(entrada, 8)

const icns = Buffer.alloc(8 + entrada.length)
icns.write('icns', 0, 'ascii')
icns.writeUInt32BE(icns.length, 4)
entrada.copy(icns, 8)

fs.writeFileSync(ICNS, icns)
console.log(`[make-icon] ok: build/icon.icns (${icns.length} bytes, ic09 512×512 a partir de icon.png)`)
