'use strict'

/**
 * ia-worker.cjs — Worker IA do Aurum Tax NCM (Phase 6, plan 06-05 / IA-05).
 *
 * Derivado de `electron/spike/ia-spike-worker.cjs` (spike GO CONDICIONAL).
 * Roda isolado em `utilityProcess.fork()` (produção) ou `child_process.fork()`
 * (testes Node puros). Mesmo protocolo `{id, cmd, ...}` → `{id, ok, ...}`.
 *
 * Comandos: `init` | `buscar` | `selecionar` | `classificar` | `encerrar`.
 *
 *   - `init {mock:true}` (padrão do tracer): seletor mock determinístico,
 *     sem GGUF, sem dependências nativas.
 *   - `init {modelPath}`: carrega o GGUF via `node-llama-cpp` com
 *     `await import()` dinâmico (a v3 é ESM-only; `require()` falha com
 *     `ERR_REQUIRE_ASYNC_MODULE` — achado C1 do spike). Falha controlada
 *     quando o arquivo ou o módulo estão ausentes.
 *   - `buscar {consulta, k}`: RAG lexical real sobre
 *     `recursos-ia/indice-ncm/indice-lexical.json` (fallback offline do
 *     06-03; mesma interface `buscarIndice()` do índice Vectra futuro).
 *   - `selecionar {descricao, candidatos}`: prompt rígido no modelo real
 *     ("escolha 1 entre [candidatos] ou NÃO SEI; nunca invente código") ou
 *     overlap de tokens no mock, com `NÃO SEI` sob limiar.
 *   - `classificar {descricao, candidatos?}`: conveniência = `buscar`
 *     (quando sem candidatos) + `selecionar` (compatível com o spike).
 *
 * SEGREGAÇÃO DE REDE (requisito IA-05): este arquivo NÃO usa `fetch`,
 * `net`, `http`, `https`, `dgram`, `dns`, `child_process` nem `worker_threads`.
 * I/O limitada a `fs` (leitura do índice/GGUF) + IPC. Verificado por grep
 * em `docs/diagnostico-fase-4.md`.
 *
 * As funções `normalizar/stem/tokenizar/expandirConsulta/buscarIndice` são
 * porte CJS de `scripts/gerar-indice-ia.mjs` (mesma regra: pesos, stopwords,
 * sinônimos, BM25-lite). Manter em sincronia ao alterar o script.
 */

const fs = require('node:fs')
const path = require('node:path')
// 06-07: resolução de caminhos centralizada (prod `process.resourcesPath` vs
// dev `<raiz>/recursos-ia`, com fallback). O esbuild copia `caminhos-ia.cjs`
// para `electron/dist/` junto a este worker, então o `require` relativo
// funciona tanto na fonte (`electron/ia/`) quanto no `dist/`.
const { dirRecursosIa } = require('./caminhos-ia.cjs')
// Camada de compatibilidade (modelo agnóstico): perfis por família, prompts e
// parâmetros via `perfil-modelo.cjs`. O worker consome o PERFIL — nunca um
// modelo específico. Trocar o `.gguf` = novo perfil automático (+ overrides
// opcionais em `recursos-ia/modelo/modelo.json`).
let compat = null
try {
  compat = require('./perfil-modelo.cjs')
} catch (_) {
  compat = null
}
// 06-08: leitura do modelo cifrado (`assets/aux.dat`, AES-256-GCM) EM MEMÓRIA.
// Módulo OPCIONAL: falha de require NÃO quebra o worker (cai para o GGUF
// legado). Ver `electron/ia/modelo-seguro.cjs` + `docs/seguranca-ia.md`.
let modeloSeguro = null
try {
  modeloSeguro = require('./modelo-seguro.cjs')
} catch (_) {
  modeloSeguro = null
}

const MODELO_SIMBOLICO = 'mock-tracer-06-05'
const LIMIAR_NAO_SEI = 0.2

let modelo = null // { mock:true } | { mock:false, llama, model, context, session, modelPath }
let indice = null // índice lexical carregado preguiçosamente
let mapaDescricoes = null // codigo -> { descricao, capitulo }
let perfilAtivo = null // perfil da camada de compatibilidade (perfil-modelo.cjs)

/** Perfil efetivo atual (genérico quando a camada está ausente). */
function perfilAtual() {
  if (perfilAtivo) return perfilAtivo
  try {
    if (compat && compat.PERFIL_GENERICO) return { ...compat.PERFIL_GENERICO }
  } catch (_) { /* fallback abaixo */ }
  return { familia: 'generico', templateChat: 'generico', contextSize: 4096, thinkTag: null, suportaGramatica: true, classificacao: { maxTokens: 8, temperature: 0, topP: 1 }, conversa: { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.4, topP: 0.9, topK: 40, repeatPenalty: 1.15 }, maxCandidatos: 6 }
}

/**
 * Carrega o perfil do modelo a partir do diretório de `modelPath`
 * (`modelo.json` ao lado do `.gguf` + heurística por nome de arquivo).
 * Nunca lança; desconhecido → perfil genérico seguro.
 */
function carregarPerfilPara(modelPath) {
  try {
    if (!compat || typeof compat.perfilEfetivo !== 'function') return perfilAtual()
    const dir = require('node:path').dirname(String(modelPath || ''))
    const { perfil } = compat.perfilEfetivo(dir)
    if (perfil) {
      perfilAtivo = perfil
      return perfil
    }
  } catch (_) { /* fallback */ }
  return perfilAtual()
}

// ---------------------------------------------------------------------------
// Normalização / tokenização PT (porte de scripts/gerar-indice-ia.mjs)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  ('de,da,do,das,dos,e,em,para,com,por,que,os,as,o,a,um,uma,uns,umas,ao,aos,' +
    'na,no,nas,nos,se,ou,como,mais,menos,sem,sob,sobre,entre,ate,apenas,' +
    'muito,este,esta,estes,estas,esse,essa,isso,isto,aqueles,ser,sao,foi,' +
    'foram,tem,ha,cada,qual,quais,quando,onde,pelo,pela,pelos,pelas,num,' +
    'numa,dum,ii,iii,iv,vi,vii,viii,ix,xi,xii,xiii,xiv,xv,i,etc,ex')
    .split(','),
)

function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function stem(token) {
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

/** Radicalização pt-BR (porte de src/domain/services/vocabulario.ts). */
function radicalizar(t) {
  let s = String(t || '').toLowerCase()
  if (!s || s.length <= 3) return s
  if (s.endsWith('oes')) s = s.slice(0, -3) + 'ao'
  else if (s.endsWith('aes')) s = s.slice(0, -3) + 'ao'
  else if (s.endsWith('ais')) s = s.slice(0, -3) + 'al'
  else if (s.endsWith('eis')) s = s.slice(0, -3) + 'el'
  else if (s.endsWith('is')) s = s.slice(0, -2) + 'il'
  else if (s.endsWith('ns')) s = s.slice(0, -2) + 'm'
  else if (s.endsWith('es') && s.length > 4) s = s.slice(0, -2)
  else if (s.endsWith('s') && s.length > 3) s = s.slice(0, -1)
  return s
}

function distanciaLevenshtein(a, b, teto = 2) {
  const s = String(a || '')
  const t = String(b || '')
  if (s === t) return 0
  if (Math.abs(s.length - t.length) > teto) return teto + 1
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j)
  for (let i = 1; i <= s.length; i++) {
    const cur = [i]
    let minLinha = i
    for (let j = 1; j <= t.length; j++) {
      const custo = s[i - 1] === t[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + custo)
      if (cur[j] < minLinha) minLinha = cur[j]
    }
    if (minLinha > teto) return teto + 1
    prev = cur
  }
  return prev[t.length]
}

/** casaToken com radical + fuzzy (porte do vocabulario.ts, com guardas anti-ruído). */
function casaToken(q, o) {
  if (!q || !o) return false
  if (q === o) return true
  const minLen = Math.min(q.length, o.length)
  if (minLen >= 4 && (o.includes(q) || q.includes(o))) return true
  if (q.length < 4 || o.length < 4) return false
  if (radicalizar(q) === radicalizar(o)) return true
  const rQ = radicalizar(q)
  const rO = radicalizar(o)
  if (rQ.length >= 4 && rO.length >= 4 && (rO.includes(rQ) || rQ.includes(rO))) return true
  if (q.length >= 5 && o.length >= 5) {
    const teto = q.length >= 8 && o.length >= 8 ? 2 : 1
    if (distanciaLevenshtein(q, o, teto) <= teto) return true
  }
  return false
}

function tokenizar(texto) {
  const limpo = normalizar(texto).replace(/<[^>]*>/g, ' ')
  return limpo
    .replace(/[^a-z0-9/.-]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^[/.-]+|[/.-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem)
}

const GRUPOS_SINONIMOS_BASE = [
  ['frango', 'frangos', 'galo', 'galos', 'galinha', 'galinhas', 'ave', 'aves',
    'peru', 'perus', 'perua', 'peruas', 'pato', 'patos', 'ganso', 'gansos', 'galinaceo'],
  ['notebook', 'laptop', 'microcomputador', 'portatil', 'portateis',
    'computador', 'computadores', 'processamento', 'dados', 'informatica',
    'automatica', 'automaticas', 'automatico', 'automaticos', 'maquina', 'maquinas'],
  ['arroz', 'polido', 'polidos', 'brunido', 'brunidos', 'branco', 'brancos',
    'integral', 'trinca', 'cereais', 'cereal'],
  ['celular', 'smartphone', 'telefone', 'telefones', 'telefonico'],
  ['alexa', 'echo', 'alto-falante', 'altifalante', 'soundbar'],
  ['kindle', 'ereader', 'leitor', 'leitores'],
  ['smartwatch', 'relogio', 'relogios'],
  ['drone', 'aeronave', 'aeronaves'],
  ['webcam', 'camera', 'gopro'],
  ['videogame', 'console', 'consoles', 'playstation', 'xbox', 'nintendo'],
  ['headset', 'headphone', 'fone', 'fones', 'airpods'],
  ['whey', 'creatina', 'suplemento', 'suplementos'],
  ['tapioca', 'polvilho', 'fecula', 'feculas'],
  ['cropped', 'blusa', 'babylook', 'regata'],
  ['legging', 'calca', 'calcas'],
  ['moletom', 'sueter', 'sueteres'],
  ['jaqueta', 'casaco', 'sobretudo'],
  ['gin', 'rum', 'tequila', 'aguardente', 'licor'],
  ['espumante', 'vinho', 'vinhos'],
  ['energetico', 'bebida', 'bebidas'],
  ['samsung', 'telefone', 'smartphone'],
  ['whey', 'suplemento'],
  ['nike', 'calcado', 'tenis'],
  ['tv', 'televisao', 'smartv'],
  ['pc', 'computador', 'notebook'],
  ['farol', 'farois', 'retrovisor', 'amortecedor', 'bateria', 'acumuladores', 'filtro', 'filtrar', 'correia', 'pneu', 'pneumatico', 'freio', 'pastilha'],
  ['parafuso', 'parafusos', 'porca', 'arruela', 'arruelas', 'fixacao'],
  ['tubo', 'tubos', 'vergalhao', 'nervura', 'arame', 'aco', 'ferro'],
  ['barra', 'barras', 'perfil', 'perfis', 'aluminio'],
  ['tecido', 'tecidos', 'malha', 'fio', 'fios', 'algodao', 'tricoline', 'denim', 'indigo'],
  ['toalha', 'atoalhado', 'lencol', 'cama'],
  ['tijolo', 'cimento', 'tinta', 'tintas', 'construcao'],
  ['martelo', 'alicate', 'serra', 'serrote', 'chave', 'ferramenta', 'furar'],
  ['panela', 'cozinha', 'colchao', 'mesa', 'cadeira', 'assento'],
  ['shampoo', 'xampus', 'sabonete', 'sabao', 'saboes'],
  ['lapis', 'caderno', 'mochila', 'caneta'],
  ['sapato', 'calcado', 'tenis'],
  ['acido', 'sulfurico', 'sulfato', 'cloreto', 'nitrato', 'fosfato', 'carbonato', 'hidroxido', 'oxido', 'potassio', 'magnesio'],
  ['metanol', 'etanol', 'acetona', 'ureia', 'etileno', 'propileno', 'acetato', 'medicamento'],
  ['comprimido', 'xarope', 'vacina', 'antibiotico', 'dipirona', 'paracetamol', 'amoxicilina', 'vitamina', 'farmaco'],
  ['fertilizante', 'adubo', 'herbicida', 'inseticida', 'fungicida', 'pesticida', 'defensivo'],
  ['tinta', 'verniz', 'pigmento', 'corante', 'solvente', 'resina'],
  ['plastico', 'polietileno', 'borracha', 'latex', 'embalagem', 'mangueira'],
  ['madeira', 'tabua', 'compensado', 'papel', 'papelao', 'etiqueta'],
  ['torno', 'prensa', 'caldeira', 'gerador', 'compressor', 'maquina', 'motor', 'bomba', 'valvula', 'rolamento'],
  ['oculos', 'lente', 'termometro', 'microscopio', 'relogio', 'protese', 'ultrassom'],
  ['trator', 'reboque', 'barco', 'aviao', 'veiculo'],
  ['carne', 'figado', 'coracao', 'camarao', 'peixe', 'fruta', 'legume'],
]

/**
 * Single-source: tenta carregar `sinonimos-gerados.json` (gerado por
 * scripts/gerar-indice-ia.mjs a partir de `recursos-ia/conhecimento/`).
 * Fallback: base embutida acima (mesmos grupos do script).
 */
function carregarGruposSinonimos() {
  try {
    const raiz = raizProjeto()
    const p = path.join(raiz, 'recursos-ia', 'indice-ncm', 'sinonimos-gerados.json')
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (Array.isArray(j.grupos) && j.grupos.length) return j.grupos
    }
  } catch (_) {
    /* fallback abaixo */
  }
  return GRUPOS_SINONIMOS_BASE
}

const GRUPOS_SINONIMOS = carregarGruposSinonimos()

const SINONIMOS = new Map()
for (const grupo of GRUPOS_SINONIMOS) {
  const stems = [...new Set(grupo.map((t) => stem(normalizar(t))))]
  for (const s of stems) SINONIMOS.set(s, stems.filter((x) => x !== s))
}

function expandirConsulta(termos) {
  const out = []
  const vistos = new Set()
  const fila = []
  for (const t of termos) {
    if (!vistos.has(t)) { vistos.add(t); out.push({ token: t, peso: 1 }); fila.push({ t, nivel: 0 }) }
  }
  while (fila.length) {
    const { t, nivel } = fila.shift()
    if (nivel >= 2) continue
    const peso = nivel === 0 ? 0.85 : 0.7
    for (const s of SINONIMOS.get(t) ?? []) {
      if (!vistos.has(s)) { vistos.add(s); out.push({ token: s, peso }); fila.push({ t: s, nivel: nivel + 1 }) }
    }
  }
  return out
}

/** BM25-lite: Σ peso·idf·tf/(tf+1.2). Ordena por score desc, desempate por código. */
function buscarIndice(ind, consulta, k = 5) {
  const termos = expandirConsulta(tokenizar(consulta))
  const res = []
  for (const doc of ind.docs) {
    let s = 0
    for (const { token, peso } of termos) {
      const tf = doc.tf[token]
      if (tf) s += peso * (ind.idf[token] ?? 1) * (tf / (tf + 1.2))
    }
    if (s > 0) res.push({ codigo: doc.codigo, capitulo: doc.capitulo, score: Math.round(s * 10000) / 10000 })
  }
  res.sort((a, b) => b.score - a.score || a.codigo.localeCompare(b.codigo))
  return res.slice(0, Math.max(1, Math.min(k, 30)))
}

// ---------------------------------------------------------------------------
// Tradutor fiscal PT-BR ↔ EN (100% local/offline)
// ---------------------------------------------------------------------------
// Enriquecimento do retrieval: a busca lexical ancora termos em PT oficial e
// em EN (consulta PT+EN no `buscar`), e o prompt do modelo leva PT original.
// Single-source: o JSON; aqui só o carregamento preguiçoso + matching guloso.

let glossario = null // { frases, termos, enFrases, enPt } | { vazio: true, ... }

function normalizarChave(chave) {
  return normalizar(String(chave || '')).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).join(' ')
}

function carregarGlossario() {
  if (glossario) return glossario
  try {
    const raiz = raizProjeto()
    const p = path.join(raiz, 'recursos-ia', 'conhecimento', 'glossario-pt-en.json')
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'))
      const frases = new Map()
      for (const [k, v] of Object.entries(j.frases ?? {})) {
        const nk = normalizarChave(k)
        if (nk && v) frases.set(nk, String(v))
      }
      const termos = new Map()
      for (const [k, v] of Object.entries(j.termos ?? {})) {
        const nk = normalizarChave(k)
        if (nk && v && !termos.has(nk)) termos.set(nk, String(v))
      }
      // EN→PT: inversão automática (PT→EN + frases) + curadoria explícita
      // (`en_para_pt` vence — mapeia para o vocabulário oficial da TEC).
      const enFrases = new Map()
      for (const [k, v] of frases) {
        const nk = normalizarChave(v)
        if (nk && !enFrases.has(nk)) enFrases.set(nk, k)
      }
      const enPt = new Map()
      for (const [k, v] of termos) {
        const nk = normalizarChave(v)
        if (nk && !enPt.has(nk)) enPt.set(nk, k)
      }
      for (const [k, v] of Object.entries(j.en_para_pt ?? {})) {
        const nk = normalizarChave(k)
        if (nk && v) enPt.set(nk, String(v))
      }
      glossario = { frases, termos, enFrases, enPt }
      return glossario
    }
  } catch (_) {
    // cai no vazio abaixo
  }
  glossario = { frases: new Map(), termos: new Map(), enFrases: new Map(), enPt: new Map(), vazio: true }
  return glossario
}

function tokensNorm(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 0)
}

function tokensBrutos(texto) {
  return String(texto ?? '').replace(/[^A-Za-zÀ-ú0-9]+/g, ' ').split(' ').filter((t) => t.length > 0)
}

/**
 * Tradução gulosa por dicionário (frases 3/2g + termos). Desconhecido passa
 * no original — nunca inventa. `mapas`: [frases, termos].
 */
function traduzirComMapas(texto, frases, termos) {
  const brutos = tokensBrutos(texto)
  if (!brutos.length) return ''
  const norms = brutos.map((t) => normalizarChave(t))
  const out = []
  let i = 0
  while (i < brutos.length) {
    let achou = null
    for (const n of [3, 2]) {
      if (i + n > norms.length) continue
      const chave = norms.slice(i, i + n).join(' ')
      const en = frases.get(chave)
      if (en) { achou = { saida: en, n }; break }
    }
    if (!achou) {
      const v = termos.get(norms[i])
      achou = { saida: v || brutos[i], n: 1 }
    }
    out.push(achou.saida)
    i += achou.n
  }
  return out.join(' ')
}

/** Traduz PT-BR → EN por glossário (frases de 3/2g guloso + termos). */
function traduzirParaEN(texto) {
  const g = carregarGlossario()
  return traduzirComMapas(texto, g.frases, g.termos)
}

/** Traduz EN → PT-BR por glossário (tempo real; desconhecido passa original). */
function traduzirParaPT(texto) {
  const g = carregarGlossario()
  return traduzirComMapas(texto, g.enFrases, g.enPt)
}

// ---------------------------------------------------------------------------
// Índice / base IA (leitura local, preguiçosa)
// ---------------------------------------------------------------------------

function raizProjeto() {
  // 06-07: delega ao módulo compartilhado (prod → dev → cwd, com fallback).
  // `carregarIndice()` monta `recursos-ia/...` sobre esta raiz, então aqui
  // devolve o PAI do diretório efetivo.
  try {
    return path.resolve(dirRecursosIa(null), '..')
  } catch (_) {
    const aqui = __dirname
    const tentativas = [
      path.resolve(aqui, '..', '..'),
      path.resolve(aqui, '..'),
      process.cwd(),
    ]
    for (const raiz of tentativas) {
      if (fs.existsSync(path.join(raiz, 'recursos-ia', 'indice-ncm', 'indice-lexical.json'))) return raiz
    }
    return tentativas[0]
  }
}

function carregarIndice() {
  if (indice) return indice
  const raiz = raizProjeto()
  const caminhoIndice = path.join(raiz, 'recursos-ia', 'indice-ncm', 'indice-lexical.json')
  if (!fs.existsSync(caminhoIndice)) {
    throw new Error(`índice lexical ausente: ${caminhoIndice} (rode scripts/gerar-indice-ia.mjs)`)
  }
  indice = JSON.parse(fs.readFileSync(caminhoIndice, 'utf8'))
  const basePath = path.join(raiz, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json')
  mapaDescricoes = new Map()
  if (fs.existsSync(basePath)) {
    try {
      const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
      for (const item of base.itens ?? []) {
        if (!mapaDescricoes.has(item.codigo)) {
          mapaDescricoes.set(item.codigo, {
            // Ficha oficial completa do item: o prompt do modelo real lê o
            // nome puro (nomenclatura) + capítulo + vínculo, não o
            // boilerplate jurídico da descrição expandida.
            descricao: item.descricaoExpandida || item.nomenclatura || item.descricao || '',
            nomenclatura: item.nomenclatura || '',
            capitulo: item.capitulo?.codigo ?? '',
            capituloNome: item.capitulo?.descricao || '',
            vinculo: item.descricaoCClassTrib || '',
            reducao: (item.pRedIBS != null || item.pRedCBS != null)
              ? `${item.pRedIBS ?? 0}/${item.pRedCBS ?? 0}`
              : '',
          })
        }
      }
    } catch (_) {
      // Base descritiva é enriquecimento; o índice funciona sem ela.
    }
  }
  return indice
}

function enriquecer(resultados) {
  const vistos = new Set()
  const unicos = []
  for (const r of resultados) {
    if (vistos.has(r.codigo)) continue // índice tem 1 doc por vínculo; UI quer 1 por NCM
    vistos.add(r.codigo)
    unicos.push(r)
  }
  return unicos.map((r) => {
    const extra = mapaDescricoes ? mapaDescricoes.get(r.codigo) : undefined
    return {
      codigo: r.codigo,
      capitulo: r.capitulo || extra?.capitulo || r.codigo.slice(0, 2),
      score: r.score,
      descricao: extra?.descricao || '',
    }
  })
}

// ---------------------------------------------------------------------------
// Seletores
// ---------------------------------------------------------------------------

/**
 * Mock determinístico (herdado do spike): maior overlap descrição×candidato.
 * v2: expansão com os mesmos sinônimos do RAG + fuzzy `casaToken`
 * (radical/typo), espelhando `selecionarAurumAILocal`; abaixo do limiar, NÃO
 * SEI. Substituído pelo LLM real em 06-04.
 */
function selecionarMock(descricao, candidatos) {
  const base = tokenizar(descricao)
  const conjunto = new Set(base)
  for (const { token } of expandirConsulta(base)) conjunto.add(token)
  const listaConjunto = [...conjunto]
  const teto = Math.max(1, base.length)
  let melhor = null
  let melhorPontos = 0
  for (const c of candidatos || []) {
    const toksC = tokenizar(c.descricao)
    const setC = new Set(toksC)
    let pontos = 0
    for (const t of listaConjunto) {
      if (setC.has(t)) {
        pontos += 1
        continue
      }
      // Fuzzy barato: radical/typo vale 0.8 (não empata com exato).
      for (const o of toksC) {
        if (casaToken(t, o)) {
          pontos += 0.8
          break
        }
      }
    }
    if (pontos > melhorPontos) {
      melhorPontos = pontos
      melhor = c
    }
  }
  const confianca = Math.round((melhorPontos / teto) * 100) / 100
  if (!melhor || confianca < LIMIAR_NAO_SEI) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente' }
  }
  return { codigo: melhor.codigo, confianca, motivo: 'mock-overlap' }
}

function montarPromptRigido(descricao, candidatos) {
  const lista = (candidatos || []).map((c) => `- ${c.codigo}: ${c.descricao || '(sem descrição)'}`).join('\n')
  return (
    'Você é um classificador fiscal. Escolha EXATAMENTE UM código da lista ' +
    'abaixo para a descrição dada, ou responda NÃO SEI. ' +
    'Nunca invente um código fora da lista.\n' +
    `Descrição: "${String(descricao ?? '').slice(0, 500)}"\n` +
    `Candidatos:\n${lista}\n` +
    'Responda apenas com o código de 8 dígitos ou NÃO SEI, sem explicações.'
  )
}

/**
 * Prompt curto de classificação (camada de compatibilidade).
 * Monta as fichas oficiais (nome + capítulo + vínculo) e delega o envelope
 * ao `perfil-modelo.cjs` — o texto é idêntico para qualquer modelo; só o
 * `maxCandidatos` vem do perfil (`modelo.json` pode ajustar).
 */
function montarPromptCurto(descricao, candidatos, maxCandidatos = 6) {
  const limpa = (s, n) => String(s || '').replace(/\s+/g, ' ').replace(/<[^>]*>/g, '').trim().slice(0, n)
  const teto = Math.max(2, Math.min(20, Number(maxCandidatos) || Number(perfilAtual().maxCandidatos) || 6))
  const fichas = (candidatos || []).slice(0, teto).map((c) => {
    const ficha = mapaDescricoes ? mapaDescricoes.get(String(c.codigo).replace(/\D+/g, '')) : undefined
    const nome = limpa(ficha?.nomenclatura || String(c.descricao || '').split(' (')[0], 80)
    const cap = ficha?.capitulo || String(c.capitulo || c.codigo || '').slice(0, 2)
    const vinc = limpa(ficha?.vinculo, 40)
    const extra = [cap ? `Cap. ${cap}` : '', vinc].filter(Boolean).join(' · ')
    return { codigo: c.codigo, nome, extra }
  })
  try {
    if (compat && typeof compat.montarPromptClassificacao === 'function') {
      return compat.montarPromptClassificacao(descricao, fichas, teto)
    }
  } catch (_) { /* fallback abaixo */ }
  const produto = limpa(descricao, 140)
  const lista = fichas.map((f, i) => `${i + 1}. ${f.codigo} — ${f.nome}${f.extra ? ` [${f.extra}]` : ''}`).join('\n')
  return (
    'Você é um classificador fiscal brasileiro (Reforma Tributária, LC 214/2025). ' +
    'Escolha EXATAMENTE UM número da lista para o produto, ou 0 se nenhum servir. ' +
    'Responda apenas com o número, sem explicações.\n' +
    `Produto: "${produto}"\n` +
    `Opções:\n${lista}\n` +
    'Resposta (somente o número):'
  )
}

/** Gramática GBNF: só o índice (1..N) ou 0 (=NÃO SEI). Sem texto livre. */
function gramaticaIndices(n) {
  const alternativas = ['"0"']
  for (let i = 1; i <= n; i++) alternativas.push(`"${i}"`)
  return `root ::= (${alternativas.join(' | ')})`
}

/**
 * Seleção via LLM real AI-FIRST (somente após `init {modelPath}`).
 * Geração restrita por gramática (índice 1..N ou 0=NÃO SEI) + temperature 0:
 * o modelo NUNCA emite texto livre nem inventa código — a resposta é sempre
 * um índice válido, mapeado aqui para o NCM da lista.
 *
 * FILA: `completion` usa 1 sequence — chamadas concorrentes são serializadas
 * via `filaInfer` para não misturar contexto entre classificar/conversar.
 */
let filaInfer = Promise.resolve()
function enfileirarInfer(fn) {
  const r = filaInfer.then(() => fn())
  filaInfer = r.catch(() => null)
  return r
}
async function selecionarReal(descricao, candidatos) {
  const perfil = perfilAtual()
  const tetoCand = Math.max(2, Math.min(20, Number(perfil.maxCandidatos) || 6))
  const lista = (candidatos || []).slice(0, tetoCand)
  if (!lista.length) return { codigo: 'NÃO SEI', confianca: 0, motivo: 'sem-candidatos' }
  if (!String(descricao ?? '').trim()) return { codigo: 'NÃO SEI', confianca: 0, motivo: 'descricao-vazia' }
  if (!modelo || modelo.mock || !modelo.completion || !modelo.llamaModulo) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'inferencia-falhou:modelo-real-nao-inicializado' }
  }
  // Trava de sanidade (fail-safe, princípio 3): sem NENHUM lastro lexical
  // entre a descrição e as fichas oficiais, nem o LLM é acordado — NÃO SEI
  // direto (gibberish, vazio, fora de escopo). O LLM decide AMONG plausíveis.
  const baseQ = tokenizar(descricao)
  if (baseQ.length) {
    const conjuntoQ = new Set(baseQ)
    for (const { token } of expandirConsulta(baseQ)) conjuntoQ.add(token)
    // EN→PT em tempo real: consulta em inglês também ancora no PT oficial.
    for (const t of tokenizar(traduzirParaPT(descricao))) conjuntoQ.add(t)
    const tetoQ = Math.max(1, baseQ.length)
    let melhorQ = 0
    for (const c of lista) {
      const fichaQ = mapaDescricoes ? mapaDescricoes.get(String(c.codigo).replace(/\D+/g, '')) : undefined
      const textoFicha = [fichaQ?.nomenclatura || '', c.descricao || '', fichaQ?.capituloNome || '', fichaQ?.vinculo || ''].join(' ')
      const toksF = tokenizar(textoFicha + ' ' + traduzirParaEN(textoFicha))
      const setF = new Set(toksF)
      let pontos = 0
      for (const t of conjuntoQ) {
        if (setF.has(t)) { pontos += 1; continue }
        for (const o of toksF) {
          if (casaToken(t, o)) { pontos += 0.8; break }
        }
      }
      if (pontos > melhorQ) melhorQ = pontos
    }
    if (melhorQ / tetoQ < LIMIAR_NAO_SEI) {
      return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente+pt-en' }
    }
  }
  const { LlamaGrammar, LlamaText } = modelo.llamaModulo
  const prompt = montarPromptCurto(descricao, lista)
  const parada = []
  try {
    parada.push(typeof LlamaText === 'function' ? LlamaText('\n') : '\n')
  } catch (_) {
    parada.push('\n')
  }
  // Robustez produção: 2 tentativas (transiente de inferência não vira NÃO SEI
  // sem tentar de novo). Com gramática (quando o perfil suporta) — nunca
  // texto livre; sem gramática (modelo sem suporte) → geração livre curta +
  // extração do 1º dígito (fail-closed: fora de 0..N vira NÃO SEI).
  // Serializado na fila (1 sequence por contexto).
  const pc = (perfil && perfil.classificacao) || { maxTokens: 8, temperature: 0, topP: 1 }
  const querGramatica = perfil.suportaGramatica !== false
  let texto = ''
  let erroFinal = null
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let gramatica = null
    try {
      if (querGramatica) {
        gramatica = new LlamaGrammar(modelo.llama, { grammar: gramaticaIndices(lista.length) })
      }
      texto = String(await enfileirarInfer(() => modelo.completion.generateCompletion(prompt, {
        maxTokens: Math.max(1, Math.min(64, Number(pc.maxTokens) || 8)),
        temperature: Math.max(0, Math.min(2, Number(pc.temperature) || 0)),
        topP: Math.max(0, Math.min(1, Number(pc.topP) || 1)),
        stopGenerationTriggers: parada,
        ...(gramatica ? { grammar: gramatica } : {}),
      })))
      erroFinal = null
      break
    } catch (e) {
      // Modelo sem suporte a gramática: 2ª tentativa sem gramática.
      if (querGramatica && tentativa === 1 && /grammar/i.test(String((e && e.message) || e))) {
        try {
          texto = String(await enfileirarInfer(() => modelo.completion.generateCompletion(prompt, {
            maxTokens: Math.max(1, Math.min(64, Number(pc.maxTokens) || 8)),
            temperature: Math.max(0, Math.min(2, Number(pc.temperature) || 0)),
            topP: Math.max(0, Math.min(1, Number(pc.topP) || 1)),
            stopGenerationTriggers: parada,
          })))
          erroFinal = null
          break
        } catch (e2) {
          erroFinal = e2
          texto = ''
        }
      } else {
        erroFinal = e
        texto = ''
      }
    } finally {
      try {
        if (gramatica && typeof gramatica.dispose === 'function') gramatica.dispose()
      } catch (_) { /* best-effort */ }
    }
  }
  if (erroFinal) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: `inferencia-falhou:${erroFinal && erroFinal.message ? erroFinal.message : erroFinal}` }
  }
  const digitos = String(texto).trim().match(/\d+/)
  const idx = digitos ? Number(digitos[0]) : NaN
  if (!Number.isFinite(idx) || idx < 0 || idx > lista.length) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'llm-indice-invalido', saidaBruta: String(texto).slice(0, 120) }
  }
  if (idx === 0) return { codigo: 'NÃO SEI', confianca: 0, motivo: 'llm-nenhum-candidato+pt-en' }
  const escolhido = lista[idx - 1]
  return { codigo: String(escolhido.codigo).replace(/\D+/g, '') ? escolhido.codigo : 'NÃO SEI', confianca: 0.7, motivo: 'llm-indice-gramatica+pt-en' }
}

// ---------------------------------------------------------------------------
// Conversa livre: envelope por TEMPLATE do perfil (chatml-qwen / llama3 /
// mistral / phi / gemma / generico). O motor determinístico continua fonte
// da verdade fiscal — aqui a IA só dá fluidez para papo leve/generico.
// Regras duras vivem no system prompt e a sanitização final é agnóstica
// (`limparTextoLivre` → `perfil-modelo.cjs`).
// ---------------------------------------------------------------------------

/** Limpa texto livre: thinking, restos de template e repetições (agnóstico). */
function limparTextoLivre(bruto) {
  try {
    if (compat && typeof compat.limparTextoLivreGenerico === 'function') {
      return compat.limparTextoLivreGenerico(bruto)
    }
  } catch (_) { /* fallback abaixo */ }
  let s = String(bruto ?? '')
  // Qwen3 thinking: <think>...</think> nunca vaza para a UI.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ')
  s = s.replace(/<\/?think>/gi, ' ')
  s = s.replace(/<\|im_(start|end)\|>/g, ' ')
  s = s.replace(/\|im_end\|/g, ' ')
  s = s.replace(/\b(system|user|assistant)\s*:/gi, ' ')
  // Corta marcadores de fim alucinados pelo 0.6B e thinking em inglês vazado.
  const cortes = ['(End of', '[End of', '</code>', '<code>', 'Okay, the user', 'translates to', 'I need to', 'I should respond']
  for (const c of cortes) {
    const i = s.indexOf(c)
    if (i >= 0) s = s.slice(0, i)
  }
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  // Colapsa frases consecutivas duplicadas (loop típico do 0.6B).
  const frases = s.split(/(?<=[.!?])\s+/)
  const unicas = []
  for (const f of frases) {
    const t = f.trim()
    if (!t) continue
    if (unicas.length && unicas[unicas.length - 1].toLowerCase() === t.toLowerCase()) continue
    unicas.push(t)
    if (unicas.length >= 6) break
  }
  s = unicas.join(' ')
  // Repetição de n-grama 5+ palavras 3x → corta (degeneração).
  const palavras = s.split(/\s+/)
  if (palavras.length > 30) {
    const assinatura = palavras.slice(0, 5).join(' ').toLowerCase()
    let rep = 0
    for (let i = 5; i + 5 <= palavras.length; i += 5) {
      if (palavras.slice(i, i + 5).join(' ').toLowerCase() === assinatura) rep += 1
    }
    if (rep >= 2) s = palavras.slice(0, 30).join(' ')
  }
  if (s.length > 1200) s = s.slice(0, 1200).trimEnd() + '…'
  return s.trim()
}

/**
 * Prompt de conversa pelo TEMPLATE do perfil ativo (ver perfil-modelo.cjs).
 * Conteúdo idêntico em todos os modelos; só o envelope muda.
 */
function montarPromptConversa(sistema, historico, pergunta, think) {
  try {
    if (compat && typeof compat.montarPromptConversa === 'function') {
      return compat.montarPromptConversa(perfilAtual(), sistema, historico, pergunta, think)
    }
  } catch (_) { /* fallback abaixo */ }
  const sys = String(sistema ?? '').slice(0, 1800)
  const hist = Array.isArray(historico) ? historico.slice(-6) : []
  const thinkTag = think ? '' : '/no_think\n'
  const direto = think ? '' : 'Responda direto em português, sem mostrar raciocínio, sem inglês, sem marcadores.\n'
  let p = `<|im_start|>system\n${thinkTag}${direto}${sys}<|im_end|>\n`
  for (const m of hist) {
    const papel = m && m.papel === 'assistant' ? 'assistant' : 'user'
    const txt = String((m && m.texto) || '').replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!txt) continue
    p += `<|im_start|>${papel}\n${txt}<|im_end|>\n`
  }
  p += `<|im_start|>user\n${String(pergunta ?? '').replace(/\s+/g, ' ').trim().slice(0, 800)}<|im_end|>\n<|im_start|>assistant\n`
  return p
}

async function conversarReal(sistema, historico, pergunta, opts) {
  if (!modelo || modelo.mock || !modelo.completion || !modelo.llamaModulo) {
    return { texto: '', motivo: 'inferencia-falhou:modelo-real-nao-inicializado' }
  }
  const perfil = perfilAtual()
  const pc = (perfil && perfil.conversa) || { maxTokensPadrao: 320, maxTokensThink: 512, temperature: 0.4, topP: 0.9, topK: 40, repeatPenalty: 1.15 }
  const o = opts && typeof opts === 'object' ? opts : {}
  const think = o.think === true
  const tetoPadrao = Number(pc.maxTokensPadrao) || 320
  const tetoThink = Number(pc.maxTokensThink) || 512
  const maxTokens = Math.max(64, Math.min(think ? 1024 : 640, Number(o.maxTokens) || (think ? tetoThink : tetoPadrao)))
  const temperature = Math.max(0, Math.min(2, Number(o.temperature ?? pc.temperature) || 0.4))
  const prompt = montarPromptConversa(sistema, historico, pergunta, think)
  const { LlamaText } = modelo.llamaModulo
  let stops = []
  try {
    if (compat && typeof compat.stopsParaTemplate === 'function') {
      stops = compat.stopsParaTemplate(perfil)
    } else {
      stops = ['<|im_end|>', '<|im_start|>', '\n\n\n']
    }
  } catch (_) {
    stops = ['<|im_end|>', '<|im_start|>', '\n\n\n']
  }
  const parada = []
  try {
    for (const s of stops) parada.push(typeof LlamaText === 'function' ? LlamaText(s) : s)
  } catch (_) {
    parada.push(stops[0] || '<|im_end|>')
  }
  let bruto = ''
  try {
    bruto = String(await enfileirarInfer(() => modelo.completion.generateCompletion(prompt, {
      maxTokens,
      temperature,
      topP: Math.max(0, Math.min(1, Number(pc.topP) || 0.9)),
      topK: Math.max(1, Math.min(200, Number(pc.topK) || 40)),
      repeatPenalty: Math.max(1, Math.min(2, Number(pc.repeatPenalty) || 1.15)),
      stopGenerationTriggers: parada,
    })))
  } catch (e) {
    return { texto: '', motivo: `inferencia-falhou:${e && e.message ? e.message : e}` }
  }
  const texto = limparTextoLivre(bruto)
  if (!texto || texto.length < 2) return { texto: '', motivo: 'llm-resposta-vazia' }
  return { texto, motivo: think ? 'llm-livre-think' : 'llm-livre' }
}

// ---------------------------------------------------------------------------
// Utilidades de runtime
// ---------------------------------------------------------------------------

function agoraMs() {
  return Number(process.hrtime.bigint() / 1000000n)
}

function ramMB() {
  return Math.round((process.memoryUsage().rss / 1048576) * 100) / 100
}

/** Canal de transporte unificado (utilityProcess ↔ fork). */
function canal() {
  if (typeof process !== 'undefined' && process.parentPort) {
    const pp = process.parentPort
    return {
      tipo: 'utilityProcess',
      enviar: (msg) => pp.postMessage(msg),
      ouvir: (cb) => pp.on('message', (ev) => cb(ev && 'data' in ev ? ev.data : ev)),
    }
  }
  return {
    tipo: 'fork',
    enviar: (msg) => {
      if (typeof process.send === 'function') process.send(msg)
    },
    ouvir: (cb) => process.on('message', cb),
  }
}

// ---------------------------------------------------------------------------
// Tratamento de comandos
// ---------------------------------------------------------------------------

async function tratar(msg) {
  const tIni = agoraMs()
  const { id, cmd } = msg || {}
  try {
    if (cmd === 'perfil') {
      // Introspecção da camada de compatibilidade: o sistema consulta o
      // perfil sem precisar conhecer o modelo.
      return { id, ok: true, cmd, perfil: perfilAtual(), mock: modelo ? modelo.mock === true : true }
    }

    if (cmd === 'init') {
      if (!msg || msg.mock !== false) {
        modelo = { mock: true, nome: MODELO_SIMBOLICO, iniciadoEm: Date.now() }
        return { id, ok: true, cmd, mock: true, msLoad: agoraMs() - tIni, ramMB: ramMB(), transporte: canalTipo, perfil: perfilAtual() }
      }
      // `modelPath` explícito OU descoberta automática (`recursos-ia/modelo/`
      // — qualquer `*.gguf` + `modelo.json`). Trocar o arquivo = novo modelo.
      let alvo = String(msg.modelPath || '')
      if (!alvo) {
        try {
          const { dirRecursosIa: dirIa } = require('./caminhos-ia.cjs')
          const dirModelo = require('node:path').join(dirIa(null), 'modelo')
          if (compat && typeof compat.descobrirModelo === 'function') {
            const achado = compat.descobrirModelo(dirModelo)
            if (achado && achado.caminho) alvo = achado.caminho
          }
        } catch (_) { /* erro tratado abaixo */ }
      }
      if (!alvo || !fs.existsSync(alvo)) {
        return { id, ok: false, cmd, erro: `GGUF não encontrado: "${alvo || '(vazio)'}" — coloque qualquer *.gguf em recursos-ia/modelo/` }
      }
      // 06-08: contêiner cifrado (`assets/aux.dat`) descriptografa EM MEMÓRIA
      // via `modelo-seguro.cjs` — nunca em disco. O `node-llama-cpp` v3 carrega
      // por PATH, então a carga a partir do Buffer é pendência UAT documentada
      // (docs/seguranca-ia.md §5); falha CONTROLADA, sem crash e sem fallback
      // silencioso para plaintext em disco.
      if (modeloSeguro && modeloSeguro.estaCifrado(alvo)) {
        if (!modeloSeguro.temChaveDisponivel()) {
          return { id, ok: false, cmd, erro: 'modelo cifrado (aux.dat) sem chave: defina AURUM_IA_KEY_HEX (dev/build) ou safeStorage (prod). Ver docs/seguranca-ia.md §4.' }
        }
        try {
          const { bytes } = await modeloSeguro.lerModeloSeguro({ caminho: alvo })
          void bytes
          return { id, ok: false, cmd, erro: 'modelo cifrado íntegro em memória (UAT-06-08: concluir carga via buffer com node-llama-cpp real).' }
        } catch (e) {
          return { id, ok: false, cmd, erro: `falha ao descriptografar modelo: ${e && e.message ? e.message : e}` }
        }
      }
      let llamaModulo
      try {
        // ESM-only (v3): `require()` falha; `import()` dinâmico funciona.
        llamaModulo = await import('node-llama-cpp')
      } catch (e) {
        return { id, ok: false, cmd, erro: `node-llama-cpp indisponível no worker: ${e && e.message ? e.message : e}` }
      }
      try {
        const llama = await llamaModulo.getLlama()
        const model = await llama.loadModel({ modelPath: alvo })
        // Contexto pelo PERFIL (modelo agnóstico): `modelo.json` pode
        // ajustar; o padrão equilibra RAM/latência em CPU.
        const perfilInit = carregarPerfilPara(alvo)
        const ctxSize = Math.max(512, Math.min(131072, Number(perfilInit.contextSize) || 4096))
        const context = await model.createContext({ contextSize: ctxSize })
        const sequence = context.getSequence()
        const { LlamaCompletion } = llamaModulo
        const completion = new LlamaCompletion({ contextSequence: sequence })
        modelo = { mock: false, llama, llamaModulo, model, context, sequence, completion, modelPath: alvo }
        return { id, ok: true, cmd, mock: false, msLoad: agoraMs() - tIni, ramMB: ramMB(), transporte: canalTipo, perfil: perfilInit }
      } catch (e) {
        return { id, ok: false, cmd, erro: `falha ao carregar GGUF: ${e && e.message ? e.message : e}` }
      }
    }

    if (cmd === 'buscar') {
      const k = Number(msg.k) > 0 ? Number(msg.k) : 15
      const ind = carregarIndice()
      // EN→PT em tempo real: consulta em inglês busca também em PT oficial.
      const consultaPT = traduzirParaPT(String(msg.consulta ?? ''))
      const efetiva = consultaPT && normalizarChave(consultaPT) !== normalizarChave(String(msg.consulta ?? ''))
        ? `${msg.consulta} ${consultaPT}`
        : String(msg.consulta ?? '')
      const resultados = enriquecer(buscarIndice(ind, efetiva, k))
      return { id, ok: true, cmd, candidatos: resultados, total: ind.totalDocs ?? ind.docs.length, ms: agoraMs() - tIni }
    }

    // Comando `traduzir` removido: modelo multilíngue nativo, sem camada de
    // tradução no app. Os mapas internos (traduzirParaPT/EN) seguem em uso
    // apenas na recuperação lexical do índice PT (buscar + gate de sanidade).

    if (cmd === 'selecionar') {
      if (!modelo) return { id, ok: false, cmd, erro: 'modelo não inicializado (envie init)' }
      const sel = modelo.mock
        ? selecionarMock(msg.descricao, msg.candidatos)
        : await selecionarReal(msg.descricao, msg.candidatos)
      return { id, ok: true, cmd, mock: modelo.mock === true, ...sel, ms: agoraMs() - tIni, ramMB: ramMB() }
    }

    if (cmd === 'classificar') {
      if (!modelo) return { id, ok: false, cmd, erro: 'modelo não inicializado (envie init)' }
      let candidatos = Array.isArray(msg.candidatos) ? msg.candidatos : []
      if (!candidatos.length) {
        const ind = carregarIndice()
        candidatos = enriquecer(buscarIndice(ind, String(msg.descricao ?? ''), 15))
      }
      const sel = modelo.mock
        ? selecionarMock(msg.descricao, candidatos)
        : await selecionarReal(msg.descricao, candidatos)
      return {
        id, ok: true, cmd,
        mock: modelo.mock === true,
        codigo: sel.codigo, confianca: sel.confianca, motivo: sel.motivo,
        ...(sel.saidaBruta ? { saidaBruta: sel.saidaBruta } : {}),
        candidatos, ms: agoraMs() - tIni, ramMB: ramMB(),
      }
    }

    if (cmd === 'conversar') {
      if (!modelo) return { id, ok: false, cmd, erro: 'modelo não inicializado (envie init)' }
      if (modelo.mock) return { id, ok: false, cmd, mock: true, erro: 'conversa livre exige modelo real (mock não verbaliza)' }
      const r = await conversarReal(msg.sistema, msg.historico, msg.pergunta, { think: msg.think === true, maxTokens: msg.maxTokens, temperature: msg.temperature })
      if (!r.texto) return { id, ok: false, cmd, mock: false, erro: r.motivo || 'resposta vazia' }
      return { id, ok: true, cmd, mock: false, texto: r.texto, motivo: r.motivo, ms: agoraMs() - tIni, ramMB: ramMB() }
    }

    if (cmd === 'encerrar') {
      const resposta = { id, ok: true, cmd, ramMB: ramMB() }
      if (modelo && !modelo.mock) {
        try {
          if (modelo.completion && typeof modelo.completion.dispose === 'function') await modelo.completion.dispose()
          else if (modelo.session && typeof modelo.session.dispose === 'function') await modelo.session.dispose()
          if (modelo.context && typeof modelo.context.dispose === 'function') await modelo.context.dispose()
          else if (modelo.model && typeof modelo.model.dispose === 'function') await modelo.model.dispose()
        } catch (_) {
          // dispose best-effort; o main faz kill de segurança.
        }
      }
      modelo = null
      indice = null
      mapaDescricoes = null
      perfilAtivo = null
      return resposta
    }

    return { id: id ?? null, ok: false, cmd: cmd ?? null, erro: `comando desconhecido: "${cmd}"` }
  } catch (e) {
    return { id: id ?? null, ok: false, cmd: cmd ?? null, erro: String((e && e.message) || e) }
  }
}

const { tipo: canalTipo, enviar, ouvir } = canal()

ouvir((msg) => {
  void tratar(msg).then((res) => {
    enviar(res)
    if (msg && msg.cmd === 'encerrar') {
      // Dá vazão ao ack antes de sair; o main também faz kill de segurança.
      setTimeout(() => process.exit(0), 50)
    }
  })
})

// Pronto: informa o boot (útil para medir tempo de spawn→pronto).
enviar({ id: null, ok: true, cmd: 'pronto', pid: process.pid, transporte: canalTipo, ramMB: ramMB() })
