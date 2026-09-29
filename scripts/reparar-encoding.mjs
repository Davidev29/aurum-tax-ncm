/**
 * Repara arquivos gravados com texto "mojibake" (UTF-8 decodificado como CP1252).
 *
 * Uso:  node scripts/reparar-encoding.mjs <arquivo...> [--aplicar]
 *
 * Sem `--aplicar` apenas mostra o antes/depois; com `--aplicar` regrava o
 * arquivo em UTF-8 correto.
 */
import fs from 'node:fs'

/** Tabela CP1252 -> Unicode para a faixa 0x80-0x9F (os 27 pontos definidos). */
const CP1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
}
const INVERSO = new Map(Object.entries(CP1252).map(([b, u]) => [u, Number(b)]))

/**
 * Assinatura de dupla codificação: um byte de lead ASCII estendido (Â, Ã ou â)
 * seguido de um byte de continuação (0x80-0xBF) ou de um símbolo CP1252 que
 * só existe fora do Latin-1 (o caractere de moeda do euro).
 */
function ehMojibake(texto) {
  for (let i = 0; i < texto.length - 1; i++) {
    const a = texto.charCodeAt(i)
    const b = texto.charCodeAt(i + 1)
    const lead = a === 0xc2 || a === 0xc3 || a === 0xe2
    if (!lead) continue
    if (b >= 0x80 && b <= 0xbf) return true
    if (b === 0x20ac) return true // â€
  }
  return false
}

/** Decodifica texto mojibake de volta para UTF-8. */
function reparar(texto) {
  const bytes = []
  const naoMapeados = new Set()
  for (const ch of texto) {
    const cp = ch.codePointAt(0)
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp)
    else if (INVERSO.has(cp)) bytes.push(INVERSO.get(cp))
    else if (cp === 0xfeff) bytes.push(0xef, 0xbb, 0xbf) // BOM original
    else naoMapeados.add(ch)
  }
  if (naoMapeados.size) return { texto: null, naoMapeados: [...naoMapeados] }
  return { texto: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(bytes)) }
}

const args = process.argv.slice(2)
const aplicar = args.includes('--aplicar')
const arquivos = args.filter((a) => a !== '--aplicar')

let corrigidos = 0
for (const arquivo of arquivos) {
  const original = fs.readFileSync(arquivo, 'utf8')
  if (!ehMojibake(original)) continue
  const { texto, naoMapeados } = reparar(original)
  if (texto === null) {
    console.log(`! ${arquivo}: caracteres fora da CP1252 -> ${JSON.stringify(naoMapeados)}`)
    continue
  }
  const linhaAntes = original.split('\n').find((l) => ehMojibake(l))?.trim()
  console.log(`~ ${arquivo}`)
  if (linhaAntes) console.log(`  antes : ${linhaAntes.slice(0, 150)}`)
  if (aplicar) {
    fs.writeFileSync(arquivo, texto, 'utf8')
    const linhaDepois = texto.split('\n').find((l) => /Detec|chave|Classifica/.test(l))?.trim()
    if (linhaDepois) console.log(`  depois: ${linhaDepois.slice(0, 150)}`)
    corrigidos++
  }
}
console.log(aplicar ? `${corrigidos} arquivo(s) corrigido(s).` : 'Simulacao — use --aplicar para gravar.')
