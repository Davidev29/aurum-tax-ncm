/**
 * validar-dados-ia.mjs — Validador da base NCM-only (Phase 6 / 06-02 / IA-02)
 * ==========================================================================
 * Checagens:
 *  1. Unicidade do vínculo (codigo|cst|cClassTrib) — o mesmo NCM pode ter 2
 *     vínculos (ex. cereais com reduções distintas), então a chave única é o
 *     vínculo, não o código isolado.
 *  2. Completude: codigo (8 dígitos), descricao, capitulo.codigo/descricao
 *     e descricaoExpandida não vazios.
 *  3. Integridade cClassTrib: formato 6 dígitos + par CST×cClassTrib existente
 *     em reforma.json (tabelas auxiliares).
 *  4. Contagem EXATA de 2335 vínculos NCM.
 *  5. Amostragem de 5 códigos contra a base vigente (reforma + nomenclatura):
 *     confere descricao/capitulo/cClassTrib e imprime para auditoria manual.
 *
 * Uso: node scripts/validar-dados-ia.mjs
 * Exit 0 se OK; exit 1 com o motivo se houver falha.
 * Puro Node ESM, sem dependências novas.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(PROJECT_ROOT, 'public', 'base');
const DADOS = path.join(PROJECT_ROOT, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json');

const ESPERADO = 2335;
// 5 códigos de amostragem: cobertura de capítulos distintos + 1 sem nomenclatura.
const AMOSTRA = ['02011000', '10063021', '22029900', '85171490', '02071400'];

const falhas = [];
const avisos = [];
const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg) => { falhas.push(msg); console.error(`  ✖ ${msg}`); };
const warn = (msg) => { avisos.push(msg); console.warn(`  ⚠ ${msg}`); };

function lerJson(p) {
  if (!fs.existsSync(p)) {
    fail(`Arquivo ausente: ${path.relative(PROJECT_ROOT, p)}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  console.log('Aurum Tax NCM — validação da base IA (NCM-only)');

  const dados = lerJson(DADOS);
  const reforma = lerJson(path.join(BASE_DIR, 'reforma.json'));
  const nomenclatura = lerJson(path.join(BASE_DIR, 'nomenclatura.json'));

  const itens = dados.itens ?? [];
  const paresVigentes = new Set((reforma.cstClassTrib ?? []).map((c) => `${c.cst}|${c.cClassTrib}`));
  const porNomen = new Map((nomenclatura.itens ?? []).map((n) => [n.codigo, n.descricao]));
  const vinculoBase = new Map((reforma.ncm ?? []).map((v) => [`${v.codigo}|${v.cst}|${v.cClassTrib}`, v]));

  // 4. Contagem exata
  if (itens.length === ESPERADO) ok(`contagem exata: ${itens.length} vínculos NCM`);
  else fail(`contagem: obtido ${itens.length}, esperado ${ESPERADO}`);

  // 1. Unicidade do vínculo
  const chaves = itens.map((i) => `${i.codigo}|${i.cst}|${i.cClassTrib}`);
  const dup = chaves.length - new Set(chaves).size;
  if (dup === 0) ok(`unicidade: ${chaves.length} chaves (codigo|cst|cClassTrib) sem duplicata`);
  else fail(`unicidade: ${dup} chaves de vínculo duplicadas`);

  // NBS / 9-dígitos não podem vazar para a base IA
  const naoNcm = itens.filter((i) => !/^\d{8}$/.test(i.codigo || ''));
  if (naoNcm.length === 0) ok('filtro NCM-only: nenhum código fora de 8 dígitos');
  else fail(`filtro NCM-only: ${naoNcm.length} registros fora de 8 dígitos (ex.: ${naoNcm[0]?.codigo})`);

  // 2. Completude
  const incompletos = itens.filter(
    (i) => !i.codigo || !i.descricao || !i.capitulo?.codigo || !i.capitulo?.descricao || !i.descricaoExpandida,
  );
  if (incompletos.length === 0) ok('completude: codigo/descricao/capitulo/descricaoExpandida preenchidos');
  else fail(`completude: ${incompletos.length} itens incompletos (ex.: ${incompletos[0]?.codigo})`);

  // 3. Integridade cClassTrib
  const formatoRuim = itens.filter((i) => !/^\d{6}$/.test(i.cClassTrib || ''));
  if (formatoRuim.length === 0) ok('cClassTrib: formato 6 dígitos em todos os itens');
  else fail(`cClassTrib: ${formatoRuim.length} fora do formato (ex.: ${formatoRuim[0]?.codigo})`);

  const parAusente = itens.filter((i) => !paresVigentes.has(`${i.cst}|${i.cClassTrib}`));
  if (parAusente.length === 0) ok('cClassTrib: todos os pares CST×cClassTrib existem em reforma.json');
  else fail(`cClassTrib: ${parAusente.length} pares ausentes da tabela auxiliar (ex.: ${parAusente[0]?.cst}|${parAusente[0]?.cClassTrib})`);

  // Sem-nomenclatura: esperado 6 vínculos, preservados e marcados
  const semNomen = itens.filter((i) => (i.notas ?? []).includes('sem-nomenclatura-vigente'));
  if (semNomen.length === 6) ok('sem-nomenclatura: 6 vínculos marcados em `notas` (paridade MANIFEST)');
  else fail(`sem-nomenclatura: ${semNomen.length} marcados, esperado 6`);

  // 5. Amostragem de 5 códigos vs tabela vigente
  console.log('\nAmostragem (vs reforma.json + nomenclatura.json):');
  let amostraOk = 0;
  for (const cod of AMOSTRA) {
    const item = itens.find((i) => i.codigo === cod);
    if (!item) { fail(`amostra ${cod}: ausente da base IA`); continue; }
    const chave = `${item.codigo}|${item.cst}|${item.cClassTrib}`;
    const base = vinculoBase.get(chave) ?? (reforma.ncm ?? []).find((v) => v.codigo === cod);
    if (!base) { fail(`amostra ${cod}: sem correspondente em reforma.json`); continue; }
    const nomenEsperada = porNomen.get(cod) ?? null;
    const problemas = [];
    if (!item.descricao) problemas.push('descricao vazia');
    if (!item.capitulo?.descricao) problemas.push('capitulo vazio');
    if (item.cClassTrib !== base.cClassTrib) problemas.push(`cClassTrib ${item.cClassTrib} ≠ base ${base.cClassTrib}`);
    if ((nomenEsperada ?? null) !== item.nomenclatura) problemas.push('nomenclatura divergente da vigente');
    if (problemas.length) fail(`amostra ${cod}: ${problemas.join('; ')}`);
    else {
      amostraOk += 1;
      console.log(`  ✔ ${cod} | CST ${item.cst} × ${item.cClassTrib} | cap.${item.capitulo.codigo} ${item.capitulo.descricao} | "${String(item.nomenclatura ?? item.descricao).slice(0, 70)}"`);
    }
  }
  if (amostraOk === AMOSTRA.length) ok(`amostragem: ${amostraOk}/${AMOSTRA.length} códigos conferidos`);

  console.log(`\nResumo: ${itens.length} itens · ${falhas.length} falha(s) · ${avisos.length} aviso(s)`);
  if (falhas.length) process.exit(1);
  console.log('✔ Base IA válida (exit 0).');
}

main();
