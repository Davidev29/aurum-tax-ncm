/**
 * Hierarquia fiscal do NCM — capítulo, posição, subposição, seção e família.
 *
 * Cobre `src/domain/services/hierarquia-fiscal.ts` (puro, sem IndexedDB).
 */
import { describe, expect, it } from 'vitest'
import {
  capituloDoNcm,
  familiaDoNcm,
  mesmaFamilia,
  nivelDoCodigo,
  posicaoDoNcm,
  prefixoDeEntradaTruncada,
  prefixosDoNcm,
  rotuloNivel,
  secaoDoCapitulo,
  secaoDoNcm,
  SECOES_NCM,
  subposicaoDoNcm,
} from '@/domain/services/hierarquia-fiscal'

describe('nivelDoCodigo', () => {
  it('classifica 2/4/6/7/8 dígitos', () => {
    expect(nivelDoCodigo('07')).toBe('capitulo')
    expect(nivelDoCodigo('0713')).toBe('posicao')
    expect(nivelDoCodigo('071333')).toBe('subposicao')
    expect(nivelDoCodigo('0713331')).toBe('item')
    expect(nivelDoCodigo('07133319')).toBe('exato')
  })
  it('3/5 dígitos são inválidos como nível (recorte ambíguo da lei)', () => {
    expect(nivelDoCodigo('071')).toBe('invalido')
    expect(nivelDoCodigo('07133')).toBe('invalido')
    expect(nivelDoCodigo('')).toBe('invalido')
  })
  it('aceita máscara com pontos', () => {
    expect(nivelDoCodigo('0713.33.19')).toBe('exato')
  })
})

describe('prefixos e família', () => {
  it('prefixosDoNcm em 5 níveis', () => {
    expect(prefixosDoNcm('07133319')).toEqual(['07', '0713', '071333', '0713331', '07133319'])
  })
  it('fora de 8 dígitos devolve []', () => {
    expect(prefixosDoNcm('0713')).toEqual([])
  })
  it('familiaDoNcm traz capítulo, seção, posição e subposição', () => {
    const f = familiaDoNcm('07133319')
    expect(f?.capitulo).toBe('07')
    expect(f?.secao).toBe('II')
    expect(f?.posicao).toBe('0713')
    expect(f?.subposicao).toBe('071333')
  })
  it('mesmaFamilia por nível', () => {
    expect(mesmaFamilia('07133319', '07133329', 'subposicao')).toBe(true)
    expect(mesmaFamilia('07133319', '07133419', 'subposicao')).toBe(false)
    expect(mesmaFamilia('07133319', '07133419', 'posicao')).toBe(true)
    expect(mesmaFamilia('07133319', '08133319', 'capitulo')).toBe(false)
  })
})

describe('seções SH', () => {
  it('21 seções cobrindo 01–97 (sem 77)', () => {
    expect(SECOES_NCM).toHaveLength(21)
    const todas = SECOES_NCM.flatMap((s) => s.capitulos)
    expect(todas).toContain('01')
    expect(todas).toContain('97')
    expect(todas).not.toContain('77')
  })
  it('secaoDoCapitulo: 07 → II, 85 → XVI, 93 → XIX', () => {
    expect(secaoDoCapitulo('07')?.numero).toBe('II')
    expect(secaoDoCapitulo('85')?.numero).toBe('XVI')
    expect(secaoDoCapitulo('93')?.numero).toBe('XIX')
  })
  it('secaoDoNcm lê os 2 primeiros dígitos', () => {
    expect(secaoDoNcm('07133319')?.numero).toBe('II')
    expect(secaoDoNcm('')).toBeNull()
  })
})

describe('entrada truncada da Reforma (4–5 dígitos)', () => {
  it('4 dígitos → posição; 5 arredonda para posição', () => {
    expect(prefixoDeEntradaTruncada('0713')).toEqual({ prefixo: '0713', nivel: 'posicao' })
    expect(prefixoDeEntradaTruncada('07133')).toEqual({ prefixo: '0713', nivel: 'posicao' })
  })
  it('6 → subposição; 2 → capítulo; 8 → exato', () => {
    expect(prefixoDeEntradaTruncada('071333')).toEqual({ prefixo: '071333', nivel: 'subposicao' })
    expect(prefixoDeEntradaTruncada('07')).toEqual({ prefixo: '07', nivel: 'capitulo' })
    expect(prefixoDeEntradaTruncada('07133319')).toEqual({ prefixo: '07133319', nivel: 'exato' })
  })
  it('vazio/1 dígito → null', () => {
    expect(prefixoDeEntradaTruncada('')).toBeNull()
    expect(prefixoDeEntradaTruncada('0')).toBeNull()
  })
})

describe('rótulos', () => {
  it('rotuloNivel descreve cada nível', () => {
    expect(rotuloNivel('capitulo', '07')).toBe('Capítulo 07')
    expect(rotuloNivel('posicao', '0713')).toBe('Posição SH4 0713')
    expect(rotuloNivel('subposicao', '071333')).toBe('Subposição SH6 071333')
  })
  it('helpers de recorte', () => {
    expect(capituloDoNcm('07133319')).toBe('07')
    expect(posicaoDoNcm('07133319')).toBe('0713')
    expect(subposicaoDoNcm('07133319')).toBe('071333')
  })
})
