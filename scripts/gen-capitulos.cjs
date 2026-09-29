const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const origem = fs.readFileSync(path.join(raiz, '..', 'index.html'), 'utf8')
const m = origem.match(/const CAPITULOS_NCM = (\{[\s\S]*?\n\});/)
if (!m) throw new Error('CAPITULOS_NCM não encontrado no index.html original')
const mapa = Function(`return ${m[1]}`)()
const body = Object.entries(mapa)
  .map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`)
  .join('\n')

const conteudo = `/**
 * Mapa oficial Capítulo NCM -> descrição (96 entradas: 01..97, sem o 77).
 * Origem: SPEC-LOGICA-NEGOCIO R2.17 — usado nos avisos legais e no
 * agrupamento da tela de Nomenclatura.
 */
export const CAPITULOS_NCM: Record<string, string> = {
${body}
};

/** Nome legível de um capítulo ("01" -> "Animais vivos"). */
export const nomeCapitulo = (cap: string): string => CAPITULOS_NCM[cap] ?? '';

/**
 * Capítulos em que a mercadoria pode ser fornecida *in natura*
 * (aviso do Art. 137, SPEC R2.14).
 */
export const CAPITULOS_IN_NATURA: ReadonlySet<string> = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13',
  '14', '15', '41', '42', '43', '44', '45', '46', '50', '51', '52', '53',
]);
`

const outPath = path.join(raiz, 'src', 'domain', 'constants', 'capitulos.ts')
fs.writeFileSync(outPath, conteudo, 'utf8')
console.log('capitulos.ts gerado:', Object.keys(mapa).length, 'entradas')
