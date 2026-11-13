#!/usr/bin/env node
/**
 * fontes-sync.mjs — Sincronização das fontes oficiais (plug-in pull)
 * ==================================================================
 * Atualiza, a partir das fontes OFICIAIS, os dados brutos em `bases-fonte/`
 * que alimentam `npm run base` (compilação para `public/base/`).
 *
 * É este o "meio oficial" para manter as tabelas em dia: em toda nova
 * compilação do software, basta rodar `npm run fontes:sync` e depois
 * `npm run base` (ou `npm run build`, que chama a base completa).
 *
 * O QUE ESTE SCRIPT FAZ (automático):
 *   1. NBS 2.00 oficial — baixa o painel oficial da MDIC (Power BI,
 *      "Painel de Códigos NBS", Portaria Conjunta RFB/SCS nº 2.000/2018)
 *      via API anônima de publish-to-web e grava a nomenclatura COMPLETA
 *      (5 seções, 26 capítulos, 146 posições, 454 subposições 1º nível,
 *      802 2º nível, 892 itens, 919 subitens) em
 *      `bases-fonte/NBS 2.00 (oficial).json`.
 *   2. DE-PARA NBS 1.1 ↔ 2.0 — normaliza a planilha oficial de correlação
 *      (MDIC, "Correlações") salva no projeto como CSV e grava
 *      `bases-fonte/NBS DE-PARA (oficial).json`.
 *   3. NCM (nomenclatura vigente) — baixa do Portal Único Siscomex
 *      (`classif/api/publico/nomenclatura/download/json`) para
 *      `bases-fonte/Tabela_NCM_Vigente_AAAAMMDD.json` e move versões
 *      anteriores para `bases-fonte/.historico/` (nada é apagado).
 *   4. Verifica a frescor de TODAS as fontes (mtime + sha256) e escreve
 *      `bases-fonte/FONTES.json` — o mapa auditável da pasta.
 *
 * O QUE AINDA É MANUAL (e por quê):
 *   - `classificacao_tributaria.json` e `reforma_tributaria_por_ncm.json`
 *     vêm do Portal CFF (SVRS): exigem navegador/sessão — o portal não
 *     oferece download programático público (403 na API). O script avisa
 *     quando estão velhos (> 120 dias) e imprime o passo a passo.
 *   - `NBS SERVIÇOS.json` (vínculos da Reforma, LC 214/2025) — idem CFF:
 *     materializa o Anexo II da LC 214/2025. Manual, com aviso de idade.
 *   - `CNAE X ANEXO.json`, `CNAE X NBS.qualclasstrib.json`, `cest.json`,
 *     `cfop.json` — arquivos vivos/derivados mantidos no projeto (fontes
 *     documentadas no README de bases-fonte). Só carimba o FONTES.json.
 *
 * USO:
 *   node scripts/fontes-sync.mjs            # tudo (recomendado)
 *   node scripts/fontes-sync.mjs --check    # só verifica (não baixa nada)
 *   node scripts/fontes-sync.mjs --only=nbs # só uma fonte (nbs|depara|ncm)
 *   node scripts/fontes-sync.mjs --full     # NBS com NEBS/notas completas (~6 MB)
 *
 * Nada aqui toca em `public/base/` — isso é trabalho do `npm run base`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FONTES = path.join(ROOT, 'bases-fonte');
const HISTORICO = path.join(FONTES, '.historico');
const OUT_NBS = path.join(FONTES, 'NBS 2.00 (oficial).json');
const OUT_DEPARA = path.join(FONTES, 'NBS DE-PARA (oficial).json');
const CSV_DEPARA = path.join(FONTES, 'NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const FULL = args.includes('--full');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? null;

const PBI_KEY = '9e9a95cb-a5c4-4468-a1bf-f20671a1f660';
const PBI_CLUSTER = 'https://wabi-brazil-south-b-primary-api.analysis.windows.net';
const PBI_DATASET_ID = 'cd781b71-cbf2-4b38-8699-9662e632c6c8';
const PBI_MODEL_ID = 8814089;
const PBI_URL = 'https://app.powerbi.com/view?r=eyJrIjoiOWU5YTk1Y2ItYTVjNC00NDY4LWExYmYtZjIwNjcxYTFmNjYwIiwidCI6IjQ1NjIxM2NmLTcwNzMtNDdjNi1iZjQ5LTQxYjY1NGFkNDQ5YiJ9';
const MDIC_CORRELACOES = 'https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/correlacoes';
const MDIC_PAINEL = 'https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/painel-de-codigos-nbs';
const MDIC_NORMATIVO = 'https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos/normativo';
const SISCOMEX_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json';
const CFF_PORTAL = 'https://dfe-portal.svrs.rs.gov.br/Cff';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const hoje = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};
const horasDesde = (mtime) => (Date.now() - mtime) / 3_600_000;
const mb = (b) => (b / 1024 / 1024).toFixed(2);

// ---------------------------------------------------------------------------
// 1) Power BI (anônimo, publish-to-web) — decodificador DSR enxuto
// ---------------------------------------------------------------------------

const PBI_FULL_EXTRA = {
  capitulos: ['Nota Legal', 'Nota Explicativa'],
  posicoes: ['Nota Legal', 'Nota Explicativa'],
  subposicoes_1_nivel: ['Nota Legal', 'Nota Explicativa'],
  subposicoes_2_nivel: ['Nota Legal', 'Nota Explicativa'],
  itens: ['Nota Legal', 'Nota Explicativa'],
  subitens: ['HTML_NEBS', 'Nota Legal', 'Nota Explicativa'],
};

async function pbiQuery(entity, columns) {
  const sel = columns.map((p) => ({ Column: { Expression: { SourceRef: { Source: 't' } }, Property: p }, Name: `${entity}.${p}` }));
  const grp = columns.map((p) => ({ Column: { Expression: { SourceRef: { Source: 't' } }, Property: p }, Name: `${entity}.${p}` }));
  const proj = columns.map((p) => ({
    Select: [{ Column: { Expression: { SourceRef: { Source: 't' } }, Property: p } }],
    Name: `${entity}.${p}`, NativeReferenceName: p,
  }));
  const body = {
    version: '1.0.0',
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: {
        Query: { Version: 2, From: [{ Name: 't', Entity: entity, Type: 0 }], Select: sel, Top: 100000 },
        Binding: {
          Primary: { GroupBy: grp, Groupings: [{ Projections: columns.map((_, i) => i) }], Projections: columns.map((_, i) => i) },
          DataShapes: { Projections: proj },
        },
      } }] },
      ApplicationContext: { DatasetId: PBI_DATASET_ID },
    }],
    modelId: PBI_MODEL_ID,
  };
  const r = await fetch(`${PBI_CLUSTER}/public/reports/querydata`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-PowerBI-ResourceKey': PBI_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Power BI HTTP ${r.status}`);
  const j = JSON.parse(await r.text());
  const res = j.results?.[0]?.result;
  if (!res?.data) throw new Error('Power BI sem dados: ' + JSON.stringify(j).slice(0, 300));
  const dsShapes = res.data.dsr?.DataShapes;
  if (dsShapes?.[0]?.['odata.error']) throw new Error('Power BI API error: ' + JSON.stringify(dsShapes[0]['odata.error']).slice(0, 300));
  return res.data.dsr.DS[0];
}

function decodeDsr(ds, columns) {
  const dicts = ds.ValueDicts ?? {};
  const entries = ds.PH?.[0]?.DM0 ?? [];
  let schema = null;
  const out = [];
  let prev = null;
  for (const entry of entries) {
    if (entry.S) schema = entry.S;
    if (!entry.C) continue;
    const n = schema.length;
    const bits = (entry.R ?? 0) | (entry['Ø'] ?? 0);
    const values = new Array(n).fill(null);
    let ci = 0;
    for (let i = 0; i < n; i++) {
      if (bits & (1 << i)) { values[i] = prev ? prev[i] : null; continue; }
      if (ci < entry.C.length) {
        let v = entry.C[ci++];
        if (schema[i].T === 1) {
          if (typeof v === 'number') v = dicts[schema[i].DN]?.[v] ?? null;
        } else if (v === undefined) v = null;
        values[i] = v;
      }
    }
    prev = values;
    const row = {};
    for (let i = 0; i < n; i++) row[columns[i]] = values[i];
    out.push(row);
  }
  return out;
}

const ENTITY_MAP = {
  secoes: ['Secoes', ['Codigo_Secao', 'Descricao', 'Chave_Composta_Secao', 'Versao']],
  capitulos: ['Capitulos', ['Codigo_Capitulo', 'Chave_Composta_Capitulo', 'Descricao', 'Versao']],
  posicoes: ['Posicoes', ['Descricao', 'Codigo_Posicao', 'Chave_Composta_Posicao', 'Chave_Composta_Capitulo', 'Versao']],
  subposicoes_1_nivel: ['Subposicoes_1_Nivel', ['Descricao', 'Codigo_Subposicao_1_Nivel', 'Chave_Composta_Subposicao_1_Nivel', 'Chave_Composta_Posicao', 'Versao']],
  subposicoes_2_nivel: ['Subposicoes_2_Nivel', ['Descricao', 'Codigo_Subposicao_2_Nivel', 'Chave_Composta_Subposicao_1_Nivel', 'Chave_Composta_Subposicao_2_Nivel', 'Versao']],
  itens: ['Itens', ['Descricao', 'Codigo_Item', 'Chave_Composta_Item', 'Chave_Composta_Subposicao_2_Nivel', 'Versao']],
  subitens: ['Subitens', ['Descricao', 'Codigo_Subitem', 'Chave_Composta_Subitem', 'Chave_Composta_Item', 'Versao']],
};

async function syncNbs() {
  console.log('\n▶ NBS 2.00 (oficial) — painel MDIC (Power BI)');
  if (CHECK_ONLY) return verificarFrescor(OUT_NBS, 'NBS 2.00 (oficial).json');
  const dump = {
    schema: 1,
    tipo: 'nbs-oficial-dump',
    meta: {
      fonte: 'MDIC — Painel de Códigos NBS (Power BI, publish-to-web)',
      url: PBI_URL,
      norma: 'Portaria Conjunta RFB/SCS nº 2.000, de 18/12/2018 (Anexos I e II da Portaria Conjunta nº 1.429/2018)',
      versao: 'NBS_2.00',
      capturaEm: new Date().toISOString(),
      refreshModelo: null,
      entidades: {},
    },
  };
  // metadados do modelo (última atualização)
  try {
    const r = await fetch(`${PBI_CLUSTER}/public/reports/${PBI_KEY}/modelsAndExploration?preferReadOnlySession=true`, {
      headers: { Accept: 'application/json', 'X-PowerBI-ResourceKey': PBI_KEY },
      signal: AbortSignal.timeout(60_000),
    });
    const j = JSON.parse(await r.text());
    dump.meta.refreshModelo = j?.models?.[0]?.lastRefreshTime ?? null;
    // Power BI devolve data em formato .NET (/Date(1794418922477)/) — normalizamos p/ ISO
    const mData = /\/Date\((\d+)\)\//.exec(String(dump.meta.refreshModelo ?? ''));
    if (mData) dump.meta.refreshModelo = new Date(Number(mData[1])).toISOString();
    dump.meta.modelo = j?.models?.[0]?.displayName ?? null;
  } catch (e) {
    console.log(`   (aviso) não consegui ler o carimbo do modelo: ${String(e).split('\n')[0]}`);
  }
  for (const [chave, [entity, baseCols]] of Object.entries(ENTITY_MAP)) {
    const cols = [...baseCols, ...(FULL ? (PBI_FULL_EXTRA[chave] ?? []) : [])];
    const ds = await pbiQuery(entity, cols);
    const rows = decodeDsr(ds, cols);
    dump[chave] = rows;
    dump.meta.entidades[entity] = rows.length;
    console.log(`   ✔ ${entity.padEnd(20)} ${rows.length} registros`);
  }
  dump.meta.totalHierarquia = Object.values(dump.meta.entidades).reduce((a, b) => a + b, 0);
  const buf = Buffer.from(JSON.stringify(dump, null, FULL ? 1 : 0), 'utf8');
  fs.writeFileSync(OUT_NBS, buf);
  console.log(`   → ${path.relative(ROOT, OUT_NBS)} (${mb(buf.length)} MB, sha256 ${sha256(buf).slice(0, 12)}…)`);
  return true;
}

// ---------------------------------------------------------------------------
// 2) DE-PARA NBS 1.1 → 2.0 — normaliza o CSV oficial para JSON
// ---------------------------------------------------------------------------

function parseCsvSemicolon(texto) {
  // Parser RFC 4180 completo: campos entre aspas podem conter ";" e quebras
  // de linha (a planilha oficial tem descrições multi-linha).
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (inQ) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ';') { row.push(cur); cur = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; continue; }
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const dig = (v) => String(v ?? '').replace(/\D/g, '');
const fmtDotted = (d) => {
  // formato oficial com pontos a partir dos dígitos (1.0101.11.00 etc.)
  if (d.length === 3) return `1.${d.slice(1)}`;
  if (d.length === 5) return `1.${d.slice(1)}`;
  if (d.length === 6) return `1.${d.slice(1, 5)}.${d.slice(5)}`;
  if (d.length === 7) return `1.${d.slice(1, 5)}.${d.slice(5)}`;
  if (d.length === 8) return `1.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7)}`;
  if (d.length === 9) return `1.${d.slice(1, 5)}.${d.slice(5, 7)}.${d.slice(7, 9)}`;
  return d;
};

function nivelDe(d) {
  // d = dígitos do código (3 a 9) OU '' (seção romana → 'secao')
  if (!d) return 'secao';
  if (d.length <= 3) return 'capitulo';
  if (d.length === 5) return 'posicao';
  if (d.length === 6) return 'subposicao1';
  if (d.length === 7) return 'subposicao2';
  if (d.length === 8) return 'item';
  return 'subitem';
}

async function syncDepara() {
  console.log('\n▶ DE-PARA NBS 1.1 → 2.0 — planilha oficial de correlação (MDIC)');
  if (CHECK_ONLY) return verificarFrescor(OUT_DEPARA, 'NBS DE-PARA (oficial).json');
  if (!fs.existsSync(CSV_DEPARA)) {
    console.log('   ✖ CSV de-para não encontrado em bases-fonte/.');
    console.log('     Baixe a "Planilha de Correlação entre as versões 1.1 e 2.0 da NBS" em:');
    console.log(`     ${MDIC_CORRELACOES}`);
    console.log('     Arquivo: NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018.xlsx — exporte a aba "Planilha1" como CSV (separador ";", encoding Latin-1)');
    console.log('     e salve como: bases-fonte/NBSa_DE-PARAa_COMPILADOa_FINALa_05a_deza_2018(Planilha1).csv');
    return false;
  }
  const csvBuf = fs.readFileSync(CSV_DEPARA);
  const texto = csvBuf.toString('latin1').replace(/^﻿/, '');
  const linhas = parseCsvSemicolon(texto);
  const header = linhas[0].map((h) => h.trim()).join('|');
  if (!/NBS 1\.1/.test(header) || !/NBS 2\.0/.test(header)) {
    throw new Error(`CSV de-para com cabeçalho inesperado: "${header}"`);
  }
  const itens = [];
  let identidade = 0, migrados = 0, extintos = 0, novos = 0;
  for (const r of linhas.slice(1)) {
    const d11 = dig(r[0]);
    const d20 = dig(r[2]);
    const desc11 = String(r[1] ?? '').trim();
    const desc20 = String(r[3] ?? '').trim();
    if (!d11 && !d20) continue;
    const identico = !!(d11 && d20 && d11 === d20);
    if (d11 && d20) { if (identico) identidade++; else migrados++; }
    else if (d11) extintos++; else novos++;
    itens.push({
      nbs11: d11 || null,
      nbs11Formatado: d11 ? fmtDotted(d11) : null,
      desc11: desc11 || null,
      nbs20: d20 || null,
      nbs20Formatado: d20 ? fmtDotted(d20) : null,
      desc20: desc20 || null,
      identico,
      relacao: d11 && d20 ? 'mapeado' : d11 ? 'extinto' : 'novo',
      nivel: nivelDe(d20 || d11),
    });
  }
  const out = {
    schema: 1,
    tipo: 'nbs-depara',
    meta: {
      fonte: 'MDIC — Correlações entre versões da NBS ("Planilha de Correlação entre as versões 1.1 e 2.0 da NBS", elaborada pela Comissão da NBS em 2019)',
      url: MDIC_CORRELACOES,
      arquivoOrigem: path.basename(CSV_DEPARA),
      sha256Csv: sha256(csvBuf),
      norma: 'Portaria Conjunta RFB/SCS nº 2.000/2018 e Portaria Conjunta RFB/SCS nº 1.820/2013 (NBS 1.1)',
      capturaEm: fs.statSync(CSV_DEPARA).mtime.toISOString(),
      convertidaEm: new Date().toISOString(),
      total: itens.length,
      mapeados: identidade + migrados,
      identidade,
      migrados,
      extintos,
      novos,
      nota: 'Tabela de orientação (não tem caráter oficial de classificação); a classificação NBS é definida pela RFB/SCS. NBS 1.1 = Portaria Conjunta 1.820/2013; NBS 2.0 = Portaria Conjunta 2.000/2018.',
    },
    itens,
  };
  const buf = Buffer.from(JSON.stringify(out), 'utf8');
  fs.writeFileSync(OUT_DEPARA, buf);
  console.log(`   total: ${itens.length} | mapeados: ${identidade + migrados} (identidade ${identidade} · migrados ${migrados}) | extintos: ${extintos} | novos: ${novos}`);
  console.log(`   → ${path.relative(ROOT, OUT_DEPARA)} (${mb(buf.length)} MB, sha256 ${sha256(buf).slice(0, 12)}…)`);
  return true;
}

// ---------------------------------------------------------------------------
// 3) NCM — Portal Único Siscomex (download público do JSON vigente)
// ---------------------------------------------------------------------------

function verificarFrescor(arquivo, rotulo) {
  if (!fs.existsSync(arquivo)) { console.log(`   ✖ ${rotulo}: AUSENTE`); return false; }
  const st = fs.statSync(arquivo);
  const idadeDias = (horasDesde(st.mtimeMs) / 24).toFixed(1);
  console.log(`   ● ${rotulo}: ${mb(st.size)} MB · ${idadeDias} dias · sha256 ${sha256(fs.readFileSync(arquivo)).slice(0, 12)}…`);
  return true;
}

async function syncNcm() {
  console.log('\n▶ NCM (nomenclatura vigente) — Portal Único Siscomex');
  if (CHECK_ONLY) {
    const achados = fs.readdirSync(FONTES).filter((f) => /^Tabela_NCM_Vigente_.*\.json$/.test(f));
    return verificarFrescor(achados.length ? path.join(FONTES, achados.sort().at(-1)) : path.join(FONTES, '__inexistente__'), 'Tabela_NCM_Vigente_*.json');
  }
  const r = await fetch(SISCOMEX_NCM, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Siscomex HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const nome = `Tabela_NCM_Vigente_${hoje()}.json`;
  // move versões anteriores para .historico (nada apagado)
  const anteriores = fs.readdirSync(FONTES).filter((f) => /^Tabela_NCM_Vigente_.*\.json$/.test(f));
  fs.mkdirSync(HISTORICO, { recursive: true });
  for (const f of anteriores) {
    fs.renameSync(path.join(FONTES, f), path.join(HISTORICO, f));
    console.log(`   ↪ ${f} → .historico/${f}`);
  }
  fs.writeFileSync(path.join(FONTES, nome), buf);
  console.log(`   ✔ ${nome} (${mb(buf.length)} MB, sha256 ${sha256(buf).slice(0, 12)}…)`);
  return true;
}

// ---------------------------------------------------------------------------
// 4) Conferência geral das fontes + FONTES.json (mapa auditável)
// ---------------------------------------------------------------------------

const REGISTRO_FONTES = [
  { nome: 'NBS 2.00 (oficial)', arquivo: 'NBS 2.00 (oficial).json', automatico: true, fonte: 'MDIC/Power BI — Painel de Códigos NBS', url: MDIC_PAINEL, licenca: 'Publicação oficial MDIC/RFB/SCS — Portaria Conjunta RFB/SCS nº 2.000/2018', cmd: 'npm run fontes:sync -- --only=nbs' },
  { nome: 'DE-PARA NBS 1.1 ↔ 2.0', arquivo: 'NBS DE-PARA (oficial).json', automatico: true, fonte: 'MDIC — Correlações NBS', url: MDIC_CORRELACOES, licenca: 'Publicação oficial MDIC — orientação de migração (não é classificação)', cmd: 'npm run fontes:sync -- --only=depara' },
  { nome: 'Tabela NCM vigente', arquivo: 'Tabela_NCM_Vigente_*.json', automatico: true, fonte: 'Portal Único Siscomex', url: 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura', licenca: 'Publicação oficial RFB/Gecex', cmd: 'npm run fontes:sync -- --only=ncm' },
  { nome: 'Referência classificação tributária (CST × cClassTrib)', arquivo: 'classificacao_tributaria.json', automatico: false, fonte: 'Portal CFF (SVRS) — Classificação Tributária', url: CFF_PORTAL, licenca: 'Publicação oficial RFB — LC 214/2025', cmd: 'manual: Portal CFF → Classificação Tributária → baixar JSON' },
  { nome: 'Reforma por NCM/NBS (LC 214/2025)', arquivo: 'reforma_tributaria_por_ncm.json', automatico: false, fonte: 'Portal CFF (SVRS) — exportação "Reforma Tributária consulta por NCM"', url: CFF_PORTAL, licenca: 'Publicação oficial RFB — LC 214/2025', cmd: 'manual: Portal CFF → exportar "Reforma Tributária consulta por NCM" (xlsx) e converter para JSON' },
  { nome: 'NBS — vínculos da Reforma (Anexo II LC 214/2025)', arquivo: 'NBS SERVIÇOS.json', automatico: false, fonte: 'Portal CFF (SVRS) — Anexo II LC 214/2025 com NBS', url: CFF_PORTAL, licenca: 'Publicação oficial RFB — LC 214/2025', cmd: 'manual: Portal CFF → Anexo II LC 214/2025 (exportar/transcrever vínculos NBS)' },
  { nome: 'CNAE × Anexo Simples (vivo)', arquivo: 'CNAE X ANEXO.json', automatico: false, fonte: 'arquivo vivo do projeto (sem URL única oficial)', url: null, licenca: 'curadoria do projeto', cmd: 'manual: manter atualizado com a tabela vigente do Simples' },
  { nome: 'Ponte CNAE → NBS (não-oficial)', arquivo: 'CNAE X NBS.qualclasstrib.json', automatico: false, fonte: 'qualclasstrib.com.br (captura manual)', url: 'https://www.qualclasstrib.com.br', licenca: 'sem licença declarada — candidatos, verdade fiscal só do resolvedor oficial', cmd: 'manual: re-capturar quando o Simples/NBS mudar' },
  { nome: 'CEST', arquivo: 'cest.json', automatico: false, fonte: 'arquivo vivo do projeto', url: null, licenca: 'curadoria do projeto', cmd: 'manual' },
  { nome: 'CFOP', arquivo: 'cfop.json', automatico: false, fonte: 'arquivo vivo do projeto', url: null, licenca: 'curadoria do projeto', cmd: 'manual' },
  { nome: 'CNAE completo', arquivo: 'cnae.json', automatico: false, fonte: 'legado — ignorado pela compilação (substituído pelo gerado public/base/cnae.json)', url: null, licenca: 'legado', cmd: 'pode apagar' },
  { nome: 'CNAE MEI', arquivo: 'mei_cnaes.json', automatico: false, fonte: 'legado — ignorado pela compilação', url: null, licenca: 'legado', cmd: 'pode apagar' },
];

function listarFontes() {
  const achados = [];
  for (const reg of REGISTRO_FONTES) {
    if (reg.arquivo.includes('*')) {
      const prefixo = reg.arquivo.split('*')[0];
      const matches = fs.readdirSync(FONTES).filter((f) => f.startsWith(prefixo)).sort();
      achados.push({ ...reg, arquivoEfetivo: matches.at(-1) ?? null, todos: matches });
    } else {
      achados.push({ ...reg, arquivoEfetivo: fs.existsSync(path.join(FONTES, reg.arquivo)) ? reg.arquivo : null });
    }
  }
  return achados;
}

function escreverFontesJson(achados) {
  const entradas = [];
  for (const reg of achados) {
    const arquivo = reg.arquivoEfetivo;
    if (!arquivo) { entradas.push({ ...reg, existe: false }); continue; }
    const p = path.join(FONTES, arquivo);
    const st = fs.statSync(p);
    entradas.push({
      ...reg,
      existe: true,
      arquivo,
      bytes: st.size,
      atualizadoEm: st.mtime.toISOString(),
      sha256: sha256(fs.readFileSync(p)),
    });
  }
  const out = {
    schema: 1,
    tipo: 'registro-fontes',
    geradoEm: new Date().toISOString(),
    pasta: 'bases-fonte/',
    regra: 'em toda nova compilação do software: rode `npm run fontes:sync` (troca/baixa o que é automático), confira o restante e então `npm run base` (ou `npm run build`)',
    fontes: entradas,
  };
  const buf = Buffer.from(JSON.stringify(out, null, 1), 'utf8');
  fs.writeFileSync(path.join(FONTES, 'FONTES.json'), buf);
  console.log(`\n→ bases-fonte/FONTES.json (${mb(buf.length)} MB... mapa auditável com ${entradas.length} fontes)`);
}

function imprimirConferencia(achados) {
  console.log('\n▶ Conferência das fontes (frescor/integridade)');
  const agora = Date.now();
  for (const reg of achados) {
    const arquivo = reg.arquivoEfetivo;
    if (!arquivo) { console.log(`   ✖ ${reg.nome}: AUSENTE — ${reg.cmd}`); continue; }
    const p = path.join(FONTES, arquivo);
    const idadeDias = (agora - fs.statSync(p).mtimeMs) / 86_400_000;
    const flag = reg.automatico ? 'auto' : 'manual';
    const alerta = idadeDias > 120 ? '  ⚠ >120 dias — verificar se há versão nova' : '';
    console.log(`   ● [${flag.padEnd(6)}] ${reg.nome.padEnd(58)} ${idadeDias.toFixed(0)}d${alerta}`);
  }
  console.log('\n   Fontes manuais (passo a passo no README de bases-fonte):');
  console.log(`   - Classificação tributária / reforma / Anexo II (NBS SERVIÇOS): ${CFF_PORTAL}`);
  console.log(`   - NBS 2.0 (normativo): ${MDIC_NORMATIVO}`);
  console.log(`   - NBS correlações:     ${MDIC_CORRELACOES}`);
  console.log(`   - NBS painel oficial:  ${MDIC_PAINEL}`);
}

// ---------------------------------------------------------------------------

(async () => {
  console.log(' Aurum Tax NCM — sincronização das fontes oficiais (plug-in pull)');
  console.log(`   modo: ${CHECK_ONLY ? '--check (somente verificação)' : 'sincronizar'}${FULL ? ' · --full (NBS com notas)' : ''}${ONLY ? ` · --only=${ONLY}` : ''}`);

  const fazer = (nome) => !ONLY || ONLY === nome;
  if (fazer('nbs')) await syncNbs().catch((e) => { console.error(`   ✖ NBS: ${e.message}`); process.exitCode = 1; });
  if (fazer('depara')) await syncDepara().catch((e) => { console.error(`   ✖ DE-PARA: ${e.message}`); process.exitCode = 1; });
  if (fazer('ncm')) await syncNcm().catch((e) => { console.error(`   ✖ NCM: ${e.message}`); process.exitCode = 1; });

  const achados = listarFontes();
  imprimirConferencia(achados);
  if (!CHECK_ONLY) escreverFontesJson(achados);

  console.log('\n✔ Sincronização concluída. Próximo passo: `npm run base` (ou `npm run build`).');
  console.log('  Painel MDIC via publish-to-web: o download lê exatamente o que a página pública expõe (sem login, somente leitura).');
})().catch((err) => {
  console.error(`\n✖ Falha na sincronização: ${err.message}`);
  process.exit(1);
});
