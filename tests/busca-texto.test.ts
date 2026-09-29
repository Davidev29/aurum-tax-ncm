/**
 * Busca textual da nomenclatura — unidade pura + integração com o Dexie.
 *
 * A invariante central: descrições fragmentadas ("Mozarela", sem "queijo")
 * precisam ser achadas pelo nome do produto via caminho hierárquico.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  comporCaminho,
  normalizarBusca,
  pontuarCandidato,
  pareceCodigoNcm,
  prefixosHierarquia,
  tokenizarBusca,
} from '@/domain/services/busca-texto'
import { buscarNomenclaturaPorTexto } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

describe('normalizarBusca / tokenizarBusca', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizarBusca('Queijos e Requeijão.')).toBe('queijos e requeijao')
    expect(normalizarBusca('0406.10.10')).toBe('0406 10 10')
    expect(tokenizarBusca('  Queijo   MOZARELA ')).toEqual(['queijo', 'mozarela'])
  })

  it('remove duplicadas e exige ao menos 2 termos úteis', () => {
    expect(tokenizarBusca('carne carne bovina')).toEqual(['carne', 'bovina'])
    expect(tokenizarBusca('')).toEqual([])
    expect(tokenizarBusca('a')).toEqual(['a'])
  })
})

describe('hierarquia', () => {
  it('gera prefixos 2/4/6/8', () => {
    expect(prefixosHierarquia('04061010')).toEqual(['04', '0406', '040610', '04061010'])
    expect(prefixosHierarquia('04')).toEqual(['04'])
  })

  it('compõe o caminho sem o próprio item e sem repetidos', () => {
    const obter = (p: string) =>
      ({ '04': 'Leite e lacticínios', '0406': 'Queijos e requeijão.', '040610': 'Queijos frescos' })[p] ?? null
    expect(comporCaminho('04061010', obter)).toEqual([
      'Leite e lacticínios',
      'Queijos e requeijão.',
      'Queijos frescos',
    ])
  })
})

describe('pontuarCandidato', () => {
  it('rejeita quando falta um token no caminho', () => {
    expect(pontuarCandidato(['queijo', 'trator'], 'mozarela', 'queijos mozarela')).toBe(-1)
  })

  it('prefere frase exata na descrição própria', () => {
    const naPropria = pontuarCandidato(['queijo', 'fresco'], 'queijos frescos', 'queijos frescos leite')
    const soNoCaminho = pontuarCandidato(['queijo', 'fresco'], 'mozarela', 'queijos frescos mozarela')
    expect(naPropria).toBeGreaterThan(soNoCaminho)
    expect(soNoCaminho).toBeGreaterThanOrEqual(0)
  })

  it('rebaixa descrições genéricas', () => {
    const generico = pontuarCandidato(['queijo'], 'outros', 'queijos outros')
    const especifico = pontuarCandidato(['queijo'], 'mozarela', 'queijos mozarela')
    expect(especifico).toBeGreaterThan(generico)
  })
})

describe('pareceCodigoNcm', () => {
  it('distingue código de texto', () => {
    expect(pareceCodigoNcm('0201.10.00')).toBe(true)
    expect(pareceCodigoNcm('02011000')).toBe(true)
    expect(pareceCodigoNcm('queijo')).toBe(false)
    expect(pareceCodigoNcm('queijo 123')).toBe(false)
  })
})

describe('buscarNomenclaturaPorTexto (Dexie)', () => {
  beforeEach(async () => {
    await db.ncmNomenclatura.clear()
    await db.ncm.clear()
    const { invalidarCacheBuscaTexto } = await import('@/infrastructure/base/classificacao-repo')
    invalidarCacheBuscaTexto()
    await db.ncmNomenclatura.bulkPut([
      { codigo: '04', codigoOriginal: '04', descricao: 'Leite e lacticínios', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '0406', codigoOriginal: '04.06', descricao: 'Queijos e requeijão.', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '040610', codigoOriginal: '0406.10', descricao: 'Queijos frescos, incluindo o requeijão', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '04061010', codigoOriginal: '0406.10.10', descricao: 'Mozarela', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '04061090', codigoOriginal: '0406.10.90', descricao: 'Outros', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '02011000', codigoOriginal: '0201.10.00', descricao: 'Carcaças e meias-carcaças de bovino', dataInicio: null, dataFim: null, ato: 'Ato' },
    ])
  })

  it('acha "queijo mozarela" pelo caminho hierárquico', async () => {
    const res = await buscarNomenclaturaPorTexto('queijo mozarela')
    expect(res.map((r) => r.codigo)).toContain('04061010')
    const alvo = res.find((r) => r.codigo === '04061010')
    expect(alvo?.caminhoTexto).toContain('Queijos e requeijão.')
    // "Mozarela" (match exato) vem antes do genérico "Outros".
    expect(res[0].codigo).toBe('04061010')
  })

  it('retorna só 8 dígitos e enriquece com vínculos', async () => {
    await db.ncm.put({
      id: '02011000|200003|0',
      codigo: '02011000',
      codigoFormatado: '0201.10.00',
      cst: '200',
      cClassTrib: '200003',
      baseLegal: '',
      reducao: 60,
      aliquotaIBS: null,
      aliquotaCBS: null,
      descricao: 'Alimentos',
      documentos: 'NFE',
    })
    const res = await buscarNomenclaturaPorTexto('bovino')
    expect(res.every((r) => r.codigo.length === 8)).toBe(true)
    expect(res.find((r) => r.codigo === '02011000')?.totalClassificacoes).toBe(1)
  })

  it('ignora consulta curta e respeita o limite', async () => {
    expect(await buscarNomenclaturaPorTexto('q')).toEqual([])
    const res = await buscarNomenclaturaPorTexto('queijo', 1)
    expect(res).toHaveLength(1)
  })
})
