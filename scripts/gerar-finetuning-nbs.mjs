/**
 * gerar-finetuning-nbs.mjs — Gera 3000 formas de perguntas de classificação NBS.
 * ============================================================================
 * 30 serviços-âncora × 100 templates PT-BR = 3000 linhas em
 * `recursos-ia/conhecimento/finetuning-nbs.json`, no formato
 * `{ consulta, nbs, fonte: "finetuning-nbs", template }`.
 *
 * Curadoria multiagente (3 âncoras com descrição oficial divergente foram
 * corrigidas para o vocabulário oficial antes de gerar).
 *
 * Garantias:
 * - Cada NBS (9 dígitos) é VALIDADO contra public/base/cnae-nbs.json (lcNbs).
 *   NBS inválido NUNCA é escrito. Falha (exit 1) se total < 3000.
 *
 * Uso: node scripts/gerar-finetuning-nbs.mjs
 * Puro Node ESM, sem dependências novas. Só leitura da base oficial.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CNAE_NBS_FILE = path.join(PROJECT_ROOT, 'public', 'base', 'cnae-nbs.json');
const OUT_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'finetuning-nbs.json');

const FONTE = 'finetuning-nbs';
const TOTAL_ESPERADO = 3000;
const QTD_PRODUTOS = 30;
const QTD_TEMPLATES = 100;

// 30 serviços-âncora (curadoria multiagente; descrições alinhadas ao oficial).
const ANCORAS = [
  { produto: 'creche para criancas', nbs: '122011100' },
  { produto: 'pronto socorro', nbs: '123011100' },
  { produto: 'seguranca em tecnologia da informacao', nbs: '115012000' },
  { produto: 'reparo de viatura militar', nbs: '120013500' },
  { produto: 'aula de ingles particular curso de idioma', nbs: '122051300' },
  { produto: 'curso tecnico de nivel medio', nbs: '122020000' },
  { produto: 'consulta com dentista', nbs: '123012300' },
  { produto: 'sessao de fisioterapia', nbs: '123019200' },
  { produto: 'consulta com psicologo', nbs: '123019800' },
  { produto: 'desenvolvimento de aplicativo sob medida para empresa', nbs: '115022000' },
  { produto: 'assinatura de software na nuvem', nbs: '115062100' },
  { produto: 'processamento de dados', nbs: '115090000' },
  { produto: 'suporte tecnico em informatica', nbs: '115013000' },
  { produto: 'contabilidade mensal da empresa', nbs: '113022100' },
  { produto: 'consultoria de gestao para empresa', nbs: '114011100' },
  { produto: 'servico de advogado consultoria juridica', nbs: '113012000' },
  { produto: 'conserto de computador manutencao de notebook', nbs: '120012000' },
  { produto: 'revisao e conserto de carro na oficina', nbs: '120013110' },
  { produto: 'manutencao de aplicativo atualizacao de programa', nbs: '115080000' },
  { produto: 'passagem de onibus municipal', nbs: '104011119' },
  { produto: 'entrega de encomenda coleta de documento', nbs: '107020000' },
  { produto: 'agenciamento de frete de carga', nbs: '106070000' },
  { produto: 'diaria de hotel com faxina', nbs: '103031100' },
  { produto: 'refeicao no restaurante', nbs: '103011000' },
  { produto: 'bufe para festa alimentacao de evento', nbs: '103013100' },
  { produto: 'corte de cabelo no salao', nbs: '126021000' },
  { produto: 'manicure e pedicure', nbs: '126022000' },
  { produto: 'instalacao de alarme e camera', nbs: '118023000' },
  { produto: 'faxina limpeza geral', nbs: '118031000' },
  { produto: 'limpeza pos obra especializada', nbs: '118032900' },
];

// 100 templates PT-BR com {p}, específicos de serviço/NBS.
const TEMPLATES = [
  'Qual é o NBS para {p}?',
  'Qual e o NBS para {p}?',
  'QUAL É O NBS PARA {p}?',
  'qual é o nbs para {p}?',
  'Qual é o NBS para {p}',
  'Qual o NBS para {p}?',
  'Qual o nbs para {p}?',
  'QUAL O NBS PARA {p}?',
  'Qual NBS de {p}?',
  'Qual nbs de {p}?',
  'Me diga o NBS de {p}?',
  'Me diga o NBS de {p}',
  'Por favor, qual é o NBS de {p}?',
  'Por favor qual o nbs de {p}?',
  'Tem nbs para {p}?',
  'Tem NBS para {p}?',
  'TEM NBS PARA {p}?',
  'Tem nbs para {p}',
  'Qual seria o NBS para {p}?',
  'Vcs têm o nbs de {p}?',
  'código nbs para {p}?',
  'Código NBS para {p}?',
  'CÓDIGO NBS PARA {p}?',
  'codigo nbs para {p}?',
  'codigo nbs para {p}',
  'codgo nbs para {p}?',
  'código nbs p/ {p}?',
  'cod nbs {p}?',
  'cod. nbs {p}?',
  'nbs {p}?',
  'NBS {p}?',
  '{p} nbs?',
  '{p} NBS?',
  'como classifica o serviço de {p}?',
  'Como classifica o serviço de {p}?',
  'COMO CLASSIFICA O SERVIÇO DE {p}?',
  'Como classificar {p}?',
  'como classifico o serviço {p}?',
  'Como fica a classificação de {p}?',
  'Como fica a classificacao do serviço {p}?',
  'qual codigo para {p} na reforma?',
  'Qual código para o serviço de {p} na reforma?',
  'QUAL CÓDIGO PARA {p} NA REFORMA?',
  'qual codigo p/ {p} na reforma tributária?',
  'Qual a classificação fiscal de {p}?',
  'qual a classificacao fiscal do serviço {p}?',
  'Qual a classificação de {p} na reforma?',
  'Me passa o nbs de {p}?',
  'Me passa o NBS de {p}',
  'ME PASSA O NBS DE {p}?',
  'preciso do nbs: {p}',
  'Preciso do NBS: {p}',
  'PRECISO DO NBS: {p}',
  'preciso do nbs de {p}?',
  'Preciso do código NBS de {p}, por favor?',
  'por favor, preciso do nbs de {p}',
  'Por favor, me informe o NBS de {p}?',
  'Por gentileza, qual o NBS de {p}?',
  'qual é o código nbs do serviço {p}?',
  'Qual é o código NBS do serviço {p}?',
  'Alguém sabe o NBS de {p}?',
  'alguem sabe o nbs de {p}?',
  'Você sabe o NBS para {p}?',
  'voce sabe o nbs para {p}?',
  'Pode me dizer o NBS de {p}?',
  'pode me dizer o nbs de {p}?',
  'Poderia informar o NBS de {p}, por favor?',
  'Gostaria de saber o NBS de {p}?',
  'gostaria de saber o nbs de {p}',
  'Quero o NBS de {p}?',
  'quero o nbs de {p}',
  'QUERO O NBS DE {p}',
  'Onde acho o NBS de {p}?',
  'onde acho o nbs de {p}?',
  'Em qual NBS se enquadra {p}?',
  'em qual nbs se enquadra {p}?',
  'Em qual NBS {p} se enquadra?',
  '{p} se enquadra em qual NBS?',
  '{p} qual o nbs?',
  '{p} qual nbs?',
  'qula o nbs de {p}?',
  'qual o nbs de {p}?',
  'qual o nbn de {p}?',
  'qual e o nbss de {p}?',
  'quall é o nbs de {p}?',
  'qual nbs pra {p}?',
  'qul nbs de {p}?',
  'nbs de {p} por favor?',
  'NBS de {p} por favor',
  'nbs de {p} pfv?',
  'nbs de {p} pf?',
  'me ajuda com o nbs de {p}?',
  'Me ajuda com o NBS de {p}, por favor?',
  'ajuda: nbs de {p}?',
  'Dúvida: qual o NBS de {p}?',
  'duvida: qual o nbs de {p}?',
  'Classificação NBS: {p}?',
  'CLASSIFICAÇÃO NBS: {p}?',
  'serviço {p} — qual nbs?',
  'Serviço {p} — qual NBS?',
];

const digits = (v) => String(v ?? '').replace(/\D+/g, '');

function main() {
  console.log(' Aurum Tax NCM — geração do fine-tuning NBS (30 × 100 = 3000)');
  if (TEMPLATES.length !== QTD_TEMPLATES) {
    console.error(`✖ Esperava ${QTD_TEMPLATES} templates, há ${TEMPLATES.length} (exit 1).`);
    process.exit(1);
  }
  const vistos = new Set();
  for (const t of TEMPLATES) {
    if (!t.includes('{p}')) { console.error(`✖ Template sem {p}: "${t}" (exit 1).`); process.exit(1); }
    if (vistos.has(t)) { console.error(`✖ Template duplicado: "${t}" (exit 1).`); process.exit(1); }
    vistos.add(t);
  }
  console.log(`   templates: ${TEMPLATES.length} únicos, todos com {p}`);

  // Base oficial NBS.
  let validos;
  try {
    const j = JSON.parse(fs.readFileSync(CNAE_NBS_FILE, 'utf8'));
    validos = new Set((j.lcNbs ?? []).map((r) => digits(r.nbs)).filter((c) => /^\d{9}$/.test(c)));
    console.log(`   NBS válidos na base (lcNbs): ${validos.size}`);
  } catch (e) {
    console.error(`✖ Base NBS ilegível: ${e.message} (exit 1).`);
    process.exit(1);
  }
  if (!validos.size) { console.error('✖ Nenhum NBS válido (exit 1).'); process.exit(1); }

  // Valida âncoras.
  const ncmsVistos = new Set();
  for (const a of ANCORAS) {
    const cod = digits(a.nbs);
    if (!/^\d{9}$/.test(cod) || !validos.has(cod)) {
      console.error(`✖ Âncora inválida/ausente na base: "${a.produto}"→${a.nbs} (exit 1).`);
      process.exit(1);
    }
    if (ncmsVistos.has(cod)) { console.error(`✖ NBS duplicado: ${cod} (exit 1).`); process.exit(1); }
    ncmsVistos.add(cod);
  }
  if (ANCORAS.length !== QTD_PRODUTOS) {
    console.error(`✖ Esperava ${QTD_PRODUTOS} âncoras, há ${ANCORAS.length} (exit 1).`);
    process.exit(1);
  }
  console.log(`   âncoras: ${ANCORAS.length} serviços distintos, ${ncmsVistos.size} NBS distintos`);

  const linhas = [];
  const consultasVistas = new Set();
  ANCORAS.forEach((ancora) => {
    TEMPLATES.forEach((tpl, idxTemplate) => {
      const consulta = tpl.replaceAll('{p}', ancora.produto);
      if (consultasVistas.has(consulta)) {
        console.error(`✖ Consulta duplicada: "${consulta}" (exit 1).`);
        process.exit(1);
      }
      consultasVistas.add(consulta);
      linhas.push({ consulta, nbs: digits(ancora.nbs), fonte: FONTE, template: idxTemplate });
    });
  });
  if (linhas.length < TOTAL_ESPERADO) {
    console.error(`✖ Total ${linhas.length} < ${TOTAL_ESPERADO} (exit 1).`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, Buffer.from(JSON.stringify(linhas, null, 1), 'utf8'));
  console.log(`\n✔ Total gerado: ${linhas.length} consultas`);
  console.log(`   arquivo: ${path.relative(PROJECT_ROOT, OUT_FILE)}`);
  console.log('✔ NBS 100% validados contra a base oficial (exit 0).');
}

if (process.argv[1]?.endsWith('gerar-finetuning-nbs.mjs')) {
  try { main(); } catch (err) {
    console.error(`✖ Falha: ${err.message}`);
    process.exit(1);
  }
}
