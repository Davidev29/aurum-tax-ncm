/**
 * Phase 7 — motor NBS + determinístico + GATE Aurum AI de serviços.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import {
  buscarNbsPorTexto,
  resolverClassificacoesNbs,
  sugerirNbs,
} from '@/infrastructure/base/classificacao-repo'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'
import { classificarComIaServicos } from '@/application/classificacao-ia-servicos'

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
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '8599-6/01', 'Descrição oficial': 'Formação de condutores', Situação: 'Permitido', Anexos: 'III / V', 'Fator R': 'Sim' },
]

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
}

beforeEach(async () => {
  await Promise.all([
    db.nbs.clear().catch(() => undefined),
    db.cnae.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.consultasCnpj.clear().catch(() => undefined),
    db.table('ia_feedback').clear().catch(() => undefined),
  ])
})

describe('resolverClassificacoesNbs', () => {
  it('resolve vínculo oficial 200/200028 com reduções e anexo', async () => {
    await semear()
    const r = await resolverClassificacoesNbs('122.011.100')
    expect(r.regraGeral).toBe(false)
    expect(r.lista).toHaveLength(1)
    const cl = r.lista[0]
    expect(cl.cst).toBe('200')
    expect(cl.cClassTrib).toBe('200028')
    expect(cl.resumo.percentualReducaoIBS).toBe(60)
    expect(cl.resumo.anexo).toBe('2')
    expect(cl.codigoFormatado).toBe('122.011.100')
  })

  it('NBS sem vínculo cai na regra geral 000/000001', async () => {
    await semear()
    const r = await resolverClassificacoesNbs('999999999')
    expect(r.regraGeral).toBe(true)
    expect(r.lista[0].cst).toBe('000')
    expect(r.lista[0].cClassTrib).toBe('000001')
  })

  it('8 dígitos não é NBS (lista vazia)', async () => {
    await semear()
    const r = await resolverClassificacoesNbs('02011000')
    expect(r.lista).toHaveLength(0)
    expect(r.regraGeral).toBe(false)
  })
})

describe('busca NBS (prefixo + texto)', () => {
  it('sugerirNbs por prefixo', async () => {
    await semear()
    const lista = await sugerirNbs('122011')
    expect(lista.map((v) => v.codigo)).toContain('122011100')
    expect(await sugerirNbs('1')).toHaveLength(0)
  })

  it('buscarNbsPorTexto acha "educacao"', async () => {
    await semear()
    const lista = await buscarNbsPorTexto('educacao')
    expect(lista.map((v) => v.codigo)).toContain('122011100')
    expect(lista[0].titulo).toContain('educação')
  })
})

describe('classificarServicoPorDescricao (determinístico)', () => {
  it('"aula de inglês online" ancora no NBS de educação', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'aula de inglês online' })
    expect(s.nbs_provavel).toBe('122.011.100')
    expect(s.cst).toBe('200')
    expect(s.cClassTrib).toBe('200028')
    expect(s.anexo).toBe('II')
    expect(s.excecao_enquadravel).toBe(true)
  })

  it('entrada insuficiente pede contexto, sem chute', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'serviço' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.confianca).toBe('baixa')
    expect(s.perguntasComplementares.length).toBeGreaterThan(0)
  })

  it('sem lastro declara, não inventa', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'nave espacial quântica' })
    expect(s.nbs_provavel).toBeNull()
  })

  it('NBS parcial vira alternativas navegáveis', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: '122011' })
    expect(s.nbs_provavel).toBeNull()
    expect(s.alternativas.length).toBeGreaterThan(0)
  })
})

describe('GATE Aurum AI de serviços', () => {
  it('determinístico-alta não acorda worker', async () => {
    await semear()
    let usou: boolean | null = null
    const g = await classificarComIaServicos(
      { descricao: 'aula de inglês online para adultos' },
      { aoWorker: (u) => { usou = u } },
    )
    expect(g.via).toBe('deterministico')
    expect(usou).toBe(false)
    expect(g.nbsValidado).toBe('122011100')
  })

  it('fallback IA decide ancorado com mock fora do Electron', async () => {
    await semear()
    const g = await classificarComIaServicos({ descricao: 'educação' })
    expect(g.via).toBe('ia')
    expect(g.mock).toBe(true)
    expect(g.nbsValidado).toBe('122011100')
    expect(g.confiancaIa).toBeGreaterThan(0)
    expect(g.fontes.length).toBeGreaterThan(0)
  })

  it('NÃO SEI sem lastro: sem código, sem decisão', async () => {
    await semear()
    const g = await classificarComIaServicos({ descricao: 'nave espacial quântica' })
    expect(g.codigoEscolhido).toBeNull()
    expect(g.nbsValidado).toBeNull()
  })
})
