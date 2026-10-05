/**
 * Fine-tuning — projeção mãe × nova: ≥2000 variações do pedido.
 *
 * Geração determinística por produto cartesiano (sem fixture gigante):
 * cada família combina eixos reais de linguagem (abertura × núcleo × fecho,
 * typos, caixa alta, números). Positivos devem rotear 100% a `projecao`;
 * negativos nunca podem virar `projecao` (precision first).
 *
 * Camadas cobertas: detector puro (`detectarIntencaoChat`), refino com
 * contexto (`refinarIntencaoComContexto`), follow-up (`ehFollowUpProjecao`),
 * extração (`extrairPercentualNova`/`extrairAnexosMaeNova`) e ponta a ponta
 * do coletor ao motor (`responderProjecaoDividida`).
 */
import { describe, expect, it } from 'vitest';
import { detectarIntencaoChat } from '@/domain/services/detector-chat';
import { refinarIntencaoComContexto } from '@/application/aurum-ai-tools';
import {
  ehFollowUpProjecao,
  extrairAnexosMaeNova,
  extrairPercentualNova,
  responderProjecaoDividida,
} from '@/application/aurum-ai-projecao';

/* ------------------------------------------------ eixos ------------- */

const ABERTURAS_A = [
  '', 'por favor, ', 'oi, ', 'bom dia, ', 'você sabe se ', 'consegue ',
  'me diz se ', 'preciso saber se ', 'quero saber se ', 'me ajuda: ',
];
const FECHOS_A = ['', '?'];

const VERBOS_A = ['dividir', 'fatiar', 'separar', 'fracionar', 'desmembrar'];
const OBJETOS_A = [
  'o faturamento', 'a receita mensal', 'meu faturamento',
  'o faturamento da empresa', 'o RBT12', 'as receitas da empresa',
];
const ALVOS_A = [
  'em duas empresas', 'entre duas empresas', 'em dois CNPJs',
  'entre a mãe e a nova', 'para a nova empresa', 'com a nova empresa',
];

const VERBOS_B = ['quebrar', 'repartir', 'distribuir', 'ratear', 'segregar', 'desdobrar'];
const OBJETOS_B = ['o faturamento', 'o faturamento da empresa', 'o RBT12'];
const ABERTURAS_B = ['', 'por favor, ', 'você sabe se ', 'consegue ', 'quero saber se ', 'me ajuda: '];

const VERBOS_C = ['abrir', 'criar', 'montar', 'constituir'];
const ALVOS_C = ['uma nova empresa', 'uma segunda empresa', 'outro CNPJ', 'uma filial', 'mais uma empresa'];
const CONTEXTOS_C = ['', ' para dividir o faturamento', ' e dividir as receitas', ', vale a pena?', ', compensa?'];
const ABERTURAS_C = ['', 'por favor, ', 'quero ', 'preciso '];

const FRAMES_DECISAO = [
  'vale a pena abrir uma nova empresa',
  'compensa abrir um segundo CNPJ',
  'é melhor dividir em duas empresas',
  'faz sentido criar outra empresa para o faturamento',
  'devo abrir uma nova empresa para dividir a receita',
  'vale a pena ter dois CNPJs',
  'compensa separar em matriz e filial',
  'é melhor concentrar tudo ou dividir em duas',
  'faz sentido desmembrar em duas empresas',
  'deveria criar uma filial para parte do faturamento',
  'vale a pena o desdobramento em duas empresas',
  'compensa mais uma empresa ou tudo junto',
];
const ABERTURAS_D = ['', 'por favor, ', 'oi, ', 'você sabe se ', 'consegue me dizer se ', 'na sua opinião, '];

const FRAMES_SIMULACAO = [
  'simula a divisão do faturamento em duas empresas',
  'projeta mãe e nova com 30% na nova',
  'compara tudo numa empresa vs dividir em duas',
  'faz a conta dividindo o RBT12 em dois CNPJs',
  'mostra a economia separando em matriz e filial',
  'calcula o DAS fatiando entre duas empresas',
  'roda a projeção com a nova ficando com 40%',
  'e se eu fatiar 50/50 entre duas empresas',
  'quero a simulação mãe × nova',
  'projeção com desmembramento do faturamento',
];
const ABERTURAS_E = ['', 'por favor, ', 'consegue ', 'me ajuda: '];
const SUFIXOS_VALOR = ['', ' com RBT12 1,2M e receita 120 mil'];

const RBTS = ['RBT12 1,2 milhão', 'RBT12 500 mil', 'faturamento 2 milhões'];
const RECEITAS = ['receita 120 mil por mês', 'receita 40 mil/mês'];
const PERCENTUAIS = ['30% na nova', 'meio a meio', '70/30', '40% para a nova', 'um terço na nova'];
const ANEXOS_F = ['mãe no III e nova no III', 'ambas no III', 'mãe no III e nova no V'];
const PREFIXOS_F = ['dividindo ', 'projeção dividindo ', ''];

/* --------------------------------------------- geração -------------- */

function gerarPositivos(): string[] {
  const out: string[] = [];
  for (const ab of ABERTURAS_A)
    for (const v of VERBOS_A)
      for (const o of OBJETOS_A)
        for (const a of ALVOS_A)
          for (const f of FECHOS_A) out.push(`${ab}${v} ${o} ${a}${f}`);
  for (const ab of ABERTURAS_B)
    for (const v of VERBOS_B)
      for (const o of OBJETOS_B)
        for (const a of ALVOS_A)
          for (const f of FECHOS_A) out.push(`${ab}${v} ${o} ${a}${f}`);
  for (const ab of ABERTURAS_C)
    for (const v of VERBOS_C)
      for (const a of ALVOS_C)
        for (const c of CONTEXTOS_C)
          for (const f of FECHOS_A) out.push(`${ab}${v} ${a}${c}${f}`);
  for (const ab of ABERTURAS_D)
    for (const d of FRAMES_DECISAO)
      for (const f of FECHOS_A) out.push(`${ab}${d}${f}`);
  for (const ab of ABERTURAS_E)
    for (const s of FRAMES_SIMULACAO)
      for (const v of SUFIXOS_VALOR) out.push(`${ab}${s}${v}`);
  for (const p of PREFIXOS_F)
    for (const r of RBTS)
      for (const rec of RECEITAS)
        for (const pct of PERCENTUAIS)
          for (const anx of ANEXOS_F) out.push(`${p}${r}, ${rec}, ${pct}, ${anx}`);
  // Camada typos: 1 typo por frase (cobre NORMALIZACAO_ENTRADA da projeção).
  const typos: Array<[RegExp, string]> = [
    [/\bdividir\b/, 'devidir'],
    [/\bfaturamento\b/, 'faturamnto'],
    [/ empresa\b/, ' empressa'],
    [/\breceita\b/, 'receuta'],
  ];
  const baseA: string[] = [];
  for (const v of VERBOS_A)
    for (const o of OBJETOS_A)
      for (const a of ALVOS_A) baseA.push(`${v} ${o} ${a}?`);
  let ti = 0;
  for (const frase of baseA.slice(0, 150)) {
    const [rx, certo] = typos[ti % typos.length];
    ti++;
    if (rx.test(frase)) out.push(`por favor, ${frase.replace(rx, certo)}`);
  }
  // Camada caixa alta (normalização de caixa do detector).
  const caps = [
    ...FRAMES_DECISAO.slice(0, 40),
    ...baseA.slice(150, 190),
  ];
  for (const frase of caps) out.push(frase.toUpperCase());
  return [...new Set(out.map((s) => s.trim()))].filter(Boolean);
}

const NEGATIVOS: Array<[string, string]> = [
  // [texto, intent CORRETO] — cada par é um erro que a IA já cometeu ou
  // quase cometeu (culinária→NCM, tutorial→generico, boleto→cálculo, etc.).
  ['qual o NCM de banana?', 'ncm'],
  ['tem algum ncm de queijo minas?', 'ncm'],
  ['classifica parafuso sextavado', 'ncm'],
  ['NCM 08031000', 'ncm'],
  ['quanto fica R$ 1.000 no NCM 08031000?', 'calculo'],
  ['quanto fica R$ 2.500 no NCM 0803.10.00?', 'calculo'],
  ['qual a tributação de tangerina?', 'ncm'],
  ['camiseta de algodão', 'ncm'],
  ['vendo parafuso sextavado', 'ncm'],
  ['qual o NCM do bolo de chocolate?', 'ncm'],
  ['qual NBS para aula de yoga?', 'nbs'],
  ['quais seriam os NBS para consultoria?', 'nbs'],
  ['nbs para programação de computadores', 'nbs'],
  ['quais atividades o CNPJ 53.795.990/0001-68 tem?', 'cnpj'],
  ['o CNPJ 53.795.990/0001-68 está cadastrado?', 'cnpj'],
  ['meu DAS no Anexo III com RBT12 500 mil e receita 40 mil', 'simples'],
  ['Anexo III, RBT12 500 mil, receita 40 mil no híbrido', 'simples'],
  ['DAS Anexo V RBT12 200 mil receita 30 mil', 'simples'],
  ['montar uma empresa de software, qual o anexo?', 'simples'],
  ['nova empresa no simples, qual anexo?', 'simples'],
  ['dividir o DAS em duas parcelas', 'simples'],
  ['posso parcelar o DAS em 3 vezes?', 'simples'],
  ['o DAS parcelado tem juros?', 'simples'],
  ['repartir as despesas entre as empresas', 'simples'],
  ['quanto é 10% de 500?', 'conta'],
  ['quanto é 2+3?', 'conta'],
  ['divide 100 por 2', 'conta'],
  ['divide 1000 em 4 parcelas iguais', 'conta'],
  ['resto de 10 por 3', 'conta'],
  ['separa os XMLs por empresa', 'dados'],
  ['lista os produtos vendidos', 'dados'],
  ['qual fornecedor me dá mais crédito?', 'dados'],
  ['tem XML de algum cliente?', 'dados'],
  ['quais top produtos desse cliente?', 'dados'],
  ['mostra as notas da Padaria em janeiro', 'dados'],
  ['como abrir uma empresa?', 'ajuda'],
  ['como criar um CNPJ?', 'ajuda'],
  ['como montar uma empresa?', 'ajuda'],
  ['quero cadastrar um produto', 'cadastrar_produto'],
  ['criar um produto novo no sistema', 'cadastrar_produto'],
  ['o que é Fator R?', 'conceito'],
  ['o que é sublimite?', 'conceito'],
  ['qual melhor: Anexo III ou V?', 'comparativo'],
  ['que horas são?', 'tempo'],
  ['obrigado', 'conversa_leve'],
  ['o que você pode fazer?', 'capacidades'],
  ['gera um relatório dessa conversa', 'relatorio'],
  ['explica o art. 128', 'legislacao'],
  ['me leva para a calculadora', 'navegar'],
  ['abrir a tela de consulta', 'navegar'],
  ['como dividir a receita do bolo em duas partes?', 'generico'],
  ['receita de bolo de cenoura', 'generico'],
  ['divido o bolo em duas partes iguais', 'generico'],
  ['preciso da segunda via do boleto', 'generico'],
  ['fatura 2 vias do boleto', 'generico'],
  ['separa os boletos por empresa', 'generico'],
  ['a reforma quebrou minha empresa', 'generico'],
  ['distribuir lucros da empresa', 'generico'],
  ['quero abrir uma filial, qual o procedimento?', 'generico'],
  ['separar a conta do mês', 'generico'],
  ['e para 50 mil?', 'generico'],
];

const HIST_PROJECAO = [{ papel: 'user' as const, texto: 'consegue dividir o faturamento em duas empresas?' }];
const FOLLOW_UPS = [
  'e com 50% na nova?',
  'e meio a meio?',
  'e 70/30?',
  'mãe no III e nova no V',
  'custo 5 mil da nova',
  'e se a nova ficar com 40%?',
  'RBT12 1,2 milhão',
  'receita 120 mil por mês',
  'e com folha 200 mil?',
];

/* ------------------------------------------------- testes ------------- */

describe('fine-tuning projeção — ≥2000 variações do pedido', () => {
  it('dataset tem ≥2000 positivos únicos', () => {
    const pos = gerarPositivos();
    console.log(`variações positivas geradas: ${pos.length}`);
    expect(pos.length).toBeGreaterThanOrEqual(2000);
  });

  it('100% dos positivos roteiam a `projecao` (sem cair em NCM/generico)', () => {
    const pos = gerarPositivos();
    const misses: string[] = [];
    for (const texto of pos) {
      const intencao = detectarIntencaoChat(texto).intencao;
      if (intencao !== 'projecao') misses.push(`[${intencao}] "${texto}"`);
    }
    if (misses.length) console.log(`MISSES (${misses.length}):\n` + misses.slice(0, 40).join('\n'));
    expect(misses, `${misses.length} variações não rotearam a projecao`).toEqual([]);
  }, 120000);

  it('negativas roteiam EXATAMENTE ao intent correto (60 casos)', () => {
    expect(NEGATIVOS.length).toBeGreaterThanOrEqual(50);
    const erros: string[] = [];
    for (const [texto, esperada] of NEGATIVOS) {
      const obtida = detectarIntencaoChat(texto).intencao;
      if (obtida !== esperada) erros.push(`[esperava ${esperada}, veio ${obtida}] "${texto}"`);
    }
    if (erros.length) console.log(`NEGATIVAS ERRADAS (${erros.length}):\n` + erros.join('\n'));
    expect(erros).toEqual([]);
  });

  it('extração de percentual cobre as formas numéricas', () => {
    expect(extrairPercentualNova('30% na nova')).toBe(0.3);
    expect(extrairPercentualNova('meio a meio no faturamento de 1M')).toBe(0.5);
    expect(extrairPercentualNova('70/30 entre mãe e nova')).toBe(0.3);
    expect(extrairPercentualNova('40% para a nova')).toBe(0.4);
    expect(extrairPercentualNova('nova fica com 25% do RBT12')).toBe(0.25);
    expect(extrairPercentualNova('30% do faturamento na nova')).toBe(0.3);
    const terco = extrairPercentualNova('um terço na nova, RBT12 900 mil');
    expect(terco).not.toBeNull();
    expect(Math.abs((terco as number) - 1 / 3)).toBeLessThan(0.0002);
  });

  it('extração de anexos cobre ordinal, numeral e ordem reversa', () => {
    expect(extrairAnexosMaeNova('mãe no III e nova no V', null)).toEqual({ mae: 'III', nova: 'V' });
    expect(extrairAnexosMaeNova('ambas no III', null)).toEqual({ mae: 'III', nova: 'III' });
    expect(extrairAnexosMaeNova('anexo 3 nas duas', 'III')).toEqual({ mae: 'III', nova: 'III' });
    expect(extrairAnexosMaeNova('terceiro anexo nas duas empresas', null)).toEqual({ mae: 'III', nova: 'III' });
    expect(extrairAnexosMaeNova('III para a mãe, V para a nova', null)).toEqual({ mae: 'III', nova: 'V' });
    // "2 empresas" nunca vira Anexo II.
    expect(extrairAnexosMaeNova('nova em 2 empresas', null)).toEqual({ mae: null, nova: null });
  });

  it('follow-ups com histórico de projeção promovem (refino + delegation)', () => {
    const histUser = HIST_PROJECAO.map((m) => m.texto);
    const semPromocao: string[] = [];
    for (const f of FOLLOW_UPS) {
      const refinada = refinarIntencaoComContexto(detectarIntencaoChat(f), f, HIST_PROJECAO as never, null);
      const viaFollow = ehFollowUpProjecao(f, histUser);
      if (refinada.intencao !== 'projecao' && !viaFollow) semPromocao.push(`"${f}" (refino=${refinada.intencao})`);
    }
    if (semPromocao.length) console.log('SEM PROMOÇÃO:\n' + semPromocao.join('\n'));
    expect(semPromocao).toEqual([]);
  });

  it('amostra de numéricos completos chega ao veredito do motor', () => {
    const amostra = [
      'dividindo RBT12 1,2 milhão, receita 120 mil por mês, 30% na nova, mãe no III e nova no III',
      'RBT12 500 mil, receita 40 mil/mês, meio a meio, ambas no III',
      'projeção dividindo faturamento 2 milhões, receita 120 mil por mês, 70/30, mãe no III e nova no V',
      'RBT12 1,2 milhão, receita 40 mil/mês, um terço na nova, III para a mãe, V para a nova',
      'vale a pena abrir uma nova empresa? RBT12 1,2 milhão, receita 120 mil por mês, 40% para a nova, terceiro anexo nas duas',
    ];
    for (const texto of amostra) {
      expect(detectarIntencaoChat(texto).intencao).toBe('projecao');
      const r = responderProjecaoDividida(texto, []);
      expect(r.texto).toMatch(/veredito|Compensa|Não compensa|Empate/);
    }
  });
});
