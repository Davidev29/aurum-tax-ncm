/**
 * Raciocínio em camadas (fine-tuning §5/§7) — antes de qualquer NÃO SEI:
 * 1) extrai o núcleo da pergunta (andaime nunca vira termo de busca);
 * 2) decide o domínio (produto=NCM x serviço=NBS);
 * 3) cruza na outra base quando a primeira não ancora.
 *
 * Caso-mãe: "Temos tributação para tangerina?" caía em NÃO SEI mesmo com o
 * NCM 0805.21.00 na base (ruído "temos/tributação" quebrava o AND).
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { detectarIntencaoChat, classificarDominio, extrairNucleoBusca } from '@/domain/services/detector-chat'
import { responderChat } from '@/application/aurum-ai-chat'
import { importarBase } from '@/infrastructure/base/base-service'
import { invalidarCacheBuscaTexto, invalidarCacheBuscaTextoNbs } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

const noop = () => undefined

const REFERENCIA = [
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200028',
    'Descrição do Código da Classificação Tributária': 'Fornecimento dos serviços de educação (Anexo II)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '2',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art129',
    'Exige Tributação': 'Sim',
    'Redução BC CST': 'Não',
    'Redução de Alíquota': 'Sim',
    'Transferência de Crédito': 'Não',
    Diferimento: 'Não',
    Monofásica: 'Não',
    'Crédito Presumido IBS Zona Franca de Manaus': 'Não',
    'Ajuste de Competência': 'Não',
    'Tributação Regular': 'Não',
    'Crédito Presumido': 'Não',
    'Estorno de Crédito': 'Não',
    'Tributação Monofásica Normal': 'Não',
    'Tributação Monofásica sujeita a retenção': 'Não',
    'Tributação Monofásica de Combustível com diferimento': 'Não',
    NFSe: 'Sim',
  },
]

const NBS_EDU = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

beforeEach(async () => {
  invalidarCacheBuscaTexto()
  invalidarCacheBuscaTextoNbs()
  await Promise.all([
    db.ncm.clear().catch(() => undefined),
    db.ncmNomenclatura.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.cnae.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
  ])
})

describe('núcleo da pergunta (andaime nunca vira busca)', () => {
  it('"Temos tributação para tangerina?" → "tangerina"', () => {
    expect(extrairNucleoBusca('Temos tributação para tangerina?')).toBe('tangerina')
  })
  it('"Qual a tributação de banana fresca?" → "banana fresca"', () => {
    expect(extrairNucleoBusca('Qual a tributação de banana fresca?')).toBe('banana fresca')
  })
  it('"tem algum ncm de banana?" → "banana"', () => {
    expect(extrairNucleoBusca('tem algum ncm de banana?')).toBe('banana')
  })
  it('"qual o nbs para aula de yoga?" → "aula de yoga"', () => {
    expect(extrairNucleoBusca('qual o nbs para aula de yoga?')).toBe('aula de yoga')
  })
  it('"Qual NCM casaria com banana fresca?" → "banana fresca"', () => {
    expect(extrairNucleoBusca('Qual NCM casaria com banana fresca para consumo?')).toBe('banana fresca para consumo')
  })
  it('"Tem no sistema alguma tributação para abacate?" → "abacate"', () => {
    expect(extrairNucleoBusca('Tem no sistema alguma tributação para abacate?')).toBe('abacate')
  })
})

describe('domínio produto × serviço (decide antes de vasculhar)', () => {
  it('"abacate" é produto', () => {
    expect(classificarDominio('abacate')).toBe('produto')
  })
  it('"aula de yoga" é serviço', () => {
    expect(classificarDominio('aula de yoga')).toBe('servico')
  })
  it('"banana" é produto', () => {
    expect(classificarDominio('banana')).toBe('produto')
  })
  it('"xyzbltq" é indefinido (tenta os dois)', () => {
    expect(classificarDominio('xyzbltq')).toBe('indefinido')
  })
  it('"qual a tributação?" (sem X) → null', () => {
    expect(extrairNucleoBusca('qual a tributação?')).toBeNull()
  })
})

describe('roteamento produto × serviço', () => {
  it('"Temos tributação para tangerina?" → ncm', () => {
    expect(detectarIntencaoChat('Temos tributação para tangerina?').intencao).toBe('ncm')
  })
  it('"Qual a tributação de tangerina?" → ncm (não conceito)', () => {
    expect(detectarIntencaoChat('Qual a tributação de tangerina?').intencao).toBe('ncm')
  })
  it('"Qual a tributação de aula de yoga?" → nbs (serviço explícito)', () => {
    expect(detectarIntencaoChat('Qual a tributação de aula de yoga?').intencao).toBe('nbs')
  })
})

describe('raciocínio fim a fim (com base mínima)', () => {
  it('tangerina ancora o NCM 0805.21.00 (caso do print)', async () => {
    await db.ncmNomenclatura.put({
      codigo: '08052100',
      codigoOriginal: '0805.21.00',
      descricao: 'Mandarinas (incluindo as tangerinas e as satsumas)',
      dataInicio: null,
      dataFim: null,
      ato: null,
    } as never)
    const r = await responderChat('Temos tributação para tangerina?')
    expect(r.texto).toContain('0805.21.00')
    expect(r.texto).toMatch(/Classificação sugerida/i)
    expect(r.texto).not.toMatch(/tangerine|taxation/i)
    expect(r.codigo).toBe('08052100')
  }, 20000)

  it('abacate ancora o NCM 0804.40.00 (print: "tem no sistema...")', async () => {
    await db.ncmNomenclatura.put({
      codigo: '08044000',
      codigoOriginal: '0804.40.00',
      descricao: 'Abacates',
      dataInicio: null,
      dataFim: null,
      ato: null,
    } as never)
    const r = await responderChat('Tem no sistema alguma tributação para abacate?')
    expect(r.texto).toContain('0804.40.00')
    expect(r.texto).toMatch(/Classificação sugerida/i)
    expect(r.texto).not.toMatch(/avocado|taxation/i)
    expect(r.codigo).toBe('08044000')
  }, 20000)

  it('NCM sem lastro cruza no NBS (autoescola → NBS educação)', async () => {
    await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
    await importarBase(NBS_EDU, 'NBS SERVIÇOS.json', noop)
    const r = await responderChat('Temos tributação para autoescola?')
    expect(r.texto).toContain('122.011.100')
    expect(r.texto).toMatch(/serviço/i)
    expect(r.codigo).toBe('122011100')
  }, 20000)

  it('sem lastro nas duas bases: NÃO SEI cita o que foi vasculhado', async () => {
    const r = await responderChat('qual a tributação de xyzbltq?')
    expect(r.texto).toMatch(/xyzbltq/i)
    expect(r.texto).toMatch(/NCM/)
  }, 20000)
})
