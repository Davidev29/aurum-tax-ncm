/**
 * testar-indice-ia.mjs — Asserts do índice RAG NCM (Phase 6 / 06-03 / IA-03)
 * ============================================================================
 * Casos (somente capítulos NCM — NBS fora de escopo):
 *   1. "Frango vivo"   → cap. 01 presente no top-3
 *   2. "Arroz branco"   → cap. 10 no top-1 (e no top-3)
 *   3. "Notebook"       → cap. 84 ou 85 presente no top-5
 *
 * Opera sobre o índice lexical fallback (`recursos-ia/indice-ncm/
 * indice-lexical.json`) via `buscarIndice()` de `gerar-indice-ia.mjs` — quando
 * o índice vetorial Vectra existir (06-05, com rede), os mesmos asserts passam
 * a consultar o backend vetorial sem mudar os casos.
 *
 * Uso: node scripts/testar-indice-ia.mjs
 * Exit 1 se qualquer assert falhar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buscarIndice, carregarIndice } from './gerar-indice-ia.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDICE_DIR = path.join(PROJECT_ROOT, 'recursos-ia', 'indice-ncm');

const CASOS = [
  { consulta: 'Frango vivo', topK: 3, capitulos: ['01'] },
  { consulta: 'Arroz branco', topK: 3, capitulos: ['10'], top1: ['10'] },
  { consulta: 'Notebook', topK: 5, capitulos: ['84', '85'] },
  // Base de conhecimento v1 — só casos COM vínculo na Reforma (o índice
  // lexical cobre os 2335 vínculos; NCMs de regra geral sem vínculo são
  // cobertos em runtime pelo dicionário comercial + resolvedor, com testes
  // em tests/dicionario-comercial.test.ts e scripts/validar-conhecimento.mjs).
  { consulta: 'parmesao', topK: 5, capitulos: ['04'] },
  { consulta: 'parmezao', topK: 5, capitulos: ['04'] },
  { consulta: 'queijo ralado', topK: 5, capitulos: ['04'] },
  { consulta: 'smartphone samsung', topK: 5, capitulos: ['85'] },
  { consulta: 'celula', topK: 5, capitulos: ['85'] },
  { consulta: 'notbook', topK: 5, capitulos: ['84', '85'] },
  { consulta: 'whey protein', topK: 5, capitulos: ['21'] },
  { consulta: 'suplemento alimentar', topK: 5, capitulos: ['21'] },
  { consulta: 'fralda descartavel', topK: 5, capitulos: ['96'] },
  { consulta: 'telefone inteligente', topK: 5, capitulos: ['85'] },
  { consulta: 'saco de cimento', topK: 5, capitulos: ['25'] },
  { consulta: 'sabonete em barra', topK: 5, capitulos: ['34'] },
];

function tamanhoIndiceBytes() {
  let total = 0;
  if (!fs.existsSync(INDICE_DIR)) return 0;
  for (const f of fs.readdirSync(INDICE_DIR)) {
    const st = fs.statSync(path.join(INDICE_DIR, f));
    if (st.isFile()) total += st.size;
  }
  return total;
}

function main() {
  console.log(' Aurum Tax NCM — teste do índice IA (06-03 / IA-03)');
  const indice = carregarIndice();
  console.log(`   índice: ${indice.tipo} · ${indice.totalDocs} docs · gerado em ${indice.geradoEm}`);

  let falhas = 0;
  for (const caso of CASOS) {
    const hits = buscarIndice(indice, caso.consulta, caso.topK);
    console.log(`\n “${caso.consulta}” (top-${caso.topK}):`);
    for (const h of hits) {
      console.log(`   ${h.codigo}  cap.${h.capitulo}  score=${h.score.toFixed(3)}`);
    }
    const caps = hits.map((h) => h.capitulo);
    const okTop = caso.capitulos.some((c) => caps.includes(c));
    const okTop1 = !caso.top1 || caso.top1.includes(hits[0]?.capitulo);
    if (okTop && okTop1) {
      console.log(`   ✔ esperado [${caso.capitulos.join('|')}] presente${caso.top1 ? ' + top-1 cap.' + caso.top1.join('/') : ''}`);
    } else {
      console.error(`   ✖ FALHOU: esperado cap.[${caso.capitulos.join('|')}] no top-${caso.topK}` +
        (caso.top1 ? ` com top-1 cap.${caso.top1.join('/')} (obtido cap.${hits[0]?.capitulo})` : ''));
      falhas += 1;
    }
  }

  const bytes = tamanhoIndiceBytes();
  const LIMITE = 200 * 1024 * 1024;
  console.log(`\n Tamanho recursos-ia/indice-ncm/: ${(bytes / 1024).toFixed(0)} KB (teto 200MB) ${bytes < LIMITE ? '✔' : '✖ ESTOUROU'}`);
  if (bytes >= LIMITE) falhas += 1;

  if (falhas) {
    console.error(`\n✖ ${falhas} assert(s) falharam (exit 1).`);
    process.exit(1);
  }
  console.log('\n✔ Índice IA válido (exit 0).');
}

main();
