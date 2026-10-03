/**
 * gerar-indice-ia.mjs — Índice RAG NCM (Phase 6 / 06-03 / IA-03)
 * ============================================================================
 * Lê `recursos-ia/dados-brutos/ncm-para-ia.json` (campo `descricaoExpandida` /
 * campos estruturados) e gera o índice de busca semântica em
 * `recursos-ia/indice-ncm/`.
 *
 * MODO VETORIAL (alvo, exige rede uma vez):
 *   `npm i @xenova/transformers vectra` + download do modelo
 *   `all-MiniLM-L6-v2` (fallback `multilingual-e5-small`) em
 *   `recursos-ia/embedding/`. Embeddings das descrições expandidas → Vectra.
 *   → NÃO TESTADO OFFLINE. Validar com rede na 06-05 antes de usar.
 *
 * MODO LEXICAL (fallback funcional, 100% offline, sem dependências novas):
 *   TF-IDF/BM25-lite em JSON puro (`indice-lexical.json`): tokens normalizados
 *   (minúsculas, sem diacríticos, singular aproximado), stopwords PT, pesos por
 *   campo (nomenclatura ×3 > capítulo ×2 > descrição do vínculo ×1 >
 *   descrição cClassTrib ×0.5) e tabela mínima de sinônimos comerciais
 *   (`frango→galo/galinha/...`, `notebook→processamento/dados/portátil/...`,
 *   `arroz→polido/brunido/...`) — necessária porque a base 06-02 usa texto
 *   tributário boilerplate e NÃO contém os literais "frango"/"notebook".
 *   Suficiente para não bloquear a 06-05 (worker RAG real); a troca pelo
 *   Vectra real é só regenerar o índice quando houver rede (mesma interface
 *   `buscarIndice()` / mesmos asserts em `testar-indice-ia.mjs`).
 *
 * Uso:
 *   node scripts/gerar-indice-ia.mjs            # gera (tenta vetorial, cai p/ lexical)
 *   node scripts/gerar-indice-ia.mjs --lexical  # força fallback lexical
 *
 * Exporta (reuso em `testar-indice-ia.mjs`, worker 06-05 e `build-base.mjs`):
 *   tokenizar, expandirConsulta, construirIndiceLexical, buscarIndice,
 *   carregarIndice, calcularHashManifest
 *
 * Puro Node ESM, sem dependências novas no modo lexical.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_IA_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json');
const INDICE_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'indice-ncm');
const LEXICAL_FILE = path.join(INDICE_DIR, 'indice-lexical.json');
const HASH_FILE = path.join(INDICE_DIR, '.manifest-hash');

export const MODELO_ALVO = 'Xenova/all-MiniLM-L6-v2';
export const MODELO_FALLBACK = 'Xenova/multilingual-e5-small';

// ---------------------------------------------------------------------------
// Normalização / tokenização PT (sem dependências)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  ('de,da,do,das,dos,e,em,para,com,por,que,os,as,o,a,um,uma,uns,umas,ao,aos,' +
    'na,no,nas,nos,se,ou,como,mais,menos,sem,sob,sobre,entre,ate,apenas,' +
    'muito,este,esta,estes,estas,esse,essa,isso,isto,aqueles,ser,sao,foi,' +
    'foram,tem,ha,cada,qual,quais,quando,onde,pelo,pela,pelos,pelas,num,' +
    'numa,dum,ii,iii,iv,vi,vii,viii,ix,xi,xii,xiii,xiv,xv,i,etc,ex')
    .split(','),
);

/** minúsculas + remove diacríticos. */
export function normalizar(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** singular aproximado: remove 's' final (len>3). Mesma regra nos dois lados. */
export function stem(token) {
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

export function tokenizar(texto) {
  const limpo = normalizar(texto).replace(/<[^>]*>/g, ' '); // remove <i>..</i> da nomenclatura
  return limpo
    .replace(/[^a-z0-9/.-]+/g, ' ')
    .split(' ')
    .map((t) => t.replace(/^[/.-]+|[/.-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}

// ---------------------------------------------------------------------------
// Sinônimos comerciais (base de conhecimento v1 — comum + incomum)
// ---------------------------------------------------------------------------
// Motivo: a base 06-02 descreve vínculos em linguagem tributária; o usuário
// consulta em linguagem comercial ("frango", "notebook", "arroz branco").
// Grupos bidirecionais: qualquer membro expande para os demais.
// v2: grupos originais + conhecimento curado em `recursos-ia/conhecimento/`
// (sinonimos.json, marcas-siglas.json, erros-comuns.json). O conhecimento só
// EXPANDE a consulta — a prova continua sendo o match + resolvedor oficial.

const GRUPOS_SINONIMOS_BASE = [
  ['frango', 'frangos', 'galo', 'galos', 'galinha', 'galinhas', 'ave', 'aves',
    'peru', 'perus', 'perua', 'peruas', 'pato', 'patos', 'ganso', 'gansos', 'galinaceo'],
  ['notebook', 'laptop', 'microcomputador', 'portatil', 'portateis',
    'computador', 'computadores', 'processamento', 'dados', 'informatica',
    'automatica', 'automaticas', 'automatico', 'automaticos', 'maquina', 'maquinas'],
  ['arroz', 'polido', 'polidos', 'brunido', 'brunidos', 'branco', 'brancos',
    'integral', 'trinca', 'cereais', 'cereal'],
  ['celular', 'smartphone', 'telefone', 'telefones', 'telefonico'],
  // Eletrônicos / marcas / vestuário / alimentos (oficial ↔ comercial).
  ['alexa', 'echo', 'alto-falante', 'altifalante', 'soundbar', 'caixa-de-som'],
  ['kindle', 'ereader', 'leitor', 'leitores'],
  ['smartwatch', 'relogio', 'relogios'],
  ['drone', 'aeronave', 'aeronaves'],
  ['webcam', 'camera', 'cameras', 'gopro'],
  ['videogame', 'console', 'consoles', 'playstation', 'xbox', 'nintendo'],
  ['headset', 'headphone', 'fone', 'fones', 'airpods'],
  ['whey', 'creatina', 'suplemento', 'suplementos', 'suplementos-alimentares'],
  ['tapioca', 'polvilho', 'fecula', 'feculas'],
  ['cropped', 'blusa', 'blusas', 'babylook', 'regata'],
  ['legging', 'calca', 'calcas'],
  ['moletom', 'sueter', 'sueteres'],
  ['jaqueta', 'casaco', 'casacos', 'sobretudo'],
  ['pijama', 'pijamas', 'roupao'],
  ['biquini', 'sunga', 'banho', 'maiô'],
  ['gin', 'rum', 'tequila', 'aguardente', 'licor', 'licores'],
  ['espumante', 'vinho', 'vinhos'],
  ['energetico', 'isotonico', 'bebida', 'bebidas'],
  ['doce', 'bala', 'confeitaria', 'chiclete', 'goma'],
  ['aspirador', 'aspiradores', 'liquidificador', 'batedeira', 'cafeteira'],
  ['furadeira', 'furar', 'parafusadeira', 'parafuso', 'parafusos', 'ferramenta', 'ferramentas'],
  ['freio', 'freios', 'pastilha', 'pastilhas', 'amortecedor'],
  ['samsung', 'motorola', 'xiaomi', 'telefone', 'smartphone'],
  ['nescau', 'cacau', 'danone', 'iogurte', 'nestle', 'chocolate'],
  ['nike', 'adidas', 'calcado', 'tenis'],
  ['tv', 'televisao', 'smartv', 'sony', 'philips'],
  ['pc', 'computador', 'notebook'],
  // 33+ novos segmentos: autopeças / metal / têxtil / construção / casa.
  ['farol', 'farois', 'retrovisor', 'amortecedor', 'bateria', 'acumuladores', 'filtro', 'filtrar', 'correia', 'pneu', 'pneumatico', 'freio', 'pastilha', 'pastilhas'],
  ['parafuso', 'parafusos', 'porca', 'porcas', 'arruela', 'arruelas', 'fixacao'],
  ['tubo', 'tubos', 'cano', 'vergalhao', 'nervura', 'arame', 'arames', 'aco', 'ferro'],
  ['barra', 'barras', 'perfil', 'perfis', 'aluminio'],
  ['tecido', 'tecidos', 'malha', 'fio', 'fios', 'algodao', 'tricoline', 'denim', 'indigo', 'tafetá', 'tafeta'],
  ['toalha', 'atoalhado', 'lencol', 'cama', 'vestido', 'calca', 'brim'],
  ['tijolo', 'tijolos', 'cimento', 'tinta', 'tintas', 'construcao'],
  ['martelo', 'marreta', 'alicate', 'alicates', 'serra', 'serras', 'serrote', 'chave', 'chaves', 'ferramenta', 'furar', 'parafuso'],
  ['panela', 'panelas', 'cozinha', 'pressao', 'colchao', 'colchoes', 'mesa', 'mesas', 'cadeira', 'assento', 'moveis'],
  ['shampoo', 'xampus', 'sabonete', 'sabao', 'saboes', 'toucador'],
  ['lapis', 'caderno', 'cadernos', 'mochila', 'mochilas', 'caneta', 'papelaria'],
  ['sapato', 'sapatos', 'calcado', 'tenis'],
  // Expansão máxima v2: químicos / farma / plásticos / madeira-papel /
  // máquinas / instrumentos (oficial ↔ comercial). Mesmos grupos no worker.
  ['acido', 'acidos', 'sulfurico', 'cloridrico', 'nitrico', 'sulfato', 'cloreto', 'nitrato', 'fosfato', 'carbonato', 'hidroxido', 'oxido', 'amonio', 'potassio', 'magnesio'],
  ['metanol', 'etanol', 'alcool', 'glicerina', 'acetona', 'benzeno', 'ureia', 'etileno', 'propileno', 'acetato', 'eter', 'cetona', 'ester'],
  ['comprimido', 'capsula', 'drajea', 'xarope', 'vacina', 'pomada', 'antibiotico', 'analgesico', 'dipirona', 'paracetamol', 'amoxicilina', 'vitamina', 'suplemento', 'medicamento', 'farmaco'],
  ['fertilizante', 'adubo', 'npk', 'fosfatado', 'nitrogenado', 'herbicida', 'inseticida', 'fungicida', 'pesticida', 'glifosato', 'defensivo'],
  ['tinta', 'verniz', 'pigmento', 'corante', 'solvente', 'resina', 'esmalte'],
  ['plastico', 'polietileno', 'pvc', 'acrilico', 'silicone', 'isopor', 'embalagem', 'mangueira', 'borracha', 'latex'],
  ['madeira', 'tabua', 'compensado', 'laminado', 'palete', 'lenha', 'carvao', 'cortica', 'papel', 'papelao', 'cartolina', 'etiqueta'],
  ['torno', 'fresa', 'prensa', 'esmeril', 'motoserra', 'caldeira', 'gerador', 'transformador', 'compressor', 'elevador', 'maquina', 'motor', 'bomba', 'valvula', 'rolamento', 'engrenagem'],
  ['oculos', 'lente', 'armacao', 'termometro', 'microscopio', 'relogio', 'bussola', 'ortese', 'protese', 'ultrassom', 'tomografo'],
  ['trator', 'colheitadeira', 'empilhadeira', 'reboque', 'locomotiva', 'vagao', 'barco', 'aviao', 'helicoptero', 'veiculo'],
  ['poltrona', 'puff', 'comoda', 'beliche', 'pelucia', 'patinete', 'skate', 'patins', 'piscina', 'brinquedo', 'jogo', 'bola'],
  ['alcatra', 'maminha', 'cupim', 'fraldinha', 'contrafile', 'carne', 'figado', 'coracao', 'mocoto', 'rabada'],
  ['camarao', 'lula', 'polvo', 'mexilhao', 'ostra', 'lagosta', 'caranguejo', 'merluza', 'peixe'],
  ['damasco', 'tamara', 'carambola', 'jabuticaba', 'acerola', 'graviola', 'pitaya', 'kiwi', 'nectarina', 'framboesa', 'mirtilo', 'fruta'],
  ['pepino', 'quiabo', 'abobora', 'berinjela', 'chuchu', 'ervilha', 'lentilha', 'palmito', 'brocolis', 'espinafre', 'legume', 'verdura'],
  ['mascavo', 'demerara', 'edulcorante', 'adocante', 'ketchup', 'mostarda', 'maionese', 'shoyu', 'dende', 'molho', 'tempero'],
  ['chope', 'sidra', 'sake', 'conhaque', 'brandy', 'rum', 'vodka', 'tequila', 'licor', 'bebida'],
  ['dell', 'hp', 'lenovo', 'asus', 'acer', 'computador', 'notebook'],
  ['fiat', 'volkswagen', 'ford', 'chevrolet', 'toyota', 'veiculo'],
  ['honda', 'yamaha', 'motocicleta', 'moto'],
  ['sadia', 'seara', 'perdigao', 'carne'],
  ['italac', 'piracanjuba', 'elege', 'leite'],
];

/**
 * Carrega o conhecimento curado (`recursos-ia/conhecimento/*.json`) e converte
 * em grupos extras: cada par `termo → expansão` vira grupo bidirecional
 * `[termo, expansao]` + correções de typo `[errado, certo]`.
 * Best-effort: sem os JSONs, usa só a base embutida acima.
 */
function carregarGruposConhecimento() {
  const extras = [];
  try {
    const dir = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento');
    const ler = (f) => {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    };
    const sin = ler('sinonimos.json');
    if (sin?.sinonimos) {
      for (const [k, v] of Object.entries(sin.sinonimos)) {
        if (k && v && k !== v) extras.push([k, v]);
      }
    }
    const marcas = ler('marcas-siglas.json');
    if (Array.isArray(marcas?.entradas)) {
      for (const e of marcas.entradas) {
        if (e?.termo && e?.expansao) {
          const termos = String(e.expansao).split(' ').filter(Boolean);
          extras.push([String(e.termo), ...termos]);
        }
      }
    }
    const erros = ler('erros-comuns.json');
    if (erros?.correcoes) {
      for (const [err, certo] of Object.entries(erros.correcoes)) {
        if (err && certo && err !== certo) extras.push([err, certo]);
      }
    }
  } catch {
    /* conhecimento ausente/corrompido: segue com a base embutida */
  }
  return extras;
}

const GRUPOS_SINONIMOS = [...GRUPOS_SINONIMOS_BASE, ...carregarGruposConhecimento()];

const SINONIMOS = new Map(); // token stemizado -> [variantes stemizadas]
for (const grupo of GRUPOS_SINONIMOS) {
  const stems = [...new Set(grupo.map((t) => stem(normalizar(t))))];
  for (const s of stems) {
    const prev = SINONIMOS.get(s) ?? [];
    SINONIMOS.set(s, [...new Set([...prev, ...stems.filter((x) => x !== s)])]);
  }
}

/** Expande termos da consulta: [{ token, peso }] (original 1.0, sinônimo 0.85, 2º salto 0.7). */
export function expandirConsulta(termos) {
  const out = [];
  const vistos = new Set();
  const fila = [];
  for (const t of termos) {
    if (!vistos.has(t)) { vistos.add(t); out.push({ token: t, peso: 1 }); fila.push({ t, nivel: 0 }); }
  }
  // BFS até 2 saltos: `notbook → computador → processamento/dados`.
  while (fila.length) {
    const { t, nivel } = fila.shift();
    if (nivel >= 2) continue;
    const peso = nivel === 0 ? 0.85 : 0.7;
    for (const s of SINONIMOS.get(t) ?? []) {
      if (!vistos.has(s)) { vistos.add(s); out.push({ token: s, peso }); fila.push({ t: s, nivel: nivel + 1 }); }
    }
  }
  return out;
}

// Pesos por campo: dicionário (conhecimento curado) > nomenclatura > capítulo > vínculo > cClassTrib.
const PESO_DICIONARIO = 4;
const PESO_NOMENCLATURA = 3;
const PESO_CAPITULO = 2;
const PESO_DESCRICAO = 1;
const PESO_CCT = 0.5;

/** Mapa NCM → termos comerciais do dicionário (só leitura; nunca altera a base oficial). */
function carregarMapaDicionario() {
  try {
    const p = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'dicionario.json');
    if (!fs.existsSync(p)) return new Map();
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const mapa = new Map();
    for (const pin of j.pins ?? []) {
      const cod = String(pin.ncm ?? '').replace(/\D+/g, '');
      if (!/^\d{8}$/.test(cod)) continue;
      const prev = mapa.get(cod) ?? [];
      mapa.set(cod, [...prev, ...((pin.termos ?? []).map((t) => String(t)))]);
    }
    return mapa;
  } catch {
    return new Map();
  }
}

function acumular(tf, texto, peso) {
  for (const t of tokenizar(texto)) tf[t] = (tf[t] ?? 0) + peso;
}

export function construirIndiceLexical(itens) {
  const mapaDict = carregarMapaDicionario();
  const docs = itens.map((item) => {
    const tf = {};
    acumular(tf, item.nomenclatura, PESO_NOMENCLATURA);
    acumular(tf, item.capitulo?.descricao, PESO_CAPITULO);
    acumular(tf, item.descricao, PESO_DESCRICAO);
    acumular(tf, item.descricaoCClassTrib, PESO_CCT);
    // Conhecimento curado indexado junto (nome popular vira sinal forte,
    // mas a decisão final continua sendo do resolvedor oficial).
    const termosDict = mapaDict.get(String(item.codigo).replace(/\D+/g, ''));
    if (termosDict?.length) acumular(tf, termosDict.join(' '), PESO_DICIONARIO);
    return { codigo: item.codigo, capitulo: item.capitulo?.codigo ?? '', tf };
  });

  const N = docs.length;
  const df = {};
  for (const doc of docs) for (const t of Object.keys(doc.tf)) df[t] = (df[t] ?? 0) + 1;
  const idf = {};
  for (const [t, f] of Object.entries(df)) idf[t] = Math.log((N - f + 0.5) / (f + 0.5)) + 1;

  return {
    tipo: 'lexical-v2',
    geradoEm: new Date().toISOString(),
    totalDocs: N,
    modeloAlvo: MODELO_ALVO,
    motivoFallback: 'offline: @xenova/transformers/vectra indisponíveis; trocar pelo índice vetorial quando houver rede (ver cabeçalho).',
    conhecimento: 'conhecimento-v1 (sinonimos+dicionario+marcas+erros)',
    idf,
    docs,
  };
}

/** BM25-lite: Σ peso·idf·tf/(tf+1.2). Ordena por score desc, desempate por código. */
export function buscarIndice(indice, consulta, k = 5) {
  const termos = expandirConsulta(tokenizar(consulta));
  const res = [];
  for (const doc of indice.docs) {
    let s = 0;
    for (const { token, peso } of termos) {
      const tf = doc.tf[token];
      if (tf) s += peso * (indice.idf[token] ?? 1) * (tf / (tf + 1.2));
    }
    if (s > 0) res.push({ codigo: doc.codigo, capitulo: doc.capitulo, score: s });
  }
  res.sort((a, b) => b.score - a.score || a.codigo.localeCompare(b.codigo));
  return res.slice(0, k);
}

export function carregarIndice(caminho = LEXICAL_FILE) {
  if (!fs.existsSync(caminho)) {
    throw new Error(`índice lexical ausente: ${caminho} (rode scripts/gerar-indice-ia.mjs)`);
  }
  return JSON.parse(fs.readFileSync(caminho, 'utf8'));
}

/**
 * Hash semântico da base: conteúdo dos 3 artefatos (exceto `meta.geradoEm`,
 * que muda a cada build) + `estatisticas`/`codigosIgnorados` do MANIFEST.
 * Estável entre builds → o gatilho de rebuild só dispara quando o conteúdo
 * tributário realmente mudou. (Descoberto em 06-03: `geradoEm` está
 * embutido em cada artefato, então o sha256 dos arquivos NUNCA estabiliza.)
 */
export function calcularHashManifest(baseDir = path.join(PROJECT_ROOT, 'public', 'base')) {
  const h = createHash('sha256');
  for (const f of ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json']) {
    const p = path.join(baseDir, f);
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j.meta) delete j.meta.geradoEm;
    h.update(JSON.stringify(j), 'utf8');
  }
  const mp = path.join(baseDir, 'MANIFEST.json');
  if (!fs.existsSync(mp)) return null;
  const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  h.update(JSON.stringify(m.estatisticas ?? null), 'utf8');
  h.update(JSON.stringify(m.codigosIgnorados ?? null), 'utf8');
  // Conhecimento curado entra no hash: mudou sinônimo/dicionário → rebuild.
  try {
    const dirCon = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento');
    for (const f of ['sinonimos.json', 'dicionario.json', 'marcas-siglas.json', 'erros-comuns.json', 'frases-modelo.json', 'pesos.json']) {
      const p = path.join(dirCon, f);
      if (fs.existsSync(p)) h.update(fs.readFileSync(p, 'utf8'), 'utf8');
    }
  } catch {
    /* sem conhecimento: hash só da base oficial */
  }
  return h.digest('hex');
}

/** Hash só do conhecimento (para auditoria do índice v2). */
export function calcularHashConhecimento() {
  try {
    const h = createHash('sha256');
    const dirCon = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento');
    for (const f of ['sinonimos.json', 'dicionario.json', 'marcas-siglas.json', 'erros-comuns.json', 'frases-modelo.json', 'pesos.json']) {
      const p = path.join(dirCon, f);
      if (fs.existsSync(p)) h.update(fs.readFileSync(p, 'utf8'), 'utf8');
    }
    return h.digest('hex').slice(0, 16);
  } catch {
    return 'sem-conhecimento';
  }
}

// ---------------------------------------------------------------------------
// Caminho vetorial (ALVO — exige rede + deps; NÃO TESTADO offline)
// ---------------------------------------------------------------------------

async function tentarIndiceVetorial(itens) {
  // Lança se @xenova/transformers ou vectra não instalados / sem rede p/ modelo.
  const { pipeline } = await import('@xenova/transformers');
  const { LocalIndex } = await import('vectra');

  const extrator = await pipeline('feature-extraction', MODELO_ALVO);
  const index = new LocalIndex(INDICE_DIR);
  if (!(await index.isIndexCreated())) await index.createIndex();

  let n = 0;
  for (const item of itens) {
    const texto = item.descricaoExpandida || item.descricao || '';
    const emb = await extrator(texto, { pooling: 'mean', normalize: true });
    await index.insertItem({
      vector: Array.from(emb.data),
      metadata: { codigo: item.codigo, capitulo: item.capitulo?.codigo ?? '' },
    });
    if (++n % 500 === 0) console.log(`  … ${n}/${itens.length} embeddings`);
  }
  return { tipo: 'vetorial', totalDocs: itens.length, modelo: MODELO_ALVO };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const forcarLexical = process.argv.includes('--lexical');
  console.log(' Aurum Tax NCM — geração do índice IA (06-03 / IA-03)');

  if (!fs.existsSync(BASE_IA_FILE)) {
    console.error(`✖ Base IA ausente: ${BASE_IA_FILE} (rode scripts/preparar-dados-ia.mjs — 06-02)`);
    process.exit(1);
  }
  const { meta, itens } = JSON.parse(fs.readFileSync(BASE_IA_FILE, 'utf8'));
  console.log(`   base: ${itens.length} vínculos NCM (meta: ${meta.totalCodigosDistintos} códigos distintos)`);

  fs.mkdirSync(INDICE_DIR, { recursive: true });

  if (!forcarLexical) {
    try {
      const r = await tentarIndiceVetorial(itens);
      console.log(`✔ Índice vetorial Vectra gerado (${r.totalDocs} docs, ${r.modelo})`);
    } catch (err) {
      console.log(`   caminho vetorial indisponível (${err.message?.split('\n')[0]}); usando fallback lexical.`);
    }
  }

  const precisaLexical = forcarLexical || !fs.existsSync(path.join(INDICE_DIR, 'index.json'));
  if (precisaLexical) {
    const indice = construirIndiceLexical(itens);
    indice.hashConhecimento = calcularHashConhecimento();
    fs.writeFileSync(LEXICAL_FILE, Buffer.from(JSON.stringify(indice), 'utf8'));
    const bytes = fs.statSync(LEXICAL_FILE).size;
    console.log(`✔ Índice lexical v2 gerado: ${LEXICAL_FILE}`);
    console.log(`   docs: ${indice.totalDocs} · vocabulário: ${Object.keys(indice.idf).length} tokens · ${(bytes / 1024).toFixed(0)} KB · conhecimento: ${indice.hashConhecimento}`);
    // Single-source para o worker: grupos de sinônimos em JSON (o worker CJS
    // lê este arquivo e elimina a duplicação dos 4 grupos legados).
    try {
      const gruposExport = GRUPOS_SINONIMOS.map((g) => [...new Set(g.map((t) => normalizar(t)))]);
      fs.writeFileSync(
        path.join(INDICE_DIR, 'sinonimos-gerados.json'),
        Buffer.from(JSON.stringify({ versao: 'conhecimento-v1', grupos: gruposExport }, null, 1), 'utf8'),
      );
      console.log('   sinonimos-gerados.json atualizado (single-source p/ ia-worker.cjs).');
    } catch (e) {
      console.log(`   aviso: não foi possível exportar sinonimos-gerados.json (${e.message})`);
    }
  }

  const hash = calcularHashManifest();
  if (hash) {
    fs.writeFileSync(HASH_FILE, hash + '\n');
    console.log('   .manifest-hash atualizado (gatilho p/ build-base.mjs).');
  } else {
    console.log('   MANIFEST.json ausente — .manifest-hash não atualizado.');
  }
}

const ehMain = process.argv[1]?.endsWith('gerar-indice-ia.mjs');
if (ehMain) {
  main().catch((err) => {
    console.error('✖ Falha na geração do índice:', err.message);
    process.exit(1);
  });
}
