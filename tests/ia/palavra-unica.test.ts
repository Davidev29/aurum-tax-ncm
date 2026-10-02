/**
 * QA da trava de especificidade sem lastro — palavra única sem contexto.
 *
 * Regra: com uma única palavra e sem refino (destinação/composição/uso), a IA
 * NÃO atribui qualidade/complemento ("chocolate" não vira "Chocolate branco";
 * verbo isolado como "plantar" não vira produto). Com mais entradas que
 * comprovem ("chocolate branco", "chocolate" + composição "branco"), a
 * especificidade vale.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { invalidarCacheBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'
import {
  ehVerboProvavel,
  MOTIVO_PALAVRA_UNICA_QUALIFICADOR,
  qualificadoresNaoComprovados,
} from '@/domain/services/palavra-unica'
import { semearBaseIa, soDigitos } from './ajuda-ia'

const NOMEN_CHOCOLATES = [
  { codigo: '1704', codigoOriginal: '17.04', descricao: 'Produtos de confeitaria sem cacau (incluindo o chocolate branco).', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '17049010', codigoOriginal: '1704.90.10', descricao: 'Chocolate branco', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '1806', codigoOriginal: '18.06', descricao: 'Chocolate e outras preparações alimentícias que contenham cacau.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '180631', codigoOriginal: '1806.31', descricao: '-- Recheados', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '18063110', codigoOriginal: '1806.31.10', descricao: 'Chocolate', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '180632', codigoOriginal: '1806.32', descricao: '-- Não recheados', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '18063210', codigoOriginal: '1806.32.10', descricao: 'Chocolate', dataInicio: null, dataFim: null, ato: 'Ato' },
]

async function semearComChocolates(semNaoRecheado = false): Promise<void> {
  await semearBaseIa()
  await db.ncmNomenclatura.bulkPut(
    (semNaoRecheado ? NOMEN_CHOCOLATES.filter((n) => n.codigo !== '18063210') : NOMEN_CHOCOLATES) as never,
  )
  invalidarCacheBuscaTexto()
}

beforeAll(() => {
  const g = globalThis as unknown as { window?: { aurum?: unknown } }
  if (typeof g.window === 'undefined') g.window = {}
  if (g.window.aurum !== undefined) delete g.window.aurum
})

describe('palavra-unica: helpers puros', () => {
  it('"Chocolate branco" tem qualificador não comprovado; "Chocolate" é genérico', () => {
    expect(qualificadoresNaoComprovados('Chocolate branco', ['chocolate'])).toEqual(['branco'])
    expect(qualificadoresNaoComprovados('Chocolate', ['chocolate'])).toEqual([])
  })

  it('verbo provável: "plantar" sim; produtos terminados em -ar/-er/-ir não', () => {
    expect(ehVerboProvavel('plantar')).toBe(true)
    expect(ehVerboProvavel('congelar')).toBe(true)
    expect(ehVerboProvavel('celular')).toBe(false)
    expect(ehVerboProvavel('acucar')).toBe(false)
    expect(ehVerboProvavel('freezer')).toBe(false)
    expect(ehVerboProvavel('chocolate')).toBe(false)
    expect(ehVerboProvavel('gatos')).toBe(false)
  })
})

describe('palavra-unica: "chocolate" sozinho nunca vira "branco"', () => {
  beforeEach(() => semearComChocolates())

  it('"chocolate" é NÃO SEI (genéricos empatados + específico sem lastro)', async () => {
    const r = await classificarComIA('chocolate')
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
    expect(r.candidatos.length).toBeGreaterThan(0)
    expect(r.motivo).toMatch(/palavra-unica/)
  })

  it('"chocolate branco" decide 17049010 (2 palavras comprovam)', async () => {
    const r = await classificarComIA('chocolate branco')
    expect(soDigitos(r.codigoEscolhido)).toBe('17049010')
    expect(r.decisao).not.toBeNull()
  })

  it('"chocolate" + composição "branco" decide 17049010 (refino comprova)', async () => {
    const r = await classificarComIA({ descricao: 'chocolate', composicao: 'branco' })
    expect(soDigitos(r.codigoEscolhido)).toBe('17049010')
    expect(r.decisao).not.toBeNull()
  })

  it('verbo isolado "plantar" é NÃO SEI (ação não comprova produto)', async () => {
    const r = await classificarComIA('plantar')
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
  })

  it('substantivo "semeadura" continua decidindo (lastro literal, sem regressão)', async () => {
    const r = await classificarComIA('semeadura')
    expect(soDigitos(r.codigoEscolhido)).toBe('10051000')
    expect(r.decisao).not.toBeNull()
  })
})

describe('palavra-unica: genérico único é preferido ao específico', () => {
  beforeEach(() => semearComChocolates(true))

  it('"chocolate" retorna só o genérico 18063110, não o branco', async () => {
    const r = await classificarComIA('chocolate')
    expect(soDigitos(r.codigoEscolhido)).toBe('18063110')
    expect(r.decisao).not.toBeNull()
    expect(r.motivo).not.toBe(MOTIVO_PALAVRA_UNICA_QUALIFICADOR)
  })
})
