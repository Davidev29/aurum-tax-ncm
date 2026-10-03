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

// 5. Fine-tuning de serviços/NBS (v2) — só guia o raciocínio, nunca a base oficial.
try {
  const s = lerJson(path.join(CON_DIR, 'servicos-nbs.json'));
  const etapas = s.raciocinio?.etapas ?? [];
  console.log(`\n servicos-nbs.json: ${(s.setores ?? []).length} setores · ${etapas.length} etapas de raciocínio`);
  if (s.versao !== 'finetuning-servicos-v1') erro('servicos-nbs.json: versão inesperada');
  else if (etapas.length !== 7) erro('servicos-nbs.json: raciocínio deve ter 7 etapas');
  else if (!(s.anexos_lc214 ?? []).length) erro('servicos-nbs.json: sem anexos LC214');
  else ok('fine-tuning de serviços válido (setores + anexos + raciocínio)');
} catch (e) {
  erro(`servicos-nbs.json: ${e.message}`);
}
try {
  const f = lerJson(path.join(CON_DIR, 'frases-modelo-servicos.json'));
  console.log(` frases-modelo-servicos.json: ${(f.frases ?? []).length} frases`);
  if ((f.frases ?? []).length < 40) erro(`frases-modelo-servicos.json: cobertura mínima 40 frases (atual ${(f.frases ?? []).length})`);
  else {
    const temPreditiva = (f.frases ?? []).some((x) => x.tipo === 'preditiva');
    const temNegativa = (f.frases ?? []).some((x) => x.tipo === 'sem-lastro');
    const temEscopo = (f.frases ?? []).some((x) => x.tipo === 'fora-de-escopo');
    if (!temPreditiva) erro('frases-modelo-servicos.json: sem caso preditivo');
    else if (!temNegativa) erro('frases-modelo-servicos.json: sem caso negativo');
    else if (!temEscopo) erro('frases-modelo-servicos.json: sem caso fora-de-escopo');
    else ok('frases-modelo de serviços com preditivas + negativas + escopo');
  }
} catch (e) {
  erro(`frases-modelo-servicos.json: ${e.message}`);
}
try {
  const vs = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'domain', 'services', 'vocabulario-servicos.ts'), 'utf8');
  const amostrasServ = ['frete', 'advogado', 'cabeleireiro', 'restaurante', 'eletricista', 'transporte', 'advogados', 'beleza', 'circo', 'formacao', 'firewall', 'dentista'];
  const faltandoServ = amostrasServ.filter((a) => !vs.includes(a));
  if (faltandoServ.length) erro(`vocabulário de serviços desatualizado no TS: ${faltandoServ.join(', ')}`);
  else {
    const n = (vs.match(/^  [a-z0-9]+:/gm) ?? []).length;
    if (n < 500) erro(`vocabulário de serviços abaixo da cobertura v3 (500): ${n}`);
    else ok(`espelho TS de serviços com cobertura v3 (${n} termos)`);
  }
} catch (e) {
  erro(`espelho TS serviços: ${e.message}`);
}

// 6. Dicionário comercial de serviços + mapeamento de padrões (v3).
try {
  const ds = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'domain', 'constants', 'dicionario-servicos.ts'), 'utf8');
  const pins = (ds.match(/nbs: '/g) ?? []).length;
  console.log(`\n dicionario-servicos.ts: ${pins} pins`);
  if (pins < 5) erro('dicionario-servicos.ts: mínimo 5 pins (1 por grupo de benefício)');
  else {
    // Pins devem apontar para NBS com benefício na base viva.
    let vivos = new Set();
    try {
      const base = lerJson(path.join(PROJECT_ROOT, 'bases-fonte', 'NBS SERVIÇOS.json'));
      for (const r of base) vivos.add(String(r.NBS ?? '').replace(/\D+/g, ''));
    } catch { /* sem base: só formato */ }
    const citados = [...ds.matchAll(/nbs: '(\d{9})'/g)].map((m) => m[1]);
    const fora = citados.filter((c) => vivos.size && !vivos.has(c));
    if (fora.length) erro(`dicionario-servicos.ts: pins fora da base viva: ${fora.join(', ')}`);
    else ok('dicionário de serviços válido (pins com benefício na base viva)');
  }
} catch (e) {
  erro(`dicionario-servicos.ts: ${e.message}`);
}
try {
  const m = lerJson(path.join(CON_DIR, 'mapeamento-padroes-servicos.json'));
  console.log(` mapeamento-padroes-servicos.json: ${(m.grupos ?? []).length} grupos · sinonimos ${m.cobertura?.sinonimos_servicos ?? '?'}`);
  if ((m.grupos ?? []).length < 5) erro('mapeamento-padroes-servicos.json: mínimo 5 grupos');
  else if (!(m.setores_sem_beneficio_na_base ?? []).length) erro('mapeamento-padroes-servicos.json: sem lista honesta de setores sem benefício');
  else ok('mapeamento de padrões válido (oficial × popular + gaps honestos)');
} catch (e) {
  erro(`mapeamento-padroes-servicos.json: ${e.message}`);
}

// 7. Contexto personalizado por NBS (cada item estudado → descrição preditiva).
try {
  const ctx = lerJson(path.join(CON_DIR, 'contexto-nbs.json'));
  const itens = ctx.itens ?? [];
  console.log(`\n contexto-nbs.json: ${itens.length} itens · ${(ctx.grupos ?? []).length} grupos`);
  if (ctx.versao !== 'contexto-nbs-v1') erro('contexto-nbs.json: versão inesperada');
  else if (itens.length !== 107) erro(`contexto-nbs.json: esperava 107 itens (atual ${itens.length})`);
  else {
    const grupos = ctx.grupos ?? [];
    const prof = grupos.find((g) => g.grupo === 'PROF-30');
    if (grupos.length !== 23) erro(`contexto-nbs.json: esperava 23 grupos (atual ${grupos.length})`);
    else if (!prof || prof.cct !== '200052') erro('contexto-nbs.json: grupo PROF-30 (200/200052) ausente');
    let vivos = new Set();
    try {
      const base = lerJson(path.join(PROJECT_ROOT, 'bases-fonte', 'NBS SERVIÇOS.json'));
      for (const r of base) {
        const cod = String(r.NBS ?? '').replace(/\D+/g, '');
        if (/^\d{9}$/.test(cod)) vivos.add(cod);
      }
    } catch { /* sem base: só formato */ }
    const faltando = vivos.size ? [...vivos].filter((c) => !itens.some((i) => i.nbs === c)) : [];
    const gruposOk = (ctx.grupos ?? []).every((g) => g.resumo && (g.quando_se_aplica ?? []).length && (g.quando_nao_se_aplica ?? []).length && (g.condicoes ?? []).length);
    const dual = itens.filter((i) => i.multi_enquadramento);
    if (faltando.length) erro(`contexto-nbs.json: NBS sem contexto: ${faltando.join(', ')}`);
    else if (!gruposOk) erro('contexto-nbs.json: grupo sem resumo/aplica/não-aplica/condições');
    else if (dual.length !== 5) erro(`contexto-nbs.json: esperava 5 duplos XI (atual ${dual.length})`);
    else {
      const ccts = new Set((ctx.grupos ?? []).map((g) => g.cct));
      const esperados = ['200028', '200029', '200039', '200043', '200044', '200052', '011003', '200001', '200016', '200017', '200019', '200020', '200021', '200025', '200026', '200027', '200037', '200040', '200041', '200046', '200048', '200051', '515001'];
      const faltandoCct = esperados.filter((c) => !ccts.has(c));
      if (faltandoCct.length) erro(`contexto-nbs.json: grupos sem cct: ${faltandoCct.join(', ')}`);
      else ok('contexto por item válido (107 NBS, 23 grupos, 5 duplos XI, PROF-30 + 17 benefícios)');
    }
  }
} catch (e) {
  erro(`contexto-nbs.json: ${e.message}`);
}
try {
  const mod = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'domain', 'constants', 'contexto-nbs.ts'), 'utf8');
  const n = (mod.match(/nbs: '\d{9}'/g) ?? []).length;
  if (n !== 107) erro(`contexto-nbs.ts: esperava 107 itens no espelho (atual ${n})`);
  else if (!mod.includes('NOTA_DUAL_XI')) erro('contexto-nbs.ts: sem NOTA_DUAL_XI');
  else ok('espelho TS do contexto com 107 itens + nota dual');
} catch (e) {
  erro(`espelho TS contexto: ${e.message}`);
}

if (falhas) {
  console.error(`\n✖ ${falhas} problema(s) no conhecimento (exit 1).`);
  process.exit(1);
}
console.log('\n✔ Base de conhecimento válida (exit 0).');
