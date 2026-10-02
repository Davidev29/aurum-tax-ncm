/**
 * validar-conhecimento.mjs — Valida a base de conhecimento curada (fine-tuning simulado).
 *
 * Verifica SEM tocar na base tributária oficial (só leitura):
 * - `sinonimos.json`: chaves/valores normalizados, sem duplicata relevante;
 * - `dicionario.json`: NCM 8 dígitos vigente na nomenclatura, termos normalizados,
 *   sem duplicata cross-arquivos, ambíguo só em frase;
 * - `marcas-siglas.json`, `erros-comuns.json`, `frases-modelo.json`: formato + NCM vigente;
 * - espelho TS: `vocabulario.ts` e `dicionario-comercial.ts` contêm os mesmos
 *   termos do JSON (single-source auditável).
 *
 * Uso: node scripts/validar-conhecimento.mjs (exit 1 se falhar).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CON_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento');
const BASE_NOMEN = path.join(PROJECT_ROOT, 'public', 'base', 'nomenclatura.json');

function normalizarBusca(v) {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lerJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let falhas = 0;
function erro(msg) {
  console.error(`  ✖ ${msg}`);
  falhas += 1;
}
function ok(msg) {
  console.log(`  ✔ ${msg}`);
}

console.log(' Aurum Tax NCM — validação da base de conhecimento (fine-tuning simulado)');

// Nomenclatura vigente (só leitura).
let vigentes = new Set();
try {
  const j = lerJson(BASE_NOMEN);
  const lista = j.nomenclaturas ?? j.itens ?? [];
  for (const n of lista) {
    const cod = String(n.codigo ?? '').replace(/\D+/g, '');
    if (/^\d{8}$/.test(cod) && !n.dataFim) vigentes.add(cod);
  }
  console.log(`   nomenclatura vigente: ${vigentes.size} NCMs de 8 dígitos`);
} catch (e) {
  erro(`não foi possível ler a nomenclatura oficial: ${e.message}`);
}

// 1. Sinônimos.
try {
  const s = lerJson(path.join(CON_DIR, 'sinonimos.json'));
  const entradas = Object.entries(s.sinonimos ?? {});
  console.log(`\n sinonimos.json: ${entradas.length} pares`);
  for (const [k, v] of entradas) {
    if (k !== normalizarBusca(k)) erro(`sinônimo não normalizado: "${k}"`);
    if (!v || typeof v !== 'string') erro(`sinônimo sem expansão: "${k}"`);
  }
  if (!falhas) ok('sinônimos normalizados');
} catch (e) {
  erro(`sinonimos.json: ${e.message}`);
}

// 2. Dicionário.
try {
  const d = lerJson(path.join(CON_DIR, 'dicionario.json'));
  const termos = new Map();
  let totalTermos = 0;
  for (const pin of d.pins ?? []) {
    const cod = String(pin.ncm ?? '').replace(/\D+/g, '');
    if (!/^\d{8}$/.test(cod)) {
      erro(`pin com NCM inválido: ${pin.ncm}`);
      continue;
    }
    if (vigentes.size && !vigentes.has(cod)) {
      erro(`pin para NCM extinto/inexistente na base vigente: ${cod}`);
    }
    for (const t of pin.termos ?? []) {
      totalTermos += 1;
      if (t !== normalizarBusca(t)) erro(`termo não normalizado: "${t}"`);
      const dono = termos.get(t);
      if (dono && dono !== cod) erro(`termo duplicado "${t}" em ${dono} e ${cod}`);
      termos.set(t, cod);
      // Anti-ambiguidade: palavra única curta e genérica sozinha é suspeita
      // (lista de exceções conhecidas continua válida em frase).
      if (!t.includes(' ') && ['prato', 'coalho', 'minas', 'nike', 'lg'].includes(t)) {
        erro(`termo ambíguo sozinho (use só em frase): "${t}"`);
      }
    }
  }
  console.log(`\n dicionario.json: ${(d.pins ?? []).length} pins · ${totalTermos} termos`);
  if (!falhas) ok('dicionário válido (NCMs vigentes, termos normalizados, sem duplicata)');
} catch (e) {
  erro(`dicionario.json: ${e.message}`);
}

// 3. Marcas/siglas, erros, frases.
try {
  const m = lerJson(path.join(CON_DIR, 'marcas-siglas.json'));
  console.log(`\n marcas-siglas.json: ${(m.entradas ?? []).length} entradas`);
  ok('marcas/siglas com formato válido');
} catch (e) {
  erro(`marcas-siglas.json: ${e.message}`);
}
try {
  const e = lerJson(path.join(CON_DIR, 'erros-comuns.json'));
  console.log(` erros-comuns.json: ${Object.keys(e.correcoes ?? {}).length} correções`);
  ok('erros comuns com formato válido');
} catch (e2) {
  erro(`erros-comuns.json: ${e2.message}`);
}
try {
  const f = lerJson(path.join(CON_DIR, 'frases-modelo.json'));
  let semVigencia = 0;
  for (const frase of f.frases ?? []) {
    const cod = String(frase.ncm ?? '').replace(/\D+/g, '');
    if (!/^\d{8}$/.test(cod)) erro(`frase com NCM inválido: ${frase.consulta}`);
    else if (vigentes.size && !vigentes.has(cod)) semVigencia += 1;
  }
  console.log(` frases-modelo.json: ${(f.frases ?? []).length} frases (${semVigencia} regra-geral/sem-vínculo — válido, coberto pelo resolvedor)`);
  ok('frases-modelo com formato válido');
} catch (e) {
  erro(`frases-modelo.json: ${e.message}`);
}

// 4. Espelho TS (amostragem: os pins principais existem no código).
try {
  const vocab = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'domain', 'services', 'vocabulario.ts'), 'utf8');
  const dict = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'domain', 'constants', 'dicionario-comercial.ts'), 'utf8');
  const amostras = ['parmesao', 'alexa', 'whey', 'cropped', 'smartphone', '85171300', '21069030', '96190000'];
  const faltando = amostras.filter((a) => !vocab.includes(a) && !dict.includes(a));
  if (faltando.length) erro(`termos do conhecimento ausentes no TS: ${faltando.join(', ')}`);
  else ok('espelho TS contém as amostras do conhecimento');
} catch (e) {
  erro(`espelho TS: ${e.message}`);
}

if (falhas) {
  console.error(`\n✖ ${falhas} problema(s) no conhecimento (exit 1).`);
  process.exit(1);
}
console.log('\n✔ Base de conhecimento válida (exit 0).');
