/**
 * Spike 10-00 — tracer GO/NO-GO do grafo (LadybugDB + fallback).
 *
 * O que prova (sem quebrar o build se o nativo não estiver instalado):
 * 1. schema.cypher contém as tabelas exigidas pelo runtime (NCM/CCT/Anexo/CNAE/NBS + PERTENCE_A/TEM_CLASSIFICACAO/MAPEIA).
 * 2. joins reais da base atual sustentam o schema (NCM 8d vigente + vínculo reforma + CNAE→NBS 508).
 * 3. tenta abrir @ladybugdb/core em Node (proxy do utilityProcess): OK => GO nativo; ausente => NO-GO parcial
 *    (seguir com FTS-puro + instalar `npm i @ladybugdb/core` em 10-02).
 * 4. contrato de fallback: sem .lbug => { ok:false, fallback:'lexical' } (nunca throw no app).
 *
 * Uso: node scripts/grafo/spike-grafo.mjs [--json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const asJson = process.argv.includes('--json');

const schema = readFileSync(join(root, 'scripts', 'grafo', 'schema.cypher'), 'utf8');
const required = ['NCM(', 'CCT(', 'Anexo(', 'CNAE(', 'NBS(', 'PERTENCE_A', 'TEM_CLASSIFICACAO', 'MAPEIA', 'PRIMARY KEY'];
const faltando = required.filter((t) => !schema.includes(t));

const nomenclatura = JSON.parse(readFileSync(join(root, 'public', 'base', 'nomenclatura.json'), 'utf8'));
const reforma = JSON.parse(readFileSync(join(root, 'public', 'base', 'reforma.json'), 'utf8'));
const noms = Array.isArray(nomenclatura) ? nomenclatura : (nomenclatura.itens ?? nomenclatura.nomenclaturas ?? []);
const vinc = Array.isArray(reforma) ? reforma : (reforma.ncm ?? reforma.vinculos ?? []);
const ncm8 = noms.filter((n) => /^\d{8}$/.test(n.codigo ?? n.ncm ?? ''));
const codVinc = new Set(vinc.map((v) => v.ncm ?? v.codigo ?? ''));
const comVinculo = ncm8.filter((n) => codVinc.has(n.codigo ?? n.ncm)).length;

let cnaeNbs = { links: 0 };
try {
  const raw = JSON.parse(readFileSync(join(root, 'public', 'base', 'cnae-nbs.json'), 'utf8'));
  const lista = Array.isArray(raw) ? raw : (raw.links ?? []);
  cnaeNbs.links = Array.isArray(lista) ? lista.length : 0;
} catch { /* base 508 pode não existir em checkout antigo */ }

let ladybug = { instalado: false, abreDb: false, detalhe: '' };
try {
  const lbug = await import('@ladybugdb/core').catch(() => null);
  if (lbug) {
    ladybug.instalado = true;
    try {
      const db = new lbug.Database(':memory:');
      const ConnCtor = db.Connection ?? lbug.Connection;
      if (ConnCtor) {
        const conn = new ConnCtor(db);
        await conn.execute('CREATE NODE TABLE T(id STRING PRIMARY KEY);');
        ladybug.abreDb = true;
        ladybug.detalhe = 'Database :memory: + CREATE NODE TABLE OK';
      } else ladybug.detalhe = 'API inesperada (sem Connection#execute)';
      await db.close?.();
    } catch (e) { ladybug.detalhe = `falha ao abrir: ${String(e).slice(0, 160)}`; }
  } else ladybug.detalhe = '@ladybugdb/core não instalado (npm i @ladybugdb/core em 10-02)';
} catch (e) { ladybug.detalhe = `import falhou: ${String(e).slice(0, 160)}`; }

// Contrato de fallback que o worker vai honrar (10-02):
const fallback = { ok: false, fallback: 'lexical' };

const go = faltando.length === 0 && ncm8.length > 1000 && comVinculo > 100;
const rel = {
  schema: { tabelasExigidas: required.length, faltando, ok: faltando.length === 0 },
  base: { ncm8: ncm8.length, comVinculoExato: comVinculo, cnaeNbsLinks: cnaeNbs.links },
  ladybug,
  fallbackContrato: fallback,
  veredito: go ? (ladybug.abreDb ? 'GO (nativo OK)' : 'GO parcial (schema+base OK; instalar nativo em 10-02)') : 'NO-GO',
};

if (asJson) console.log(JSON.stringify(rel));
else {
  console.log('— spike-grafo 10-00 —');
  console.log(`schema: ${rel.schema.ok ? 'OK' : 'FALTANDO ' + faltando.join(',')}`);
  console.log(`base: ncm8=${rel.base.ncm8} comVinculo=${rel.base.comVinculoExato} cnaeNbsLinks=${rel.base.cnaeNbsLinks}`);
  console.log(`ladybug: instalado=${ladybug.instalado} abreDb=${ladybug.abreDb} (${ladybug.detalhe})`);
  console.log(`fallback sem .lbug: ${JSON.stringify(fallback)}`);
  console.log(`veredito: ${rel.veredito}`);
}
process.exit(go ? 0 : 1);
