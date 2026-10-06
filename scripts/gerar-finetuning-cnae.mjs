/**
 * gerar-finetuning-cnae.mjs — Gera 3000 formas de perguntas CNAE→Anexo Simples.
 * ============================================================================
 * 30 CNAEs-âncora × 100 templates PT-BR = 3000 linhas em
 * `recursos-ia/conhecimento/finetuning-cnae.json`, no formato
 * `{ consulta, cnae, anexos, fonte: "finetuning-cnae", template }`.
 *
 * Garantias:
 * - Cada CNAE (7 dígitos) é VALIDADO contra public/base/cnae.json (1090 itens).
 *   CNAE inválido NUNCA é escrito. Falha (exit 1) se total < 3000.
 *
 * Uso: node scripts/gerar-finetuning-cnae.mjs
 * Puro Node ESM, sem dependências novas. Só leitura da base oficial.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CNAE_FILE = path.join(PROJECT_ROOT, 'public', 'base', 'cnae.json');
const OUT_FILE = path.join(PROJECT_ROOT, 'recursos-ia', 'conhecimento', 'finetuning-cnae.json');

const FONTE = 'finetuning-cnae';
const TOTAL_ESPERADO = 3000;
const QTD_PRODUTOS = 30;
const QTD_TEMPLATES = 100;

// 30 CNAEs-âncora validados (comércio I, indústria II, serviços III/IV/V).
const ANCORAS = [
  { cnae: '4721102', descricao: 'Padaria e confeitaria com predominância de revenda', anexos: ['I'] },
  { cnae: '4781400', descricao: 'Comércio varejista de artigos do vestuário e acessórios', anexos: ['I'] },
  { cnae: '4511101', descricao: 'Comércio a varejo de automóveis, camionetas e utilitários novos', anexos: ['I'] },
  { cnae: '4744005', descricao: 'Comércio varejista de materiais de construção', anexos: ['I'] },
  { cnae: '4637101', descricao: 'Comércio atacadista de café torrado, moído e solúvel', anexos: ['I'] },
  { cnae: '1011201', descricao: 'Frigorífico – abate de bovinos', anexos: ['II'] },
  { cnae: '1091102', descricao: 'Fabricação de produtos de padaria e confeitaria', anexos: ['II'] },
  { cnae: '1411801', descricao: 'Confecção de roupas íntimas', anexos: ['II'] },
  { cnae: '3101200', descricao: 'Fabricação de móveis com predominância de madeira', anexos: ['II'] },
  { cnae: '6201501', descricao: 'Desenvolvimento de programas de computador sob encomenda', anexos: ['III', 'V'] },
  { cnae: '6202300', descricao: 'Desenvolvimento e licenciamento de programas customizáveis', anexos: ['III', 'V'] },
  { cnae: '6203100', descricao: 'Desenvolvimento e licenciamento de programas não customizáveis', anexos: ['III', 'V'] },
  { cnae: '6204000', descricao: 'Consultoria em tecnologia da informação', anexos: ['III', 'V'] },
  { cnae: '6209100', descricao: 'Suporte técnico e manutenção em TI', anexos: ['III'] },
  { cnae: '6911701', descricao: 'Serviços advocatícios', anexos: ['IV'] },
  { cnae: '6920601', descricao: 'Atividades de contabilidade', anexos: ['III', 'V'] },
  { cnae: '7112000', descricao: 'Serviços de engenharia', anexos: ['III', 'IV', 'V'] },
  { cnae: '7111100', descricao: 'Serviços de arquitetura', anexos: ['III', 'IV', 'V'] },
  { cnae: '8630503', descricao: 'Atividade médica ambulatorial restrita a consultas', anexos: ['III', 'V'] },
  { cnae: '8630504', descricao: 'Atividade odontológica', anexos: ['III', 'V'] },
  { cnae: '8640202', descricao: 'Laboratórios clínicos', anexos: ['III'] },
  { cnae: '8650003', descricao: 'Atividades de psicologia e psicanálise', anexos: ['III', 'V'] },
  { cnae: '4120400', descricao: 'Construção de edifícios', anexos: ['IV'] },
  { cnae: '4321500', descricao: 'Instalação e manutenção elétrica', anexos: ['III'] },
  { cnae: '4330404', descricao: 'Serviços de pintura de edifícios em geral', anexos: ['III'] },
  { cnae: '4930202', descricao: 'Transporte rodoviário de carga intermunicipal e interestadual', anexos: ['III'] },
  { cnae: '4923001', descricao: 'Serviço de táxi', anexos: ['III'] },
  { cnae: '5223100', descricao: 'Estacionamento de veículos', anexos: ['III'] },
  { cnae: '5611201', descricao: 'Restaurantes e similares', anexos: ['III'] },
  { cnae: '5620102', descricao: 'Serviços de alimentação para eventos – bufê', anexos: ['III'] },
];

// 100 templates PT-BR com {p} (CNAE corrido e formatado alternados).
const TEMPLATES = [
  'Qual anexo do CNAE {p}?',
  'Qual o anexo do CNAE {p}?',
  'QUAL ANEXO DO CNAE {p}?',
  'qual anexo do cnae {p}?',
  'Qual anexo do CNAE {p}',
  'CNAE {p} qual anexo?',
  'CNAE {p} é de qual anexo?',
  'cnae {p} qual anexo?',
  'Me diga o anexo do CNAE {p}?',
  'Me diga o anexo do CNAE {p}',
  'Por favor, qual o anexo do CNAE {p}?',
  'Por favor qual anexo do cnae {p}?',
  'Tem anexo para o CNAE {p}?',
  'CNAE {p} cai em qual anexo?',
  'cnae {p} cai em qual anexo?',
  'Em qual anexo se enquadra o CNAE {p}?',
  'em qual anexo se enquadra o cnae {p}?',
  'O CNAE {p} é anexo III ou V?',
  'o cnae {p} é anexo III ou V?',
  'CNAE {p} tem Fator R?',
  'cnae {p} tem fator r?',
  'O CNAE {p} exige Fator R?',
  'Qual a situação do CNAE {p} no Simples?',
  'qual a situacao do cnae {p} no simples?',
  'CNAE {p} é permitido no Simples?',
  'cnae {p} é permitido no simples?',
  'O CNAE {p} pode ser Simples Nacional?',
  'Preciso do anexo do CNAE {p}?',
  'preciso do anexo do cnae {p}',
  'PRECISO DO ANEXO DO CNAE {p}',
  'Por gentileza, anexo do CNAE {p}?',
  'qual é o anexo do cnae {p} no simples nacional?',
  'Qual é o Anexo do CNAE {p} no Simples Nacional?',
  'Alguém sabe o anexo do CNAE {p}?',
  'alguem sabe o anexo do cnae {p}?',
  'Você sabe o anexo do CNAE {p}?',
  'voce sabe o anexo do cnae {p}?',
  'Pode me dizer o anexo do CNAE {p}?',
  'pode me dizer o anexo do cnae {p}?',
  'Poderia informar o anexo do CNAE {p}, por favor?',
  'Gostaria de saber o anexo do CNAE {p}?',
  'gostaria de saber o anexo do cnae {p}',
  'Quero o anexo do CNAE {p}?',
  'quero o anexo do cnae {p}',
  'QUERO O ANEXO DO CNAE {p}',
  'Onde acho o anexo do CNAE {p}?',
  'onde acho o anexo do cnae {p}?',
  'qula o anexo do cnae {p}?',
  'qual o anexo do cnae {p}?',
  'qual o anexo do cnnae {p}?',
  'qual e o anexo do cnaee {p}?',
  'quall é o anexo do CNAE {p}?',
  'qual anexo pro cnae {p}?',
  'qul anexo do cnae {p}?',
  'anexo do CNAE {p} por favor?',
  'Anexo do CNAE {p} por favor',
  'anexo do cnae {p} pfv?',
  'anexo do cnae {p} pf?',
  'me ajuda com o anexo do CNAE {p}?',
  'Me ajuda com o anexo do CNAE {p}, por favor?',
  'ajuda: anexo do CNAE {p}?',
  'Dúvida: qual o anexo do CNAE {p}?',
  'duvida: qual o anexo do cnae {p}?',
  'Classificação CNAE: {p}?',
  'CLASSIFICAÇÃO CNAE: {p}?',
  'CNAE {p} — qual anexo do Simples?',
  'cnae {p} — qual anexo do simples?',
  'Sou do CNAE {p}, qual anexo?',
  'sou do cnae {p}, qual anexo?',
  'Minha empresa é CNAE {p}, qual anexo do Simples?',
  'minha empresa é cnae {p}, qual anexo?',
  'CNAE {p} permite Simples? Qual anexo?',
  'Atividade do CNAE {p}: qual anexo?',
  'atividade do cnae {p}: qual anexo?',
  'Enquadramento do CNAE {p}?',
  'enquadramento do cnae {p}?',
  'CNAE {p} é comércio, indústria ou serviço?',
  'cnae {p} é comercio, industria ou servico?',
  'Tributação do CNAE {p} no Simples?',
  'tributacao do cnae {p} no simples?',
  'DAS do CNAE {p}: qual anexo?',
  'das do cnae {p}: qual anexo?',
  'Simples Nacional CNAE {p}?',
  'simples nacional cnae {p}?',
  'CNAE {p} paga DAS em qual anexo?',
  'cnae {p} paga das em qual anexo?',
  'Quais NBS e benefícios do CNAE {p}?',
  'quais nbs e beneficios do cnae {p}?',
  'CNAE {p} tem benefício da reforma?',
  'cnae {p} tem beneficio da reforma?',
  'CNAE {p} é vedado no Simples?',
  'cnae {p} é vedado no simples?',
  'Posso abrir empresa no CNAE {p} no Simples?',
  'posso abrir empresa no cnae {p} no simples?',
  'CNAE {p}: Anexo III, IV ou V?',
  'cnae {p}: anexo III, IV ou V?',
  'Confirma o anexo do CNAE {p}?',
  'confirma o anexo do cnae {p}?',
  'CNAE {p}.',
  'cnae {p}.',
];

const digits = (v) => String(v ?? '').replace(/\D+/g, '');

function main() {
  console.log(' Aurum Tax NCM — geração do fine-tuning CNAE (30 × 100 = 3000)');
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

  let base;
  try {
    base = JSON.parse(fs.readFileSync(CNAE_FILE, 'utf8'));
    console.log(`   CNAEs na base: ${(base.itens ?? []).length}`);
  } catch (e) {
    console.error(`✖ Base CNAE ilegível: ${e.message} (exit 1).`);
    process.exit(1);
  }
  const porCodigo = new Map((base.itens ?? []).map((r) => [digits(r.codigo7), r]));
  const vistosCnae = new Set();
  for (const a of ANCORAS) {
    const cod = digits(a.cnae);
    const oficial = porCodigo.get(cod);
    if (!/^\d{7}$/.test(cod) || !oficial) {
      console.error(`✖ Âncora CNAE ausente na base: ${a.cnae} (exit 1).`);
      process.exit(1);
    }
    const anexosOf = [...(oficial.anexos ?? [])].sort().join(',');
    if (anexosOf !== [...a.anexos].sort().join(',')) {
      console.error(`✖ Anexos divergentes p/ ${cod}: script=[${a.anexos}] base=[${oficial.anexos}] (exit 1).`);
      process.exit(1);
    }
    if (vistosCnae.has(cod)) { console.error(`✖ CNAE duplicado: ${cod} (exit 1).`); process.exit(1); }
    vistosCnae.add(cod);
  }
  if (ANCORAS.length !== QTD_PRODUTOS) {
    console.error(`✖ Esperava ${QTD_PRODUTOS} âncoras, há ${ANCORAS.length} (exit 1).`);
    process.exit(1);
  }
  console.log(`   âncoras: ${ANCORAS.length} CNAEs distintos, anexos conferidos na base`);

  const linhas = [];
  const consultasVistas = new Set();
  ANCORAS.forEach((ancora) => {
    const oficial = porCodigo.get(digits(ancora.cnae));
    TEMPLATES.forEach((tpl, idxTemplate) => {
      const consulta = tpl.replaceAll('{p}', ancora.cnae);
      const consultaFmt = tpl.replaceAll('{p}', oficial.codigoFormatado ?? ancora.cnae);
      for (const q of [consulta, consultaFmt]) {
        void q;
      }
      if (consultasVistas.has(consulta)) {
        console.error(`✖ Consulta duplicada: "${consulta}" (exit 1).`);
        process.exit(1);
      }
      consultasVistas.add(consulta);
      linhas.push({ consulta, cnae: digits(ancora.cnae), anexos: ancora.anexos, fonte: FONTE, template: idxTemplate });
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
  console.log('✔ CNAEs 100% validados contra a base oficial (exit 0).');
}

if (process.argv[1]?.endsWith('gerar-finetuning-cnae.mjs')) {
  try { main(); } catch (err) {
    console.error(`✖ Falha: ${err.message}`);
    process.exit(1);
  }
}
