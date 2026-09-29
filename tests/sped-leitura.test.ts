/**
 * Leitura e detecção de SPED (SPEC R4.1–R4.3).
 *
 * Inclui a regressão do `[BUG] L1296`: um EFD Contribuições truncado (só
 * C100/C170, sem A/M/F/P) não pode ser classificado como ICMS/IPI.
 */
import { describe, expect, it } from 'vitest'
import { detectarTipo, lerArquivoTexto, spedToNumber } from '@/infrastructure/sped/leitura'

/** Monta uma linha pipe-delimited a partir do registro (c[1]) em diante. */
const linha = (...campos: string[]): string => ['', ...campos].join('|')

/* -------------------------------------------------------------------------- */
/* Decodificação                                                               */
/* -------------------------------------------------------------------------- */

describe('lerArquivoTexto', () => {
  it('decodifica UTF-8', () => {
    const bytes = new TextEncoder().encode('Ação — tributação')
    expect(lerArquivoTexto(bytes)).toBe('Ação — tributação')
  })

  it('aceita ArrayBuffer além de Uint8Array', () => {
    const bytes = new TextEncoder().encode('NCM 0201.10.00')
    const copia = bytes.slice().buffer
    expect(lerArquivoTexto(copia)).toBe('NCM 0201.10.00')
  })

  it('cai para windows-1252 quando o UTF-8 falha', () => {
    // "ação" em cp1252: 61 E7 E3 6F — inválido como UTF-8 (fatal).
    const cp1252 = new Uint8Array([0x61, 0xe7, 0xe3, 0x6f])
    expect(lerArquivoTexto(cp1252)).toBe('ação')
  })

  it('nunca devolve binário', () => {
    expect(typeof lerArquivoTexto(new Uint8Array([0x41, 0x42]))).toBe('string')
  })
})

/* -------------------------------------------------------------------------- */
/* Numérico                                                                    */
/* -------------------------------------------------------------------------- */

describe('spedToNumber', () => {
  it('vazio/nulo/não numérico valem zero', () => {
    expect(spedToNumber('')).toBe(0)
    expect(spedToNumber('   ')).toBe(0)
    expect(spedToNumber(null)).toBe(0)
    expect(spedToNumber(undefined)).toBe(0)
    expect(spedToNumber('abc')).toBe(0)
    expect(spedToNumber(NaN)).toBe(0)
    expect(spedToNumber(Infinity)).toBe(0)
  })

  it('entende a vírgula decimal brasileira', () => {
    expect(spedToNumber('1234,56')).toBe(1234.56)
    expect(spedToNumber('1.234,56')).toBe(1234.56)
    expect(spedToNumber('-12,5')).toBe(-12.5)
    expect(spedToNumber('0,00')).toBe(0)
  })

  it('aceita ponto decimal e números prontos', () => {
    expect(spedToNumber('1234.56')).toBe(1234.56)
    expect(spedToNumber(15.5)).toBe(15.5)
    expect(spedToNumber(0)).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Detecção de tipo                                                            */
/* -------------------------------------------------------------------------- */

describe('detectarTipo', () => {
  it('EFD Reinf', () => {
    const r = detectarTipo([linha('0000', '09'), linha('R1000', 'x'), linha('C100', '1')].join('\n'))
    expect(r.tipo).toBe('reinf')
    expect(r.compativel).toBe(false)
    expect(r.motivo).toBeTruthy()
  })

  it('e-Social', () => {
    const r = detectarTipo([linha('S1000'), linha('S1200')].join('\n'))
    expect(r.tipo).toBe('esocial')
    expect(r.compativel).toBe(false)
  })

  it('ECD (blocos I/J)', () => {
    expect(detectarTipo(linha('I200')).tipo).toBe('ecd')
    expect(detectarTipo(linha('I250')).tipo).toBe('ecd')
  })

  it('ECF exige J100 somado a P100/P200', () => {
    expect(detectarTipo([linha('J100'), linha('P100')].join('\n')).tipo).toBe('ecf')
    expect(detectarTipo([linha('J100'), linha('P200')].join('\n')).tipo).toBe('ecf')
    // Só J100 não basta.
    expect(detectarTipo(linha('J100')).tipo).toBe('desconhecido')
  })

  it('EFD Contribuições pelos blocos A/M/F/P', () => {
    for (const reg of ['A100', 'A170', 'M100', 'M200', 'F100', 'F170', 'M606', 'P200']) {
      const r = detectarTipo(linha(reg))
      expect(r.tipo).toBe('contribuicoes')
      expect(r.compativel).toBe(true)
    }
  })

  it('EFD ICMS/IPI pelos blocos C/D', () => {
    const r = detectarTipo(
      [linha('0000', '09'), linha('C100', '1'), linha('C190', '000', '5102')].join('\r\n'),
    )
    expect(r.tipo).toBe('icmsipi')
    expect(r.compativel).toBe(true)
    expect(r.codVer).toBe('09')
  })

  it('[BUG L1296] Contribuições truncado só com C100/C170 não vira ICMS/IPI', () => {
    const c170 = new Array<string>(37).fill('')
    c170[1] = 'C170'
    c170[2] = '1'
    c170[3] = 'P1'
    c170[25] = '01' // CST_PIS
    c170[26] = '100,00' // VL_BC_PIS

    const conteudo = [
      linha('0000', '16'),
      linha('C100', '1', '0', 'P', '55', '000', '1', 'CH', '01/02/2026', '01/02/2026', '100,00'),
      c170.join('|'),
    ].join('\r\n')

    const r = detectarTipo(conteudo)
    expect(r.tipo).toBe('contribuicoes')
    expect(r.codVer).toBe('16')
  })

  it('C170 sem o parecer estrutural continua sendo ICMS/IPI', () => {
    // 16 campos: a posição 25 nem existe, então não há como ser PIS/COFINS.
    const c170 = [
      '', 'C170', '1', 'P1', 'Desc', '1,000000', 'UN', '100,00', '0,00', '',
      '000', '5102', '', '100,00', '18,00', '18,00',
    ].join('|')
    expect(detectarTipo([linha('C100', '1'), c170].join('\n')).tipo).toBe('icmsipi')
  })

  it('arquivo irreconhecível', () => {
    const r = detectarTipo('qualquer coisa\noutra linha')
    expect(r.tipo).toBe('desconhecido')
    expect(r.compativel).toBe(false)
    expect(r.motivo).toContain('SPED Fiscal')
  })

  it('detecta o tipo mesmo com bloco 0200 longo antes dos C100', () => {
    const linhas = Array.from({ length: 1500 }, (_, i) => linha('0200', `P${i}`, `Produto ${i}`, 'SEM', 'SEM', 'UN', '00', '02011000', ''))
    linhas.push(linha('C100', '1'), linha('C190', '000', '5102'))
    expect(detectarTipo(linhas.join('\n')).tipo).toBe('icmsipi')
  })

  it('ignora linhas curtas e malformadas', () => {
    expect(detectarTipo(['', '  ', '|', '|||'].join('\n')).tipo).toBe('desconhecido')
  })
})
