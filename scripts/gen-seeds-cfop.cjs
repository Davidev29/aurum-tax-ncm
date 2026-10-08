/**
 * Gera `SEED_CFOP` (src/domain/constants/seeds.ts) a partir da tabela
 * oficial `bases-fonte/cfop.json` (619 CFOPs).
 *
 * - codigo: 4 dígitos sem ponto ("5.102" -> "5102")
 * - descricao: texto oficial sem o ponto final (padrão dos seeds)
 * - tipo: grupos 1/2/3 -> "Entrada", grupos 5/6/7 -> "Saída"
 * - ordenado numericamente; blocos CST ICMS / PIS-COFINS preservados.
 *
 * Uso: `node scripts/gen-seeds-cfop.cjs`
 */
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const fonte = JSON.parse(
  fs.readFileSync(path.join(raiz, 'bases-fonte', 'cfop.json'), 'utf8'),
)

const cfop = [...fonte.dados]
  .map((d) => {
    const codigo = String(d.cfop).replace(/\D/g, '')
    const descricao = String(d.descricao).trim().replace(/\s+/g, ' ').replace(/\.$/, '')
    const tipo = /^[123]/.test(codigo) ? 'Entrada' : 'Saída'
    return { codigo, descricao, tipo }
  })
  .filter((d) => /^\d{4}$/.test(d.codigo))
  .sort((a, b) => a.codigo.localeCompare(b.codigo))

// Preserva os blocos CST atuais de seeds.ts (não são objeto desta cura).
const seedsAtual = fs.readFileSync(
  path.join(raiz, 'src', 'domain', 'constants', 'seeds.ts'),
  'utf8',
)
const extrair = (nome) => {
  const m = seedsAtual.match(new RegExp(`export const ${nome}[^=]*= \\[([\\s\\S]*?)\\n\\];`))
  if (!m) throw new Error(`${nome} não encontrado em seeds.ts`)
  return m[1].trim()
}

const fmt = (lista) => lista.map((o) => `  ${JSON.stringify(o)},`).join('\n')

const conteudo = `import type { TabelaAuxiliarSimples } from '../entities'

/**
 * Seeds das tabelas auxiliares (SPEC R9.6).
 * CFOP gerado de bases-fonte/cfop.json em ${new Date().toISOString().slice(0, 10)}
 * (${cfop.length} CFOPs oficiais — cura completa; o que já existia foi mantido).
 * Gravados apenas quando a respectiva store estiver vazia ou por
 * complementação dos códigos faltantes (garantirSementes).
 */

export const SEED_CFOP: TabelaAuxiliarSimples[] = [
${fmt(cfop)}
];

export const SEED_CST_ICMS: TabelaAuxiliarSimples[] = [
${extrair('SEED_CST_ICMS')}
];

export const SEED_CST_PISCOFINS: TabelaAuxiliarSimples[] = [
${extrair('SEED_CST_PISCOFINS')}
];
`

fs.writeFileSync(path.join(raiz, 'src', 'domain', 'constants', 'seeds.ts'), conteudo, 'utf8')
console.log(`SEED_CFOP: ${cfop.length} CFOPs (CSTs preservados).`)
