/**
 * Formatação, máscaras e parsers — paridade bit a bit com a v1 (SPEC §10.4).
 */
import { describe, expect, it } from 'vitest'
import {
  MASK,
  clamp,
  esc,
  fmtBRL,
  fmtCarga,
  fmtCnpj,
  fmtInt,
  fmtNcm,
  hexToRgb,
  norm,
  normalizeHeader,
  parseMoeda,
  parseQtd,
  uid,
} from '@/domain/services/format'

describe('norm / fmtNcm', () => {
  it('mantém apenas dígitos', () => {
    expect(norm('02.01.10-00')).toBe('02011000')
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
    expect(norm(123)).toBe('123')
  })

  it('formata NCM somente com exatamente 8 dígitos', () => {
    expect(fmtNcm('02011000')).toBe('0201.10.00')
    expect(fmtNcm('0201.10.00')).toBe('0201.10.00')
    expect(fmtNcm('0201')).toBe('0201')
    expect(fmtNcm('0201100')).toBe('0201100')
    expect(fmtNcm('')).toBe('')
  })
})

describe('fmtCnpj (máscara progressiva)', () => {
  it('avança por faixa de dígitos', () => {
    expect(fmtCnpj('')).toBe('')
    expect(fmtCnpj('1')).toBe('1')
    expect(fmtCnpj('12')).toBe('12')
    expect(fmtCnpj('123')).toBe('12.3')
    expect(fmtCnpj('1234')).toBe('12.34')
    expect(fmtCnpj('1234567')).toBe('12.345.67')
    expect(fmtCnpj('12345678')).toBe('12.345.678')
    expect(fmtCnpj('123456789012')).toBe('12.345.678/9012')
    expect(fmtCnpj('12345678000190')).toBe('12.345.678/0001-90')
  })

  it('trunca em 14 dígitos e ignora o que não é número', () => {
    expect(fmtCnpj('12345678000190999')).toBe('12.345.678/0001-90')
    expect(fmtCnpj('12.345.678/0001-90')).toBe('12.345.678/0001-90')
  })
})

describe('MASK', () => {
  it('ncm', () => {
    expect(MASK.ncm('0201')).toBe('0201')
    expect(MASK.ncm('020110')).toBe('0201.10')
    expect(MASK.ncm('02011000')).toBe('0201.10.00')
    expect(MASK.ncm('123456789')).toBe('1234.56.78')
    expect(MASK.ncm('')).toBe('')
  })

  it('cfop / cst / cstPis são truncamentos de dígitos', () => {
    expect(MASK.cfop('510299')).toBe('5102')
    expect(MASK.cst('00099')).toBe('000')
    expect(MASK.cstPis('010')).toBe('01')
  })

  it('qtd aceita vírgula brasileira e limita a 3 casas', () => {
    expect(MASK.qtd('10,5')).toBe('10,5')
    expect(MASK.qtd('10,5555')).toBe('10,555')
    expect(MASK.qtd('1.234')).toBe('1,234')
    // Vários separadores: junta e corta em 3 casas (paridade com a v1).
    expect(MASK.qtd('1.234,5678')).toBe('1,234')
    expect(MASK.qtd('abc')).toBe('')
  })

  it('moeda deriva dos centavos digitados', () => {
    expect(MASK.moeda('')).toBe('')
    expect(MASK.moeda('1')).toBe('R$ 0,01')
    expect(MASK.moeda('123456')).toBe('R$ 1.234,56')
    expect(MASK.moeda('12a3')).toBe('R$ 1,23')
  })
})

describe('parseMoeda / parseQtd', () => {
  it('parseMoeda ignora tudo que não é dígito', () => {
    expect(parseMoeda('R$ 1.234,56')).toBe(1234.56)
    expect(parseMoeda('R$ 0,00')).toBe(0)
    expect(parseMoeda('')).toBe(0)
    expect(parseMoeda(null)).toBe(0)
  })

  it('parseQtd trata ponto como milhar e vírgula como decimal', () => {
    expect(parseQtd('1.234,567')).toBe(1234.567)
    expect(parseQtd('12,5')).toBe(12.5)
    expect(parseQtd('abc')).toBe(0)
    expect(parseQtd('')).toBe(0)
    // Sem vírgula, o ponto também é removido (paridade com a v1).
    expect(parseQtd('12.5')).toBe(125)
  })
})

describe('normalizeHeader', () => {
  it('vai para minúsculas, sem acento e sem não-alfanuméricos', () => {
    expect(normalizeHeader('Código de Barras')).toBe('codigodebarras')
    expect(normalizeHeader('NOME DO PRODUTO')).toBe('nomedoproduto')
    expect(normalizeHeader('CST ICMS')).toBe('csticms')
    expect(normalizeHeader('Cod. Produto')).toBe('codproduto')
    expect(normalizeHeader('Razão Social')).toBe('razaosocial')
    expect(normalizeHeader(null)).toBe('')
    expect(normalizeHeader(undefined)).toBe('')
  })
})

describe('esc', () => {
  it('escapa os cinco caracteres de HTML', () => {
    expect(esc('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;')
    expect(esc("&'")).toBe('&amp;&#39;')
    expect(esc('texto simples')).toBe('texto simples')
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
    expect(esc(0)).toBe('0')
  })
})

describe('utilitários', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('fmtBRL monta "R$ 1.234,56" sem depender de Intl/estilo', () => {
    expect(fmtBRL(1234.56)).toBe('R$ 1.234,56')
    expect(fmtBRL(19.9)).toBe('R$ 19,90')
    expect(fmtBRL(-2345.67)).toBe('-R$ 2.345,67')
    expect(fmtBRL(0)).toBe('R$ 0,00')
    expect(fmtBRL('abc')).toBe('R$ 0,00')
  })

  it('fmtInt / fmtCarga', () => {
    expect(fmtInt(1234)).toBe('1.234')
    expect(fmtCarga(26.5)).toBe('26,50%')
    expect(fmtCarga(NaN)).toBe('0,00%')
  })

  it('hexToRgb tolera #, 3 dígitos e vazio', () => {
    expect(hexToRgb('#0f215c')).toEqual([15, 33, 92])
    expect(hexToRgb('f00')).toEqual([255, 0, 0])
    expect(hexToRgb(null)).toEqual([15, 33, 92])
    expect(hexToRgb('#fff')).toEqual([255, 255, 255])
  })

  it('uid é prefixado por x e distinto', () => {
    const a = uid()
    const b = uid()
    expect(a.startsWith('x')).toBe(true)
    expect(a).not.toBe(b)
  })
})
