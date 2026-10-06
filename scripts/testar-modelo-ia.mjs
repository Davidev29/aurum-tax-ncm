#!/usr/bin/env node
/**
 * testar-modelo-ia.mjs — Plan 06-04 [IA-04] (Phase 6).
 *
 * Valida o LLM local `Qwen3.5-2B-Q4_K_M.gguf` (~1221MB, pin em
 * `recursos-ia/modelo/modelo.json`) pelo caminho REAL de
 * produção: `electron/ia/ia-worker.cjs` via fork (trava lexical + prompt PT
 * nativo + geração restrita por gramática — nunca inventa código), ou roda em
 * MODO MOCK quando o GGUF está ausente.
 *
 * - NUNCA adiciona dependência ao package.json: `node-llama-cpp` (ESM-only v3)
 *   é carregado SOMENTE dentro do worker via `import()` dinâmico. Este script
 *   só faz fork + IPC, sem dependências nativas.
 * - Com GGUF presente: valida SHA256 contra `recursos-ia/CHECKSUMS.txt`
 *   antes de carregar; aborta (exit 1) se o hash divergir.
 * - O worker responde `mock:false` quando o modelo real decidiu; qualquer
 *   resposta em modo mock no caminho REAL conta como violação (AI-first).
 * - Loga latência (ms) e RSS (MB) por caso + resumo.
 *
 * Uso:
 *   node scripts/testar-modelo-ia.mjs [--mock] [--json] [--modelo <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RECURSOS_IA = path.join(REPO_ROOT, 'recursos-ia');
const DIR_MODELO = path.join(RECURSOS_IA, 'modelo');
// Modelo agnóstico: `--modelo <path>` > env AURUM_IA_MODEL > manifesto >
// legado > qualquer *.gguf (maior vence). Trocar o .gguf = trocar o modelo.
function descobrirGgufPadrao() {
  try {
    const arg = process.argv.slice(2);
    const i = arg.indexOf('--modelo');
    if (i >= 0 && arg[i + 1]) return arg[i + 1];
  } catch (_) { /* segue */ }
  try {
    const env = String(process.env.AURUM_IA_MODEL || '').trim();
    if (env && fs.existsSync(env)) return env;
  } catch (_) { /* segue */ }
  try {
    const man = path.join(DIR_MODELO, 'modelo.json');
    if (fs.existsSync(man)) {
      const j = JSON.parse(fs.readFileSync(man, 'utf8'));
      if (j && typeof j.arquivo === 'string') {
        const abs = path.join(DIR_MODELO, j.arquivo.trim());
        if (fs.existsSync(abs)) return abs;
      }
    }
  } catch (_) { /* segue */ }
  const legado = path.join(DIR_MODELO, 'Qwen3.5-2B-Q4_K_M.gguf');
  try { if (fs.existsSync(legado)) return legado; } catch (_) { /* segue */ }
  const legadoAntigo = path.join(DIR_MODELO, 'Qwen3-0.6B-Q8_0.gguf');
  try { if (fs.existsSync(legadoAntigo)) return legadoAntigo; } catch (_) { /* segue */ }
  try {
    if (fs.existsSync(DIR_MODELO)) {
      const ggufs = fs.readdirSync(DIR_MODELO)
        .filter((f) => f.toLowerCase().endsWith('.gguf'))
        .map((f) => ({ f, abs: path.join(DIR_MODELO, f), bytes: fs.statSync(path.join(DIR_MODELO, f)).size }))
        .filter((e) => e.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes);
      if (ggufs.length) return ggufs[0].abs;
    }
  } catch (_) { /* segue */ }
  return legado;
}
const MODELO_PADRAO = descobrirGgufPadrao();
const CHECKSUMS = path.join(REPO_ROOT, 'recursos-ia', 'CHECKSUMS.txt');
const WORKER = path.join(REPO_ROOT, 'electron', 'ia', 'ia-worker.cjs');

// Medido em 2026-10-06 (Qwen3.5-2B-Q4_K_M, CPU, via worker): load 8.6s,
// inferência 0.9–2.7s/caso, RSS ~2.2GB com modelo residente; gibberish barrado
// na trava lexical sem acordar o LLM (0ms). Anterior 2026-10-04 (Qwen3-0.6B-Q8_0):
// load 5.6s, inferência ~0.4s/caso, RSS ~1.3GB.
const ORCAMENTO = { latenciaMsTeto: 15000, latenciaMsMeta: 8000, rssMBTeto: 2600, rssMBMeta: 2200 };

// Casos de fumaça (somente NCM — NBS fora de escopo neste módulo).
const CASOS = [
  {
    nome: 'frango-vivo',
    descricao: 'frango vivo para abate',
    candidatos: [
      { codigo: '0105.94.00', descricao: 'Galos e galinhas vivos; frango vivo para abate (sinonimos: frango, frango vivo, abate)' },
      { codigo: '0207.12.00', descricao: 'Carnes de galos e galinhas, inteiras, congeladas' },
      { codigo: '1006.30.21', descricao: 'Arroz semibranqueado ou branqueado, polido' },
      { codigo: '8471.30.12', descricao: 'Máquinas automáticas para processamento de dados, portáteis' },
      { codigo: '0901.11.10', descricao: 'Café não torrado, não descafeinado, em grão' },
    ],
    espera: '0105.94.00', // mock deve acertar por overlap; real pode variar → só exige restrição
  },
  {
    nome: 'notebook',
    descricao: 'notebook computador portátil 14 polegadas',
    candidatos: [
      { codigo: '8471.30.12', descricao: 'Máquinas automáticas para processamento de dados, portáteis; notebook computador portatil (sinonimos: notebook, computador, portatil)' },
      { codigo: '8471.41.10', descricao: 'Máquinas automáticas para processamento de dados, de mesa' },
      { codigo: '8528.72.00', descricao: 'Aparelhos receptores de televisão, em cores' },
      { codigo: '0105.94.00', descricao: 'Galos e galinhas vivos' },
      { codigo: '1006.30.21', descricao: 'Arroz branqueado' },
    ],
    espera: '8471.30.12',
  },
  {
    nome: 'gibberish',
    descricao: 'xqztw blorp kkk 123 !!!',
    candidatos: [
      { codigo: '0105.94.00', descricao: 'Galos e galinhas vivos' },
      { codigo: '8471.30.12', descricao: 'Máquinas portáteis para processamento de dados' },
    ],
    espera: 'NÃO SEI', // fail-safe obrigatório nos dois modos
  },
];

/** Prompt rígido: só índice do candidato ou NÃO SEI. Nunca inventar código. */
export function montarPromptRigido(descricao, candidatos) {
  const linhas = candidatos
    .map((c, i) => `${i + 1}. ${c.codigo} — ${c.descricao}`)
    .join('\n');
  return [
    'Você é um seletor fiscal restrito. REGRAS INVIOLÁVEIS:',
    '1. Responda SOMENTE com o NÚMERO do candidato (1 a ' + candidatos.length + ') ou com a frase exata "NÃO SEI".',
    '2. NUNCA invente, complete ou sugira código NCM fora da lista.',
    '3. Se nenhum candidato corresponder com confiança, responda "NÃO SEI".',
    '4. Nenhuma explicação, nenhum texto extra.',
    '',
    `Descrição: "${descricao}"`,
    'Candidatos:',
    linhas,
    '',
    'Resposta (número ou NÃO SEI):',
  ].join('\n');
}

/** Coage qualquer saída do LLM para {codigo} ou NÃO SEI. Retorna violação=true se saiu do formato. */
export function interpretarSaida(saida, candidatos) {
  const t = String(saida ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (t === 'NÃO SEI' || t === 'NAO SEI') return { codigo: 'NÃO SEI', violacao: false };
  const m = t.match(/^([1-9]\d?)\b/);
  if (m) {
    const idx = Number(m[1]) - 1;
    if (idx >= 0 && idx < candidatos.length) return { codigo: candidatos[idx].codigo, violacao: false };
  }
  // Aceita código literal da lista (tolerância), resto é violação → fail-safe.
  const soDigitos = t.replace(/\D/g, '');
  for (const c of candidatos) {
    if (c.codigo.replace(/\D/g, '') === soDigitos && soDigitos.length >= 4) {
      return { codigo: c.codigo, violacao: false };
    }
  }
  return { codigo: 'NÃO SEI', violacao: true };
}

/** Seletor MOCK determinístico (mesma semântica do spike ia-spike-worker.cjs). */
export function selecionarMock(descricao, candidatos) {
  const toks = (String(descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) =>
    t.toLowerCase(),
  );
  const conjunto = new Set(toks);
  let melhor = null;
  let melhorPontos = 0;
  for (const c of candidatos || []) {
    const ct = (String(c.descricao || '').toLowerCase().match(/[a-zà-ú0-9]+/gi) || []).map((t) =>
      t.toLowerCase(),
    );
    let pontos = 0;
    for (const t of ct) if (conjunto.has(t)) pontos += 1;
    if (pontos > melhorPontos) {
      melhorPontos = pontos;
      melhor = c;
    }
  }
  const teto = Math.max(1, toks.length);
  const confianca = Math.min(1, Math.round((melhorPontos / teto) * 100) / 100);
  if (!melhor || confianca < 0.2) {
    return { codigo: 'NÃO SEI', confianca: 0, motivo: 'similaridade-insuficiente' };
  }
  return { codigo: melhor.codigo, confianca, motivo: 'mock-overlap' };
}

function agoraMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}
function rssMB() {
  return Math.round((process.memoryUsage().rss / 1048576) * 100) / 100;
}

function lerChecksums() {
  if (!fs.existsSync(CHECKSUMS)) return new Map();
  const mapa = new Map();
  for (const linha of fs.readFileSync(CHECKSUMS, 'utf8').split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^([0-9a-fA-F]+|PENDENTE\S*)\s+(.+)$/);
    if (m) mapa.set(m[2].trim(), m[1]);
  }
  return mapa;
}

function sha256Arquivo(caminho) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(caminho, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

async function inferenciaReal(modelPath, descricao, candidatos) {
  // node-llama-cpp v3: `LlamaCompletion.generateCompletion` sobre a sequência
  // (mesmo caminho do worker `electron/ia/ia-worker.cjs`). ctx do perfil (4096 no pin oficial).
  // NOTA: mantida como referência direta; o `main()` valida pelo worker via
  // fork (caminho de produção). Esta função segue o mesmo protocolo.
  const { getLlama, LlamaCompletion, LlamaGrammar } = await import('node-llama-cpp');
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  try {
    const context = await model.createContext({ contextSize: 2048 });
    try {
      const sequence = context.getSequence();
      const completion = new LlamaCompletion({ contextSequence: sequence });
      let gramatica = null;
      try {
        const prompt = montarPromptRigido(descricao, candidatos);
        const alts = candidatos.map((_, i) => `"${i + 1}"`).join(' | ');
        gramatica = new LlamaGrammar(llama, { grammar: `root ::= (${alts} | "0")` });
        const t0 = agoraMs();
        const texto = await completion.generateCompletion(prompt, {
          maxTokens: 4,
          temperature: 0,
          topP: 1,
          grammar: gramatica,
        });
        const ms = agoraMs() - t0;
        const { codigo, violacao } = interpretarSaida(texto, candidatos);
        return { codigo, ms, ramMB: rssMB(), bruto: String(texto).slice(0, 80), violacao };
      } finally {
        if (gramatica && typeof gramatica.dispose === 'function') gramatica.dispose();
        if (typeof completion.dispose === 'function') await completion.dispose();
      }
    } finally {
      if (typeof context.dispose === 'function') await context.dispose();
    }
  } finally {
    if (typeof model.dispose === 'function') await model.dispose();
  }
}

/**
 * Harness do caminho de produção: fork do `ia-worker.cjs` + IPC `{id,cmd}`.
 * Carrega o modelo UMA vez (`init`) e classifica cada caso (`classificar`).
 */
function iniciarWorkerFork() {
  return new Promise((resolver, rejeitar) => {
    let filho;
    try {
      filho = fork(WORKER, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    } catch (e) {
      rejeitar(e);
      return;
    }
    const timer = setTimeout(() => rejeitar(new Error('timeout esperando "pronto" do worker')), 60_000);
    filho.on('message', (msg) => {
      if (msg && typeof msg === 'object' && msg.cmd === 'pronto' && (msg.id === null || msg.id === undefined)) {
        clearTimeout(timer);
        resolver(filho);
      }
    });
    filho.on('error', (e) => {
      clearTimeout(timer);
      rejeitar(e);
    });
  });
}

function rpcWorker(filho, cmd, carga = {}, timeoutMs = 120_000) {
  return new Promise((resolver, rejeitar) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => {
      filho.off('message', aoResponder);
      rejeitar(new Error(`timeout (${timeoutMs}ms) no comando "${cmd}"`));
    }, timeoutMs);
    function aoResponder(msg) {
      if (msg && typeof msg === 'object' && msg.id === id) {
        clearTimeout(timer);
        filho.off('message', aoResponder);
        resolver(msg);
      }
    }
    filho.on('message', aoResponder);
    try {
      filho.send({ id, cmd, ...carga });
    } catch (e) {
      clearTimeout(timer);
      filho.off('message', aoResponder);
      rejeitar(e);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const forcarMock = args.includes('--mock');
  const comoJson = args.includes('--json');
  const iMod = args.indexOf('--modelo');
  const modelPath = iMod >= 0 && args[iMod + 1] ? path.resolve(args[iMod + 1]) : MODELO_PADRAO;

  const ggufExiste = !forcarMock && fs.existsSync(modelPath);
  const modo = ggufExiste ? 'REAL' : 'MOCK';

  let hashOk = null;
  if (ggufExiste) {
    const base = path.basename(modelPath);
    const mapa = lerChecksums();
    const esperado = mapa.get(`modelo/${base}`) ?? [...mapa.values()][0];
    if (!esperado || /^PENDENTE/i.test(esperado)) {
      console.error(
        `[06-04] ABORTADO: GGUF presente mas sem hash real em recursos-ia/CHECKSUMS.txt. ` +
          `Registre o SHA256 antes de inferir.`,
      );
      process.exit(1);
    }
    const real = sha256Arquivo(modelPath).toLowerCase();
    hashOk = real === esperado.toLowerCase();
    if (!hashOk) {
      console.error(`[06-04] ABORTADO: SHA256 divergente.\n  esperado: ${esperado}\n  real:     ${real}`);
      process.exit(1);
    }
  }

  // Tenta carregar node-llama-cpp só no modo REAL; ausência → fallback MOCK documentado.
  let moduloLlamaOk = false;
  if (ggufExiste) {
    try {
      await import('node-llama-cpp');
      moduloLlamaOk = true;
    } catch (e) {
      console.warn(
        `[06-04] AVISO: GGUF presente e hash OK, mas node-llama-cpp não instalado ` +
          `(${e?.code ?? e?.message}). Caindo para MOCK (sem prova de orçamento real). ` +
          `Instale com: npm i --no-save node-llama-cpp`,
      );
    }
  }
  const realAtivo = ggufExiste && moduloLlamaOk;

  // Caminho REAL = worker de produção (fork único, modelo carregado uma vez).
  let worker = null;
  if (realAtivo) {
    try {
      worker = await iniciarWorkerFork();
      const rInit = await rpcWorker(worker, 'init', { mock: false, modelPath }, 300_000);
      if (!rInit.ok || rInit.mock !== false) {
        console.error(`[06-04] Falha no init real: ${rInit.erro ?? 'worker em mock'}`);
        try { worker.kill() } catch (_) { /* ignora */ }
        process.exit(1);
      }
      console.log(`[06-04] worker real pronto (load ${rInit.msLoad}ms, rss ${rInit.ramMB}MB).`);
    } catch (e) {
      console.error(`[06-04] Falha ao iniciar worker real: ${e?.message ?? e}`);
      try { if (worker) worker.kill() } catch (_) { /* ignora */ }
      process.exit(1);
    }
  }

  const resultados = [];
  let violacoes = 0;
  for (const caso of CASOS) {
    const t0 = agoraMs();
    const rssAntes = rssMB();
    let codigo;
    let motivo;
    let bruto = '';
    if (realAtivo) {
      try {
        const r = await rpcWorker(worker, 'classificar', { descricao: caso.descricao, candidatos: caso.candidatos });
        if (!r.ok) {
          console.error(`[06-04] Falha na inferência real (${caso.nome}): ${r.erro ?? 'sem resposta'}`);
          process.exit(1);
        }
        codigo = r.codigo;
        motivo = r.motivo;
        bruto = r.saidaBruta ? String(r.saidaBruta).slice(0, 80) : '';
        // AI-first: resposta em mock no caminho real = violação.
        if (r.mock) violacoes += 1;
        resultados.push({
          caso: caso.nome,
          codigo,
          confianca: r.confianca ?? (codigo === 'NÃO SEI' ? 0 : 1),
          motivo: r.mock ? `${motivo ?? 'mock'}+mock-inesperado` : motivo,
          ms: r.ms ?? (agoraMs() - t0),
          rssMB: r.ramMB ?? Math.max(rssAntes, rssMB()),
          violacao: !!r.mock,
          ...(bruto ? { bruto } : {}),
        });
        continue;
      } catch (e) {
        console.error(`[06-04] Falha na inferência real (${caso.nome}): ${e?.message ?? e}`);
        process.exit(1);
      }
    } else {
      const sel = selecionarMock(caso.descricao, caso.candidatos);
      codigo = sel.codigo;
      motivo = sel.motivo;
      // Simula a coerção do prompt rígido: mock só emite candidato ou NÃO SEI.
      const { codigo: coagido, violacao } = interpretarSaida(
        codigo === 'NÃO SEI' ? 'NÃO SEI' : sel.codigo,
        caso.candidatos,
      );
      codigo = coagido;
      if (violacao) violacoes += 1;
    }
    resultados.push({
      caso: caso.nome,
      codigo,
      confianca: codigo === 'NÃO SEI' ? 0 : selecionarMock(caso.descricao, caso.candidatos).confianca,
      motivo,
      ms: agoraMs() - t0,
      rssMB: Math.max(rssAntes, rssMB()),
      violacao: false,
    });
  }

  const latMax = Math.max(...resultados.map((r) => r.ms));
  const rssMax = Math.max(...resultados.map((r) => r.rssMB));
  const restricaoOk = resultados.every((r) =>
    r.codigo === 'NÃO SEI' || CASOS.find((c) => c.nome === r.caso).candidatos.some((c) => c.codigo === r.codigo),
  );
  const acertos = resultados.filter((r) => {
    const espera = CASOS.find((c) => c.nome === r.caso).espera;
    return r.codigo === espera;
  }).length;

  const resumo = {
    plano: '06-04',
    requisito: 'IA-04',
    modo: realAtivo ? 'REAL' : 'MOCK',
    modelo: realAtivo ? modelPath : null,
    sha256Ok: hashOk,
    nodeLlamaCpp: realAtivo ? 'carregado' : 'ausente-ou-mock',
    casos: resultados,
    acertosEsperados: `${acertos}/${CASOS.length}`,
    restricao100: restricaoOk && violacoes === 0,
    violacoes,
    latenciaMaxMs: latMax,
    rssMaxMB: rssMax,
    orcamento: {
      ...ORCAMENTO,
      latenciaOk: realAtivo ? latMax <= ORCAMENTO.latenciaMsTeto : null,
      rssOk: realAtivo ? rssMax <= ORCAMENTO.rssMBTeto : null,
      notaMock: realAtivo
        ? 'medidas reais do modelo'
        : 'medidas do MOCK — NÃO provam orçamento do GGUF real (~1221MB, ~2.2GB RAM)',
    },
  };

  if (comoJson) {
    console.log(JSON.stringify(resumo, null, 2));
  } else {
    console.log(`[06-04] Modelo IA — modo ${resumo.modo}${forcarMock ? ' (forçado --mock)' : ''}`);
    if (!realAtivo && ggufExiste && !moduloLlamaOk) {
      console.log('[06-04] Fallback MOCK: GGUF presente, node-llama-cpp ausente (--no-save, ESM-only v3).');
    }
    if (!ggufExiste) console.log('[06-04] GGUF ausente — MOCK determinístico (sem download offline).');
    for (const r of resultados) {
      console.log(
        `  - ${r.caso}: codigo=${r.codigo} motivo=${r.motivo} ms=${r.ms} rss=${r.rssMB}MB` +
          (r.bruto ? ` bruto="${r.bruto}"` : ''),
      );
    }
    console.log(
      `[06-04] acertos=${resumo.acertosEsperados} restricao100=${resumo.restricao100} ` +
        `latMax=${latMax}ms rssMax=${rssMax}MB`,
    );
    if (!realAtivo) {
      console.log('[06-04] NOTA: latência/RAM acima são do MOCK; orçamento real (<15s/~1.4GB) pendente de GGUF.');
    }
  }

  if (worker) {
    try {
      await rpcWorker(worker, 'encerrar', {}, 15_000).catch(() => null);
    } catch (_) { /* best-effort */ }
    try { worker.kill() } catch (_) { /* ignora */ }
    worker = null;
  }

  if (!restricaoOk || violacoes > 0) {
    console.error('[06-04] FALHA: violação da restrição (saída fora de candidato/NÃO SEI).');
    process.exit(2);
  }
}

await main();
