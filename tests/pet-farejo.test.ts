/**
 * Farejo da Aurinha: frases personalizadas a partir do termo digitado.
 * Tudo puro e determinístico — mesmo termo, mesma gracinha.
 */
import { describe, expect, it } from 'vitest'
import {
  detectarTipoTermo,
  fraseFarejando,
  fraseNcmInvalido,
  fraseResultadoBusca,
  palpiteFarejo,
  resumirTermo,
  soDigitos,
} from '@/store/pet-farejo'

describe('resumirTermo', () => {
  it('mantém termo curto intacto', () => {
    expect(resumirTermo('camiseta')).toBe('camiseta')
  })

  it('colapsa espaços e trunca com reticência', () => {
    expect(resumirTermo('  camiseta   de   algodão  ', 12)).toBe('camiseta de…')
  })
})

describe('detectarTipoTermo', () => {
  it('detecta intenção de NCM', () => {
    expect(detectarTipoTermo('8471')).toBe('ncm')
    expect(detectarTipoTermo('0201.10.00')).toBe('ncm')
  })

  it('marca vazio e curto', () => {
    expect(detectarTipoTermo('')).toBe('curto')
    expect(detectarTipoTermo('ab')).toBe('curto')
  })

  it('texto livre passa', () => {
    expect(detectarTipoTermo('camiseta algodão')).toBe('texto')
  })
})

describe('palpiteFarejo', () => {
  it('fareja tecido, tech e comida', () => {
    expect(palpiteFarejo('camiseta de algodão')).toBe('cheiro de tecido!')
    expect(palpiteFarejo('notebook i7')).toBe('apita que é tech!')
    expect(palpiteFarejo('queijo mozarela')).toBe('hmm, comestível?')
  })

  it('devolve null para o desconhecido', () => {
    expect(palpiteFarejo('xyz aleatório')).toBeNull()
  })
})

describe('fraseFarejando', () => {
  it('cita o termo e o palpite', () => {
    const frase = fraseFarejando('camiseta de algodão')
    expect(frase).toContain('camiseta')
    expect(frase).toContain('tecido')
  })

  it('NCM confere dígito a dígito', () => {
    expect(fraseFarejando('8471')).toContain('8471')
  })

  it('termo curto rende null (frase genérica)', () => {
    expect(fraseFarejando('ab')).toBeNull()
  })

  it('é determinística para o mesmo termo', () => {
    expect(fraseFarejando('queijo mozarela')).toBe(fraseFarejando('queijo mozarela'))
  })
})

describe('fraseResultadoBusca', () => {
  it('celebra o NCM exato com o termo', () => {
    expect(fraseResultadoBusca('queijo', { oficiais: 1, textos: 3, temSugestao: false, primeiroCodigo: '04061000' }))
      .toBe(`Achei! 'queijo' é NCM 04061000!`)
  })

  it('conta classificações e candidatos', () => {
    expect(fraseResultadoBusca('carne', { oficiais: 3, textos: 0, temSugestao: false }))
      .toContain('3 classificações')
    expect(fraseResultadoBusca('carne', { oficiais: 0, textos: 5, temSugestao: false }))
      .toContain('5 candidatos')
  })

  it('cita a sugestão da IA', () => {
    expect(fraseResultadoBusca('drone', { oficiais: 0, textos: 0, temSugestao: true, primeiroCodigo: '88062200' }))
      .toContain('88062200')
  })

  it('busca zerada sugere retentar com o termo', () => {
    const frase = fraseResultadoBusca('xyzabc', { oficiais: 0, textos: 0, temSugestao: false })
    expect(frase).toContain('xyzabc')
  })
})

describe('fraseNcmInvalido', () => {
  it('cita o que foi digitado', () => {
    expect(fraseNcmInvalido('999')).toContain('999')
  })

  it('sem termo usa a frase genérica', () => {
    expect(fraseNcmInvalido('')).toBe('Hmm, esse NCM tá estranho…')
  })
})

describe('soDigitos', () => {
  it('extrai só dígitos', () => {
    expect(soDigitos('0201.10.00')).toBe('02011000')
  })
})
