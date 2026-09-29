const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const origem = fs.readFileSync(path.join(raiz, '..', 'index.html'), 'utf8')
const extrair = (nome) => {
  const m = origem.match(new RegExp(`const ${nome} = (\\[[\\s\\S]*?\\n\\]);`))
  if (!m) throw new Error(`${nome} não encontrado`)
  return Function(`return ${m[1]}`)()
}

const cfop = extrair('SEED_CFOP')
const icms = extrair('SEED_CST_ICMS')
const piscofins = extrair('SEED_CST_PISCOFINS')

const fmt = (lista) =>
  lista.map((o) => `  ${JSON.stringify(o)},`).join('\n')

const conteudo = `import type { TabelaAuxiliarSimples } from '../entities'

/**
 * Seeds das tabelas auxiliares (SPEC R9.6).
 * Gravados apenas quando a respectiva store estiver vazia.
 */

export const SEED_CFOP: TabelaAuxiliarSimples[] = [
${fmt(cfop)}
];

export const SEED_CST_ICMS: TabelaAuxiliarSimples[] = [
${fmt(icms)}
];

export const SEED_CST_PISCOFINS: TabelaAuxiliarSimples[] = [
${fmt(piscofins)}
];
`

const out = path.join(raiz, 'src', 'domain', 'constants', 'seeds.ts')
fs.writeFileSync(out, conteudo, 'utf8')
console.log(
  'seeds.ts:',
  cfop.length, 'CFOP ·',
  icms.length, 'CST ICMS ·',
  piscofins.length, 'PIS/COFINS',
)
