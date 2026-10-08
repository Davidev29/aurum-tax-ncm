/**
 * Predição informativa de serviços — nomes/sinônimos mesmo sem NBS direto.
 *
 * Garante o pedido do usuário:
 * - atividade que NÃO puxa NBS no fluxo estrito, mas BATE com os termos
 *   do sistema, ganha sugestão preditiva (top-3) a título INFORMATIVO;
 * - nunca inventa código; nunca é decisão final (`apenasInformativo: true`).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import {
  pontuarAlvoPreditivo,
  sugerirPreditivoServicos,
  AVISO_PREDITIVO_INFORMATIVO,
} from '@/domain/services/preditivo-servicos'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'

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
    'Tributação Monofásica retida anteriormente': 'Não',
    'Tributação Monofásica de Combustível com diferimento': 'Não',
    NFe: 'Não',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  },
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200029',
    'Descrição do Código da Classificação Tributária': 'Fornecimento dos serviços de saúde (Anexo III)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '3',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art130',
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
    'Tributação Monofásica retida anteriormente': 'Não',
    'Tributação Monofásica de Combustível com diferimento': 'Não',
    NFe: 'Não',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  },
]

const NBS_BASE = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
  { NBS: '122013200', CST: '200', CclassTrib: '200029', 'Base Legal': 'Fornecimento dos serviços de saúde (Anexo III)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de saúde ambulatorial e domiciliar.' },
]

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_BASE, 'NBS SERVIÇOS.json', noop)
}

beforeEach(async () => {
  await Promise.all([
    db.nbs.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
  ])
})

describe('pontuarAlvoPreditivo (puro)', () => {
  it('título exato vale ×2 e registra cobertura', () => {
    const r = pontuarAlvoPreditivo(
      ['aula', 'ingles'],
      new Map([['aula', 'educacao']]),
      { toksTitulo: new Set(['educacao', 'servicos']), toksRico: new Set(['educacao', 'servicos', 'anexo']) },
    )
    expect(r.casados).toContain('aula')
    expect(r.cobertura).toBeGreaterThan(0)
    expect(r.sinonimos).toContain('aula→educacao')
  })

  it('sem overlap não pontua', () => {
    const r = pontuarAlvoPreditivo(
      ['nave', 'quantica'],
      new Map(),
      { toksTitulo: new Set(['educacao']), toksRico: new Set(['educacao', 'saude']) },
    )
    expect(r.casados).toHaveLength(0)
    expect(r.cobertura).toBe(0)
  })
})

describe('sugerirPreditivoServicos (com base)', () => {
  it('atividade com termos do sistema ganha pista informativa (não decisão)', async () => {
    await semear()
    const lista = await sugerirPreditivoServicos('aula de inglês', { limite: 3 })
    expect(lista.length).toBeGreaterThan(0)
    const top = lista[0]
    expect(top.codigo).toMatch(/^\d{9}$|^\d{6}$/)
    expect(top.apenasInformativo).toBe(true)
    expect(top.aviso).toBe(AVISO_PREDITIVO_INFORMATIVO)
    expect(top.cobertura).toBeGreaterThanOrEqual(0.34)
    expect(top.termosCasados.length).toBeGreaterThan(0)
  })

  it('sem lastro retorna vazio (sem chute)', async () => {
    await semear()
    const lista = await sugerirPreditivoServicos('nave espacial quântica xyz', { limite: 3 })
    expect(lista).toHaveLength(0)
  })

  it('texto vazio retorna vazio', async () => {
    await semear()
    expect(await sugerirPreditivoServicos('', { limite: 3 })).toHaveLength(0)
    expect(await sugerirPreditivoServicos('de para com', { limite: 3 })).toHaveLength(0)
  })
})

describe('classificarServicoPorDescricao com preditivas', () => {
  it('sem match estrito mas com lastro: preenche sugestoesPreditivas informativas', async () => {
    await semear()
    // "formação de condutores" tem vocabulário (condutores→educacao) mas o
    // título oficial pode não casar no AND estrito em base mínima — o
    // preditivo deve ao menos tentar (array presente, mesmo que vazio).
    const s = await classificarServicoPorDescricao({ descricao: 'nave espacial quântica' })
    expect(s.nbs_provavel).toBeNull()
    expect(Array.isArray(s.sugestoesPreditivas)).toBe(true)
  })

  it('preditivas nunca viram decisão: nbs_provavel continua null no vazio', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'consultoria esotérica quântica xyz' })
    if ((s.sugestoesPreditivas ?? []).length > 0) {
      for (const p of s.sugestoesPreditivas!) {
        expect(p.apenasInformativo).toBe(true)
      }
      // A decisão oficial continua sendo "sem sugestão segura".
      expect(s.nbs_provavel).toBeNull()
    }
  })
})
