'use strict'
/**
 * avaliar-grafo-rag.cjs — Eval de precisão do RAG do grafo local.
 *
 * Ground-truth (só pares consulta→código concreto; entradas de
 * regra-geral/sem-lastro/fora-de-escopo são ignoradas com contagem):
 *   - recursos-ia/conhecimento/frases-modelo.json (NCM, 71 frases);
 *   - recursos-ia/conhecimento/frases-modelo-servicos.json (NBS);
 *   - 16 CASOS de scripts/testar-indice-ia.mjs (recall por capítulo).
 *
 * Métricas: top-1 exato, top-3 exato (NCM+NBS) e recall de capítulo.
 * Uso: node scripts/avaliar-grafo-rag.cjs [--k 5]
 * Exit 0 sempre (é termômetro, não gate): imprime tabela + resumo.
 * NUNCA lança; compara só dígitos.
 */

const fs = require('node:fs')
const path = require('node:path')
const grafo = require('../electron/ia/grafo-service.cjs')

const ROOT = path.resolve(__dirname, '..')
const K = Number(process.argv.includes('--k') ? process.argv[process.argv.indexOf('--k') + 1] : 5) || 5

const soDig = (s) => String(s ?? '').replace(/\D+/g, '')

function carregarFrases(arq, campo) {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, arq), 'utf8'))
  const out = []
  let ignorados = 0
  for (const f of doc.frases || []) {
    const cod = soDig(f[campo])
    if (!f.consulta || !cod) {
      ignorados++
      continue
    }
    out.push({ consulta: String(f.consulta), esperado: cod })
  }
  return { casos: out, ignorados }
}

// 16 CASOS espelhados de scripts/testar-indice-ia.mjs (capítulo + top-k).
const CASOS_CAPITULO = [
  { consulta: 'Frango vivo', cap: ['01'], k: 3 },
  { consulta: 'Arroz branco', cap: ['10'], k: 3, top1: '10' },
  { consulta: 'Notebook', cap: ['84', '85'], k: 5 },
  { consulta: 'parmesao', cap: ['04'], k: 3 },
  { consulta: 'smartphone samsung', cap: ['85'], k: 5 },
  { consulta: 'whey', cap: ['21'], k: 5 },
  { consulta: 'fralda', cap: ['96'], k: 5 },
  { consulta: 'saco cimento', cap: ['25'], k: 5 },
  { consulta: 'sabonete', cap: ['34'], k: 5 },
]

async function main() {
  const ncm = carregarFrases('recursos-ia/conhecimento/frases-modelo.json', 'ncm')
  const nbs = carregarFrases('recursos-ia/conhecimento/frases-modelo-servicos.json', 'nbs')
  const casos = [...ncm.casos.map((c) => ({ ...c, tipo: 'NCM' })), ...nbs.casos.map((c) => ({ ...c, tipo: 'NBS' }))]
  let top1 = 0
  let top3 = 0
  const erros = []
  for (const c of casos) {
    let r = null
    try {
      r = await grafo.grafoConsultar({ texto: c.consulta, k: Math.max(K, 3) }, {})
    } catch (_) {
      r = null
    }
    const cods = r && r.ok ? r.candidatos.map((x) => soDig(x.codigo)) : []
    const hit1 = cods[0] === c.esperado
    const hit3 = cods.slice(0, 3).includes(c.esperado)
    if (hit1) top1++
    if (hit3) top3++
    if (!hit3) erros.push({ consulta: c.consulta, esperado: c.esperado, top3: cods.slice(0, 3).join(',') || '—' })
  }
  let capOk = 0
  for (const c of CASOS_CAPITULO) {
    let r = null
    try {
      r = await grafo.grafoConsultar({ texto: c.consulta, k: c.k }, {})
    } catch (_) {
      r = null
    }
    const cods = r && r.ok ? r.candidatos.map((x) => soDig(x.codigo)) : []
    const hit = cods.some((d) => c.cap.some((p) => d.startsWith(p)))
    const hitTop1 = c.top1 ? cods[0] && cods[0].startsWith(c.top1) : true
    if (hit && hitTop1) capOk++
    else erros.push({ consulta: `${c.consulta} [cap ${c.cap.join('/')}]`, esperado: `cap ${c.cap.join('/')}`, top3: cods.slice(0, 3).join(',') || '—' })
  }
  const total = casos.length
  console.log(`casos codigo-exato: ${total} (ignorados sem codigo: NCM=${ncm.ignorados} NBS=${nbs.ignorados})`)
  console.log(`top-1 exato: ${top1}/${total} (${(100 * top1 / Math.max(1, total)).toFixed(1)}%)`)
  console.log(`top-3 exato: ${top3}/${total} (${(100 * top3 / Math.max(1, total)).toFixed(1)}%)`)
  console.log(`capitulos:   ${capOk}/${CASOS_CAPITULO.length}`)
  if (erros.length) {
    console.log('--- erros (fora do top-3 / capitulo) ---')
    for (const e of erros) console.log(`  "${e.consulta}" esp=${e.esperado} top3=[${e.top3}]`)
  }
  try {
    grafo._limparCache()
    if (typeof grafo._limparCacheVetores === 'function') grafo._limparCacheVetores()
  } catch (_) { /* ignora */ }
}

main().catch((e) => {
  console.error(`eval falhou: ${String((e && e.message) || e)}`)
  process.exitCode = 1
})
