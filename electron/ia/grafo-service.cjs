'use strict'

/**
 * grafo-service.cjs — Runtime do grafo fiscal local (Phase 10-02 / GRAFO-02).
 *
 * Lado consultável do grafo (`public/base/grafo/grafo.lbug`, gerado por
 * `scripts/build-grafo.mjs` via `npm run base`):
 *   - `abrirGrafo()` / `grafoConsultar()` resolvem userData
 *     (`%APPDATA%/Aurum Tax NCM/grafo/grafo.lbug`) vs empacotado
 *     (`recursos-ia/grafo/` via extraResources) vs dev
 *     (`public/base/grafo/`) pelo `caminhos-ia.cjs`;
 *   - tenta `require('@ladybugdb/core')` quando instalado (modo `'lbug'`),
 *     senão lê o JSON portátil em memória (modo `'json-fallback'`,
 *     bit-idêntico — o build grava os mesmos bytes no `.lbug` quando o
 *     nativo está ausente);
 *   - sem arquivo → `{ ok:false, fallback:'lexical' }` (fail-closed: o
 *     chamador cai no Top-20 lexical atual, comportamento pré-grafo).
 *
 * NUNCA lança: toda entrada/Saída é blindada — qualquer falha vira
 * `{ ok:false, fallback:'lexical' }`. O `require('@ladybugdb/core')` é
 * PREGUIÇOSO (dentro de função, com try/catch) e está em `external` no
 * `electron/esbuild.mjs`: nunca é bundlado nem carregado no renderer/main
 * quente — só aqui e no worker (`ia-worker.cjs`, comando `grafo`).
 *
 * Consulta (Phase 10-03 / GRAFO-03+06: 4 estágios; 10-04: precisão):
 *   - (a) FTS seeds: tokens da CONSULTA sem stopwords/juridiquês
 *     (`tokenizarConsulta`), score por overlap ponderado por IDF (raro =
 *     diagnóstico; typo ganha o teto) + bônus de Termo→NCM/NBS
 *     (`SINONIMO_DE`, +0.25);
 *   - (b) HNSW/vetor seeds: cosine similarity sobre `vetores.json`
 *     (build `scripts/gerar-embeddings.mjs`, 384-d, NUNCA baixado em runtime;
 *     ausente → estágio pulado, `modoVetor:'fts-puro'`);
 *     GUARDA anti-dessincronia: `hashGrafo` do vetor ≠ `hash` do grafo →
 *     estágio pulado com `avisoVetor:'indice-desatualizado'` (o `npm run
 *     base` regenera os vetores a cada rebuild do grafo);
 *   - (c) expansão 2-hops: `NCM→CCT→Anexo→Artigo`, `CNAE→NBS→CCT(→Anexo)`,
 *     `NBS→CCT→Anexo→Artigo` — caminho auditável por candidato + `cypher`
 *     determinístico (vai para `via:grafo` em 10-05);
 *   - (d) rerank: `score_base` (blend FTS 0.6 + vetor 0.4 normalizados +
 *     PageRank simplificado por grau + boost Anexo + scoping por
 *     comunidade/capítulo, estilo Louvain-lite) + `min(boost_uso, 0.3)`
 *     do overlay (GRAFO-08). Cada candidato carrega
 *     `scores:{fts,vetor,pagerank}` (ranking interno — NUNCA confiança
 *     fiscal) + `boost:'uso_local'|null` na trilha.
 *   - índices `Map` (por id, adjacência, tokens): <50ms p/ base 20k nodos.
 *
 * Overlay de aprendizado (GRAFO-08, nesta plan só abre/cria):
 *   - `%APPDATA%/Aurum Tax NCM/grafo/aprendizado.json` nasce
 *     `{ versao:1, arestas:[] }` vazio, com checksum sha256;
 *   - corrompido → backup `aprendizado.corrompido-<ts>.json` + recria vazio,
 *     base intacta (o grafo é só lido, nunca escrito);
 *   - só este módulo lê/escreve o overlay (escritores vêm em 10-05).
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

let caminhosIa = null
try {
  caminhosIa = require('./caminhos-ia.cjs')
} catch (_) {
  caminhosIa = null
}

/** Versão do schema aceita (espelha `scripts/build-grafo.mjs`). */
const GRAFO_VERSAO = 'grafo-v1'
/** Versão do overlay de aprendizado local (GRAFO-08). */
const OVERLAY_VERSAO = 1
/** Bônus de alias Termo→nó quando o token casa exatamente um Termo. */
const BONUS_TERMO = 0.25
/** Tipos que viram candidatos de consulta. */
const TIPOS_CANDIDATOS = new Set(['NCM', 'NBS', 'CNAE'])

// ---------------------------------------------------------------------------
// Phase 10-03 (GRAFO-03 + GRAFO-06 + parte GRAFO-08): retrieval híbrido.
// ---------------------------------------------------------------------------

/** Dimensão dos vetores (all-MiniLM-L6-v2). */
const EMBEDDING_DIM = 384
/** Modelo oficial dos vetores (download 1× no BUILD, nunca em runtime). */
const MODELO_EMBEDDING = 'all-MiniLM-L6-v2'
/** Formato do arquivo lateral de vetores. */
const VETORES_FORMATO = 'vetores-grafo-v1'
/** TETO do boost de uso local: `score_final = score_base + min(boost, 0.3)`. */
const TETO_BOOST = 0.3
/** TTL das arestas de uso local (dias). */
const TTL_USO_DIAS = 90
/** Pesos do blend base: FTS 0.6 + vetor 0.4 (ambos normalizados por max). */
const PESO_FTS = 0.6
const PESO_VETOR = 0.4
/** PageRank simplificado: grau normalizado conta pouco, Anexo conta mais. */
const PESO_GRAU = 0.05
const BONUS_ANEXO = 0.1
/** Louvain-lite: candidatos na comunidade dominante ganham scoping. */
const BONUS_COMUNIDADE = 0.05
/** Tipos de aresta do overlay que geram boost (`uso_local`). */
const TIPOS_USO_LOCAL = ['Termo-PREFERIDO', 'NCM-ESCOLHIDO', 'CNAE-CARTEIRA']
/** Peso padrão quando a aresta de uso não declara `peso`. */
const PESO_USO_PADRAO = 0.1

/**
 * Ponte semântica do embedding hash-fallback (Phase 10-03).
 *
 * O fallback hash é um saco esparso de tokens — sem expansão, "aula" jamais
 * encontraria "educação". Esta tabela cura os clusters onde o texto oficial
 * (boilerplate tributário) e a fala do usuário divergem; cada chave expande
 * para os valores com peso 0.5 (o token original segue peso 1).
 * Single-source: `scripts/gerar-embeddings.mjs` importa daqui via require —
 * consulta (runtime) e documento (build) usam a MESMA expansão.
 * Espelha `src/domain/services/vocabulario-servicos.ts` (cluster educação).
 * O modelo real (transformers.js) captura o resto neuralmente quando há rede.
 *
 * CHAVES EM FORMA STEMIZADA: a expansão recebe o token JÁ com `stem`
 * aplicado (`tokensExpandidos`, `indiceVetorFiltro`) — por isso `ingle`
 * (de "inglês") e `france` (de "francês"), nunca as formas com `-s` final.
 */
const PONTE_SEMANTICA_VETOR = {
  aula: ['educacao', 'ensino'],
  escola: ['educacao', 'ensino'],
  colegio: ['educacao', 'ensino'],
  faculdade: ['educacao', 'ensino'],
  universidade: ['educacao', 'ensino'],
  curso: ['educacao', 'ensino'],
  cursinho: ['educacao', 'ensino'],
  vestibular: ['educacao', 'ensino'],
  professor: ['educacao', 'ensino'],
  ensino: ['educacao', 'ensino'],
  treinamento: ['educacao', 'ensino'],
  idioma: ['educacao', 'idioma'],
  ingle: ['educacao', 'idioma'],
  espanhol: ['educacao', 'idioma'],
  france: ['educacao', 'idioma'],
  online: ['online', 'internet'],
  internet: ['online', 'internet'],
  remoto: ['online', 'internet'],
  ead: ['educacao', 'ensino', 'online'],
}

/** Expande um token (já normalizado+stemizado) para a ponte semântica. */
function expandirTokenVetor(tok) {
  const extras = PONTE_SEMANTICA_VETOR[tok]
  if (!extras || !extras.length) return [tok]
  const vistos = new Set([tok])
  const out = [tok]
  for (const e of extras) {
    const n = stem(normalizar(e).replace(/[^a-z0-9]+/g, ''))
    if (n && !vistos.has(n)) {
      vistos.add(n)
      out.push(n)
    }
  }
  return out
}

/** Cache em memória por arquivo (chave = caminho absoluto). */
let cacheGrafo = null // { caminho, mtimeMs, tamanho, nodos, arestas, indices }

/** Normaliza: minúsculas, sem acento, espaços colapsados. */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Stem pt-BR mínimo (mesma regra do `ia-worker.cjs`: plural → singular). */
function stem(token) {
  const t = String(token || '')
  if (t.length > 3 && t.endsWith('s')) return t.slice(0, -1)
  return t
}

/** Tokens de um texto livre (dígitos preservados p/ busca por código). */
function tokenizar(texto) {
  return normalizar(texto)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/**
 * Stopwords da CONSULTA (Phase 10-04): preposições, pronomes, verbos de
 * pedido e juridiquês fiscal ("servico", "fornecimento", "anexo", "art"…).
 * Espelham `STOPWORDS_BUSCA` (`src/domain/services/busca-texto.ts`),
 * `TOKENS_JURIDIQUES_NBS` (`classificador-descricao-servicos.ts`) e
 * `GENERICOS_HIPOTESE` (`infrastructure/base/classificacao-repo.ts`).
 *
 * Sem este filtro, o boilerplate tributário ("fornecimento dos serviços…",
 * presente em milhares de descrições oficiais) empatava o score médio e
 * gerava bônus de alias espúrio. Palavras de diagnóstico ("nacional",
 * "simples", "exportacao", "diferimento", "isencao") ficam DE FORA de
 * propósito. Só a consulta filtra — documentos mantêm todos os tokens.
 */
const STOPWORDS_CONSULTA = new Set(
  ('o a os as um uma uns umas ao aos do da dos das no na nos nas ' +
    'pelo pela pelos pelas num numa dum duma deste desta desse dessa ' +
    'daquele daquela nele nela nisso disso em de por para com sem sob ' +
    'sobre entre ate apos como quando onde qual quais quanto quantos ' +
    'que se mais menos muito pouco algo coisa coisas este esta isto ' +
    'esse essa isso aquele aquela aquilo meu minha seu sua nosso nossa ' +
    'qualquer cada todo toda todos todas outro outra outros outras ' +
    'mesmo mesma proprio propria ser estar sao foi foram sido ter tem ' +
    'teve quer quero preciso precisa fazer achar procurar buscar saber ' +
    'dizer favor alguem ninguem produto produtos mercadoria mercadorias ' +
    'item itens codigo codigos ncm nbs cnae cst classificacao classificacoes ' +
    'enquadramento tributacao tributo tributos imposto impostos aliquota ' +
    'aliquotas lei leis complementar complementares art artigo artigos ' +
    'inciso incisos paragrafo paragrafos alinea anexos observado observada ' +
    'observados redacao lc servico servicos fornecimento fornecimentos ' +
    'prestacao prestacoes atividade atividades bem bens forma geral ' +
    'demais similar similares regime regimes beneficio beneficios reducao ' +
    'reducoes').split(' '),
)

/** Token da consulta é stopword (forma crua ou stemizada)? */
function ehStopword(t) {
  return STOPWORDS_CONSULTA.has(t) || STOPWORDS_CONSULTA.has(stem(t))
}

/** Tokens da CONSULTA: `tokenizar` menos stopwords (documentos intactos). */
function tokenizarConsulta(texto) {
  return tokenizar(texto).filter((t) => !ehStopword(t))
}

/** Peso do melhor casamento entre token da consulta e token do documento. */
function pesoCasamento(q, d, qs, ds) {
  if (!q || !d) return 0
  if (q === d) return 1
  const sq = qs !== undefined ? qs : stem(q)
  const sd = ds !== undefined ? ds : stem(d)
  if (sq === sd) return 0.9
  if (q.length >= 4 && d.length >= 4 && (d.includes(q) || q.includes(d))) return 0.7
  return 0
}

function sha256Hex(dados) {
  return crypto.createHash('sha256').update(dados).digest('hex')
}

// ---------------------------------------------------------------------------
// Embedding hash-fallback determinístico (384-d, L2-normalizado).
// Usado no BUILD (`gerar-embeddings.mjs`) p/ vetorizar documentos e no
// RUNTIME p/ vetorizar a consulta — mesma função, sem rede, sem dependência.
// Vetores `modo:'real'` exigem o modelo local; sem ele o estágio vetorial é
// pulado (fail-closed → `modoVetor:'fts-puro'`).
// ---------------------------------------------------------------------------

/**
 * Tokens expandidos p/ embedding: `[{ t, w }]` (original peso 1, ponte 0.5).
 * Mesma função no build e na consulta — single-source desta etapa.
 */
function tokensExpandidos(texto) {
  return expandirTokens(tokenizar(texto).map(stem).filter((t) => t.length >= 2))
}

/** Expande tokens JÁ stemizados (ponte semântica). */
function expandirTokens(stems) {
  const out = []
  for (const tok of stems || []) {
    const expandidos = expandirTokenVetor(tok)
    for (let i = 0; i < expandidos.length; i++) {
      out.push({ t: expandidos[i], w: i === 0 ? 1 : 0.5 })
    }
  }
  return out
}

/** Tokens expandidos da CONSULTA (stopwords fora — menos ruído de hash). */
function tokensExpandidosConsulta(texto) {
  return expandirTokens(tokenizarConsulta(texto).map(stem).filter((t) => t.length >= 2))
}

/**
 * IDF do corpus (`log((N-df+0.5)/(df+0.5))+1`, mesma forma do índice lexical):
 * `listas`: array de arrays de tokens (já expandidos). Raros pesam mais —
 * é o que separa "educação" (raro, diagnóstico) de colisão de hash.
 */
function calcularIdf(listas) {
  const N = Math.max(1, (listas || []).length)
  const df = new Map()
  for (const lista of listas || []) {
    const unicos = new Set((lista || []).map((x) => (typeof x === 'string' ? x : x && x.t)))
    for (const t of unicos) {
      if (t) df.set(t, (df.get(t) || 0) + 1)
    }
  }
  const idf = new Map()
  for (const [t, f] of df) {
    idf.set(t, Math.round((Math.log((N - f + 0.5) / (f + 0.5)) + 1) * 10000) / 10000)
  }
  return idf
}

/**
 * Vetoriza um texto: tokens expandidos ponderados por IDF (raro pesa mais) →
 * projeção hash esparsa (8 índices por token via sha256) → L2-normalizado
 * → arredondado a 4 casas. Determinístico entre builds e consultas.
 * `pesos`: Map(token→idf) do corpus (build); ausente → peso 1 (compat).
 */
function incorporarTextoVetor(texto, dim, pesos) {
  return incorporarListaVetor(tokensExpandidos(texto), dim, pesos)
}

/**
 * Núcleo da vetorização sobre lista JÁ expandida (`[{ t, w }]`).
 * A consulta usa `tokensExpandidosConsulta` (sem stopwords); documentos usam
 * `tokensExpandidos` (íntegra — o IDF do corpus já despondera o boilerplate).
 */
function incorporarListaVetor(expandida, dim, pesos) {
  const d = dim && Number.isFinite(Number(dim)) && Number(dim) > 0 ? Math.floor(Number(dim)) : EMBEDDING_DIM
  const vec = new Array(d).fill(0)
  const getPeso = (t) => {
    if (pesos && typeof pesos.get === 'function') {
      const v = pesos.get(t)
      if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v)
    } else if (pesos && typeof pesos === 'object' && Number.isFinite(Number(pesos[t])) && Number(pesos[t]) > 0) {
      return Number(pesos[t])
    }
    return 1
  }
  for (const { t, w } of expandida || []) {
    const peso = w * getPeso(t)
    const h = crypto.createHash('sha256').update(t).digest()
    for (let j = 0; j < 8; j++) {
      const idx = ((h[j * 2] << 8) | h[j * 2 + 1]) % d
      vec[idx] += peso * (1 + (h[(j * 3 + 1) % h.length] % 8) / 8)
    }
  }
  let norma = 0
  for (const v of vec) norma += v * v
  norma = Math.sqrt(norma)
  if (!(norma > 0)) return vec
  return vec.map((v) => Math.round((v / norma) * 10000) / 10000)
}

/** Cosine similarity entre dois vetores de mesma dimensão. */
function similaridadeCosseno(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0
  let s = 0
  // Hot path do rerank (12k docs × 384-d): sem coerção por elemento.
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return Math.round(s * 10000) / 10000
}

/** Cache do índice vetorial lateral (chave = caminho absoluto). */
let cacheVetores = null // { caminho, mtimeMs, tamanho, mapa, meta }

/** Limpa o cache vetorial (testes). */
function _limparCacheVetores() {
  cacheVetores = null
}

/**
 * Diretórios/arqs candidatos do índice vetorial, em ordem.
 * `ctx.dirEmbedding` / `AURUM_EMBEDDING_DIR` são EXCLUSIVOS (testes).
 * Procura `vetores.json` (cópia ao lado do grafo) e `vetores-ncm.json`.
 */
function arquivosVetoresCandidatos(ctx, dirGrafoEfetivo) {
  const c = (ctx && typeof ctx === 'object' ? ctx : {})
  const explicito = c.dirEmbedding || process.env.AURUM_EMBEDDING_DIR || ''
  const nomes = ['vetores.json', 'vetores-ncm.json']
  if (String(explicito).trim()) {
    const base = String(explicito)
    try {
      if (fs.existsSync(base) && fs.statSync(base).isFile()) return [base]
    } catch (_) { /* segue p/ join */ }
    return nomes.map((n) => path.join(base, n))
  }
  const lista = []
  if (dirGrafoEfetivo) {
    for (const n of nomes) lista.push(path.join(dirGrafoEfetivo, n))
  }
  const basesProjeto = []
  try {
    basesProjeto.push(process.cwd())
  } catch (_) { /* ignora */ }
  try {
    basesProjeto.push(path.resolve(__dirname, '..', '..'))
  } catch (_) { /* ignora */ }
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) basesProjeto.push(process.resourcesPath)
  } catch (_) { /* fora do Electron */ }
  try {
    if (caminhosIa && typeof caminhosIa.dirRecursosIa === 'function') {
      basesProjeto.push(path.dirname(caminhosIa.dirRecursosIa(c.app || null)))
    }
  } catch (_) { /* ignora */ }
  for (const b of [...new Set(basesProjeto)]) {
    lista.push(path.join(b, 'recursos-ia', 'embedding', 'vetores-ncm.json'))
  }
  return [...new Set(lista)]
}

/**
 * Carrega o índice vetorial lateral (`{ formato:'vetores-grafo-v1', ... }`).
 * Devolve `{ ok:true, mapa:Map(id→float[]), meta:{modo,modelo,dim,...} }`
 * ou `{ ok:false, motivo }`. NUNCA lança (ausente → estágio pulado).
 */
function carregarVetores(ctx, dirGrafoEfetivo) {
  try {
    for (const arq of arquivosVetoresCandidatos(ctx, dirGrafoEfetivo)) {
      let st = null
      try {
        if (!arq || !fs.existsSync(arq)) continue
        st = fs.statSync(arq)
        if (!st.isFile()) continue
      } catch (_) {
        continue
      }
      if (cacheVetores && cacheVetores.caminho === arq &&
          cacheVetores.mtimeMs === st.mtimeMs && cacheVetores.tamanho === st.size) {
        return { ok: true, ...cacheVetores }
      }
      let doc = null
      try {
        doc = JSON.parse(fs.readFileSync(arq, 'utf8'))
      } catch (_) {
        continue
      }
      if (!doc || doc.formato !== VETORES_FORMATO || !doc.vetores || typeof doc.vetores !== 'object') continue
      const dim = Number(doc.dim) === EMBEDDING_DIM ? EMBEDDING_DIM : Number(doc.dim)
      if (!Number.isFinite(dim) || dim <= 0 || dim > 2048) continue
      const mapa = new Map()
      for (const [id, v] of Object.entries(doc.vetores)) {
        if (typeof id !== 'string' || !Array.isArray(v) || v.length !== dim) continue
        // Float32Array: hot path do cosine (12k×384) sem coerção/GC por query.
        // Sem mapper por elemento (arquivo próprio, validado por formato+
        // CHECKSUMS; números finitos saídos do JSON).
        try {
          mapa.set(id, Float32Array.from(v))
        } catch (_) {
          continue
        }
      }
      if (!mapa.size) continue
      // IDF do corpus (pondera a consulta igual aos documentos do build).
      let idf = null
      try {
        if (doc.idf && typeof doc.idf === 'object' && !Array.isArray(doc.idf)) {
          idf = new Map()
          for (const [t, v] of Object.entries(doc.idf)) {
            if (typeof t === 'string' && Number.isFinite(Number(v)) && Number(v) > 0) idf.set(t, Number(v))
          }
          if (!idf.size) idf = null
        }
      } catch (_) {
        idf = null
      }
      cacheVetores = {
        caminho: arq, mtimeMs: st.mtimeMs, tamanho: st.size, mapa, idf,
        meta: {
          modo: doc.modo === 'real' ? 'real' : 'hash-fallback',
          modelo: typeof doc.modelo === 'string' ? doc.modelo : MODELO_EMBEDDING,
          dim, totalVetores: mapa.size, hashGrafo: doc.hashGrafo ?? null,
          comIdf: idf !== null,
        },
      }
      return { ok: true, ...cacheVetores }
    }
  } catch (_) { /* nunca lança */ }
  return { ok: false, motivo: 'índice vetorial ausente (modo FTS-puro)' }
}

function existeArquivo(p) {
  try {
    return !!p && fs.existsSync(p) && fs.statSync(p).isFile()
  } catch (_) {
    return false
  }
}

/**
 * Diretórios candidatos do grafo, em ordem. Retorna a lista para que o
 * chamador escolha o primeiro com `grafo.lbug` (ou `.lbug.json`).
 * `ctx.dirGrafo` / `AURUM_GRAFO_DIR` são EXCLUSIVOS (testes sem .lbug).
 */
function dirsCandidatos(ctx) {
  const c = (ctx && typeof ctx === 'object' ? ctx : {})
  const explicito = c.dirGrafo || process.env.AURUM_GRAFO_DIR || ''
  if (String(explicito).trim()) return [String(explicito)]
  const dirs = []
  try {
    if (c.app && typeof c.app.getPath === 'function') {
      dirs.push(path.join(c.app.getPath('userData'), 'grafo'))
    }
  } catch (_) { /* sem app (testes) — segue */ }
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      dirs.push(path.join(process.resourcesPath, 'recursos-ia', 'grafo'))
    }
  } catch (_) { /* fora do Electron */ }
  try {
    if (caminhosIa && typeof caminhosIa.dirRecursosIa === 'function') {
      dirs.push(path.join(caminhosIa.dirRecursosIa(c.app || null), 'grafo'))
    }
  } catch (_) { /* fallback abaixo */ }
  try {
    if (caminhosIa && typeof caminhosIa.raizProjetoDev === 'function') {
      dirs.push(path.join(caminhosIa.raizProjetoDev(), 'public', 'base', 'grafo'))
    } else {
      dirs.push(path.resolve(__dirname, '..', '..', 'public', 'base', 'grafo'))
    }
  } catch (_) { /* ignora */ }
  try {
    dirs.push(path.join(process.cwd(), 'public', 'base', 'grafo'))
  } catch (_) { /* ignora */ }
  return [...new Set(dirs)]
}

/**
 * Localiza o arquivo do grafo (`grafo.lbug` primeiro, espelho
 * `grafo.lbug.json` como alternativa). Nunca lança; devolve `null`.
 */
function resolverArquivoGrafo(ctx) {
  try {
    for (const dir of dirsCandidatos(ctx)) {
      const lbug = path.join(dir, 'grafo.lbug')
      if (existeArquivo(lbug)) return { caminho: lbug, origem: 'lbug' }
      const espelho = path.join(dir, 'grafo.lbug.json')
      if (existeArquivo(espelho)) return { caminho: espelho, origem: 'json' }
    }
  } catch (_) { /* nunca lança */ }
  return null
}

/**
 * Tenta o nativo `@ladybugdb/core` (preguiçoso, try/catch). Devolve o módulo
 * ou `null` — NUNCA lança, NUNCA quebra o boot sem o pacote.
 */
function tentarLadybug() {
  try {
    return require('@ladybugdb/core')
  } catch (_) {
    return null
  }
}

/**
 * Lê o payload `{ nodos, arestas }` de um arquivo do grafo.
 *   - JSON parseável (inclui o `.lbug` portátil do build sem nativo) →
 *     `{ payload, modo:'json-fallback' }`;
 *   - binário + `@ladybugdb/core` presente → best-effort de extração para
 *     memória → `{ payload, modo:'lbug' }`;
 *   - senão lança (o chamador converte em fallback lexical).
 */
async function lerPayload(caminho) {
  const bytes = fs.readFileSync(caminho)
  const texto = bytes.toString('utf8')
  let parsed = null
  try {
    // Guarda anti-binário: JSON do grafo sempre começa com `{`.
    if (texto.trimStart().startsWith('{')) parsed = JSON.parse(texto)
  } catch (_) {
    parsed = null
  }
  if (parsed && Array.isArray(parsed.nodos) && Array.isArray(parsed.arestas)) {
    return { payload: parsed, modo: 'json-fallback' }
  }
  // Não-JSON: só o nativo sabe abrir. Best-effort com a mesma adivinhação de
  // API do `scripts/build-grafo.mjs` (Database/connect/execute|query).
  const mod = tentarLadybug()
  if (!mod) throw new Error('grafo binário sem @ladybugdb/core (rode npm run base)')
  const Database = mod.Database ?? mod.default?.Database ?? mod.default
  if (typeof Database !== 'function') throw new Error('API nativa sem Database')
  const db = new Database(caminho)
  try {
    let conn = null
    if (typeof db.connect === 'function') conn = await db.connect()
    else if (typeof db.query === 'function') conn = db
    if (!conn) throw new Error('sem Connection nativa')
    const executar = async (cypher) => {
      if (typeof conn.execute === 'function') return conn.execute(cypher)
      if (typeof conn.query === 'function') return conn.query(cypher)
      throw new Error('Connection sem execute/query')
    }
    const nodos = await extrairTabela(executar, 'nodos')
    const arestas = await extrairTabela(executar, 'arestas')
    return { payload: { nodos, arestas }, modo: 'lbug' }
  } finally {
    try {
      if (typeof db.close === 'function') await db.close()
    } catch (_) { /* best-effort */ }
  }
}

/** Extrai linhas de uma tabela nativa para o shape do JSON portátil. */
async function extrairTabela(executar, tabela) {
  const res = await executar(`MATCH (n:${tabela}) RETURN n LIMIT 100000`)
  const linhas = Array.isArray(res) ? res : (res && res.rows) || (res && res.records) || []
  return linhas.map((l) => (l && l.n !== undefined ? l.n : l)).filter((x) => x && typeof x === 'object')
}

/** Constrói os índices Map sobre o payload (uma vez por arquivo). */
function construirIndices(nodos, arestas) {
  const porId = new Map()
  for (const n of nodos || []) {
    if (n && typeof n.id === 'string' && !porId.has(n.id)) porId.set(n.id, n)
  }
  const adjSaida = new Map() // de -> aresta[] (ordem estável do payload)
  const aliasTermo = new Map() // para -> Set(termo normalizado)
  for (const a of arestas || []) {
    if (!a || typeof a.de !== 'string' || typeof a.para !== 'string') continue
    if (!adjSaida.has(a.de)) adjSaida.set(a.de, [])
    adjSaida.get(a.de).push(a)
    if ((a.tipo === 'SINONIMO_DE' || a.tipo === 'SINONIMO_NBS') && typeof a.de === 'string' &&
      a.de.startsWith('Termo:')) {
      const termo = normalizar(a.de.slice('Termo:'.length))
      if (termo) {
        if (!aliasTermo.has(a.para)) aliasTermo.set(a.para, new Set())
        aliasTermo.get(a.para).add(termo)
      }
    }
  }
  // Tokens por documento candidato (descrição + código + aliases de Termo).
  const docTokens = new Map()
  for (const [id, n] of porId) {
    if (!TIPOS_CANDIDATOS.has(n.tipo)) continue
    const toks = new Set(tokenizar(n.props?.descricao || ''))
    const codigo = String(n.props?.codigo || '').replace(/\D+/g, '')
    if (codigo.length >= 2) toks.add(codigo)
    const aliases = aliasTermo.get(id)
    if (aliases) for (const t of aliases) for (const w of tokenizar(t)) toks.add(w)
    docTokens.set(id, [...toks])
  }
  // Stems alinhados por índice (hot path do FTS: `stem` 1× no load, nunca
  // por comparação — valores bit-idênticos ao cálculo sob demanda).
  const docStems = new Map()
  for (const [id, toks] of docTokens) docStems.set(id, toks.map(stem))
  // IDF do FTS (Phase 10-04): token raro (diagnóstico) pesa mais que
  // boilerplate ("servico", "carne", "de" — este último já filtrado na
  // consulta). Mesma forma do índice lexical; piso 0.05 p/ preservar
  // `fts>0 ⟺ match>0` (nenhum teste assera valor absoluto de score FTS).
  const dfFts = new Map()
  for (const toks of docTokens.values()) {
    const unicos = new Set()
    for (const t of toks) unicos.add(stem(t))
    for (const t of unicos) dfFts.set(t, (dfFts.get(t) || 0) + 1)
  }
  const nFts = Math.max(1, docTokens.size)
  const idfFts = new Map()
  for (const [t, f] of dfFts) {
    idfFts.set(t, Math.max(0.05, Math.log((nFts - f + 0.5) / (f + 0.5)) + 1))
  }
  const idfFtsMax = Math.max(0.05, Math.log((nFts - 0 + 0.5) / (0 + 0.5)) + 1)
  // Índice invertido p/ o pré-filtro vetorial (10-03): token expandido
  // (stem + ponte) → ids ordenados. O estágio HNSW só calcula cosine nos
  // docs que compartilham ≥1 token com a consulta — sem overlap, o cosine
  // hash seria puro ruído de colisão. Construído 1× no load (rápido).
  const indiceVetorFiltro = new Map() // token -> string[] (ordenado)
  for (const [id, toks] of docTokens) {
    const exp = new Set()
    for (const t of toks) {
      const s = stem(t)
      exp.add(s)
      for (const e of expandirTokenVetor(s)) exp.add(e)
    }
    for (const t of exp) {
      if (!indiceVetorFiltro.has(t)) indiceVetorFiltro.set(t, [])
      indiceVetorFiltro.get(t).push(id)
    }
  }
  for (const lista of indiceVetorFiltro.values()) lista.sort()
  // Texto do documento p/ embedding (build usa a mesma regra via
  // `textoDocumentoVetor`): descrição + código + aliases de Termo.
  const docTextos = new Map()
  for (const [id, n] of porId) {
    if (!TIPOS_CANDIDATOS.has(n.tipo)) continue
    const partes = [String(n.props?.descricao || ''), String(n.props?.codigo || '')]
    const aliases = aliasTermo.get(id)
    if (aliases) for (const t of aliases) partes.push(t)
    docTextos.set(id, partes.join(' ').trim())
  }
  // Grau de entrada por nó (PageRank simplificado: autoridade por citação).
  const grauEntrada = new Map()
  for (const a of arestas || []) {
    if (!a || typeof a.para !== 'string') continue
    grauEntrada.set(a.para, (grauEntrada.get(a.para) || 0) + 1)
  }
  let grauMax = 0
  for (const v of grauEntrada.values()) if (v > grauMax) grauMax = v
  // Termo exato: token normalizado -> para[] (bônus de alias).
  const termoPara = new Map()
  for (const [para, termos] of aliasTermo) {
    for (const t of termos) {
      for (const w of tokenizar(t)) {
        if (!termoPara.has(w)) termoPara.set(w, new Set())
        termoPara.get(w).add(para)
      }
    }
  }
  return { porId, adjSaida, aliasTermo, docTokens, docStems, idfFts, idfFtsMax, docTextos, termoPara, grauEntrada, grauMax, indiceVetorFiltro }
}

/** Primeira aresta de saída de `de` com um dos tipos, ou null. */
function primeiraAresta(adjSaida, de, tipos) {
  const lista = adjSaida.get(de)
  if (!lista) return null
  for (const a of lista) {
    if (tipos.includes(a.tipo)) return a
  }
  return null
}

/**
 * Expansão 2-hops a partir de um nó semente. Devolve o caminho como lista de
 * ids: `NCM→CCT→Anexo(→Artigo)`, `CNAE→NBS→CCT(→Anexo)`,
 * `NBS→CCT→Anexo(→Artigo)`. Determinística (primeira aresta por tipo).
 */
function expandirCaminho(no, indices) {
  const { porId, adjSaida } = indices
  const caminho = [no.id]
  if (no.tipo === 'NCM') {
    const e1 = primeiraAresta(adjSaida, no.id, ['TEM_CLASSIFICACAO'])
    if (!e1 || !porId.has(e1.para)) return caminho
    caminho.push(e1.para)
    const e2 = primeiraAresta(adjSaida, e1.para, ['REDUZ_PARA'])
    if (!e2 || !porId.has(e2.para)) return caminho
    caminho.push(e2.para)
    const e3 = primeiraAresta(adjSaida, e2.para, ['FUNDAMENTA_EM'])
    if (e3 && porId.has(e3.para)) caminho.push(e3.para)
    return caminho
  }
  if (no.tipo === 'CNAE') {
    const e1 = primeiraAresta(adjSaida, no.id, ['MAPEIA'])
    if (!e1 || !porId.has(e1.para)) return caminho
    caminho.push(e1.para)
    const e2 = primeiraAresta(adjSaida, e1.para, ['TEM_CLASSIFICACAO_NBS'])
    if (!e2 || !porId.has(e2.para)) return caminho
    caminho.push(e2.para)
    const e3 = primeiraAresta(adjSaida, e2.para, ['REDUZ_PARA'])
    if (e3 && porId.has(e3.para)) caminho.push(e3.para)
    return caminho
  }
  if (no.tipo === 'NBS') {
    const e1 = primeiraAresta(adjSaida, no.id, ['TEM_CLASSIFICACAO_NBS'])
    if (!e1 || !porId.has(e1.para)) return caminho
    caminho.push(e1.para)
    const e2 = primeiraAresta(adjSaida, e1.para, ['REDUZ_PARA'])
    if (!e2 || !porId.has(e2.para)) return caminho
    caminho.push(e2.para)
    const e3 = primeiraAresta(adjSaida, e2.para, ['FUNDAMENTA_EM'])
    if (e3 && porId.has(e3.para)) caminho.push(e3.para)
    return caminho
  }
  return caminho
}

/**
 * Proveniência por aresta do caminho (Phase 10-05 / GRAFO-05).
 * Para cada passo `caminho[i] → caminho[i+1]`, localiza a aresta efetiva
 * (a mesma `primeiraAresta` usada na expansão) e devolve
 * `{ de, para, tipo, origem, confianca, anoReferencia }`.
 * Sem proveniência = sem citação de caminho (fail-closed: retorna []).
 * NUNCA lança.
 */
function provenienciaDoCaminho(caminho, adjSaida) {
  try {
    if (!Array.isArray(caminho) || caminho.length < 2) return []
    const out = []
    for (let i = 0; i < caminho.length - 1; i++) {
      const de = String(caminho[i])
      const para = String(caminho[i + 1])
      const lista = adjSaida ? adjSaida.get(de) : null
      if (!lista) return []
      const aresta = lista.find((a) => String(a.para) === para) || null
      if (!aresta) return []
      const origem = String(aresta.origem || '')
      const confianca = Number(aresta.confianca)
      if (!origem || !Number.isFinite(confianca)) return []
      out.push({
        de,
        para,
        tipo: String(aresta.tipo || ''),
        origem,
        confianca,
        anoReferencia: aresta.anoReferencia !== undefined && aresta.anoReferencia !== null
          ? aresta.anoReferencia
          : null,
      })
    }
    return out
  } catch (_) {
    return []
  }
}

/**
 * Abre (ou reaproveita do cache) o grafo para `ctx` (`{ app?, dirGrafo? }`).
 * Devolve `{ ok:true, caminho, modo, nodos, arestas, indices, ... }` ou
 * `{ ok:false, fallback:'lexical', motivo }`. NUNCA lança.
 */
async function abrirGrafo(ctx) {
  try {
    const achado = resolverArquivoGrafo(ctx)
    if (!achado) return { ok: false, fallback: 'lexical', motivo: 'grafo.lbug ausente' }
    let st = null
    try {
      st = fs.statSync(achado.caminho)
    } catch (_) {
      return { ok: false, fallback: 'lexical', motivo: 'grafo ilegível' }
    }
    if (cacheGrafo && cacheGrafo.caminho === achado.caminho &&
        cacheGrafo.mtimeMs === st.mtimeMs && cacheGrafo.tamanho === st.size) {
      return { ok: true, ...cacheGrafo }
    }
    const { payload, modo } = await lerPayload(achado.caminho)
    if (payload.versao && payload.versao !== GRAFO_VERSAO) {
      return { ok: false, fallback: 'lexical', motivo: `versão ${payload.versao} ≠ ${GRAFO_VERSAO}` }
    }
    const nodos = Array.isArray(payload.nodos) ? payload.nodos : []
    const arestas = Array.isArray(payload.arestas) ? payload.arestas : []
    const indices = construirIndices(nodos, arestas)
    cacheGrafo = {
      caminho: achado.caminho, mtimeMs: st.mtimeMs, tamanho: st.size,
      modo, nodos, arestas, indices,
      hash: payload && typeof payload.hash === 'string' ? payload.hash : null,
      totalNodos: indices.porId.size, totalArestas: arestas.length,
    }
    // Overlay nasce junto (best-effort, nunca quebra a abertura).
    try {
      abrirOverlay(dirUsuario(ctx))
    } catch (_) { /* overlay nunca quebra o grafo */ }
    return { ok: true, ...cacheGrafo }
  } catch (e) {
    return { ok: false, fallback: 'lexical', motivo: String((e && e.message) || e).slice(0, 160) }
  }
}

/**
 * Texto do documento p/ embedding (MESMA regra do build: descrição + código +
 * aliases de Termo). `indices` é o retorno de `construirIndices`.
 */
function textoDocumentoVetor(id, indices) {
  if (indices && indices.docTextos && indices.docTextos.has(id)) return indices.docTextos.get(id)
  const no = indices && indices.porId ? indices.porId.get(id) : null
  if (!no) return ''
  return `${no.props?.descricao || ''} ${no.props?.codigo || ''}`.trim()
}

/**
 * Comunidade Louvain-lite de um nó (scoping por capítulo/grupo):
 * NCM→capítulo (2 dígitos), NBS→grupo (3 dígitos), CNAE→divisão (2 dígitos).
 */
function comunidadeDoNo(no) {
  if (!no || typeof no !== 'object') return 'outros'
  const cod = String(no.props?.codigo || '')
  if (no.tipo === 'NCM') return `CAP:${no.props?.capitulo || cod.slice(0, 2)}`
  if (no.tipo === 'NBS') return `NBS:${cod.slice(0, 3)}`
  if (no.tipo === 'CNAE') return `CNAE:${cod.slice(0, 2)}`
  return `outros:${no.tipo || '?'}`
}

/**
 * Boost de uso local (GRAFO-08, parte scoring — Phase 10-03).
 *
 * Soma os `peso` das arestas do overlay que tocam `candidatoId` quando:
 *   - `tipo ∈ {Termo-PREFERIDO, NCM-ESCOLHIDO, CNAE-CARTEIRA}` ou
 *     `origem === 'uso_local'`; e
 *   - dentro do TTL (90d por `criadoEm`; sem `criadoEm` conta como vigente
 *     para compat com escritores simples); e
 *   - sem demote (código em `feedbackNegativo` ou aresta marcada
 *     `feedback:'negativo'`/`rejeitado:true` → boost zerado).
 *
 * Devolve `{ boost, bruto, tocadas, expiradas, demote }` com
 * `boost = min(bruto, 0.3)`. NUNCA lança.
 */
function calcularBoost(overlayDoc, candidatoId, opcoes) {
  const zerado = { boost: 0, bruto: 0, tocadas: 0, expiradas: 0, demote: false }
  try {
    const o = (opcoes && typeof opcoes === 'object' ? opcoes : {})
    const codigo = String(candidatoId || '').includes(':')
      ? String(candidatoId).split(':').slice(1).join(':')
      : String(candidatoId || '')
    const negativos = new Set(
      (Array.isArray(o.feedbackNegativo) ? o.feedbackNegativo : []).map((c) => String(c).replace(/\D+/g, '')),
    )
    if (negativos.has(codigo.replace(/\D+/g, ''))) return { ...zerado, demote: true }
    const doc = overlayDoc && typeof overlayDoc === 'object' ? overlayDoc : null
    const arestas = doc && Array.isArray(doc.arestas) ? doc.arestas : []
    if (!arestas.length) return { ...zerado }
    const agora = Number.isFinite(Number(o.agora)) ? Number(o.agora) : Date.now()
    const ttlMs = TTL_USO_DIAS * 24 * 60 * 60 * 1000
    let bruto = 0
    let tocadas = 0
    let expiradas = 0
    for (const a of arestas) {
      if (!a || typeof a !== 'object') continue
      const ehUso = TIPOS_USO_LOCAL.includes(a.tipo) || a.origem === 'uso_local'
      if (!ehUso) continue
      if (String(a.de) !== String(candidatoId) && String(a.para) !== String(candidatoId)) continue
      if (a.feedback === 'negativo' || a.rejeitado === true) return { ...zerado, tocadas: tocadas + 1, demote: true }
      if (a.criadoEm !== undefined && a.criadoEm !== null) {
        const t = new Date(a.criadoEm).getTime()
        if (Number.isFinite(t) && agora - t > ttlMs) {
          expiradas++
          continue
        }
      }
      const peso = Number.isFinite(Number(a.peso)) ? Number(a.peso) : PESO_USO_PADRAO
      if (peso <= 0) continue
      bruto += peso
      tocadas++
    }
    if (!tocadas) return { ...zerado, expiradas }
    const boost = Math.min(bruto, TETO_BOOST)
    return { boost: Math.round(boost * 10000) / 10000, bruto: Math.round(bruto * 10000) / 10000, tocadas, expiradas, demote: false }
  } catch (_) {
    return zerado
  }
}

/** Cypher auditável determinístico dos seeds (vai para `via:grafo`). */
function montarCypher(texto, k, anoReferencia, modo, codigos, modoVetor) {
  const lista = codigos.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(', ')
  const ano = anoReferencia !== null && anoReferencia !== undefined && Number.isFinite(Number(anoReferencia))
    ? ` AND all(r IN relationships(p) WHERE r.anoReferencia IS NULL OR r.anoReferencia = ${Number(anoReferencia)})`
    : ''
  const vetor = modoVetor ? `, vetor=${modoVetor}` : ''
  return (
    `// grafoConsultar(texto="${String(texto ?? '').slice(0, 80).replace(/"/g, "'")}", k=${k}, modo=${modo}${vetor}) | ` +
    `MATCH p = (n)-[:TEM_CLASSIFICACAO|MAPEIA|TEM_CLASSIFICACAO_NBS]->(c)-[:REDUZ_PARA]->(a:Anexo) ` +
    `WHERE n.codigo IN [${lista}]${ano} ` +
    `RETURN n.codigo AS codigo, [x IN nodes(p) | x.id] AS caminho`
  )
}

/**
 * Consulta o grafo em 4 estágios (Phase 10-03):
 *   (a) FTS seeds, (b) HNSW/vetor seeds (cosine; pulado sem índice →
 *   `modoVetor:'fts-puro'`), (c) expansão 2-hops, (d) rerank PageRank
 *   simplificado + Louvain-lite + boost de uso (teto 0.3).
 * `args`: `{ texto, k=5, anoReferencia, modoVetorForcado?:'fts-puro' }`;
 * `ctx`: `{ app?, dirGrafo?, dirEmbedding?, userDataDir?, overlay?, feedbackNegativo? }`.
 * Sem arquivo → `{ ok:false, fallback:'lexical' }`. NUNCA lança.
 *
 * `score` (ranking interno — NUNCA confiança fiscal) =
 * `scoreBase + min(boost_uso, 0.3)`; `scores:{fts,vetor,pagerank}` por
 * candidato serve ao debug (DebugIA).
 */
async function grafoConsultar(args, ctx) {
  const t0 = Number(process.hrtime.bigint() / 1000000n)
  try {
    const texto = String((args && (args.texto ?? args.consulta)) ?? '')
    const k = Math.max(1, Math.min(30, Number(args && args.k) > 0 ? Number(args.k) : 5))
    const anoRaw = args && args.anoReferencia !== undefined && args.anoReferencia !== null
      ? Number(args.anoReferencia)
      : null
    const anoReferencia = Number.isFinite(anoRaw) ? anoRaw : null
    const forcarFtsPuro = args && args.modoVetorForcado === 'fts-puro'
    const g = await abrirGrafo(ctx)
    if (!g.ok) return { ok: false, fallback: 'lexical', motivo: g.motivo }
    const qTokens = tokenizarConsulta(texto)
    if (!qTokens.length) {
      return {
        ok: true, candidatos: [], caminhos: [],
        cypher: montarCypher(texto, k, anoReferencia, g.modo, [], 'fts-puro'),
        tempoMs: Number(process.hrtime.bigint() / 1000000n) - t0, modo: g.modo,
        modoVetor: 'fts-puro', embedding: null, avisoVetor: null,
      }
    }
    const { porId, docTokens, docStems, idfFts, idfFtsMax, termoPara, grauEntrada, grauMax } = g.indices

    // ---- (a) FTS seeds (regra 10-02 preservada + 10-04: stopwords + IDF) ----
    const bonus = new Map()
    for (const q of qTokens) {
      // Stopwords curtas (de/da/do/…) aparecem na tokenização de Termos
      // multi-palavra e gerariam bônus espúrio p/ milhares de nós.
      if (q.length < 3) continue
      const ligados = termoPara.get(q) || termoPara.get(stem(q))
      if (!ligados) continue
      for (const id of ligados) bonus.set(id, (bonus.get(id) || 0) + BONUS_TERMO)
    }
    // Peso IDF por token da consulta (raro = diagnóstico); desconhecido
    // (typo) ganha o teto — é o que salva "parmezao" via substring.
    const qInfo = qTokens.map((t) => {
      const s = stem(t)
      const w = idfFts && idfFts.has(s) ? idfFts.get(s) : (idfFtsMax || 1)
      return { t, s, w }
    })
    let somaW = 0
    for (const q of qInfo) somaW += q.w
    if (!(somaW > 0)) somaW = Math.max(1, qInfo.length)
    const ftsMap = new Map() // id -> score FTS bruto
    for (const [id, toks] of docTokens) {
      const stems = (docStems && docStems.get(id)) || []
      let s = 0
      for (const q of qInfo) {
        let melhor = 0
        for (let i = 0; i < toks.length; i++) {
          const p = pesoCasamento(q.t, toks[i], q.s, stems[i])
          if (p > melhor) {
            melhor = p
            if (p >= 1) break
          }
        }
        s += q.w * melhor
      }
      const total = s / somaW + (bonus.get(id) || 0)
      if (total > 0) ftsMap.set(id, Math.round(total * 10000) / 10000)
    }

    // ---- (b) HNSW/vetor seeds (cosine; fail-closed sem índice) ----
    let modoVetor = 'fts-puro'
    let metaVetor = null
    let avisoVetor = null
    const vetorMap = new Map() // id -> cosine
    if (!forcarFtsPuro) {
      const dirGrafoEfetivo = g.caminho ? path.dirname(g.caminho) : null
      const vv = carregarVetores(ctx, dirGrafoEfetivo)
      let vetoresOk = !!(vv.ok && vv.meta && vv.meta.dim === EMBEDDING_DIM)
      // Guarda anti-dessincronia (Phase 10-04): vetores gerados contra OUTRO
      // grafo (aliases novos fora do cosine) são ignorados com honestidade —
      // `modoVetor:'fts-puro'` + `avisoVetor`, nunca score corrompido. Só
      // dispara com os dois hashes presentes e divergentes (compat: índices
      // antigos sem `hashGrafo` e minigrafos de teste seguem valendo).
      if (vetoresOk && vv.meta.hashGrafo && g.hash && vv.meta.hashGrafo !== g.hash) {
        vetoresOk = false
        avisoVetor = 'indice-desatualizado'
      }
      if (vetoresOk) {
        const usarHash = vv.meta.modo !== 'real'
        // Vetores reais sem o modelo local NÃO podem ser consultados com
        // hash (espaços distintos) — estágio pulado, FTS-puro honesto.
        if (usarHash) {
          const qVec = Float32Array.from(incorporarListaVetor(tokensExpandidosConsulta(texto), EMBEDDING_DIM, vv.idf || null))
          // Pré-filtro por overlap (só docs que compartilham token expandido;
          // sem isso o cosine hash seria ruído de colisão — e o scan cai de
          // 12k p/ centenas). Vetores `real` (densos) NÃO pré-filtram.
          const filtro = g.indices.indiceVetorFiltro
          const alvos = new Set()
          if (filtro && typeof filtro.get === 'function') {
            for (const { t } of tokensExpandidosConsulta(texto)) {
              const lista = filtro.get(t)
              if (lista) for (const id of lista) alvos.add(id)
            }
          }
          const escopo = alvos.size ? alvos : vv.mapa.keys()
          for (const id of escopo) {
            const docVec = vv.mapa.get(id)
            if (!docVec || !porId.has(id)) continue
            const cos = similaridadeCosseno(qVec, docVec)
            if (cos > 0) vetorMap.set(id, cos)
          }
          modoVetor = 'hnsw'
          metaVetor = vv.meta
        }
      }
    }

    // ---- pool + normalização ----
    let maxFts = 0
    for (const v of ftsMap.values()) if (v > maxFts) maxFts = v
    let maxVet = 0
    for (const v of vetorMap.values()) if (v > maxVet) maxVet = v
    const pool = new Set([...ftsMap.keys(), ...vetorMap.keys()])
    const base = []
    for (const id of pool) {
      const nFts = maxFts > 0 ? (ftsMap.get(id) || 0) / maxFts : 0
      const nVet = maxVet > 0 ? (vetorMap.get(id) || 0) / maxVet : 0
      const blend = modoVetor === 'hnsw' ? PESO_FTS * nFts + PESO_VETOR * nVet : nFts
      base.push({ id, nFts, nVet, blend })
    }
    base.sort((a, b) => b.blend - a.blend || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const poolTop = base.slice(0, Math.max(k * 3, k))

    // ---- comunidade dominante (Louvain-lite: scoping por capítulo) ----
    const votosComunidade = new Map()
    for (const p of poolTop.slice(0, k)) {
      const no = porId.get(p.id)
      if (!no) continue
      const com = comunidadeDoNo(no)
      votosComunidade.set(com, (votosComunidade.get(com) || 0) + 1)
    }
    let comunidadeDominante = null
    let votosMax = 0
    for (const [com, v] of votosComunidade) {
      if (v > votosMax || (v === votosMax && (comunidadeDominante === null || com < comunidadeDominante))) {
        votosMax = v
        comunidadeDominante = com
      }
    }

    // ---- overlay de uso local (GRAFO-08; best-effort, nunca quebra) ----
    let overlayDoc = null
    try {
      const c = (ctx && typeof ctx === 'object' ? ctx : {})
      if (c.overlay && typeof c.overlay === 'object') overlayDoc = c.overlay
      else overlayDoc = abrirOverlay(dirUsuario(ctx)).doc || null
    } catch (_) {
      overlayDoc = null
    }
    const feedbackNegativo = ctx && Array.isArray(ctx.feedbackNegativo) ? ctx.feedbackNegativo : []

    // ---- (c) expansão + (d) rerank ----
    const candidatos = []
    const caminhos = []
    const vistos = new Set()
    for (const p of poolTop) {
      const no = porId.get(p.id)
      if (!no) continue
      const caminho = expandirCaminho(no, g.indices)
      const proveniencia = provenienciaDoCaminho(caminho, g.indices.adjSaida)
      const codigo = String(no.props?.codigo ?? p.id.split(':')[1] ?? p.id)
      const grauNorm = grauMax > 0 ? (grauEntrada.get(p.id) || 0) / grauMax : 0
      const temAnexo = caminho.some((x) => String(x).startsWith('Anexo:')) ? 1 : 0
      const mesmaComunidade = comunidadeDominante !== null && comunidadeDoNo(no) === comunidadeDominante ? 1 : 0
      const pagerank = Math.round((PESO_GRAU * grauNorm + BONUS_ANEXO * temAnexo + BONUS_COMUNIDADE * mesmaComunidade) * 10000) / 10000
      const scoreBase = Math.round((p.blend + pagerank) * 10000) / 10000
      const b = calcularBoost(overlayDoc, p.id, { feedbackNegativo })
      const scoreFinal = Math.round((scoreBase + b.boost) * 10000) / 10000
      candidatos.push({
        codigo,
        tipo: no.tipo,
        descricao: String(no.props?.descricao || ''),
        score: scoreFinal,
        scoreBase,
        caminho,
        ...(proveniencia.length ? { proveniencia } : {}),
        comunidade: comunidadeDoNo(no),
        scores: {
          fts: ftsMap.get(p.id) || 0,
          vetor: vetorMap.get(p.id) || 0,
          pagerank,
        },
        boost: b.boost > 0 ? 'uso_local' : null,
        boostValor: b.boost,
      })
      const chave = caminho.join('>')
      if (!vistos.has(chave)) {
        vistos.add(chave)
        caminhos.push(caminho)
      }
    }
    candidatos.sort((a, b) => b.score - a.score || (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
    const top = candidatos.slice(0, k)
    const caminhosTop = []
    const vistosTop = new Set()
    for (const c of top) {
      const chave = c.caminho.join('>')
      if (!vistosTop.has(chave)) {
        vistosTop.add(chave)
        caminhosTop.push(c.caminho)
      }
    }
    return {
      ok: true,
      candidatos: top,
      caminhos: caminhosTop,
      cypher: montarCypher(texto, k, anoReferencia, g.modo, top.map((c) => c.codigo), modoVetor),
      tempoMs: Number(process.hrtime.bigint() / 1000000n) - t0,
      modo: g.modo,
      modoVetor,
      embedding: metaVetor,
      avisoVetor,
    }
  } catch (e) {
    return { ok: false, fallback: 'lexical', motivo: String((e && e.message) || e).slice(0, 160) }
  }
}

// ---------------------------------------------------------------------------
// Overlay de aprendizado local (GRAFO-08 — nesta plan: abre/cria + verifica)
// ---------------------------------------------------------------------------

/** Diretório gravável do grafo (`userData/grafo`); `null` sem app/override. */
function dirUsuario(ctx) {
  try {
    const c = (ctx && typeof ctx === 'object' ? ctx : {})
    if (c.userDataDir && String(c.userDataDir).trim()) return String(c.userDataDir)
    const env = process.env.AURUM_GRAFO_USERDATA || ''
    if (env.trim()) return env.trim()
    if (c.app && typeof c.app.getPath === 'function') {
      return path.join(c.app.getPath('userData'), 'grafo')
    }
  } catch (_) { /* sem diretório */ }
  return null
}

function checksumOverlay(doc) {
  return sha256Hex(JSON.stringify({ versao: doc.versao, arestas: doc.arestas }))
}

function overlayVazio() {
  const doc = { versao: OVERLAY_VERSAO, arestas: [] }
  doc.checksum = checksumOverlay(doc)
  return doc
}

/**
 * Abre ou cria o overlay de aprendizado em `dir` (ou no `userData/grafo` de
 * `ctx`). Nasce `{ versao:1, arestas:[] }` vazio com checksum; corrompido →
 * backup `aprendizado.corrompido-<ts>.json` + recria vazio (base intacta).
 * Sem diretório resolvível → `{ ok:false, desabilitado:true }` (grafo segue).
 * NUNCA lança.
 */
function abrirOverlay(dirOuCtx) {
  try {
    const dir = typeof dirOuCtx === 'string'
      ? dirOuCtx
      : dirUsuario(dirOuCtx)
    if (!dir) return { ok: false, desabilitado: true, doc: overlayVazio() }
    fs.mkdirSync(dir, { recursive: true })
    const arq = path.join(dir, 'aprendizado.json')
    if (!fs.existsSync(arq)) {
      const doc = overlayVazio()
      fs.writeFileSync(arq, JSON.stringify(doc), 'utf8')
      return { ok: true, caminho: arq, novo: true, doc }
    }
    try {
      const doc = JSON.parse(fs.readFileSync(arq, 'utf8'))
      const valido = doc && doc.versao === OVERLAY_VERSAO && Array.isArray(doc.arestas) &&
        typeof doc.checksum === 'string' && doc.checksum === checksumOverlay(doc)
      if (valido) return { ok: true, caminho: arq, novo: false, doc }
      throw new Error(`checksum inválido (versao=${doc && doc.versao})`)
    } catch (e) {
      const backup = path.join(dir, `aprendizado.corrompido-${Date.now()}.json`)
      try {
        fs.copyFileSync(arq, backup)
      } catch (_) { /* backup best-effort */ }
      const doc = overlayVazio()
      fs.writeFileSync(arq, JSON.stringify(doc), 'utf8')
      return { ok: true, caminho: arq, novo: true, recuperado: true, backup, doc, motivo: String((e && e.message) || e).slice(0, 120) }
    }
  } catch (e) {
    return { ok: false, desabilitado: true, doc: overlayVazio(), motivo: String((e && e.message) || e).slice(0, 120) }
  }
}

// ---------------------------------------------------------------------------
// Escritores do overlay (GRAFO-08, Phase 10-05): registrarUso + poda + job.
// ---------------------------------------------------------------------------

/** Teto de arestas do overlay (só-na-máquina, sem rebuild diário). */
const MAX_OVERLAY_ARESTAS = 5000

/** Normaliza id de código para o overlay (`NCM:xxxxxxxx`, `NBS:…`, `CNAE:…`). */
function idCodigoOverlay(codigo) {
  const dig = String(codigo ?? '').replace(/\D+/g, '')
  if (dig.length === 8) return `NCM:${dig}`
  if (dig.length === 9) return `NBS:${dig}`
  if (dig.length === 7) return `CNAE:${dig}`
  if (dig) return `Codigo:${dig}`
  return null
}

/**
 * Poda determinística do overlay (TTL 90d + teto de tamanho).
 * - remove arestas expiradas (`criadoEm` > 90d; sem `criadoEm` = vigente);
 * - se ainda > 5000, mantém as 5000 mais recentes (por `criadoEm`, estáveis).
 * Pura (não escreve em disco). NUNCA lança. Devolve `{ doc, expiradas, cortadas }`.
 */
function podarOverlay(doc, agora) {
  try {
    const agoraMs = Number.isFinite(Number(agora)) ? Number(agora) : Date.now()
    const ttlMs = TTL_USO_DIAS * 24 * 60 * 60 * 1000
    const base = doc && typeof doc === 'object' && Array.isArray(doc.arestas)
      ? doc.arestas.filter((a) => a && typeof a === 'object')
      : []
    let expiradas = 0
    const vigentes = []
    for (const a of base) {
      if (a.criadoEm !== undefined && a.criadoEm !== null) {
        const t = new Date(a.criadoEm).getTime()
        if (Number.isFinite(t) && agoraMs - t > ttlMs) {
          expiradas++
          continue
        }
      }
      vigentes.push(a)
    }
    let cortadas = 0
    let finais = vigentes
    if (vigentes.length > MAX_OVERLAY_ARESTAS) {
      const comIndice = vigentes.map((a, i) => ({ a, i }))
      comIndice.sort((x, y) => {
        const tx = x.a.criadoEm ? new Date(x.a.criadoEm).getTime() : 0
        const ty = y.a.criadoEm ? new Date(y.a.criadoEm).getTime() : 0
        if (ty !== tx) return ty - tx
        return y.i - x.i
      })
      finais = comIndice.slice(0, MAX_OVERLAY_ARESTAS).map((x) => x.a)
      // Ordem estável de gravação: mais recentes primeiro já ordenado acima.
      cortadas = vigentes.length - finais.length
    }
    const novo = { versao: OVERLAY_VERSAO, arestas: finais }
    novo.checksum = checksumOverlay(novo)
    return { doc: novo, expiradas, cortadas }
  } catch (_) {
    return { doc: overlayVazio(), expiradas: 0, cortadas: 0 }
  }
}

/**
 * Constrói UMA aresta de uso a partir do evento (pura, sem IO).
 * `evento`: `{ tipo, termo?, codigo?, emitente?, peso? }`.
 * - `tipo ∈ {Termo-PREFERIDO, NCM-ESCOLHIDO, CNAE-CARTEIRA}` (ou qualquer
 *   string; fora da lista só gera boost quando `origem:'uso_local'`);
 * - `codigo` (8/9/7 dígitos) vira `para` (`NCM:/NBS:/CNAE:`);
 * - `termo` vira `de` (`Termo:<normalizado>`); com `emitente` (CNPJ) e sem
 *   termo, `de` = `Emitente:<14 dígitos>`;
 * - `peso` default 0.1; `feedback:'negativo'`/`rejeitado:true` quando
 *   `tipo` indica demote (`feedback-negativo`, `rejeitado`) ou peso ≤ 0.
 * O overlay SÓ reordena (boost com teto 0.3 em `calcularBoost`) — nunca
 * cria redução (o resolvedor tem veto total).
 */
function construirArestaUso(evento, agoraIso) {
  try {
    const e = (evento && typeof evento === 'object' ? evento : {})
    const tipo = String(e.tipo || '').trim() || 'NCM-ESCOLHIDO'
    const termo = e.termo !== undefined && e.termo !== null ? String(e.termo).trim() : ''
    const codigo = e.codigo !== undefined && e.codigo !== null ? String(e.codigo) : ''
    const emitente = e.emitente !== undefined && e.emitente !== null
      ? String(e.emitente).replace(/\D+/g, '')
      : ''
    const para = idCodigoOverlay(codigo)
    if (!para) return null
    let de = null
    if (termo) {
      const nt = normalizar(termo)
      if (!nt) return null
      de = `Termo:${nt}`
    } else if (emitente && emitente.length === 14) {
      de = `Emitente:${emitente}`
    } else {
      de = `Uso:${tipo}`
    }
    const pesoBruto = Number(e.peso)
    const peso = Number.isFinite(pesoBruto) && pesoBruto !== 0 ? pesoBruto : PESO_USO_PADRAO
    const ehDemote = /negativo|rejeit/i.test(tipo) || peso <= 0
    const aresta = {
      de,
      para,
      tipo,
      origem: 'uso_local',
      peso: ehDemote ? 0 : Math.abs(peso),
      criadoEm: agoraIso || new Date().toISOString(),
    }
    if (emitente) aresta.emitente = emitente.slice(0, 14)
    if (termo) aresta.termo = termo.slice(0, 120)
    if (ehDemote) aresta.feedback = 'negativo'
    return aresta
  } catch (_) {
    return null
  }
}

/**
 * Registra uso no overlay EM MEMÓRIA (puro, testável).
 * `registrarUsoEmDoc(doc, evento)` → `{ doc, adicionada }` com poda aplicada
 * (TTL + teto). `feedback-negativo` vira demote (boost zerado em
 * `calcularBoost`), nunca remoção da base (base é só lida).
 */
function registrarUsoEmDoc(doc, evento, agora) {
  try {
    const base = doc && typeof doc === 'object' && Array.isArray(doc.arestas)
      ? { versao: OVERLAY_VERSAO, arestas: [...doc.arestas] }
      : overlayVazio()
    // Demote explícito por código: marca arestas existentes do código.
    const tipoTxt = String((evento && evento.tipo) || '')
    const codigoAlvo = evento && evento.codigo !== undefined ? String(evento.codigo).replace(/\D+/g, '') : ''
    if (/negativo|rejeit/i.test(tipoTxt) && codigoAlvo) {
      let tocadas = 0
      for (const a of base.arestas) {
        if (!a || typeof a !== 'object') continue
        const alvo = String(a.para || '').replace(/\D+/g, '')
        if (alvo === codigoAlvo) {
          a.feedback = 'negativo'
          tocadas++
        }
      }
      // Sem aresta prévia: registra a marca de demote (peso 0, feedback negativo).
      if (!tocadas) {
        const marca = construirArestaUso(evento, new Date(Number.isFinite(Number(agora)) ? Number(agora) : Date.now()).toISOString())
        if (marca) base.arestas.push(marca)
      }
    } else {
      const aresta = construirArestaUso(evento, new Date(Number.isFinite(Number(agora)) ? Number(agora) : Date.now()).toISOString())
      if (!aresta) return { doc: base, adicionada: false }
      base.arestas.push(aresta)
    }
    const podado = podarOverlay(base, agora)
    return { doc: podado.doc, adicionada: true, expiradas: podado.expiradas, cortadas: podado.cortadas }
  } catch (_) {
    return { doc: overlayVazio(), adicionada: false }
  }
}

/** Grava o overlay em disco (com checksum). NUNCA lança. */
function salvarOverlay(dir, doc) {
  try {
    if (!dir || !doc || typeof doc !== 'object' || !Array.isArray(doc.arestas)) {
      return { ok: false, motivo: 'doc-invalido' }
    }
    fs.mkdirSync(dir, { recursive: true })
    const limpo = { versao: OVERLAY_VERSAO, arestas: doc.arestas }
    limpo.checksum = checksumOverlay(limpo)
    const arq = path.join(dir, 'aprendizado.json')
    fs.writeFileSync(arq, JSON.stringify(limpo), 'utf8')
    return { ok: true, caminho: arq }
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e).slice(0, 120) }
  }
}

/**
 * Escritor em disco: `registrarUso(evento, ctx)`.
 * Abre/cria o overlay (`abrirOverlay`), aplica `registrarUsoEmDoc` + poda e
 * salva. `ctx`: `{ app?, userDataDir? }` (testes usam `userDataDir` tmp).
 * NUNCA lança; sem diretório → `{ ok:false, desabilitado:true }`.
 */
function registrarUso(evento, ctx) {
  try {
    const dir = dirUsuario(ctx)
    if (!dir) return { ok: false, desabilitado: true }
    const aberto = abrirOverlay(dir)
    const atual = (aberto && aberto.doc) || overlayVazio()
    const r = registrarUsoEmDoc(atual, evento)
    const salv = salvarOverlay(dir, r.doc)
    if (!salv.ok) return { ok: false, erro: salv.motivo }
    return { ok: true, caminho: salv.caminho, adicionada: r.adicionada }
  } catch (e) {
    return { ok: false, erro: String((e && e.message) || e).slice(0, 120) }
  }
}

/**
 * Job incremental do overlay (GRAFO-08): poda TTL + teto em <1s.
 * Roda ao abrir + ocioso (`requestIdleCallback`/`setTimeout` no renderer;
 * aqui a função pura `executarJobOverlay(dirOuCtx)` faz o trabalho síncrono).
 * NUNCA rebuilda o grafo inteiro; NUNCA lança.
 */
function executarJobOverlay(dirOuCtx) {
  try {
    const dir = typeof dirOuCtx === 'string' ? dirOuCtx : dirUsuario(dirOuCtx)
    if (!dir) return { ok: false, desabilitado: true }
    const aberto = abrirOverlay(dir)
    const atual = (aberto && aberto.doc) || overlayVazio()
    const podado = podarOverlay(atual)
    if (podado.expiradas === 0 && podado.cortadas === 0 && aberto && !aberto.recuperado) {
      return { ok: true, caminho: path.join(dir, 'aprendizado.json'), nadaAFazer: true }
    }
    const salv = salvarOverlay(dir, podado.doc)
    if (!salv.ok) return { ok: false, erro: salv.motivo }
    return { ok: true, caminho: salv.caminho, expiradas: podado.expiradas, cortadas: podado.cortadas }
  } catch (e) {
    return { ok: false, erro: String((e && e.message) || e).slice(0, 120) }
  }
}

/** Limpa o cache em memória (testes). */
function _limparCache() {
  cacheGrafo = null
}

module.exports = {
  GRAFO_VERSAO,
  OVERLAY_VERSAO,
  EMBEDDING_DIM,
  MODELO_EMBEDDING,
  VETORES_FORMATO,
  TETO_BOOST,
  TTL_USO_DIAS,
  MAX_OVERLAY_ARESTAS,
  TIPOS_USO_LOCAL,
  PONTE_SEMANTICA_VETOR,
  normalizar,
  tokenizar,
  tokenizarConsulta,
  STOPWORDS_CONSULTA,
  expandirTokenVetor,
  expandirTokens,
  tokensExpandidos,
  tokensExpandidosConsulta,
  calcularIdf,
  incorporarTextoVetor,
  incorporarListaVetor,
  similaridadeCosseno,
  textoDocumentoVetor,
  comunidadeDoNo,
  calcularBoost,
  provenienciaDoCaminho,
  podarOverlay,
  construirArestaUso,
  registrarUsoEmDoc,
  salvarOverlay,
  registrarUso,
  executarJobOverlay,
  carregarVetores,
  resolverArquivoGrafo,
  abrirGrafo,
  grafoConsultar,
  abrirOverlay,
  dirUsuario,
  _limparCache,
  _limparCacheVetores,
}
