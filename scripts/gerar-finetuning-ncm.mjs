/**
 * gerar-finetuning-ncm.mjs — Gera 6000 formas de perguntas de classificação NCM.
 * ============================================================================
 * 60 produtos-âncora × 100 templates PT-BR = 6000 linhas em
 * `recursos-ia/conhecimento/finetuning-6000.json`, no formato
 * `{ consulta, ncm, fonte: "finetuning-6000", template }`.
 *
 * Fluxo multiagente: 30 âncoras base + 30 da expansão (10 agro/alimentos +
 * 10 metal/autopeças + 10 casa/vestuário/farmácia/eletrônicos, curadas por
 * subagentes em `ANCORAS_EXPANSAO`).
 *
 * Garantias:
 * - Cada NCM é VALIDADO contra a base oficial (união de
 *   `recursos-ia/dados-brutos/ncm-para-ia.json` + `public/base/*`).
 *   NCM inválido NUNCA é escrito: o produto é substituído por um válido
 *   e a troca é registrada no log.
 * - Falha (exit 1) se o total gerado for < 6000.
 *
 * Uso:
 *   node scripts/gerar-finetuning-ncm.mjs
 *
 * Puro Node ESM, sem dependências novas. Só leitura da base oficial.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FRASES_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'frases-modelo.json');
const NCM_PARA_IA_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'dados-brutos', 'ncm-para-ia.json');
const NOMENCLATURA_FILE = path.join(PROJECT_ROOT, 'public', 'base', 'nomenclatura.json');
const CONSOLIDADAS_FILE = path.join(PROJECT_ROOT, 'public', 'base', 'classificacoes-consolidadas.json');
const REFORMA_FILE = path.join(PROJECT_ROOT, 'public', 'base', 'reforma.json');
const OUT_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'finetuning-6000.json');
const OUT_FILE_LEGADO = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'finetuning-3000.json');

const FONTE = 'finetuning-6000';
const TOTAL_ESPERADO = 6000;
const QTD_PRODUTOS = 60;
const QTD_TEMPLATES = 100;

// ---------------------------------------------------------------------------
// 30 produtos-âncora: 6 obrigatórios + 24 reais de frases-modelo.json.
// ---------------------------------------------------------------------------

/** Os 6 âncoras obrigatórias (rótulo → NCM). */
const ANCORAS_OBRIGATORIAS = [
  { produto: 'frango vivo para abate', ncm: '01059400' },
  { produto: 'banana fresca', ncm: '08031000' },
  { produto: 'vergalhão de aço', ncm: '72142000' },
  { produto: 'coxa de frango congelada', ncm: '02071400' },
  { produto: 'queijo parmesão', ncm: '04069010' },
  { produto: 'camiseta 100% algodão', ncm: '61091000' },
];

/**
 * 30 âncoras da expansão multiagente (10 agro/alimentos + 10 metal/autopeças +
 * 10 casa/vestuário/farmácia/eletrônicos). Todas validadas contra a base oficial
 * pelos subagentes; o script revalida cada uma antes de escrever.
 */
const ANCORAS_EXPANSAO = [
  // Agro/alimentos.
  { produto: 'pintinho de um dia', ncm: '01051190' },
  { produto: 'porco vivo adulto para abate', ncm: '01039200' },
  { produto: 'carne bovina fresca desossada', ncm: '02013000' },
  { produto: 'peito de frango congelado', ncm: '02071422' },
  { produto: 'manteiga', ncm: '04051000' },
  { produto: 'iogurte natural', ncm: '04032000' },
  { produto: 'banana prata fresca', ncm: '08039000' },
  { produto: 'laranja fresca', ncm: '08051000' },
  { produto: 'milho em grão', ncm: '10059010' },
  { produto: 'arroz branco polido', ncm: '10063021' },
  // Metal/ferramentas/autopeças.
  { produto: 'correia dentada', ncm: '40103500' },
  { produto: 'parafuso sextavado', ncm: '73181500' },
  { produto: 'tubo de aco', ncm: '73041900' },
  { produto: 'arame galvanizado', ncm: '72171090' },
  { produto: 'barra de aluminio', ncm: '76041010' },
  { produto: 'martelo de unha', ncm: '82052000' },
  { produto: 'chave de fenda', ncm: '82054000' },
  { produto: 'alicate universal', ncm: '82032010' },
  { produto: 'tubo inox', ncm: '73041100' },
  { produto: 'tirafundo', ncm: '73181100' },
  // Casa/vestuário/farmácia/eletrônicos.
  { produto: 'tecido de algodao tricoline', ncm: '52085200' },
  { produto: 'calca jeans', ncm: '62034200' },
  { produto: 'toalha de banho algodao', ncm: '63026000' },
  { produto: 'panela de pressao', ncm: '76151000' },
  { produto: 'cadeira de escritorio', ncm: '94013900' },
  { produto: 'amoxicilina 500mg', ncm: '30041011' },
  { produto: 'paracetamol 750mg', ncm: '30049099' },
  { produto: 'papel sulfite a4', ncm: '48025510' },
  { produto: 'ar condicionado split', ncm: '84151011' },
  { produto: 'roteador wifi', ncm: '85176241' },
];

/**
 * 100 templates PT-BR com `{p}`. Variação proposital: maiúsculas/minúsculas,
 * com/sem `?`, com/sem "por favor", com/sem acento e erros comuns de
 * digitação (qula, nmc, codgo, ncmm...). Cada string deve ser única e conter
 * exatamente o placeholder `{p}`.
 */
const TEMPLATES = [
  'Qual é o NCM de {p}?',
  'Qual e o NCM de {p}?',
  'QUAL É O NCM DE {p}?',
  'qual é o ncm de {p}?',
  'Qual é o NCM de {p}',
  'Qual o NCM de {p}?',
  'Qual o ncm de {p}?',
  'QUAL O NCM DE {p}?',
  'Qual NCM para {p}?',
  'Qual ncm para {p}?',
  'Me diga o NCM de {p}?',
  'Me diga o NCM de {p}',
  'Por favor, qual é o NCM de {p}?',
  'Por favor qual o ncm de {p}?',
  'Tem ncm de {p}?',
  'Tem NCM de {p}?',
  'TEM NCM DE {p}?',
  'Tem ncm de {p}',
  'Têm ncm de {p}?',
  'Vcs têm o ncm de {p}?',
  'código ncm para {p}?',
  'Código NCM para {p}?',
  'CÓDIGO NCM PARA {p}?',
  'codigo ncm para {p}?',
  'codigo ncm para {p}',
  'codgo ncm para {p}?',
  'código ncm p/ {p}?',
  'cod ncm {p}?',
  'cod. ncm {p}?',
  'ncm {p}?',
  'NCM {p}?',
  '{p} ncm?',
  '{p} NCM?',
  'como classifica {p}?',
  'Como classifica {p}?',
  'COMO CLASSIFICA {p}?',
  'Como classificar {p}?',
  'como classifico {p}?',
  'Como fica a classificação de {p}?',
  'Como fica a classificacao de {p}?',
  'qual codigo para {p} na reforma?',
  'Qual código para {p} na reforma?',
  'QUAL CÓDIGO PARA {p} NA REFORMA?',
  'qual codigo p/ {p} na reforma tributária?',
  'Qual a classificação fiscal de {p}?',
  'qual a classificacao fiscal de {p}?',
  'Qual a classificação de {p} na reforma?',
  'Me passa o ncm de {p}?',
  'Me passa o NCM de {p}',
  'ME PASSA O NCM DE {p}?',
  'preciso do ncm: {p}',
  'Preciso do NCM: {p}',
  'PRECISO DO NCM: {p}',
  'preciso do ncm de {p}?',
  'Preciso do código NCM de {p}, por favor?',
  'por favor, preciso do ncm de {p}',
  'Por favor, me informe o NCM de {p}?',
  'Por gentileza, qual o NCM de {p}?',
  'qual é o código ncm do produto {p}?',
  'Qual é o código NCM do produto {p}?',
  'Alguém sabe o NCM de {p}?',
  'alguem sabe o ncm de {p}?',
  'Você sabe o NCM de {p}?',
  'voce sabe o ncm de {p}?',
  'Pode me dizer o NCM de {p}?',
  'pode me dizer o ncm de {p}?',
  'Poderia informar o NCM de {p}, por favor?',
  'Gostaria de saber o NCM de {p}?',
  'gostaria de saber o ncm de {p}',
  'Quero o NCM de {p}?',
  'quero o ncm de {p}',
  'QUERO O NCM DE {p}',
  'Onde acho o NCM de {p}?',
  'onde acho o ncm de {p}?',
  'Em qual NCM se enquadra {p}?',
  'em qual ncm se enquadra {p}?',
  'Em qual NCM {p} se enquadra?',
  '{p} se enquadra em qual NCM?',
  '{p} qual o ncm?',
  '{p} qual ncm?',
  'qula o ncm de {p}?',
  'qual o nmc de {p}?',
  'qual o ncn de {p}?',
  'qual e o ncmm de {p}?',
  'quall é o ncm de {p}?',
  'qual ncm pra {p}?',
  'qul ncm de {p}?',
  'ncm de {p} por favor?',
  'NCM de {p} por favor',
  'ncm de {p} pfv?',
  'ncm de {p} pf?',
  'me ajuda com o ncm de {p}?',
  'Me ajuda com o NCM de {p}, por favor?',
  'ajuda: ncm de {p}?',
  'Dúvida: qual o NCM de {p}?',
  'duvida: qual o ncm de {p}?',
  'Classificação NCM: {p}?',
  'CLASSIFICAÇÃO NCM: {p}?',
  'produto {p} — qual ncm?',
  'Produto {p} — qual NCM?',
];

// ---------------------------------------------------------------------------
// Validação contra a base oficial (só leitura).
// ---------------------------------------------------------------------------

function normalizarNcm(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

function ehNcm8(cod) {
  return /^\d{8}$/.test(cod);
}

/** União dos NCMs válidos: ncm-para-ia.json + public/base/*. */
function carregarNcmsValidos() {
  const validos = new Set();
  const fontes = {};

  try {
    const j = JSON.parse(fs.readFileSync(NCM_PARA_IA_FILE, 'utf8'));
    let n = 0;
    for (const item of j.itens ?? []) {
      const cod = normalizarNcm(item.codigo);
      if (ehNcm8(cod)) {
        validos.add(cod);
        n += 1;
      }
    }
    fontes['ncm-para-ia.json'] = n;
  } catch (e) {
    fontes['ncm-para-ia.json'] = `ERRO: ${e.message}`;
  }

  try {
    const j = JSON.parse(fs.readFileSync(NOMENCLATURA_FILE, 'utf8'));
    const lista = j.itens ?? j.nomenclaturas ?? [];
    let n = 0;
    for (const item of lista) {
      const cod = normalizarNcm(item.codigo);
      // Respeita vigência quando o campo existe (dataFim preenchida = extinta).
      if (ehNcm8(cod) && !item.dataFim) {
        validos.add(cod);
        n += 1;
      }
    }
    fontes['nomenclatura.json'] = n;
  } catch (e) {
    fontes['nomenclatura.json'] = `ERRO: ${e.message}`;
  }

  // Best-effort: consolidadas + reforma (formatos variados, nunca falha).
  try {
    const texto = fs.readFileSync(CONSOLIDADAS_FILE, 'utf8');
    const cods = new Set([...texto.matchAll(/"(\d{8})"/g)].map((m) => m[1]));
    let n = 0;
    for (const c of cods) {
      if (!validos.has(c)) n += 1;
      validos.add(c);
    }
    fontes['classificacoes-consolidadas.json'] = `+${n} novos (total brutos ${cods.size})`;
  } catch (e) {
    fontes['classificacoes-consolidadas.json'] = `ausente (${e.code ?? e.message})`;
  }
  try {
    const j = JSON.parse(fs.readFileSync(REFORMA_FILE, 'utf8'));
    const chaves = Object.keys(j.ncm ?? {});
    let n = 0;
    for (const k of chaves) {
      const cod = normalizarNcm(k);
      if (ehNcm8(cod) && !validos.has(cod)) n += 1;
      if (ehNcm8(cod)) validos.add(cod);
    }
    fontes['reforma.json'] = `+${n} novos (chaves ${chaves.length})`;
  } catch (e) {
    fontes['reforma.json'] = `ausente (${e.code ?? e.message})`;
  }

  return { validos, fontes };
}

function main() {
  console.log(' Aurum Tax NCM — geração do fine-tuning NCM (60 × 100 = 6000)');

  // 0. Sanidade dos templates (garantia de sucesso: falha cedo e alto).
  if (TEMPLATES.length !== QTD_TEMPLATES) {
    console.error(`✖ Esperava ${QTD_TEMPLATES} templates, há ${TEMPLATES.length} (exit 1).`);
    process.exit(1);
  }
  const tplsVistos = new Set();
  for (const t of TEMPLATES) {
    if (!t.includes('{p}')) {
      console.error(`✖ Template sem placeholder {p}: "${t}" (exit 1).`);
      process.exit(1);
    }
    if (tplsVistos.has(t)) {
      console.error(`✖ Template duplicado: "${t}" (exit 1).`);
      process.exit(1);
    }
    tplsVistos.add(t);
  }
  console.log(`   templates: ${TEMPLATES.length} únicos, todos com {p}`);

  // 1. Base válida.
  const { validos, fontes } = carregarNcmsValidos();
  console.log(`   NCMs válidos na união das bases: ${validos.size}`);
  for (const [f, n] of Object.entries(fontes)) console.log(`     · ${f}: ${n}`);
  if (validos.size === 0) {
    console.error('✖ Nenhum NCM válido carregado — verifique a base oficial (exit 1).');
    process.exit(1);
  }
  const ehValido = (ncm) => validos.has(normalizarNcm(ncm));

  // 2. Pool de reposição: frases-modelo.json (reais, na ordem do arquivo).
  let frases = [];
  try {
    const j = JSON.parse(fs.readFileSync(FRASES_FILE, 'utf8'));
    frases = (j.frases ?? [])
      .map((f) => ({ produto: String(f.consulta ?? '').trim(), ncm: normalizarNcm(f.ncm) }))
      .filter((f) => f.produto && ehNcm8(f.ncm));
    console.log(`   frases-modelo.json: ${frases.length} frases aproveitáveis`);
  } catch (e) {
    console.error(`✖ Não foi possível ler ${FRASES_FILE}: ${e.message} (exit 1).`);
    process.exit(1);
  }

  const substituicoes = [];
  const usadosNcm = new Set();
  const usadasLabels = new Set();
  const ancoras = [];

  function tentarAdicionar(produto, ncm, origem) {
    const cod = normalizarNcm(ncm);
    const labelKey = produto.toLowerCase();
    if (!ehNcm8(cod)) {
      substituicoes.push(`[${origem}] "${produto}"→"${ncm}": NCM malformado, descartado`);
      return false;
    }
    if (!ehValido(cod)) {
      substituicoes.push(`[${origem}] "${produto}"→${cod}: NCM ausente na base oficial, descartado`);
      return false;
    }
    if (usadosNcm.has(cod)) {
      substituicoes.push(`[${origem}] "${produto}"→${cod}: NCM já ancorado, descartado (diversidade)`);
      return false;
    }
    if (usadasLabels.has(labelKey)) return false;
    ancoras.push({ produto, ncm: cod });
    usadosNcm.add(cod);
    usadasLabels.add(labelKey);
    return true;
  }

  function buscarReposicao(ncmEvitar) {
    for (const f of frases) {
      const cod = normalizarNcm(f.ncm);
      if (cod === normalizarNcm(ncmEvitar)) continue;
      if (usadosNcm.has(cod)) continue;
      if (usadasLabels.has(f.produto.toLowerCase())) continue;
      if (!ehValido(cod)) continue;
      return f;
    }
    return null;
  }

  // 3. As 6 obrigatórias primeiro (com substituição registrada se inválidas).
  for (const a of ANCORAS_OBRIGATORIAS) {
    if (tentarAdicionar(a.produto, a.ncm, 'obrigatoria')) continue;
    const rep = buscarReposicao(a.ncm);
    if (!rep) {
      console.error(`✖ Âncora obrigatória "${a.produto}"→${a.ncm} inválida e sem reposição (exit 1).`);
      process.exit(1);
    }
    substituicoes.push(`[obrigatoria] "${a.produto}"→${normalizarNcm(a.ncm)} SUBSTITUÍDO por "${rep.produto}"→${rep.ncm}`);
    tentarAdicionar(rep.produto, rep.ncm, 'reposicao-obrigatoria');
  }

  // 3b. Expansão multiagente (30 âncoras curadas por domínio).
  for (const a of ANCORAS_EXPANSAO) {
    if (ancoras.length >= QTD_PRODUTOS) break;
    if (tentarAdicionar(a.produto, a.ncm, 'expansao-multiagente')) continue;
    substituicoes.push(`[expansao-multiagente] "${a.produto}"→${normalizarNcm(a.ncm)}: descartado (duplicado/ausente na base)`);
  }

  // 4. Restante (24) de frases-modelo.json (ordem do arquivo, pulando NCMs já usados).
  let varridos = 0;
  for (const f of frases) {
    if (ancoras.length >= QTD_PRODUTOS) break;
    varridos += 1;
    if (usadosNcm.has(normalizarNcm(f.ncm))) continue;
    if (!ehValido(f.ncm)) {
      substituicoes.push(`[frases-modelo] "${f.produto}"→${f.ncm}: NCM ausente na base, pulado`);
      continue;
    }
    tentarAdicionar(f.produto, f.ncm, 'frases-modelo');
  }
  if (ancoras.length < QTD_PRODUTOS) {
    console.error(
      `✖ Só ${ancoras.length} âncoras válidas após varrer ${varridos} frases (preciso de ${QTD_PRODUTOS}) (exit 1).`,
    );
    process.exit(1);
  }

  console.log(`   âncoras: ${ancoras.length} produtos distintos, ${new Set(ancoras.map((a) => a.ncm)).size} NCMs distintos`);
  if (substituicoes.length) {
    console.log('   substituições/validações registradas:');
    for (const s of substituicoes) console.log(`     · ${s}`);
  } else {
    console.log('   substituições: nenhuma (todas as âncoras validaram de primeira)');
  }

  // 5. Geração 60 × 100.
  const linhas = [];
  const consultasVistas = new Set();
  let duplicadas = 0;
  ancoras.forEach((ancora, idxProduto) => {
    TEMPLATES.forEach((tpl, idxTemplate) => {
      const consulta = tpl.replaceAll('{p}', ancora.produto);
      // Defesa em profundidade: nunca escrever NCM inválido.
      if (!ehValido(ancora.ncm)) {
        console.error(`✖ NCM inválido na geração: ${ancora.ncm} (exit 1).`);
        process.exit(1);
      }
      if (consultasVistas.has(consulta)) duplicadas += 1;
      consultasVistas.add(consulta);
      linhas.push({ consulta, ncm: ancora.ncm, fonte: FONTE, template: idxTemplate });
    });
    void idxProduto;
  });

  if (duplicadas > 0) {
    console.error(`✖ ${duplicadas} consultas duplicadas — templates/produtos devem ser únicos (exit 1).`);
    process.exit(1);
  }
  if (linhas.length < TOTAL_ESPERADO) {
    console.error(`✖ Total gerado ${linhas.length} < ${TOTAL_ESPERADO} (exit 1).`);
    process.exit(1);
  }

  // 6. Escrita (não toca em nada existente além do próprio artefato).
  // Mantém o legado finetuning-3000.json (compat com testes) + gera o 6000.
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, Buffer.from(JSON.stringify(linhas, null, 1), 'utf8'));
  try {
    if (!fs.existsSync(OUT_FILE_LEGADO)) {
      fs.writeFileSync(OUT_FILE_LEGADO, Buffer.from(JSON.stringify(linhas.slice(0, 3000), null, 1), 'utf8'));
    }
  } catch { /* legado é best-effort */ }

  // 7. Resumo: total + cobertura por produto.
  console.log(`\n✔ Total gerado: ${linhas.length} consultas`);
  console.log(`   arquivo: ${path.relative(PROJECT_ROOT, OUT_FILE)}`);
  console.log('   cobertura por produto (100 esperadas cada):');
  const porProduto = new Map();
  for (const l of linhas) {
    const k = `${l.ncm}`;
    porProduto.set(k, (porProduto.get(k) ?? 0) + 1);
  }
  ancoras.forEach((a) => {
    const n = porProduto.get(a.ncm) ?? 0;
    const flag = n === QTD_TEMPLATES ? '✔' : '✖';
    console.log(`     ${flag} "${a.produto}" → ${a.ncm}: ${n}`);
  });
  const foraDoPadrao = [...porProduto.values()].filter((n) => n !== QTD_TEMPLATES);
  if (foraDoPadrao.length) {
    console.error('✖ Cobertura irregular por produto (exit 1).');
    process.exit(1);
  }
  const formatosOk = linhas.every(
    (l) => typeof l.consulta === 'string' && l.consulta.length > 0 && ehNcm8(l.ncm) && l.fonte === FONTE && Number.isInteger(l.template),
  );
  if (!formatosOk) {
    console.error('✖ Linha fora do formato {consulta, ncm, fonte, template} (exit 1).');
    process.exit(1);
  }
  console.log('✔ Formato válido em todas as linhas · NCMs 100% validados contra a base oficial (exit 0).');
}

const ehMain = process.argv[1]?.endsWith('gerar-finetuning-ncm.mjs');
if (ehMain) {
  try {
    main();
  } catch (err) {
    console.error(`✖ Falha na geração do fine-tuning: ${err.message}`);
    process.exit(1);
  }
}
