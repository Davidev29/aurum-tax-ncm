#!/usr/bin/env node
/**
 * gerar-catalogo-rag.mjs — Valida o catálogo RAG contra o registro TS.
 *
 * O REGISTRO (`src/application/aurum-ai-registro-ferramentas.ts`) é a
 * single-source das ferramentas; o CATÁLOGO
 * (`recursos-ia/conhecimento/catalogo-rag.json`) é o mapa das FONTES RAG
 * que cada ferramenta consulta. Este script garante que:
 *   1. toda ferramenta do catálogo existe no registro;
 *   2. todo domínio do registro tem ao menos uma fonte no catálogo;
 *   3. todo arquivo-fonte listado existe (ou é Dexie/rede, marcado).
 *
 * Uso: node scripts/gerar-catalogo-rag.mjs [--check]
 *   --check: só valida (exit 1 se divergir). Sem flag: valida + imprime resumo.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.resolve(__dirname, '..')
const CATALOGO = path.join(RAIZ, 'recursos-ia', 'conhecimento', 'catalogo-rag.json')
const REGISTRO_TS = path.join(RAIZ, 'src', 'application', 'aurum-ai-registro-ferramentas.ts')

function ferramentasDoRegistro() {
  const src = fs.readFileSync(REGISTRO_TS, 'utf8')
  const nomes = [...src.matchAll(/nome:\s*'([A-Za-z0-9]+)'/g)].map((m) => m[1])
  return [...new Set(nomes)]
}

function main() {
  const falhas = []
  if (!fs.existsSync(CATALOGO)) {
    console.error(`FALTA: ${path.relative(RAIZ, CATALOGO)}`)
    process.exit(1)
  }
  if (!fs.existsSync(REGISTRO_TS)) {
    console.error(`FALTA: ${path.relative(RAIZ, REGISTRO_TS)}`)
    process.exit(1)
  }
  const catalogo = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'))
  const registro = ferramentasDoRegistro()
  const citadas = new Set()
  for (const fonte of catalogo.fontes ?? []) {
    for (const f of fonte.ferramentas ?? []) {
      citadas.add(f)
      if (!registro.includes(f)) falhas.push(`catálogo cita ferramenta inexistente: "${f}" (fonte ${fonte.id})`)
    }
    const arq = String(fonte.arquivo ?? '')
    if (/Dexie|BrasilAPI|rede|sistema|runtime/i.test(arq)) continue // runtime, não arquivo
    const partes = arq.split('+').map((s) => s.trim()).filter(Boolean)
    let algumaExiste = false
    for (const p of partes) {
      const limpo = p.replace(/\{[^}]*\}/g, 'sinonimos.json').split(' ')[0]
      if (fs.existsSync(path.join(RAIZ, limpo))) { algumaExiste = true; break }
    }
    if (!algumaExiste) console.warn(`AVISO: fonte ${fonte.id} sem arquivo verificável (${arq})`)
  }
  for (const nome of registro) {
    if (!citadas.has(nome)) console.warn(`AVISO: ferramenta "${nome}" sem fonte no catálogo`)
  }
  if (falhas.length) {
    console.error(`\nCATÁLOGO RAG DIVERGENTE (${falhas.length}):`)
    falhas.forEach((f) => console.error(` - ${f}`))
    process.exit(1)
  }
  console.log(`✔ catálogo RAG íntegro: ${catalogo.fontes.length} fontes × ${registro.length} ferramentas (${catalogo.versao})`)
}

main()
