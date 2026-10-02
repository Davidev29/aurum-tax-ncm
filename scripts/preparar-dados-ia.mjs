/**
 * preparar-dados-ia.mjs — Curadoria de Dados NCM-only (Phase 6 / 06-02 / IA-02)
 * ============================================================================
 * Fonte única offline para o módulo IA: join por código de 8 dígitos entre
 *   - public/base/reforma.json                (vínculos NCM × CST × cClassTrib)
 *   - public/base/nomenclatura.json           (descrições vigentes + capítulos)
 *   - public/base/classificacao-tributaria.json (referência CST × cClassTrib)
 *   - public/base/MANIFEST.json               (contagens oficiais + ignorados)
 *
 * Regras:
 *  - SOMENTE NCM de 8 dígitos (reforma.json → ncm). NBS (9 dígitos) excluído.
 *  - Os 10 códigos de 9 dígitos listados em MANIFEST.codigosIgnorados já foram
 *    descartados pelo build-base; este script reafirma o filtro (dígitos != 8 → fora).
 *  - Paridade com montarClassificacao (src/domain/services/classificacao.ts:61):
 *      descricao             = vinculo.descricao || nomenclatura.descricao || ''
 *      descricaoCClassTrib   = cct.nome || cct.descricao || ref.descricao || vinculo.baseLegal || ''
 *      pRedIBS / pRedCBS     = cct ?? ref ?? 0
 *  - descricaoExpandida = descricao + nomenclatura + capítulo (deduplicado).
 *  - Vínculos sem nomenclatura vigente (6 esperados) são mantidos e marcados em `notas`.
 *
 * Saída: recursos-ia/dados-brutos/ncm-para-ia.json  { meta, itens }
 *
 * Uso: node scripts/preparar-dados-ia.mjs
 * Puro Node ESM, sem dependências novas.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(PROJECT_ROOT, 'public', 'base');
const OUT_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'dados-brutos');
const OUT_FILE = path.join(OUT_DIR, 'ncm-para-ia.json');

const EXPECTED_NCM = 2335;

const onlyDigits = (v) => String(v ?? '').replace(/\D+/g, '');

function lerJson(nome) {
  const p = path.join(BASE_DIR, nome);
  if (!fs.existsSync(p)) {
    console.error(`✖ Arquivo ausente: public/base/${nome}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function dedupPartes(partes) {
  const vistas = new Set();
  const out = [];
  for (const p of partes) {
    const t = String(p ?? '').trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const chave = t.toLowerCase();
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(t);
  }
  return out;
}

async function main() {
  const reforma = lerJson('reforma.json');
  const nomenclatura = lerJson('nomenclatura.json');
  const classTrib = lerJson('classificacao-tributaria.json');
  const manifest = lerJson('MANIFEST.json');

  const vinculos = Array.isArray(reforma.ncm) ? reforma.ncm : [];
  const itensNomen = Array.isArray(nomenclatura.itens) ? nomenclatura.itens : [];
  const itensRef = Array.isArray(classTrib.itens) ? classTrib.itens : [];

  const porNomen = new Map(itensNomen.map((n) => [n.codigo, n]));
  const porCapitulo = new Map(
    itensNomen.filter((n) => n.codigo && n.codigo.length === 2).map((n) => [n.codigo, n.descricao]),
  );
  const porCst = new Map((reforma.cst ?? []).map((c) => [c.codigo, c]));
  const porCct = new Map((reforma.cstClassTrib ?? []).map((c) => [c.id, c]));
  const porRef = new Map(itensRef.map((r) => [r.id, r]));

  const ignoradosNoveDigitos = (manifest.codigosIgnorados ?? []).filter((i) =>
    /9 d.gitos/.test(String(i.motivo ?? '')),
  );

  let excluidosNaoNcm = 0;
  const itens = [];

  for (const v of vinculos) {
    const codigo = onlyDigits(v.codigo);
    // Filtro NCM-only: exatamente 8 dígitos. NBS (9) e os 10 códigos de 9
    // dígitos do MANIFEST caem aqui (defesa em profundidade — o build-base
    // já os removeu de reforma.json).
    if (codigo.length !== 8) {
      excluidosNaoNcm += 1;
      continue;
    }

    const nomen = porNomen.get(codigo) ?? null;
    const cstDet = porCst.get(v.cst) ?? null;
    const chave = `${v.cst}|${v.cClassTrib}`;
    const cctDet = porCct.get(chave) ?? null;
    const ref = porRef.get(chave) ?? null;

    // Paridade montarClassificacao (classificacao.ts:69-81,90).
    const descricao = (v.descricao && String(v.descricao).trim()) || nomen?.descricao || '';
    const descricaoCClassTrib =
      cctDet?.nome || cctDet?.descricao || ref?.descricao || v.baseLegal || '';
    const pRedIBS = cctDet?.pRedIBS ?? ref?.pRedIBS ?? 0;
    const pRedCBS = cctDet?.pRedCBS ?? ref?.pRedCBS ?? 0;

    const capCodigo = codigo.slice(0, 2);
    const capDescricao = porCapitulo.get(capCodigo) ?? null;

    const descricaoExpandida = dedupPartes([
      descricao,
      nomen?.descricao && nomen.descricao !== descricao ? nomen.descricao : '',
      capDescricao ? `Capítulo ${capCodigo} — ${capDescricao}` : '',
      descricaoCClassTrib && descricaoCClassTrib !== descricao ? descricaoCClassTrib : '',
    ]).join('. ');

    const notas = [];
    if (!nomen) notas.push('sem-nomenclatura-vigente');
    if (!capDescricao) notas.push('sem-capitulo');
    if (!cctDet) notas.push('sem-cct-auxiliar');
    if (!ref) notas.push('sem-referencia-oficial');
    if (!descricao) notas.push('sem-descricao');

    itens.push({
      codigo,
      codigoFormatado: v.codigoFormatado ?? `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 8)}`,
      capitulo: { codigo: capCodigo, descricao: capDescricao ?? '' },
      descricao,
      nomenclatura: nomen?.descricao ?? null,
      descricaoExpandida,
      cst: v.cst,
      cClassTrib: v.cClassTrib,
      baseLegal: v.baseLegal ?? '',
      descricaoCClassTrib,
      pRedIBS: pRedIBS ?? 0,
      pRedCBS: pRedCBS ?? 0,
      notas,
    });
  }

  // Ordem determinística (mesma do resolverClassificacoes): código, CST, cClassTrib.
  itens.sort((a, b) =>
    a.codigo.localeCompare(b.codigo) ||
    a.cst.localeCompare(b.cst) ||
    a.cClassTrib.localeCompare(b.cClassTrib),
  );

  const semNomen = itens.filter((i) => i.notas.includes('sem-nomenclatura-vigente'));

  const meta = {
    geradoEm: new Date().toISOString(),
    fonte: 'public/base (reforma.json + nomenclatura.json + classificacao-tributaria.json + MANIFEST.json)',
    manifestGeradoEm: manifest.geradoEm ?? null,
    totalVinculos: itens.length,
    totalCodigosDistintos: new Set(itens.map((i) => i.codigo)).size,
    esperadoNcm: EXPECTED_NCM,
    semNomenclatura: semNomen.length,
    codigosSemNomenclatura: [...new Set(semNomen.map((i) => i.codigo))].sort(),
    ignoradosNoveDigitosManifest: ignoradosNoveDigitos.length,
    excluidosNaoNcmNestaEtapa: excluidosNaoNcm,
    filtro: 'NCM-only: somente códigos de 8 dígitos; NBS excluído',
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, Buffer.from(JSON.stringify({ meta, itens }, null, 1), 'utf8'));

  console.log('✔ ncm-para-ia.json gerado');
  console.log(`  vínculos NCM : ${itens.length} (esperado ${EXPECTED_NCM})`);
  console.log(`  códigos únicos: ${meta.totalCodigosDistintos}`);
  console.log(`  sem nomenclatura (vínculos): ${semNomen.length} → ${meta.codigosSemNomenclatura.join(', ')}`);
  console.log(`  9-dígitos no MANIFEST: ${ignoradosNoveDigitos.length} | excluídos aqui: ${excluidosNaoNcm}`);
  console.log(`  saída: recursos-ia/dados-brutos/ncm-para-ia.json`);

  if (itens.length !== EXPECTED_NCM) {
    console.error(`✖ Contagem divergente: obtido ${itens.length}, esperado ${EXPECTED_NCM}.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✖ Falha na curadoria:', err.message);
  process.exit(1);
});
