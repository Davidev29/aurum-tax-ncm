/**
 * Normalização avançada de códigos digitados: NCM, NBS, CNAE e CNPJ.
 * Uma única interpretação para máscaras, dígitos unicode, prefixos e ruído.
 */
import { describe, expect, it } from 'vitest'
import {
  digitosAscii,
  interpretarCodigo,
  pareceCodigo,
} from '@/domain/services/interpretar-codigo'
import { hipoteseNcmParcial } from '@/application/classificacao-inteligente'
import { hipoteseNbsParcial } from '@/application/classificacao-inteligente-servicos'
import { interpretarEntradaNcm } from '@/domain/services/classificacao'
import { interpretarEntradaNbs } from '@/domain/services/classificacao-nbs'

describe('digitosAscii — normalização unicode', () => {
  it('converte fullwidth, arábico-indic e devanagari para ASCII', () => {
    expect(digitosAscii('０２１１１０００')).toBe('02111000')
    expect(digitosAscii('٠٢٠١١٠٠٠')).toBe('02011000')
    expect(digitosAscii('०२०११०००')).toBe('02011000')
  })
  it('descarta letras e símbolos', () => {
    expect(digitosAscii('abc-0201.10.00!')).toBe('02011000')
  })
})

describe('interpretarCodigo — NCM', () => {
  it.each([
    '02011000',
    '0201.10.00',
    '0201 10 00',
    '0201-10-00',
    'NCM: 0201.10.00',
    'codigo ncm 0201.10.00',
    '０２０１１０００',
    '٠٢٠١١٠٠٠',
  ])('aceita %s como NCM completo', (entrada) => {
    const r = interpretarCodigo(entrada, 'ncm')
    expect(r.kind).toBe('ok')
    expect(r.digitos).toBe('02011000')
    expect(r.formatado).toBe('0201.10.00')
    expect(r.suspeitoDe).toBeUndefined()
  })

  it('reconhece NCM extinto pontuado como código, não descrição', () => {
    const r = interpretarCodigo('3913.90.50', 'ncm')
    expect(r.kind).toBe('ok')
    expect(r.digitos).toBe('39139050')
  })

  it('classifica prefixo 2–7 dígitos como parcial', () => {
    expect(interpretarCodigo('0406', 'ncm')).toMatchObject({ kind: 'parcial', digitos: '0406' })
    expect(hipoteseNcmParcial('10.05')).toBe('1005')
  })

  it('detecta outros tipos em vez de fingir NCM', () => {
    expect(interpretarCodigo('8599-6/01', 'ncm')).toMatchObject({ kind: 'parcial', suspeitoDe: 'cnae' })
    expect(hipoteseNcmParcial('8599-6/01')).toBeNull()
    expect(interpretarCodigo('12.345.678/0001-90', 'ncm')).toMatchObject({ kind: 'truncado', suspeitoDe: 'cnpj' })
    expect(interpretarCodigo('123.012.300', 'ncm')).toMatchObject({ kind: 'truncado', suspeitoDe: 'nbs' })
    expect(hipoteseNcmParcial('12.345.678/0001-90')).toBeNull()
  })

  it('não transforma texto misto em código', () => {
    expect(interpretarCodigo('abc02011000', 'ncm')).toMatchObject({ kind: 'misto', motivo: 'letras' })
    expect(interpretarCodigo('queijo parmesão', 'ncm').kind).toBe('texto')
    expect(pareceCodigo('queijo parmesão', 'ncm')).toBe(false)
  })

  it('mantém compatibilidade com interpretarEntradaNcm', () => {
    expect(interpretarEntradaNcm('0201.10.00')).toEqual({ kind: 'ok', codigo: '02011000', digitos: 8 })
    expect(interpretarEntradaNcm('12.345.678/0001-90').kind).toBe('truncado')
  })
})

describe('interpretarCodigo — NBS', () => {
  it.each(['123.012.300', '123012300', '123 012 300', 'NBS 123.012.300', '１２３０１２３００'])(
    'aceita %s como NBS 2.00 completo', (entrada) => {
      const r = interpretarCodigo(entrada, 'nbs')
      expect(r.kind).toBe('ok')
      expect(r.digitos).toBe('123012300')
      expect(r.formatado).toBe('123.012.300')
    })

  it('marca formato NBS 1.1 como legado (sem conversão automática)', () => {
    expect(interpretarCodigo('1.2502.20.00', 'nbs')).toMatchObject({ kind: 'legado', formato: 'nbs11' })
  })

  it('não trata NCM pontuado como prefixo NBS', () => {
    expect(interpretarCodigo('3913.90.50', 'nbs')).toMatchObject({ kind: 'parcial', suspeitoDe: 'ncm' })
    expect(hipoteseNbsParcial('3913.90.50')).toBeNull()
    expect(hipoteseNbsParcial('122011')).toBe('122011')
  })

  it('mantém compatibilidade com interpretarEntradaNbs', () => {
    expect(interpretarEntradaNbs('123.012.300')).toEqual({ kind: 'ok', codigo: '123012300', digitos: 9 })
    expect(interpretarEntradaNbs('3913.90.50').kind).toBe('invalido')
  })
})

describe('interpretarCodigo — CNAE e CNPJ', () => {
  it('reconhece CNAE pontuado e cru', () => {
    expect(interpretarCodigo('8599-6/01', 'cnae')).toMatchObject({ kind: 'ok', digitos: '8599601', formatado: '8599-6/01' })
    expect(interpretarCodigo('8599601', 'cnae')).toMatchObject({ kind: 'ok', digitos: '8599601' })
  })

  it('reconhece CNPJ pontuado e cru', () => {
    expect(interpretarCodigo('12.345.678/0001-90', 'cnpj')).toMatchObject({
      kind: 'ok', digitos: '12345678000190', formatado: '12.345.678/0001-90',
    })
    expect(interpretarCodigo('CNPJ 12345678000190', 'cnpj').kind).toBe('ok')
  })
})

describe('classificadores — correção de pontuação', () => {
  it('NCM pontuado e cru resolvem para o mesmo código', async () => {
    const { classificarPorDescricao } = await import('@/application/classificacao-inteligente')
    const pontuado = await classificarPorDescricao({ descricao: '3913.90.50' })
    const cru = await classificarPorDescricao({ descricao: '39139050' })
    expect(pontuado.ncm_provavel).toBe('3913.90.50')
    expect(cru.ncm_provavel).toBe('3913.90.50')
    expect(pontuado.cst).toBe('000')
    expect(pontuado.cClassTrib).toBe('000001')
  })
})
