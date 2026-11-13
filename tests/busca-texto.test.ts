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
  pontuarCandidatoParcial,
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

  it('remove duplicadas e ignora termos curtos', () => {
    expect(tokenizarBusca('carne carne bovina')).toEqual(['carne', 'bovina'])
    expect(tokenizarBusca('')).toEqual([])
    expect(tokenizarBusca('a')).toEqual([])
  })
})

describe('hierarquia', () => {
  it('gera prefixos 2/4/5/6/7/8 (inclui níveis intermediários da TEC)', () => {
    expect(prefixosHierarquia('04061010')).toEqual(['04', '0406', '04061', '040610', '0406101', '04061010'])
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

  it('fase 1 (AND estrito) sempre vence a fase 2, mesmo com score menor', async () => {
    // Fixture da auditoria: "Queijos ralados" vence a fase 1 por cobertura
    // de tokens, mas é a fase 1 ("Mozarela") que deve encabeçar a lista.
    await db.ncmNomenclatura.bulkPut([
      { codigo: '04062000', codigoOriginal: '0406.20.00', descricao: 'Queijos ralados ou em pó', dataInicio: null, dataFim: null, ato: 'Ato' },
      { codigo: '04063000', codigoOriginal: '0406.30.00', descricao: 'Queijos fundidos', dataInicio: null, dataFim: null, ato: 'Ato' },
    ])
    const res = await buscarNomenclaturaPorTexto('queijo mozarela')
    expect(res[0].codigo).toBe('04061010')
    expect(res[0].fase).toBe(1)
  })

  it('não casa substring solta de 3-4 letras no caminho (fOtOVOltaicos, leucovorina)', async () => {
    // "ovo" não pode bater em "fotovoltaicos" nem "leucovorina" — exige token.
    const res = await buscarNomenclaturaPorTexto('ovo de codorna')
    for (const r of res) {
      expect(r.caminhoTexto.toLowerCase()).not.toContain('fotovoltaico')
      expect(r.caminhoTexto.toLowerCase()).not.toContain('leucovorina')
    }
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

describe('normalização com tags HTML/XML da TEC', () => {
  it('remove tags da descrição oficial (ex.: <i>Gallus domesticus</i>)', () => {
    expect(normalizarBusca('Galinhas - <i>Gallus domesticus</i>')).toBe('galinhas gallus domesticus')
    expect(normalizarBusca('<sup>*</sup> Quitosan')).toBe('quitosan')
  })
})

describe('pontuarCandidato — casamento por TOKEN (não substring)', () => {
  it('rejeita quando o token não existe como palavra no caminho', () => {
    expect(pontuarCandidato(['ave'], 'aveia', 'cereais de aveia')).toBe(-1)
    expect(pontuarCandidato(['milho'], 'saco de tomilho', 'tomilho farinha')).toBe(-1)
  })

  it('aceita plural/radical do token oficial', () => {
    expect(pontuarCandidato(['queijo'], 'mozarela', 'queijos frescos mozarela')).toBeGreaterThanOrEqual(0)
    expect(pontuarCandidato(['carne'], 'bovina', 'carnes de bovino')).toBeGreaterThanOrEqual(0)
  })
})

describe('pontuarCandidatoParcial — lastro de token', () => {
  it('retorna -1 quando nenhum token do caminho casa', () => {
    expect(pontuarCandidatoParcial(['ovo'], 'leucovorina', 'farmacos outros')).toBe(-1)
    expect(pontuarCandidatoParcial(['milho'], 'tomilho', 'condimentos tomilho')).toBe(-1)
  })

  it('aceita cobertura parcial real com tokens oficiais', () => {
    expect(
      pontuarCandidatoParcial(['queijo', 'fundido'], 'queijos fundidos', 'queijos fundidos leite'),
    ).toBeGreaterThanOrEqual(0)
  })
})

describe('comporCaminho — inclui níveis 5 e 7 da TEC', () => {
  it('compõe ancestrais de 2/4/5/6/7 dígitos', () => {
    const mapa: Record<string, string> = {
      '01': 'Animais vivos',
      '010229': 'Bovinos domésticos',
      '0102291': 'Para reprodução',
    }
    const obter = (p: string) => mapa[p] ?? null
    expect(comporCaminho('01022911', obter)).toEqual(['Animais vivos', 'Bovinos domésticos', 'Para reprodução'])
  })

  it('ignora níveis ausentes sem quebrar a ordem', () => {
    const obter = (p: string) => ({ '04': 'Leite', '0406': 'Queijos' } as Record<string, string>)[p] ?? null
    expect(comporCaminho('04061010', obter)).toEqual(['Leite', 'Queijos'])
  })
})
