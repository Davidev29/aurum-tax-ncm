/**
 * build-grafo.mjs — Phase 10-01 (GRAFO-01).
 *
 * Gera o grafo fiscal local versionado a partir de `public/base/*.json` +
 * `recursos-ia/conhecimento/*`:
 *   - CSVs temporários em `scripts/grafo/.tmp/` (um por tabela do
 *     `scripts/grafo/schema.cypher` — serve ao LadybugDB `COPY` e ao KGLite);
 *   - `public/base/grafo/grafo.lbug` (nativo LadybugDB quando
 *     `@ladybugdb/core` está instalado; senão, o JSON portátil com os mesmos
 *     bytes — o runtime lê igual);
 *   - `public/base/grafo/grafo.lbug.json` (portátil, sempre);
 *   - `public/base/grafo/MANIFEST.grafo.json` (versão, hash, contadores).
 *
 * Regras duras:
 *   - NUNCA falha o build: sem base → aviso + grafo vazio versionado, exit 0.
 *   - Rebuild só quando o hash semântico da base muda (mesmo
 *     `calcularHashManifest` do gatilho 06-03, que já inclui o conhecimento).
 *   - Resolvedor é a única verdade: o grafo é índice derivado (nós + arestas
 *     com proveniência), nunca precifica.
 *
 * Núcleo puro e testável (`tests/grafo-base.test.ts` importa daqui):
 *   dedupePorChave, ehRevogadoNomenclatura, comProveniencia, construirGrafo,
 *   hashGrafo, calcularHashBaseAtual, buildGrafo.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(PROJECT_ROOT, 'public', 'base');
const CONHECIMENTO_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento');
const OUT_DIR = path.join(BASE_DIR, 'grafo');
const TMP_DIR = path.join(__dirname, 'grafo', '.tmp');

/** Versão do schema do grafo (espelha `scripts/grafo/schema.cypher`). */
export const GRAFO_VERSAO = 'grafo-v1';
/** Ano de referência das arestas fiscais (base LC 214/2025). */
export const ANO_REFERENCIA = 2026;
/** Origens permitidas em TODA aresta (fail-closed: fora disso é rejeitada). */
export const ORIGENS = ['por_codigo', 'triangulado', 'heranca', 'curadoria', 'uso_local'];
/** Teto determinístico de arestas Termo→NCM por radical (ver construirGrafo). */
export const MAX_SINONIMO_POR_TERMO = 8;

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

/** Dedupe determinístico preservando a primeira ocorrência. */
export function dedupePorChave(lista, chaveFn) {
  const vistos = new Set();
  const unicos = [];
  let duplicados = 0;
  for (const item of lista ?? []) {
    if (!item || typeof item !== 'object') continue;
    const chave = chaveFn(item);
    if (vistos.has(chave)) {
      duplicados++;
      continue;
    }
    vistos.add(chave);
    unicos.push(item);
  }
  return { unicos, duplicados };
}

/** Nomenclatura com `dataFim` é revogada/extinta → fora do grafo. */
export function ehRevogadoNomenclatura(item) {
  const fim = item?.dataFim ?? item?.Data_Fim ?? null;
  return fim !== null && fim !== undefined && String(fim).trim() !== '' && String(fim).trim() !== '31/12/9999';
}

const digits = (v) => String(v ?? '').replace(/\D+/g, '');

/** Minúsculas, sem acento — para o match radical→descrição. */
export function normalizarTermo(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Proveniência de aresta. Lança em origem inválida (fail-closed: o build
 * captura e descarta a aresta, nunca grava sem proveniência).
 */
export function comProveniencia(origem, confianca, anoReferencia = ANO_REFERENCIA) {
  if (!ORIGENS.includes(origem)) throw new Error(`origem de aresta inválida: ${origem}`);
  const conf = Number(confianca);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) throw new Error(`confiança inválida: ${confianca}`);
  return { origem, confianca: conf, anoReferencia };
}

/** "1".."15" → "I".."XV" (Anexos da LC 214/2025); outros valores intactos. */
export function normalizarAnexo(nome) {
  const s = String(nome ?? '').trim();
  const romanos = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV', 15: 'XV' };
  if (/^\d{1,2}$/.test(s) && romanos[Number(s)]) return romanos[Number(s)];
  return s.toUpperCase() || s;
}

/** sha256 hexadecimal de string/bytes. */
export function sha256Hex(dados) {
  return createHash('sha256').update(dados).digest('hex');
}

// ---------------------------------------------------------------------------
// Construção do grafo (pura — sem IO)
// ---------------------------------------------------------------------------

/**
 * Entradas (shapes dos artefatos de `public/base/` + conhecimento):
 *   nomenclatura {itens[]}, reforma {ncm[], nbs[]}, referencia {itens[]},
 *   cnae {itens[]}, cnaeNbs {links[]}, conhecimento {sinonimos{}, pins[],
 *   pesoSinonimo, artigos[{numero,titulo,anexo?}] }
 *
 * Saída: { nodos: [{id,tipo,props}], arestas: [{de,para,tipo,...prov}],
 *   relatorio: {duplicados, ignorados} } — arrays ORDENADOS por id
 *   (rebuild idempotente: mesma entrada → mesmos bytes → mesmo hash).
 */
export function construirGrafo(entradas = {}) {
  const nomenclatura = Array.isArray(entradas.nomenclatura?.itens)
    ? entradas.nomenclatura.itens
    : Array.isArray(entradas.nomenclatura)
      ? entradas.nomenclatura
      : [];
  const vincNcm = Array.isArray(entradas.reforma?.ncm) ? entradas.reforma.ncm : [];
  const vincNbs = Array.isArray(entradas.reforma?.nbs) ? entradas.reforma.nbs : [];
  const referencia = Array.isArray(entradas.referencia?.itens)
    ? entradas.referencia.itens
    : Array.isArray(entradas.referencia)
      ? entradas.referencia
      : [];
  const cnaes = Array.isArray(entradas.cnae?.itens) ? entradas.cnae.itens : [];
  const links = Array.isArray(entradas.cnaeNbs?.links) ? entradas.cnaeNbs.links : [];
  const lcNbs = Array.isArray(entradas.cnaeNbs?.lcNbs) ? entradas.cnaeNbs.lcNbs : [];
  const con = entradas.conhecimento ?? {};
  const sinonimos = con.sinonimos && typeof con.sinonimos === 'object' ? con.sinonimos : {};
  const pins = Array.isArray(con.pins) ? con.pins : [];
  const pesoSinonimo = Number.isFinite(Number(con.pesoSinonimo)) ? Number(con.pesoSinonimo) : 0.85;
  const artigos = Array.isArray(con.artigos) ? con.artigos : [];

  const nodos = new Map();
  const arestas = new Map();
  const relatorio = { duplicadosNodos: 0, duplicadosArestas: 0, revogadosFiltrados: 0, arestasSemProveniencia: 0, linksIgnorados: 0 };

  const porNo = (tipo, codigo, props = {}) => {
    const id = `${tipo}:${codigo}`;
    if (nodos.has(id)) {
      relatorio.duplicadosNodos++;
      return null;
    }
    nodos.set(id, { id, tipo, props });
    return id;
  };
  const porAresta = (de, para, tipo, prov, extra = {}) => {
    if (!nodos.has(de) || !nodos.has(para)) return null;
    let provOk;
    try {
      provOk = comProveniencia(prov.origem, prov.confianca, prov.anoReferencia);
    } catch {
      relatorio.arestasSemProveniencia++;
      return null;
    }
    const chave = `${de}|${tipo}|${para}`;
    if (arestas.has(chave)) {
      relatorio.duplicadosArestas++;
      return null;
    }
    arestas.set(chave, { de, para, tipo, ...provOk, ...extra });
    return chave;
  };

  // --- NCM (só vigentes: revogado/extinto é filtrado, nunca vira nó) ---
  const nomenPorCodigo = new Map();
  for (const n of nomenclatura) {
    const cod = digits(n?.codigo ?? n?.ncm ?? '');
    if (cod && !nomenPorCodigo.has(cod)) nomenPorCodigo.set(cod, n);
  }
  const idNcmPorCodigo = new Map();
  for (const n of nomenclatura) {
    const cod = digits(n?.codigo ?? n?.ncm ?? '');
    if (cod.length !== 8) continue;
    if (ehRevogadoNomenclatura(n)) {
      relatorio.revogadosFiltrados++;
      continue;
    }
    if (idNcmPorCodigo.has(cod)) {
      relatorio.duplicadosNodos++;
      continue;
    }
    const id = porNo('NCM', cod, {
      codigo: cod,
      descricao: String(n?.descricao ?? '').trim(),
      vigente: true,
      capitulo: cod.slice(0, 2),
    });
    if (id) idNcmPorCodigo.set(cod, id);
  }

  // --- Hierarquia SH6 → SH4 → Capítulo → Seção (derivada por prefixo) ---
  const descPrefixo = (prefixo) => {
    const n = nomenPorCodigo.get(prefixo);
    return n ? String(n.descricao ?? '').trim() || null : null;
  };
  const hier = new Map();
  for (const cod of idNcmPorCodigo.keys()) {
    const sh6 = cod.slice(0, 6);
    const sh4 = cod.slice(0, 4);
    const cap = cod.slice(0, 2);
    hier.set(`SH6:${sh6}`, { tipo: 'SH6', codigo: sh6, descricao: descPrefixo(sh6) });
    hier.set(`SH4:${sh4}`, { tipo: 'SH4', codigo: sh4, descricao: descPrefixo(sh4) });
    hier.set(`Capitulo:${cap}`, { tipo: 'Capitulo', codigo: cap, descricao: descPrefixo(cap) });
  }
  for (const [chave, h] of hier) {
    const [tipo, codigo] = chave.split(':');
    porNo(tipo, codigo, { codigo, descricao: h.descricao });
  }
  porNo('Secao', 'default', { codigo: 'default', descricao: 'Seção (agrupamento de capítulos — sem seção oficial na base)' });
  for (const cod of idNcmPorCodigo.keys()) {
    porAresta(idNcmPorCodigo.get(cod), `SH6:${cod.slice(0, 6)}`, 'PERTENCE_A', { origem: 'por_codigo', confianca: 1 });
  }
  // Arestas de hierarquia uma vez por par (não por NCM — evita re-tentativas).
  const paresHier = new Set();
  for (const cod of idNcmPorCodigo.keys()) {
    paresHier.add(`SH6:${cod.slice(0, 6)}|SH6_EM|SH4:${cod.slice(0, 4)}`);
    paresHier.add(`SH4:${cod.slice(0, 4)}|SH4_EM|Capitulo:${cod.slice(0, 2)}`);
    paresHier.add(`Capitulo:${cod.slice(0, 2)}|CAP_EM|Secao:default`);
  }
  for (const chave of [...paresHier].sort()) {
    const [de, tipo, para] = chave.split('|');
    porAresta(de, para, tipo, { origem: 'por_codigo', confianca: 1 });
  }

  // --- CCT (referência oficial; dedupe por cClassTrib) ---
  const cctPorCodigo = new Map();
  for (const r of referencia) {
    const raw = digits(r?.cClassTrib ?? '');
    if (!raw) continue;
    const cct = raw.padStart(6, '0').slice(-6);
    if (cctPorCodigo.has(cct)) {
      relatorio.duplicadosNodos++;
      continue;
    }
    const id = porNo('CCT', cct, {
      codigo: cct,
      descricao: String(r?.descricao ?? '').trim(),
      redIBS: r?.pRedIBS ?? null,
      redCBS: r?.pRedCBS ?? null,
    });
    const anexoNorm = normalizarAnexo(r?.anexo ?? '');
    if (id) cctPorCodigo.set(cct, { id, anexo: anexoNorm || null, redIBS: r?.pRedIBS ?? null, redCBS: r?.pRedCBS ?? null });
  }

  // --- Anexo (distintos da referência, nome canônico romano; rótulo oficial) ---
  const anexosVistos = new Set();
  for (const { anexo } of cctPorCodigo.values()) {
    if (!anexo || anexosVistos.has(anexo)) continue;
    anexosVistos.add(anexo);
    porNo('Anexo', anexo, { nome: anexo, rotulo: /^[IVX]+$/.test(anexo) ? `Anexo ${anexo} (LC 214/2025)` : `Anexo ${anexo}` });
  }

  // --- ArtigoLC214 (curadoria lc214-artigos.json) ---
  for (const a of artigos) {
    const numero = String(a?.numero ?? '').trim();
    if (!numero) continue;
    porNo('ArtigoLC214', numero, {
      numero,
      titulo: String(a?.titulo ?? '').trim(),
      anexo: String(a?.anexo ?? '').trim() || null,
    });
  }

  // --- NCM → CCT (vínculos oficiais da reforma) ---
  for (const v of vincNcm) {
    const cod = digits(v?.codigo ?? '');
    const cct = digits(v?.cClassTrib ?? '').padStart(6, '0').slice(-6);
    if (cod.length !== 8 || !cct) continue;
    const de = idNcmPorCodigo.get(cod);
    const alvo = cctPorCodigo.get(cct);
    if (!de || !alvo) continue;
    porAresta(de, alvo.id, 'TEM_CLASSIFICACAO', { origem: 'por_codigo', confianca: 1, anoReferencia: ANO_REFERENCIA });
  }

  // --- NBS (nós por código; vínculos viram arestas NBS → CCT) ---
  // Códigos da ponte (não-oficiais) também viram nós — marcados
  // `oficial:false` com descrição da ponte — para que MAPEIA não perca
  // os links da Phase 9. Sem lastro oficial, o resolvedor os ignora.
  const descPonteNbs = new Map();
  for (const rel of lcNbs) {
    const cod = digits(rel?.nbs ?? rel?.codigo ?? '');
    const d = String(rel?.descricaoNbs ?? '').trim();
    if (cod.length === 9 && d && !descPonteNbs.has(cod)) descPonteNbs.set(cod, d);
  }
  const nbsPonte = new Set();
  for (const l of links) {
    const cod = digits(l?.nbs ?? l?.codigo ?? '');
    if (cod.length === 9) nbsPonte.add(cod);
  }
  const idNbsPorCodigo = new Map();
  const porNoNbs = (cod, descricao, oficial) => {
    if (idNbsPorCodigo.has(cod)) {
      relatorio.duplicadosNodos++;
      return;
    }
    const id = porNo('NBS', cod, { codigo: cod, descricao, oficial, fonteDescricao: oficial ? 'oficial' : 'qualclasstrib' });
    if (id) idNbsPorCodigo.set(cod, id);
  };
  for (const v of vincNbs) {
    const cod = digits(v?.codigo ?? '');
    if (cod.length !== 9) continue;
    porNoNbs(cod, String(v?.descricao ?? '').trim(), true);
  }
  for (const cod of [...nbsPonte].sort()) {
    if (idNbsPorCodigo.has(cod)) continue;
    porNoNbs(cod, descPonteNbs.get(cod) ?? '', false);
  }
  for (const v of vincNbs) {
    const cod = digits(v?.codigo ?? '');
    const cct = digits(v?.cClassTrib ?? '').padStart(6, '0').slice(-6);
    if (cod.length !== 9 || !cct) continue;
    const de = idNbsPorCodigo.get(cod);
    const alvo = cctPorCodigo.get(cct);
    if (!de || !alvo) continue;
    porAresta(de, alvo.id, 'TEM_CLASSIFICACAO_NBS', { origem: 'por_codigo', confianca: 1, anoReferencia: ANO_REFERENCIA });
  }

  // --- CCT → Anexo (reduções oficiais por linha da referência) ---
  for (const [cct, info] of cctPorCodigo) {
    if (!info.anexo || !nodos.has(`Anexo:${info.anexo}`)) continue;
    porAresta(info.id, `Anexo:${info.anexo}`, 'REDUZ_PARA', { origem: 'por_codigo', confianca: 1 }, { redIBS: info.redIBS, redCBS: info.redCBS });
  }

  // --- Anexo → ArtigoLC214 (só quando a curadoria declara o anexo) ---
  for (const a of artigos) {
    const anx = normalizarAnexo(a?.anexo ?? '');
    const numero = String(a?.numero ?? '').trim();
    if (!anx || !numero) continue;
    if (!nodos.has(`Anexo:${anx}`) || !nodos.has(`ArtigoLC214:${numero}`)) continue;
    porAresta(`Anexo:${anx}`, `ArtigoLC214:${numero}`, 'FUNDAMENTA_EM', { origem: 'curadoria', confianca: 0.9 });
  }

  // --- CNAE + MAPEIA → NBS (ponte não-oficial; origem explícita) ---
  const idCnaePorCodigo = new Map();
  for (const c of cnaes) {
    const cod7 = digits(c?.codigo7 ?? c?.codigo ?? '');
    if (cod7.length !== 7 || idCnaePorCodigo.has(cod7)) {
      if (cod7) relatorio.duplicadosNodos++;
      continue;
    }
    const id = porNo('CNAE', cod7, { codigo: cod7, descricao: String(c?.descricao ?? '').trim() });
    if (id) idCnaePorCodigo.set(cod7, id);
  }
  for (const l of links) {
    const cnae7 = digits(l?.cnae7 ?? l?.cnae ?? '');
    const nbs = digits(l?.nbs ?? l?.codigo ?? '');
    if (cnae7.length !== 7 || nbs.length !== 9) {
      relatorio.linksIgnorados++;
      continue;
    }
    const de = idCnaePorCodigo.get(cnae7);
    const para = idNbsPorCodigo.get(nbs);
    if (!de || !para) continue;
    const triangulado = l?.fonte === 'triangulacao' || l?.fonte === 'triangulado';
    porAresta(de, para, 'MAPEIA', {
      origem: triangulado ? 'triangulado' : 'por_codigo',
      confianca: triangulado ? 0.6 : 0.9,
    });
  }

  // --- Termo (FTS seeds: sinônimos + pins do dicionário) ---
  const termosVistos = new Set();
  for (const t of Object.keys(sinonimos)) {
    const nt = normalizarTermo(t);
    if (nt && !termosVistos.has(nt)) {
      termosVistos.add(nt);
      porNo('Termo', nt, { termo: nt });
    }
  }
  for (const p of pins) {
    for (const t of p?.termos ?? []) {
      const nt = normalizarTermo(t);
      if (nt && !termosVistos.has(nt)) {
        termosVistos.add(nt);
        porNo('Termo', nt, { termo: nt });
      }
    }
  }
  // Arestas explícitas dos pins (termo → NCM declarado pela curadoria).
  const paresSinonimo = new Set();
  const porSinonimo = (termoNt, alvo, prov, peso) => {
    const chavePar = `${termoNt}|${alvo}`;
    if (paresSinonimo.has(chavePar)) return;
    paresSinonimo.add(chavePar);
    porAresta(termoNt, alvo, 'SINONIMO_DE', prov, { peso });
  };
  for (const p of pins) {
    const cod = digits(p?.ncm ?? '');
    const alvo = idNcmPorCodigo.get(cod);
    if (!alvo) continue;
    for (const t of p?.termos ?? []) {
      const nt = normalizarTermo(t);
      if (!nt || !nodos.has(`Termo:${nt}`)) continue;
      porSinonimo(`Termo:${nt}`, alvo, { origem: 'curadoria', confianca: pesoSinonimo }, pesoSinonimo);
    }
  }
  // Arestas por radical: sinônimo dia-a-dia cujo canônico aparece na
  // descrição oficial (cap determinístico por termo, ordenado por código).
  const descNcmNorm = new Map();
  for (const [cod, id] of idNcmPorCodigo) {
    const n = nodos.get(id);
    descNcmNorm.set(cod, normalizarTermo(n?.props?.descricao ?? ''));
  }
  const codsOrdenados = [...idNcmPorCodigo.keys()].sort();
  // Termos únicos normalizados (primeiro radical vence — sem re-tentativas).
  const termosUnicos = new Map();
  for (const [termo, canonico] of Object.entries(sinonimos)) {
    const nt = normalizarTermo(termo);
    if (!nt || termosUnicos.has(nt)) continue;
    termosUnicos.set(nt, normalizarTermo(canonico));
  }
  for (const [nt, radical] of termosUnicos) {
    if (!nt || !radical || radical.length < 4) continue;
    if (!nodos.has(`Termo:${nt}`)) continue;
    let criadas = 0;
    for (const cod of codsOrdenados) {
      if (criadas >= MAX_SINONIMO_POR_TERMO) break;
      const alvo = idNcmPorCodigo.get(cod);
      if (paresSinonimo.has(`Termo:${nt}|${alvo}`)) continue;
      if (descNcmNorm.get(cod)?.includes(radical)) {
        const antes = paresSinonimo.size;
        porSinonimo(`Termo:${nt}`, alvo, { origem: 'curadoria', confianca: 0.5 }, 0.5);
        if (paresSinonimo.size > antes) criadas++;
      }
    }
  }

  const nodosArr = [...nodos.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const arestasArr = [...arestas.values()].sort((a, b) => {
    const ka = `${a.de}|${a.tipo}|${a.para}`;
    const kb = `${b.de}|${b.tipo}|${b.para}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { nodos: nodosArr, arestas: arestasArr, relatorio };
}

/** Hash canônico do payload (estável: entradas ordenadas em construirGrafo). */
export function hashGrafo(nodos, arestas) {
  return sha256Hex(JSON.stringify({ nodos: nodos ?? [], arestas: arestas ?? [] }));
}

// ---------------------------------------------------------------------------
// IO: leitura das fontes, CSVs, LadybugDB, artefatos versionados
// ---------------------------------------------------------------------------

function lerJsonSeguro(caminho) {
  try {
    if (!fs.existsSync(caminho)) return null;
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Hash semântico da base (o MESMO do gatilho 06-03, que já inclui o
 * conhecimento curado): mudou qualquer byte tributário → rebuild do grafo.
 * Fallback interno (sem gerar-indice-ia): sha256 dos artefatos sem `geradoEm`.
 */
export async function calcularHashBaseAtual(dirBase = BASE_DIR) {
  try {
    const { calcularHashManifest } = await import('./gerar-indice-ia.mjs');
    const h = calcularHashManifest(dirBase);
    if (h) return h;
  } catch {
    /* cai no fallback abaixo */
  }
  const h = createHash('sha256');
  for (const f of ['classificacao-tributaria.json', 'reforma.json', 'nomenclatura.json', 'cnae.json', 'cnae-nbs.json', 'classificacoes-consolidadas.json']) {
    const p = path.join(dirBase, f);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j?.meta) delete j.meta.geradoEm;
      h.update(JSON.stringify(j), 'utf8');
    } catch {
      /* arquivo ilegível: ignora no fallback */
    }
  }
  return h.digest('hex');
}

function lerEntradas() {
  const nomenclatura = lerJsonSeguro(path.join(BASE_DIR, 'nomenclatura.json'));
  const reforma = lerJsonSeguro(path.join(BASE_DIR, 'reforma.json'));
  const referencia = lerJsonSeguro(path.join(BASE_DIR, 'classificacao-tributaria.json'));
  const cnae = lerJsonSeguro(path.join(BASE_DIR, 'cnae.json'));
  const cnaeNbs = lerJsonSeguro(path.join(BASE_DIR, 'cnae-nbs.json'));
  const sinonimos = lerJsonSeguro(path.join(CONHECIMENTO_DIR, 'sinonimos.json'));
  const dicionario = lerJsonSeguro(path.join(CONHECIMENTO_DIR, 'dicionario.json'));
  const pesos = lerJsonSeguro(path.join(CONHECIMENTO_DIR, 'pesos.json'));
  const lc214 = lerJsonSeguro(path.join(CONHECIMENTO_DIR, 'lc214-artigos.json'));
  const temBase = Boolean(nomenclatura || reforma || referencia);
  return {
    temBase,
    grafo: {
      nomenclatura: nomenclatura ?? { itens: [] },
      reforma: reforma ?? { ncm: [], nbs: [] },
      referencia: referencia ?? { itens: [] },
      cnae: cnae ?? { itens: [] },
      cnaeNbs: cnaeNbs ?? { links: [], lcNbs: [] },
      conhecimento: {
        sinonimos: sinonimos?.sinonimos ?? {},
        pins: dicionario?.pins ?? [],
        pesoSinonimo: pesos?.pesos?.sinonimo ?? 0.85,
        artigos: lc214?.artigos ?? [],
      },
    },
  };
}

const csvCelula = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function escreverCsvs(nodos, arestas) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const porTipo = new Map();
  for (const n of nodos) {
    if (!porTipo.has(n.tipo)) porTipo.set(n.tipo, []);
    porTipo.get(n.tipo).push(n);
  }
  const arquivos = [];
  for (const [tipo, lista] of porTipo) {
    const chaves = [...new Set(lista.flatMap((n) => Object.keys(n.props ?? {})))].sort();
    const linhas = [`id,${chaves.join(',')}`];
    for (const n of lista) linhas.push([n.id, ...chaves.map((k) => csvCelula(n.props?.[k] ?? ''))].join(','));
    const nome = `node-${tipo}.csv`;
    fs.writeFileSync(path.join(TMP_DIR, nome), linhas.join('\n'), 'utf8');
    arquivos.push(nome);
  }
  const porRel = new Map();
  for (const a of arestas) {
    if (!porRel.has(a.tipo)) porRel.set(a.tipo, []);
    porRel.get(a.tipo).push(a);
  }
  for (const [tipo, lista] of porRel) {
    const linhas = ['de,para,origem,confianca,anoReferencia'];
    for (const a of lista) linhas.push([csvCelula(a.de), csvCelula(a.para), csvCelula(a.origem), String(a.confianca), String(a.anoReferencia ?? '')].join(','));
    const nome = `rel-${tipo}.csv`;
    fs.writeFileSync(path.join(TMP_DIR, nome), linhas.join('\n'), 'utf8');
    arquivos.push(nome);
  }
  return arquivos;
}

/**
 * Tenta materializar o `.lbug` nativo via `@ladybugdb/core` (COPY dos CSVs
 * sobre o `schema.cypher`). Qualquer falha (pacote ausente, API divergente,
 * nativo incompatível) devolve `false` — o chamador usa o JSON portátil.
 */
async function tentarNativo(destinoLbug) {
  let mod = null;
  try {
    mod = await import('@ladybugdb/core');
  } catch {
    console.log('   grafo: @ladybugdb/core ausente — usando JSON portátil (runtime lê igual).');
    return false;
  }
  try {
    const Database = mod.Database ?? mod.default?.Database ?? mod.default;
    if (typeof Database !== 'function') throw new Error('API sem Database');
    if (fs.existsSync(destinoLbug)) fs.rmSync(destinoLbug, { recursive: true, force: true });
    const db = new Database(destinoLbug);
    const ConnCtor = db.Connection ?? db.connect?.constructor ?? mod.Connection ?? mod.default?.Connection;
    let conn = null;
    if (typeof db.connect === 'function') conn = await db.connect();
    else if (typeof ConnCtor === 'function') conn = new ConnCtor(db);
    else if (typeof db.query === 'function') conn = db;
    if (!conn) throw new Error('sem Connection');
    const executar = async (cypher) => {
      if (typeof conn.execute === 'function') return conn.execute(cypher);
      if (typeof conn.query === 'function') return conn.query(cypher);
      throw new Error('Connection sem execute/query');
    };
    const schema = fs.readFileSync(path.join(__dirname, 'grafo', 'schema.cypher'), 'utf8');
    for (const stmt of schema.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('//') && !s.startsWith('CALL CREATE') && !s.startsWith('// CALL'))) {
      if (stmt.startsWith('//') || stmt.startsWith('---')) continue;
      await executar(stmt);
    }
    for (const f of fs.readdirSync(TMP_DIR).filter((x) => x.endsWith('.csv'))) {
      const tabela = f.replace(/^(node|rel)-/, '').replace(/\.csv$/, '');
      try {
        await executar(`COPY ${tabela} FROM '${path.join(TMP_DIR, f).replace(/\\/g, '/')}' (HEADER=true)`);
      } catch {
        /* tabela sem CSV correspondente: ignora */
      }
    }
    if (typeof db.close === 'function') await db.close();
    else if (typeof conn.close === 'function') await conn.close();
    console.log('   grafo: .lbug nativo materializado via @ladybugdb/core.');
    return true;
  } catch (err) {
    console.log(`   grafo: nativo indisponível (${String(err?.message ?? err).slice(0, 120)}) — usando JSON portátil.`);
    try {
      if (fs.existsSync(destinoLbug)) fs.rmSync(destinoLbug, { recursive: true, force: true });
    } catch {
      /* limpeza best-effort */
    }
    return false;
  }
}

/**
 * Gera (ou reaproveita) os artefatos do grafo. Nunca lança: sem base, grava
 * o grafo vazio versionado e devolve `{ vazio: true }`.
 */
export async function buildGrafo(opcoes = {}) {
  const dirBase = opcoes.dirBase ?? BASE_DIR;
  const dirSaida = opcoes.dirSaida ?? OUT_DIR;
  const forcar = Boolean(opcoes.forcar);
  fs.mkdirSync(dirSaida, { recursive: true });

  const hashBase = opcoes.hashBase ?? (await calcularHashBaseAtual(dirBase));
  const manifestPath = path.join(dirSaida, 'MANIFEST.grafo.json');
  const lbugPath = path.join(dirSaida, 'grafo.lbug');
  const lbugJsonPath = path.join(dirSaida, 'grafo.lbug.json');

  if (!forcar) {
    const anterior = lerJsonSeguro(manifestPath);
    if (anterior?.hashBase && anterior.hashBase === hashBase && fs.existsSync(lbugPath) && fs.existsSync(lbugJsonPath)) {
      console.log('   grafo: em dia (hash da base inalterado) — rebuild ignorado.');
      return { ...anterior, skipped: true };
    }
  }

  const { temBase, grafo: entradas } = lerEntradas();
  if (!temBase) {
    console.log('   grafo: base ausente — gravando grafo vazio versionado (build preservado).');
  }
  const { nodos, arestas, relatorio } = construirGrafo(entradas);
  const hash = hashGrafo(nodos, arestas);
  const geradoEm = new Date().toISOString();

  const payload = {
    formato: 'grafo-portatil',
    versao: GRAFO_VERSAO,
    geradoEm,
    hashBase,
    hash,
    nodos,
    arestas,
  };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  fs.writeFileSync(lbugJsonPath, bytes);
  escreverCsvs(nodos, arestas);

  const nativoOk = temBase ? await tentarNativo(lbugPath) : false;
  if (!nativoOk) {
    fs.writeFileSync(lbugPath, bytes);
  }

  const manifest = {
    versao: GRAFO_VERSAO,
    geradoEm,
    hashBase,
    hash,
    nodos: nodos.length,
    arestas: arestas.length,
    embedding: 'ausente',
    fontes: {
      nomenclatura: 'public/base/nomenclatura.json',
      reforma: 'public/base/reforma.json',
      referencia: 'public/base/classificacao-tributaria.json',
      cnae: 'public/base/cnae.json',
      ponteCnaeNbs: 'public/base/cnae-nbs.json (fonte NÃO-oficial — candidatos)',
      conhecimento: 'recursos-ia/conhecimento/{sinonimos,dicionario,pesos,lc214-artigos}.json',
      formato: nativoOk ? 'lbug-nativo' : 'json-portatil',
      vazio: !temBase,
    },
    relatorio,
    arquivos: ['grafo.lbug', 'grafo.lbug.json'],
  };
  fs.writeFileSync(manifestPath, Buffer.from(JSON.stringify(manifest), 'utf8'));

  console.log(`   grafo: ${nodos.length} nodos · ${arestas.length} arestas · hash ${hash.slice(0, 12)}… (${nativoOk ? 'nativo' : 'portátil'})`);
  if (relatorio.revogadosFiltrados) console.log(`   grafo: ${relatorio.revogadosFiltrados} revogado(s) filtrado(s)`);
  return { ...manifest, skipped: false };
}

async function main() {
  const resultado = await buildGrafo({ forcar: process.argv.includes('--forcar') });
  console.log(`\n Grafo ${resultado.skipped ? '(reaproveitado)' : `OK: ${resultado.nodos} nodos · ${resultado.arestas} arestas`}`);
}

const executadoDireto = process.argv[1]?.endsWith('build-grafo.mjs');
if (executadoDireto) {
  main().catch((err) => {
    console.log(`   grafo: falha blindada (${String(err?.message ?? err).slice(0, 160)}) — gravando vazio versionado.`);
    try {
      gravarVazioFallback();
    } catch {
      /* último recurso: nunca falhar o build */
    }
  });
}

function gravarVazioFallback() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const geradoEm = new Date().toISOString();
  const payload = { formato: 'grafo-portatil', versao: GRAFO_VERSAO, geradoEm, hashBase: null, hash: hashGrafo([], []), nodos: [], arestas: [] };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'grafo.lbug.json'), bytes);
  fs.writeFileSync(path.join(OUT_DIR, 'grafo.lbug'), bytes);
  fs.writeFileSync(path.join(OUT_DIR, 'MANIFEST.grafo.json'), Buffer.from(JSON.stringify({
    versao: GRAFO_VERSAO, geradoEm, hashBase: null, hash: payload.hash, nodos: 0, arestas: 0,
    embedding: 'ausente', fontes: { vazio: true }, arquivos: ['grafo.lbug', 'grafo.lbug.json'],
  }), 'utf8'));
}
