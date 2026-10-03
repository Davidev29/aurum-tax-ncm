#!/usr/bin/env node
/**
 * cobertura-traducao.mjs — Extrai o vocabulário COMPLETO das bases oficiais
 * (NCM vigente + Reforma + classificações) e mede a cobertura do glossário
 * fiscal PT↔EN (`recursos-ia/conhecimento/glossario-pt-en.json`).
 *
 * Fluxo agêntico (AI-first):
 *   1. extrair  → todos os tokens PT das fontes oficiais, com frequência;
 *   2. medir    → % coberto pelo glossário (termos + frases);
 *   3. descobrir→ lista priorizada de tokens descobertos p/ tradução;
 *   4. validar  → `--min <pct>`: exit 1 se abaixo (trava de produção).
 *
 * Uso:
 *   node scripts/cobertura-traducao.mjs [--json] [--min 95] [--top 120]
 *   node scripts/cobertura-traducao.mjs --exportar-lacunas ./lacunas.json
 *
 * 100% local/offline. Leitura latin1 (bases-fonte) + utf8 (recursos-ia).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');

function lerJson(caminho) {
  const raw = fs.readFileSync(caminho);
  for (const enc of ['utf8', 'latin1']) {
    try {
      return JSON.parse(raw.toString(enc));
    } catch { /* tenta próxima */ }
  }
  throw new Error(`JSON ilegível: ${caminho}`);
}

function normalizar(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const STOP = new Set(
  ('de,da,do,das,dos,e,em,para,com,por,que,os,as,o,a,um,uma,uns,umas,ao,aos,' +
    'na,no,nas,nos,se,ou,como,mais,menos,sem,sob,sobre,entre,ate,apenas,' +
    'muito,este,esta,estes,estas,esse,essa,isso,isto,ser,sao,foi,foram,tem,ha,' +
    'cujo,cuja,nos,neste,nesta,nisso,disso,qual,quais,quando,onde,pelo,pela,' +
    'pelos,pelas,num,numa,etc,ex,n,art,arts,anexo,lei,lc,ncm,cst,nbs,ibs,cbs,' +
    'ii,iii,iv,vi,vii,viii,ix,xi,xii,xiii,xiv,xv,i,xi,obs').split(','),
);

function tokenizar(texto) {
  return normalizar(texto).replace(/<[^>]*>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Coleta {texto, fonte} de todas as fontes oficiais. */
function coletarFontes() {
  const fontes = [];
  const push = (fonte, texto) => {
    if (texto && String(texto).trim()) fontes.push({ fonte, texto: String(texto) });
  };

  // 1. Nomenclatura NCM vigente (15k descrições oficiais da TEC).
  const tab = lerJson(path.join(RAIZ, 'bases-fonte', 'Tabela_NCM_Vigente_20260922.json'));
  for (const n of tab.Nomenclaturas ?? []) push(`TEC:${n.Codigo}`, n.Descricao);

  // 2. Base unificada da IA (nomenclatura pura + capítulo + vínculo + base legal).
  const base = lerJson(path.join(RAIZ, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json'));
  for (const it of base.itens ?? []) {
    push(`IA-nomenclatura:${it.codigo}`, it.nomenclatura);
    push(`IA-capitulo:${it.codigo}`, it.capitulo?.descricao);
    push(`IA-vinculo:${it.codigo}`, it.descricaoCClassTrib);
    push(`IA-baseLegal:${it.codigo}`, it.baseLegal);
  }

  // 3. Tabelas auxiliares da Reforma (CST + cClassTrib — tributação).
  const ref = lerJson(path.join(RAIZ, 'bases-fonte', 'reforma_tributaria_por_ncm.json'));
  const aux = ref.tabelasAuxiliares ?? {};
  for (const [tabela, linhas] of Object.entries(aux)) {
    for (const linha of linhas ?? []) {
      for (const [k, v] of Object.entries(linha)) {
        if (/descric|nome|observ/i.test(k) && typeof v === 'string') {
          push(`AUX-${tabela}:${k}`, v);
        }
      }
    }
  }

  // 4. Classificações tributárias (164 linhas CST×cClassTrib).
  try {
    const cls = lerJson(path.join(RAIZ, 'bases-fonte', 'classificacao_tributaria.json'));
    for (const linha of cls ?? []) {
      for (const [k, v] of Object.entries(linha)) {
        if (typeof v === 'string' && /descric|observ/i.test(k)) push(`CLS:${k}`, v);
      }
    }
  } catch { /* opcional */ }

  // 5. Dicionário comercial (nomes populares → NCM).
  try {
    const src = fs.readFileSync(path.join(RAIZ, 'src', 'domain', 'constants', 'dicionario-comercial.ts'), 'utf8');
    for (const m of src.matchAll(/termo:\s*['"]([^'"]+)['"]/g)) push('DICIONARIO', m[1]);
  } catch { /* opcional */ }

  return fontes;
}

function carregarGlossario() {
  const j = JSON.parse(fs.readFileSync(
    path.join(RAIZ, 'recursos-ia', 'conhecimento', 'glossario-pt-en.json'), 'utf8'));
  const termos = new Map(Object.entries(j.termos ?? {}));
  const frasesTok = new Set();
  for (const k of Object.keys(j.frases ?? {})) {
    for (const t of tokenizar(k)) frasesTok.add(t);
  }
  return { termos, frasesTok };
}

async function main() {
  const args = process.argv.slice(2);
  const comoJson = args.includes('--json');
  const iMin = args.indexOf('--min');
  const minimo = iMin >= 0 ? Number(args[iMin + 1]) : null;
  const iTop = args.indexOf('--top');
  const topN = iTop >= 0 ? Number(args[iTop + 1]) : 120;
  const iExp = args.indexOf('--exportar-lacunas');
  const expPath = iExp >= 0 ? path.resolve(args[iExp + 1]) : null;

  const fontes = coletarFontes();
  const { termos, frasesTok } = carregarGlossario();

  const freq = new Map();
  const contexto = new Map();
  for (const { fonte, texto } of fontes) {
    for (const t of tokenizar(texto)) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
      if (!contexto.has(t) && contexto.size < 200000) contexto.set(t, `${fonte} :: ${texto.slice(0, 90)}`);
    }
  }

  const todos = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  // Dígitos puros e siglas de espécie não exigem tradução — fora da métrica.
  const traduzivel = ([t]) => !/^\d+$/.test(t);
  const avaliados = todos.filter(traduzivel);
  const coberto = (t) => termos.has(t) || frasesTok.has(t);
  const cobertos = avaliados.filter(([t]) => coberto(t));
  const lacunas = avaliados.filter(([t]) => !coberto(t));
  const pct = avaliados.length ? (cobertos.length / avaliados.length) * 100 : 100;

  const lacunasTop = lacunas.slice(0, topN).map(([token, ocorrencias]) => ({
    token, ocorrencias, exemplo: contexto.get(token) ?? '',
  }));

  if (expPath) {
    fs.writeFileSync(expPath, JSON.stringify({ geradoEm: new Date().toISOString(), lacunas: lacunasTop }, null, 2), 'utf8');
  }

  if (comoJson) {
    console.log(JSON.stringify({
      fontes: fontes.length,
      tokensUnicos: todos.length,
      cobertos: cobertos.length,
      coberturaPct: Math.round(pct * 100) / 100,
      lacunas: lacunasTop,
    }, null, 2));
  } else {
    console.log(`[cobertura] fontes=${fontes.length} tokensÚnicos=${todos.length} cobertos=${cobertos.length} (${pct.toFixed(2)}%)`);
    console.log(`[cobertura] top-${lacunasTop.length} lacunas por frequência:`);
    for (const l of lacunasTop.slice(0, 40)) {
      console.log(`  - ${l.token} (×${l.ocorrencias}) :: ${l.exemplo.slice(0, 100)}`);
    }
    if (expPath) console.log(`[cobertura] lacunas exportadas: ${expPath}`);
  }

  if (minimo != null && pct < minimo) {
    console.error(`[cobertura] FALHA: ${pct.toFixed(2)}% < mínimo ${minimo}%`);
    process.exit(1);
  }
}

await main();
