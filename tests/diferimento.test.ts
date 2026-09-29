/**
 * Diferimento — Anexo IX (art. 138) e CST 510/515.
 *
 * Trava o pedido do usuário: produto do Anexo IX SEMPRE exibe o aviso de
 * produto diferido (quando recolhe, anexos e hipóteses), no mesmo padrão
 * dos demais textos informativos.
 */
import { describe, expect, it } from 'vitest'
import {
  ehAnexoIX,
  ehDiferimento,
  observacoesDiferimento,
} from '@/domain/services/calculo'
import type { Classificacao } from '@/domain/entities'

function fake(extra: Partial<Classificacao> = {}): Classificacao {
  return {
    id: 'x',
    codigo: '31010000',
    codigoFormatado: '3101.00.00',
    cst: '200',
    cClassTrib: '200038',
    baseLegal: 'Art. 138',
    descricao: 'Adubo',
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: {
      descricaoCClassTrib:
        'Fornecimento dos insumos agropecuários e aquícolas relacionados no Anexo IX da LC 214/2025',
      percentualReducaoIBS: 60,
      percentualReducaoCBS: 60,
      anexo: '9',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art138',
      documentosHabilitados: null,
    },
    regraGeral: false,
    ...extra,
  } as Classificacao
}

describe('diferimento Anexo IX', () => {
  it('detecta Anexo IX por anexo 9, cClassTrib 200038/515001 ou descrição', () => {
    expect(ehAnexoIX(fake())).toBe(true)
    expect(ehAnexoIX(fake({ cClassTrib: '515001', resumo: { descricaoCClassTrib: '', percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: null, urlLegislacao: null, documentosHabilitados: null } }))).toBe(true)
    expect(ehAnexoIX(fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))).toBe(false)
  })

  it('Anexo IX sempre é diferimento, mesmo com CST 200', () => {
    expect(ehDiferimento(fake())).toBe(true)
    expect(ehDiferimento(fake({ cst: '510', cClassTrib: '510001' }))).toBe(true)
    expect(ehDiferimento(fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))).toBe(false)
  })

  it('emite aviso elegante com hipóteses, recolhimento e anexos', () => {
    const [o] = observacoesDiferimento(fake())
    expect(o.titulo).toContain('Anexo IX')
    expect(o.cor).toBe('violet')
    expect(o.texto).toContain('DIFERIDO')
    expect(o.texto).toContain('§2º')
    expect(o.texto).toContain('art. 168')
    expect(o.texto).toContain('Anexo IX')
    expect(o.link).toContain('#art138')
  })

  it('energia elétrica usa arts. 22 e 28', () => {
    const [o] = observacoesDiferimento(fake({ cst: '510', cClassTrib: '510001', resumo: { descricaoCClassTrib: 'energia eletrica', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))
    expect(o.titulo).toContain('Energia')
    expect(o.link).toContain('#art28')
  })

  it('retorna vazio quando não há diferimento', () => {
    expect(observacoesDiferimento(null)).toEqual([])
    expect(
      observacoesDiferimento(
        fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }),
      ),
    ).toEqual([])
  })
})
