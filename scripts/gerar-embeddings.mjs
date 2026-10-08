/**
 * gerar-embeddings.mjs — Vetores offline do grafo fiscal (Phase 10-03 / GRAFO-03+06).
 *
 * Gera `recursos-ia/embedding/vetores-ncm.json` (amostra: id→float[384]
 * L2-normalizado) + `MANIFEST-embedding.json` + append em
 * `recursos-ia/CHECKSUMS.txt` + CÓPIA byte-idêntica em
 * `public/base/grafo/vetores.json` (ao lado do `grafo.lbug`, acha o runtime
 * em dev e via extraResources no pacote).
 *
 * Dois modos (registrados em `MANIFEST-embedding.json`):
 *   - `real`: Xenova all-MiniLM-L6-v2 via transformers.js (download 1× AQUI
 *     no build; exige rede + `@xenova/transformers` instalado);
 *   - `hash-fallback`: projeção hash determinística (`incorporarTextoVetor`
 *     do `electron/ia/grafo-service.cjs` — a MESMA função do runtime, via
 *     require; offline/CI sempre funciona).
 *
 * NUNCA falha o build sem rede: qualquer erro cai no hash-fallback (aceitável
 * e documentado). Sem `grafo.lbug.json`, preserva o existente e sai 0.
 * NUNCA baixa nada em runtime (este é o único lugar que toca em rede/modelo).
 *
 * Uso:
 *   node scripts/gerar-embeddings.mjs          # tenta real, cai p/ hash
 *   node scripts/gerar-embeddings.mjs --hash    # força hash-fallback
 *
 * Exporta (reuso em `tests/grafo-hibrido.test.ts`):
 *   textoDocumentoVetor, gerarVetores
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const requireCjs = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const GRAFO_JSON = path.join(PROJECT_ROOT, 'public', 'base', 'grafo', 'grafo.lbug.json')
const EMBEDDING_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'embedding')
const VETORES_FILE = path.join(EMBEDDING_DIR, 'vetores-ncm.json')
const MANIFEST_FILE = path.join(EMBEDDING_DIR, 'MANIFEST-embedding.json')
const CHECKSUMS_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'CHECKSUMS.txt')
const COPIA_GRAFO = path.join(PROJECT_ROOT, 'public', 'base', 'grafo', 'vetores.json')

export const MODELO_OFICIAL = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIM = 384
export const VETORES_FORMATO = 'vetores-grafo-v1'

function carregarGrafoService() {
  return requireCjs('../electron/ia/grafo-service.cjs')
}

/**
 * Texto do documento p/ embedding (MESMA regra do runtime:
 * `textoDocumentoVetor` do grafo-service, sobre os índices construídos do
 * payload — descrição + código + aliases de Termo).
 */
export function textoDocumentoVetor(no, aliasPorId) {
  const partes = [String(no?.props?.descricao || ''), String(no?.props?.codigo || '')]
  const aliases = aliasPorId?.get?.(no?.id)
  if (aliases) for (const t of aliases) partes.push(t)
  return partes.join(' ').trim()
}

/** Mapa id→Set(termo) a partir das arestas SINONIMO_DE/SINONIMO_NBS (Termo→nó).
 * Paridade com o runtime (`construirIndices` coleta os dois tipos): sem o
 * NBS aqui, os termos do fine-tuning de serviços nunca entravam no
 * `vetores.json` e o cosine os ignorava. */
export function mapaAliases(arestas) {
  const mapa = new Map()
  for (const a of arestas || []) {
    if (!a || (a.tipo !== 'SINONIMO_DE' && a.tipo !== 'SINONIMO_NBS') || typeof a.de !== 'string' || typeof a.para !== 'string') continue
    if (!a.de.startsWith('Termo:')) continue
    const termo = a.de.slice('Termo:'.length)
    if (!mapa.has(a.para)) mapa.set(a.para, new Set())
    mapa.get(a.para).add(termo)
  }
  return mapa
}

const TIPOS_VETORIZADOS = new Set(['NCM', 'NBS', 'CNAE'])

/**
 * Gera `{ id: float[dim] }` pelo fallback hash (puro, determinístico),
 * ponderado pelo IDF do corpus (raro pesa mais — ver `calcularIdf`).
 * `nodos`: array do payload do grafo. Nunca lança (nó ruim → pula).
 * Devolve `{ vetores, pulados, idf }` (`idf` serializável p/ o arquivo).
 */
export function gerarVetores(nodos, arestas, opcoes = {}) {
  const gs = carregarGrafoService()
  const dim = Number(opcoes.dim) > 0 ? Math.floor(Number(opcoes.dim)) : EMBEDDING_DIM
  const aliases = mapaAliases(arestas)
  const textos = []
  const ordem = []
  const crus = []
  for (const no of nodos || []) {
    try {
      if (!no || typeof no.id !== 'string' || !TIPOS_VETORIZADOS.has(no.tipo)) continue
      const texto = textoDocumentoVetor(no, aliases)
      if (!texto) continue
      textos.push(gs.tokensExpandidos(texto).map((x) => x.t))
      crus.push(texto)
      ordem.push(no.id)
    } catch {
      /* nó ruim: pula (contado abaixo por diferença) */
    }
  }
  const idf = gs.calcularIdf(textos)
  const vetores = {}
  for (let i = 0; i < ordem.length; i++) {
    try {
      // Texto CRU (o runtime incorpora a consulta crua do mesmo jeito —
      // expansão/idf idênticos dos dois lados).
      vetores[ordem[i]] = gs.incorporarTextoVetor(crus[i], dim, idf)
    } catch {
      /* pula */
    }
  }
  const idfObj = {}
  for (const [t, v] of idf) idfObj[t] = v
  return { vetores, pulados: (nodos || []).length - ordem.length, idf: idfObj }
}

/**
 * Tenta o caminho real (transformers.js + download 1× do modelo).
 * Lança em qualquer indisponibilidade (sem rede, sem pacote) — o chamador
 * cai no hash-fallback.
 */
async function tentarVetoresReais(nodos, arestas) {
  const { pipeline } = await import('@xenova/transformers')
  const aliases = mapaAliases(arestas)
  const docs = (nodos || []).filter(
    (no) => no && typeof no.id === 'string' && TIPOS_VETORIZADOS.has(no.tipo),
  )
  const extrator = await pipeline('feature-extraction', MODELO_OFICIAL, {
    cache_dir: path.join(EMBEDDING_DIR, 'modelo-cache'),
  })
  const vetores = {}
  let n = 0
  for (const no of docs) {
    const texto = textoDocumentoVetor(no, aliases)
    if (!texto) continue
    const emb = await extrator(texto, { pooling: 'mean', normalize: true })
    const arr = Array.from(emb.data, (v) => Math.round(Number(v) * 10000) / 10000)
    if (arr.length !== EMBEDDING_DIM) throw new Error(`dimensão inesperada: ${arr.length}`)
    vetores[no.id] = arr
    if (++n % 2000 === 0) console.log(`  … ${n}/${docs.length} embeddings`)
  }
  return vetores
}

function sha256Arquivo(caminho) {
  return createHash('sha256').update(fs.readFileSync(caminho)).digest('hex')
}

/** Atualiza (ou acrescenta) as linhas do embedding no CHECKSUMS.txt. */
function atualizarChecksums() {
  try {
    const linhas = fs.existsSync(CHECKSUMS_FILE)
      ? fs.readFileSync(CHECKSUMS_FILE, 'utf8').split('\n')
      : []
    const v1 = `${sha256Arquivo(VETORES_FILE)}  embedding/vetores-ncm.json`
    const v2 = `${sha256Arquivo(MANIFEST_FILE)}  embedding/MANIFEST-embedding.json`
    const mantidas = linhas.filter(
      (l) => l.trim() !== '' && !l.includes('embedding/vetores-ncm.json') && !l.includes('embedding/MANIFEST-embedding.json'),
    )
    const temNovaLinha = mantidas.length > 0 && mantidas[mantidas.length - 1].trim() !== ''
    const saida = [...mantidas, ...(temNovaLinha ? [''] : []), v1, v2]
    fs.writeFileSync(CHECKSUMS_FILE, `${saida.join('\n')}\n`, 'utf8')
    console.log('   CHECKSUMS.txt atualizado (embedding/vetores-ncm.json + MANIFEST-embedding.json).')
  } catch (e) {
    console.log(`   aviso: CHECKSUMS.txt não atualizado (${String(e?.message || e).slice(0, 100)})`)
  }
}

async function main() {
  const forcarHash = process.argv.includes('--hash')
  console.log(' Aurum Tax NCM — geração dos vetores do grafo (10-03 / GRAFO-03+06)')

  if (!fs.existsSync(GRAFO_JSON)) {
    console.log('   grafo.lbug.json ausente — preservando vetores existentes (build blindado, exit 0).')
    return
  }
  let payload = null
  try {
    payload = JSON.parse(fs.readFileSync(GRAFO_JSON, 'utf8'))
  } catch (e) {
    console.log(`   grafo ilegível (${String(e?.message || e).slice(0, 100)}) — preservando vetores (exit 0).`)
    return
  }
  const nodos = Array.isArray(payload?.nodos) ? payload.nodos : []
  const arestas = Array.isArray(payload?.arestas) ? payload.arestas : []
  console.log(`   grafo: ${nodos.length} nodos · ${arestas.length} arestas`)

  fs.mkdirSync(EMBEDDING_DIR, { recursive: true })

  let vetores = null
  let modo = 'hash-fallback'
  if (!forcarHash) {
    try {
      vetores = await tentarVetoresReais(nodos, arestas)
      modo = 'real'
      console.log(`✔ Vetores REAIS (${MODELO_OFICIAL}, ${Object.keys(vetores).length} docs, 384-d).`)
    } catch (err) {
      console.log(`   modelo real indisponível (${String(err?.message || err).split('\n')[0].slice(0, 120)}); usando hash-fallback.`)
      vetores = null
    }
  }
  if (!vetores) {
    const { vetores: v, pulados, idf } = gerarVetores(nodos, arestas, { dim: EMBEDDING_DIM })
    vetores = v
    modo = 'hash-fallback'
    var idfObj = idf
    console.log(`✔ Vetores HASH-FALLBACK determinísticos (${Object.keys(vetores).length} docs, 384-d, idf:${Object.keys(idf || {}).length}${pulados ? `, ${pulados} fora do escopo` : ''}).`)
    console.log('   (aceitável e documentado p/ offline/CI; com rede, rode sem --hash p/ o modelo real.)')
  }

  const hashGrafo = typeof payload?.hash === 'string' ? payload.hash : null
  const doc = {
    formato: VETORES_FORMATO,
    modelo: modo === 'real' ? MODELO_OFICIAL : 'hash-fallback:sha256-projecao',
    modeloAlvo: MODELO_OFICIAL,
    dim: EMBEDDING_DIM,
    modo,
    geradoEm: new Date().toISOString(),
    hashGrafo,
    totalVetores: Object.keys(vetores).length,
    ...(modo === 'hash-fallback' && typeof idfObj === 'object' ? { idf: idfObj } : {}),
    vetores,
  }
  const bytes = Buffer.from(JSON.stringify(doc), 'utf8')
  fs.writeFileSync(VETORES_FILE, bytes)
  fs.writeFileSync(COPIA_GRAFO, bytes) // cópia byte-idêntica ao lado do grafo
  console.log(`   vetores: ${VETORES_FILE} (${(bytes.length / 1048576).toFixed(1)} MB)`)
  console.log('   cópia: public/base/grafo/vetores.json (runtime dev + extraResources)')

  const manifest = {
    embedding: { modelo: 'all-MiniLM-L6-v2', dim: EMBEDDING_DIM, modo },
    modelo: doc.modelo,
    modeloAlvo: MODELO_OFICIAL,
    dim: EMBEDDING_DIM,
    modo,
    geradoEm: doc.geradoEm,
    hashGrafo,
    totalVetores: doc.totalVetores,
    arquivos: ['recursos-ia/embedding/vetores-ncm.json', 'public/base/grafo/vetores.json (cópia)'],
  }
  fs.writeFileSync(MANIFEST_FILE, Buffer.from(JSON.stringify(manifest, null, 1), 'utf8'))
  console.log(`   manifesto: ${MANIFEST_FILE} (modo: ${modo})`)

  atualizarChecksums()
}

const ehMain = process.argv[1]?.endsWith('gerar-embeddings.mjs')
if (ehMain) {
  main().catch((err) => {
    // NUNCA falhar o build: fallback final vazio-versionado é melhor que exit 1.
    console.log(`   falha blindada (${String(err?.message || err).slice(0, 160)}) — exit 0, vetores preservados.`)
  })
}
