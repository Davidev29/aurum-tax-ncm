/**
 * Diferimento — decisão EXCLUSIVA por bases oficiais (CST 510/515,
 * `cstDetalhes.indDiferimento`, `referencia.diferimento`).
 *
 * Anexo IX com CST 200 (cClassTrib 200038 — 957 NCMs da base) NÃO é
 * diferido: é tributação com redução de 60% + diferimento CONDICIONAL
 * à operação (art. 138, §2º). Só CST 515/510 é diferimento efetivo.
 */
import { describe, expect, it } from 'vitest'
import {
  ehAnexoIX,
  ehDiferimento,
  ehDiferimentoCondicionalAnexoIX,
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
  it('detecta Anexo IX por anexo 9 ou cClassTrib 200038/515001 (nunca por descrição)', () => {
    expect(ehAnexoIX(fake())).toBe(true)
    expect(ehAnexoIX(fake({ cClassTrib: '515001', resumo: { descricaoCClassTrib: '', percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: null, urlLegislacao: null, documentosHabilitados: null } }))).toBe(true)
    expect(ehAnexoIX(fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))).toBe(false)
    // Descrição citando "Anexo IX" sem anexo oficial NÃO identifica Anexo IX
    expect(
      ehAnexoIX(
        fake({
          cst: '000',
          cClassTrib: '000001',
          resumo: { descricaoCClassTrib: 'qualquer coisa Anexo IX', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
          baseLegal: 'texto Anexo IX',
        }),
      ),
    ).toBe(false)
  })

  it('Anexo IX com CST 200 NÃO é diferimento efetivo (é condicional)', () => {
    expect(ehDiferimento(fake())).toBe(false)
    expect(ehDiferimentoCondicionalAnexoIX(fake())).toBe(true)
    expect(ehDiferimento(fake({ cst: '510', cClassTrib: '510001' }))).toBe(true)
    expect(ehDiferimento(fake({ cst: '515', cClassTrib: '515001' }))).toBe(true)
    expect(ehDiferimento(fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))).toBe(false)
  })

  it('diferimento via flags oficiais (indDiferimento, referencia.diferimento)', () => {
    expect(
      ehDiferimento(
        fake({
          cst: '200',
          cClassTrib: '200001',
          cstDetalhes: { codigo: '200', descricao: 'x', indIBSCBS: true, indIBSCBSMono: false, indReducao: false, indDiferimento: true, indTransferenciaCredito: true, docs: {} } as Classificacao['cstDetalhes'],
          resumo: { descricaoCClassTrib: 'x', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
        }),
      ),
    ).toBe(true)
    expect(
      ehDiferimento(
        fake({
          cst: '200',
          cClassTrib: '200001',
          referencia: { lcRef: 'x', reducaoAliquota: false, reducaoBcCst: false, monofasica: false, creditoPresumido: false, diferimento: true, anexo: null, urlLegislacao: null, documentos: {} },
          resumo: { descricaoCClassTrib: 'x', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
        }),
      ),
    ).toBe(true)
  })

  it('Anexo IX CST 200 emite aviso CONDICIONAL âmbar (não "diferido")', () => {
    const [o] = observacoesDiferimento(fake())
    expect(o.titulo).toContain('condicional')
    expect(o.cor).toBe('amber')
    expect(o.texto).toContain('NÃO é automaticamente diferido')
    expect(o.texto).toContain('§2º')
    expect(o.link).toContain('#art138')
  })

  it('diferimento efetivo Anexo IX (CST 515) emite aviso violeta "diferido"', () => {
    const [o] = observacoesDiferimento(
      fake({
        cst: '515',
        cClassTrib: '515001',
        referencia: { lcRef: 'x', reducaoAliquota: false, reducaoBcCst: false, monofasica: false, creditoPresumido: false, diferimento: true, anexo: '9', urlLegislacao: null, documentos: {} },
      }),
    )
    expect(o.titulo).toContain('diferido')
    expect(o.cor).toBe('violet')
    expect(o.texto).toContain('DIFERIDO')
    expect(o.texto).toContain('§2º')
    expect(o.texto).toContain('art. 168')
    expect(o.link).toContain('#art138')
  })

  it('energia elétrica usa arts. 22 e 28', () => {
    const [o] = observacoesDiferimento(fake({ cst: '510', cClassTrib: '510001', resumo: { descricaoCClassTrib: 'energia eletrica', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }))
    expect(o.titulo).toContain('Energia')
    expect(o.link).toContain('#art28')
  })

  it('retorna vazio quando não há diferimento nem hipótese condicional', () => {
    expect(observacoesDiferimento(null)).toEqual([])
    expect(
      observacoesDiferimento(
        fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }),
      ),
    ).toEqual([])
  })
})
