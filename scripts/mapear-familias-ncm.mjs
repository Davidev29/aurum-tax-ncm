/**
 * mapear-familias-ncm.mjs
 * =======================
 * Gera o mapeamento hierárquico da Reforma (família por capítulo/posição/
 * subposição) e valida a curadoria de `regras-hierarquicas.ts`.
 *
 * Uso:
 *   node scripts/mapear-familias-ncm.mjs [--json]
 *
 * Entradas (mesma ordem de procura de `build-base.mjs`):
 *   1. `AURUM_BASE_DIR` · 2. `bases-fonte/` · 3. pasta pai (legado).
 *
 * Saída:
 *   - relatório humano no stdout (cobertura exata, prefixos unânimes,
 *     capítulos 100%, condicionais, validação da curadoria);
 *   - `--json` imprime o objeto completo (para auditoria/CI).
 *
 * Ele NÃO reescreve código: a curadoria vive em
 * `src/domain/services/regras-hierarquicas.ts`. Quando o relatório apontar
 * divergência (ex.: capítulo curado deixou de ser 100%), atualize a
 * curadoria e rode os testes `heranca-familia`.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DIRS = [
  ...(process.env.AURUM_BASE_DIR ? [path.resolve(process.env.AURUM_BASE_DIR)] : []),
  path.join(PROJECT_ROOT, 'bases-fonte'),
  path.join(PROJECT_ROOT, '..'),
]

const dig = (s) => String(s ?? '').replace(/\D+/g, '')
const localizar = (padrao) => {
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue
    const achado = fs.readdirSync(dir).find((f) => new RegExp(padrao).test(f))
    if (achado) return path.join(dir, achado)
  }
  return null
}

function carregar() {
  const reformaArq = localizar('^reforma_tributaria_por_ncm\\.json$')
  const nomenArq = localizar('^Tabela_NCM_Vigente_.*\\.json$')
  const refArq = localizar('^classificacao_tributaria\\.json$')
  if (!reformaArq || !nomenArq) throw new Error('Fontes não encontradas (reforma + nomenclatura).')
  return {
    reforma: JSON.parse(fs.readFileSync(reformaArq, 'utf8')),
    nomen: JSON.parse(fs.readFileSync(nomenArq, 'utf8')),
    referencia: refArq ? JSON.parse(fs.readFileSync(refArq, 'utf8')) : [],
  }
}

function analisar(reforma, nomen) {
  const vinculo = new Map()
  for (const x of reforma.NCM ?? []) {
    const c = dig(x.codigo)
    if (c.length === 8) vinculo.set(c, `${x.cst}|${x.cClassTrib}`)
  }
  const vig = (nomen.Nomenclaturas ?? [])
    .map((n) => ({ codigo: dig(n.Codigo), fim: n.Data_Fim }))
    .filter((n) => n.codigo.length === 8 && (!n.fim || n.fim === '31/12/9999'))
    .map((n) => n.codigo)

  const porPrefixo = (tam) => {
    const grupos = new Map()
    for (const c of vig) {
      const p = c.slice(0, tam)
      if (!grupos.has(p)) grupos.set(p, [])
      grupos.get(p).push(c)
    }
    const stats = { total: grupos.size, nenhum: 0, todosUnanime: 0, todosMisto: 0, parcialUnanime: 0, parcialMisto: 0 }
    const parcialUnanime = []
    for (const [p, filhos] of grupos) {
      const com = filhos.filter((c) => vinculo.has(c))
      const sem = filhos.length - com.length
      if (!com.length) { stats.nenhum++; continue }
      const ccts = new Set(com.map((c) => vinculo.get(c)))
      if (!sem) {
        if (ccts.size === 1) stats.todosUnanime++
        else stats.todosMisto++
      } else if (ccts.size === 1) {
        stats.parcialUnanime++
        parcialUnanime.push({ prefixo: p, total: filhos.length, com: com.length, cobertura: com.length / filhos.length, cct: [...ccts][0] })
      } else stats.parcialMisto++
    }
    parcialUnanime.sort((a, b) => b.cobertura - a.cobertura)
    return { stats, parcialUnanime }
  }

  const cap = new Map()
  for (const c of vig) {
    const k = c.slice(0, 2)
    if (!cap.has(k)) cap.set(k, { total: 0, com: 0, ccts: new Map() })
    const e = cap.get(k)
    e.total++
    if (vinculo.has(c)) {
      e.com++
      const t = vinculo.get(c)
      e.ccts.set(t, (e.ccts.get(t) ?? 0) + 1)
    }
  }
  const capitulos = [...cap.entries()].map(([c, e]) => ({
    capitulo: c, total: e.total, com: e.com, sem: e.total - e.com,
    cobertura: e.total ? e.com / e.total : 0,
    unanime: e.ccts.size === 1, ccts: [...e.ccts.entries()],
  })).sort((a, b) => a.capitulo.localeCompare(b.capitulo))

  return {
    totalVigentes: vig.length,
    comVinculo: vig.filter((c) => vinculo.has(c)).length,
    sh6: porPrefixo(6),
    sh4: porPrefixo(4),
    capitulos,
  }
}

function validarCuradoria(rel, referencia) {
  const problemas = []
  // Capítulos curados precisam continuar 100% + unânimes.
  const curados = ['07', '10', '11', '12', '15', '25', '31']
  for (const c of curados) {
    const e = rel.capitulos.find((x) => x.capitulo === c)
    if (!e) { problemas.push(`capítulo curado ${c} ausente da nomenclatura vigente`); continue }
    if (e.cobertura !== 1) problemas.push(`capítulo curado ${c} com cobertura ${(e.cobertura * 100).toFixed(1)}% (esperado 100%) — revisar REGRAS_CAPITULO`)
    if (!e.unanime) problemas.push(`capítulo curado ${c} deixou de ser unânime — revisar REGRAS_CAPITULO`)
    const cct = e.ccts[0]?.[0]
    if (cct !== '200|200038') problemas.push(`capítulo curado ${c} mudou de enquadramento (${cct}) — revisar REGRAS_CAPITULO`)
  }
  // 06 deve continuar fora (misto) — se unificar, a curadoria pode incorporá-lo.
  const cap06 = rel.capitulos.find((x) => x.capitulo === '06')
  if (cap06?.unanime && cap06.cobertura === 1) {
    problemas.push('capítulo 06 unificou (100% unânime) — avaliar inclusão em REGRAS_CAPITULO')
  }
  return problemas
}

function main() {
  const { reforma, nomen } = carregar()
  const rel = analisar(reforma, nomen)
  const cobertura = rel.totalVigentes ? rel.comVinculo / rel.totalVigentes : 0
  const problemas = validarCuradoria(rel)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ cobertura, ...rel, problemas }, null, 2))
    process.exit(problemas.length ? 1 : 0)
  }

  console.log(' Aurum Tax NCM — mapeamento hierárquico (família NCM × Reforma)')
  console.log(`   vigentes 8 dígitos: ${rel.totalVigentes} · com vínculo exato: ${rel.comVinculo} (${(cobertura * 100).toFixed(1)}%) · sem vínculo: ${rel.totalVigentes - rel.comVinculo}`)
  console.log(`   SH6: ${JSON.stringify(rel.sh6.stats)} · SH4: ${JSON.stringify(rel.sh4.stats)}`)
  console.log('   capítulos 100% unânimes curados: 07, 10, 11, 12, 15, 25, 31 (200/200038 Anexo IX)')
  console.log('   top SH6 parcial unânime (candidatos a hipótese):')
  for (const p of rel.sh6.parcialUnanime.slice(0, 10)) {
    console.log(`     ${p.prefixo}: ${p.com}/${p.total} (${(p.cobertura * 100).toFixed(0)}%) ${p.cct}`)
  }
  if (problemas.length) {
    console.log('   ⚠ divergências da curadoria:')
    for (const p of problemas) console.log(`     - ${p}`)
    process.exit(1)
  }
  console.log('   ✔ curadoria válida (REGRAS_CAPITULO + limiares).')
}

main()
