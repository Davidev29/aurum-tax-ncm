/**
 * Phase 7 — normalização dos arquivos vivos + fingerprint + formato.
 */
import { describe, expect, it } from 'vitest'
import {
  fmtCnae,
  normalizarAnexosSimples,
  normalizarCnaeAnexo,
  normalizarNbsServicos,
} from '@/infrastructure/base/normalizacao'
import { fingerprintBase } from '@/infrastructure/base/formatos'
import { fmtNbs, MASK } from '@/domain/services/format'

const CNAE_VIVO = [
  { CNAE: '0111-3/01', 'Descrição oficial': 'Cultivo de arroz', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '8599-6/01', 'Descrição oficial': 'Formação de condutores', Situação: 'Permitido', Anexos: 'III / V', 'Fator R': 'Sim' },
  { CNAE: '0230-6/00', 'Descrição oficial': 'Atividades de apoio à produção florestal', Situação: 'Permitido com ressalvas', Anexos: 'III / IV / V', 'Fator R': 'Sim' },
  { CNAE: '8599-6/01', 'Descrição oficial': 'DUPLICADO', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: 'invalido', 'Descrição oficial': 'Sem dígitos', Situação: 'Permitido', Anexos: 'I', 'Fator R': 'Não' },
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Texto jurídico.' },
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'DUPLICADO', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Repetido.' },
  { NBS: '123', CST: '200', CclassTrib: '200029', 'Base Legal': 'Curto', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Descartado.' },
]

describe('normalizarCnaeAnexo', () => {
  it('normaliza chaves acentuadas, dedupe e máscara', () => {
    const itens = normalizarCnaeAnexo(CNAE_VIVO)
    expect(itens).toHaveLength(3)
    const formacao = itens.find((c) => c.codigo7 === '8599601')!
    expect(formacao.codigoFormatado).toBe('8599-6/01')
    expect(formacao.situacao).toBe('Permitido')
    expect(formacao.anexos).toEqual(['III', 'V'])
    expect(formacao.fatorR).toBe(true)
    expect(itens.find((c) => c.codigo7 === '0111301')!.anexos).toEqual(['II'])
  })

  it('aceita o artefato embutido { itens } (idempotente)', () => {
    const itens = normalizarCnaeAnexo(CNAE_VIVO)
    const deNovo = normalizarCnaeAnexo({ tipo: 'cnae', itens })
    expect(deNovo).toHaveLength(3)
  })

  it('situação desconhecida cai em "Depende da atividade" (seguro)', () => {
    const [unica] = normalizarCnaeAnexo([
      { CNAE: '9999-9/99', 'Descrição oficial': 'X', Situação: '???', Anexos: 'I', 'Fator R': 'Não' },
    ])
    expect(unica.situacao).toBe('Depende da atividade')
  })
})

describe('normalizarAnexosSimples', () => {
  it('divide multi-anexo e descarta "Não aplicável"', () => {
    expect(normalizarAnexosSimples('III / V')).toEqual(['III', 'V'])
    expect(normalizarAnexosSimples('III / Não aplicável')).toEqual(['III'])
    expect(normalizarAnexosSimples('')).toEqual([])
  })
})

describe('normalizarNbsServicos', () => {
  it('dedupe por codigo|cst|cct e descarta fora de 9 dígitos', () => {
    const { vinculos, duplicados } = normalizarNbsServicos(NBS_VIVO)
    expect(duplicados).toBe(1)
    expect(vinculos).toHaveLength(1)
    expect(vinculos[0].codigo).toBe('122011100')
    expect(vinculos[0].cst).toBe('200')
    expect(vinculos[0].cClassTrib).toBe('200028')
    expect(vinculos[0].reducao).toBe(0.6)
    expect(vinculos[0].documentos).toBe('NFSE')
  })
})

describe('fingerprintBase (Phase 7)', () => {
  it('reconhece CNAE X ANEXO e NBS SERVIÇOS', () => {
    expect(fingerprintBase(CNAE_VIVO)).toBe('cnae-anexo')
    expect(fingerprintBase(NBS_VIVO)).toBe('nbs-servicos')
  })

  it('não confunde o legado reforma (objeto com NCM/NBS)', () => {
    expect(fingerprintBase({ NCM: [], NBS: [] })).toBe('reforma')
  })
})

describe('formato NBS/CNAE', () => {
  it('fmtNbs formata 3-3-3 só com 9 dígitos', () => {
    expect(fmtNbs('122011100')).toBe('122.011.100')
    expect(fmtNbs('12201110')).toBe('12201110')
  })

  it('MASK.nbs mascara progressivo', () => {
    expect(MASK.nbs('122')).toBe('122')
    expect(MASK.nbs('122011')).toBe('122.011')
    expect(MASK.nbs('122011100')).toBe('122.011.100')
  })

  it('fmtCnae formata 7 dígitos', () => {
    expect(fmtCnae('8599601')).toBe('8599-6/01')
    expect(fmtCnae('curto')).toBe('curto')
  })
})
