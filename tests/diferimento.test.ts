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
  calcularTributos,
  classificacaoDiferimentoAnexoIX,
  ehAnexoIX,
  ehDiferimento,
  ehDiferimentoCondicionalAnexoIX,
  expandirOpcoesComDiferimento,
  observacoesDiferimento,
  opcoesTributacao,
  temOpcaoDiferimento,
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

describe('opção de tributação com diferimento (Anexo IX)', () => {
  it('só o Anexo IX condicional ganha a 2ª opção', () => {
    expect(temOpcaoDiferimento(fake())).toBe(true)
    // Diferimento efetivo já é diferido — sem opção extra
    expect(temOpcaoDiferimento(fake({ cst: '515', cClassTrib: '515001' }))).toBe(false)
    // Tributação integral — sem opção extra
    expect(
      temOpcaoDiferimento(
        fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }),
      ),
    ).toBe(false)
    expect(temOpcaoDiferimento(null)).toBe(false)
  })

  it('hipótese diferida: CST 515, redução 100% e diferimento efetivo', () => {
    const dif = classificacaoDiferimentoAnexoIX(fake())
    expect(dif.cst).toBe('515')
    expect(dif.cClassTrib).toBe('515001')
    expect(dif.resumo.percentualReducaoIBS).toBe(100)
    expect(dif.resumo.percentualReducaoCBS).toBe(100)
    // Continua sendo o mesmo NCM/operação — só muda o enquadramento
    expect(dif.codigo).toBe(fake().codigo)
    expect(ehDiferimento(dif)).toBe(true)
    expect(ehAnexoIX(dif)).toBe(true)
    expect(ehDiferimentoCondicionalAnexoIX(dif)).toBe(false)
    const [o] = observacoesDiferimento(dif)
    expect(o.cor).toBe('violet')
  })

  it('hipótese diferida simula com alíquota 0% de IBS/CBS', () => {
    const dif = classificacaoDiferimentoAnexoIX(fake())
    const c = calcularTributos(
      1000,
      dif.resumo.percentualReducaoIBS,
      dif.resumo.percentualReducaoCBS,
      17.7,
      10.4,
    )
    expect(c.aliqIBS).toBe(0)
    expect(c.aliqCBS).toBe(0)
    expect(c.total).toBe(0)
    // A tributação normal do mesmo NCM continua tributando com a redução de 60%
    const normal = calcularTributos(1000, 60, 60, 17.7, 10.4)
    expect(normal.total).toBeGreaterThan(0)
  })

  it('opcoesTributacao: normal + diferimento para Anexo IX condicional', () => {
    const base = fake()
    const opcoes = opcoesTributacao(base)
    expect(opcoes.map((o) => o.chave)).toEqual(['normal', 'diferimento'])
    expect(opcoes[0].classificacao).toBe(base)
    expect(opcoes[1].classificacao.cst).toBe('515')
    // Demais casos: só a tributação normal
    expect(
      opcoesTributacao(
        fake({ cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' }),
      ),
    ).toHaveLength(1)
  })

  it('expandirOpcoesComDiferimento insere a hipótese logo após a normal', () => {
    const normal = fake()
    const integral = fake({ id: 'y', cst: '000', cClassTrib: '000001', resumo: { descricaoCClassTrib: 'integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null }, baseLegal: '' })
    const expandida = expandirOpcoesComDiferimento([normal, integral])
    expect(expandida).toHaveLength(3)
    expect(expandida[0]).toBe(normal)
    expect(expandida[1].cst).toBe('515')
    expect(expandida[1].resumo.percentualReducaoIBS).toBe(100)
    expect(expandida[2]).toBe(integral)
    // Lista sem Anexo IX condicional volta intacta (mesma referência)
    const semCondicional = [integral]
    expect(expandirOpcoesComDiferimento(semCondicional)).toBe(semCondicional)
  })
})
