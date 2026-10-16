/**
 * Cálculo IBS/CBS — ramos de borda do gate de cobertura da CI.
 *
 * `vitest.config.ts` exige `src/domain/services/calculo.ts` com
 * branches ≥ 90%. Estes testes exercem os ramos frios (fallbacks de
 * normalização, faixas intermediárias de anexo, Prouni assimétrico,
 * diferimento genérico/condicional-NBS, cesta básica nula e os avisos
 * de revogação/herança no funil `observacoesFiscais`).
 */
import { describe, expect, it } from 'vitest'
import {
  anexoDeReducao,
  anexoReal,
  calcularTributos,
  ehAnexoIX,
  ehCestaBasica,
  ehDiferimento,
  motivoRegimeEspecial,
  observacoesDiferimento,
  observacoesFiscais,
  observacoesLegais,
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
      descricaoCClassTrib: 'Insumos agropecuários — Anexo IX',
      percentualReducaoIBS: 60,
      percentualReducaoCBS: 60,
      anexo: '9',
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: false,
    ...extra,
  } as Classificacao
}

describe('calculo ramos — regime especial e gate de motivo', () => {
  it('tipoAliquota 3 (sem alíquota) gera motivo próprio', () => {
    expect(motivoRegimeEspecial('000', 3)).toContain('tipo-sem-aliquota')
  })

  it('calcularTributos com motivo e refs zeradas zera valores sem NaN', () => {
    const r = calcularTributos(100, 0, 0, 0, 0, { cst: '550' })
    expect(r.total).toBe(0)
    expect(r.aliqIBS).toBe(0)
    expect(r.refIBS).toBe(0)
    expect(r.refCBS).toBe(0)
  })
})

describe('calculo ramos — anexoReal e faixas intermediárias', () => {
  it('anexo oficial informado é retornado cru', () => {
    expect(anexoReal('9', 0)).toBe('9')
  })

  it('faixas intermediárias 75/65/45/35 mapeiam para o piso da faixa', () => {
    expect(anexoDeReducao(75, 75)).toBe('70')
    expect(anexoDeReducao(65, 65)).toBe('60')
    expect(anexoDeReducao(45, 45)).toBe('40')
    expect(anexoDeReducao(35, 35)).toBe('30')
  })

  it('tolerância de arredondamento perto de 100% ainda é alíquota zero', () => {
    expect(anexoDeReducao(99.996, 99.992)).toBe('0')
  })
})

describe('calculo ramos — observacoesLegais assimétricas e genéricas', () => {
  it('assimetria fora do Prouni gera mensagem genérica', () => {
    const obs = observacoesLegais('85044010', 60, 50)
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('assimétrica')
  })

  it('100/99.997 (tolerância) cai no ramo de alíquota zero', () => {
    const obs = observacoesLegais('31010000', 100, 99.997)
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toBe('Alíquota Zero')
  })

  it('faixa genérica 10% emite observação com o percentual real', () => {
    const obs = observacoesLegais('31010000', 10, 10)
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('10%')
  })
})

describe('calculo ramos — diferimento e cesta básica', () => {
  it('ehAnexoIX/ehDiferimento/ehCestaBasica aceitam nulo sem throw', () => {
    expect(ehAnexoIX(null)).toBe(false)
    expect(ehAnexoIX(undefined)).toBe(false)
    expect(ehDiferimento(null)).toBe(false)
    expect(ehCestaBasica(null)).toBe(false)
  })

  it('anexo 9 sem cClassTrib ainda identifica o Anexo IX', () => {
    expect(ehAnexoIX(fake({ cClassTrib: undefined } as unknown as Partial<Classificacao>))).toBe(true)
  })

  it('classificação vazia não é diferimento nem cesta básica', () => {
    const vazia = {} as unknown as Classificacao
    expect(ehDiferimento(vazia)).toBe(false)
    expect(ehCestaBasica(vazia)).toBe(false)
    expect(ehCestaBasica(fake({ cst: '200', cClassTrib: undefined } as unknown as Partial<Classificacao>))).toBe(false)
  })

  it('diferimento com cClassTrib 510001 emite energia elétrica', () => {
    const obs = observacoesDiferimento(fake({ cst: '510', cClassTrib: '510001' }))
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('Energia elétrica')
  })

  it('diferimento sem cClassTrib usa o ?? e emite energia elétrica pelo CST', () => {
    const obs = observacoesDiferimento(fake({ cst: '510', cClassTrib: undefined } as unknown as Partial<Classificacao>))
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('Energia elétrica')
  })

  it('diferimento via indDiferimento sem CST 510/energia cobre fallbacks e emite o genérico', () => {
    const obs = observacoesDiferimento(
      fake({
        cst: undefined,
        cClassTrib: '000000',
        cstDetalhes: { indDiferimento: 1 },
        resumo: {
          descricaoCClassTrib: 'Genérico',
          percentualReducaoIBS: 0,
          percentualReducaoCBS: 0,
          anexo: null,
          urlLegislacao: null,
          documentosHabilitados: null,
        },
      } as unknown as Partial<Classificacao>),
    )
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('sujeita a diferimento')
  })

  it('diferimento 510 fora do Anexo IX emite o aviso genérico', () => {
    const obs = observacoesDiferimento(
      fake({
        cst: '000',
        cClassTrib: '000000',
        cstDetalhes: { indDiferimento: 1 },
        resumo: {
          descricaoCClassTrib: 'Genérico',
          percentualReducaoIBS: 0,
          percentualReducaoCBS: 0,
          anexo: null,
          urlLegislacao: null,
          documentosHabilitados: null,
        },
      } as unknown as Partial<Classificacao>),
    )
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toContain('sujeita a diferimento')
  })

  it('condicional do Anexo IX com NBS (9 dígitos) rotula NBS', () => {
    const obs = observacoesDiferimento(fake({ cst: '200', cClassTrib: '200038', codigo: '123456789' }))
    expect(obs).toHaveLength(1)
    expect(obs[0].texto).toContain('NBS')
  })
})

describe('calculo ramos — funil observacoesFiscais', () => {
  it('revogação e herança por família entram no funil', () => {
    const obs = observacoesFiscais(
      '31010000',
      fake({
        revogado: { alvo: '200038', tipo: 'cClassTrib', ato: 'Ato X', data: null, motivo: 'Revogado na fonte.' },
        heranca: {
          nivel: 'posicao',
          prefixo: '3101',
          irmaosVinculados: 2,
          vigentesNoPrefixo: 4,
          origem: 'familia-SH4',
          confianca: 'media',
          aConfirmar: true,
        },
      }),
    )
    expect(obs.some((o) => o.titulo.includes('revogado'))).toBe(true)
    expect(obs.some((o) => o.titulo.includes('herdado por família'))).toBe(true)
  })
})
