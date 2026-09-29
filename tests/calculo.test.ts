/**
 * Motor de cálculo tributário — LC 214/2025 (redução via BC) / R2.18–R2.22.
 *
 * Verifica a fórmula `BC = operação × (1 − red/100)` e
 * `tributo = BC × referência/100`, os limiares
 * 100/60/30, o badge de redução e as observações legais (um grupo por faixa,
 * com o ramo `>= 60` acumulando art. 137/135 + art. 128).
 */
import { describe, expect, it } from 'vitest'
import {
  anexoDeReducao,
  avisoInNatura,
  badgeReducao,
  calcularTributos,
  observacoesLegais,
} from '@/domain/services/calculo'
import { OBS_ARTIGOS } from '@/domain/constants/tributarios'

describe('calcularTributos', () => {
  it('aplica a alíquota cheia sobre a base cheia', () => {
    const r = calcularTributos(1000, 0, 0, 17.7, 8.8)
    expect(r.base).toBe(1000)
    expect(r.bcIBS).toBeCloseTo(1000, 9)
    expect(r.bcCBS).toBeCloseTo(1000, 9)
    expect(r.aliqIBS).toBeCloseTo(17.7, 9)
    expect(r.aliqCBS).toBeCloseTo(8.8, 9)
    expect(r.vIBS).toBeCloseTo(177, 9)
    expect(r.vCBS).toBeCloseTo(88, 9)
    expect(r.total).toBeCloseTo(265, 9)
    expect(r.carga).toBeCloseTo(26.5, 9)
  })

  it('reduz a BC (LC 214/2025): 50 com 60% vira BC 20', () => {
    const r = calcularTributos(50, 60, 60, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(20, 9)
    expect(r.bcCBS).toBeCloseTo(20, 9)
    // Débito = BC reduzida × alíquota cheia
    expect(r.vIBS).toBeCloseTo(20 * 17.7 / 100, 9)
    expect(r.vCBS).toBeCloseTo(20 * 8.8 / 100, 9)
    expect(r.total).toBeCloseTo(r.vIBS + r.vCBS, 9)
  })

  it('reduz cada tributo de forma linear e independente', () => {
    const r = calcularTributos(1000, 60, 60, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(400, 9)
    expect(r.aliqIBS).toBeCloseTo(17.7 * 0.4, 9)
    expect(r.aliqCBS).toBeCloseTo(8.8 * 0.4, 9)
    expect(r.vIBS).toBeCloseTo(1000 * (17.7 * 0.4) / 100, 9)
    expect(r.total).toBeCloseTo(r.vIBS + r.vCBS, 9)
  })

  it('redução 100% zera a BC e o tributo', () => {
    const r = calcularTributos(50, 100, 100, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(0, 9)
    expect(r.bcCBS).toBeCloseTo(0, 9)
    expect(r.vIBS).toBeCloseTo(0, 9)
    expect(r.vCBS).toBeCloseTo(0, 9)
    expect(r.total).toBeCloseTo(0, 9)
  })

  it('mantém reduções assimétricas', () => {
    const r = calcularTributos(1000, 100, 0, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(0, 9)
    expect(r.bcCBS).toBeCloseTo(1000, 9)
    expect(r.vIBS).toBeCloseTo(0, 9)
    expect(r.vCBS).toBeCloseTo(88, 9)
    expect(r.total).toBeCloseTo(88, 9)
  })

  it('clampa red > 100 em 100 (BC zerada, sem alíquota negativa)', () => {
    const r = calcularTributos(1000, 150, 0, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(0, 9)
    expect(r.vIBS).toBeCloseTo(0, 9)
    expect(r.aliqIBS).toBeCloseTo(0, 9)
  })

  it('zero a carga quando a base é nula ou inválida', () => {
    expect(calcularTributos(0, 0, 0, 17.7, 8.8).carga).toBe(0)
    expect(calcularTributos(NaN, 0, 0, 17.7, 8.8).base).toBe(0)
    expect(calcularTributos(1000, NaN, NaN, 17.7, 8.8).aliqIBS).toBe(17.7)
  })
})

describe('anexoDeReducao', () => {
  it('usa os limiares 100 / 60 / 30 sobre redIBS', () => {
    expect(anexoDeReducao(100)).toBe('0')
    expect(anexoDeReducao(150)).toBe('0')
    expect(anexoDeReducao(99.99)).toBe('60')
    expect(anexoDeReducao(60)).toBe('60')
    expect(anexoDeReducao(59.99)).toBe('30')
    expect(anexoDeReducao(30)).toBe('30')
    expect(anexoDeReducao(29.99)).toBe('isento')
    expect(anexoDeReducao(0)).toBe('isento')
    expect(anexoDeReducao(NaN)).toBe('isento')
  })
})

describe('badgeReducao', () => {
  it('sinaliza alíquota zero em vermelho', () => {
    expect(badgeReducao(100)).toEqual({ rotulo: '⚡ Alíquota zero', cor: 'red' })
  })

  it('formata a redução com sinal menos tipográfico e 2 casas', () => {
    expect(badgeReducao(60)).toEqual({ rotulo: '\u221260,00%', cor: 'amber' })
    expect(badgeReducao(12.5)).toEqual({ rotulo: '\u221212,50%', cor: 'amber' })
  })

  it('usa "Sem redução" quando não há redução', () => {
    expect(badgeReducao(0)).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
    expect(badgeReducao('abc')).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
    expect(badgeReducao(null)).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
  })
})

describe('observacoesLegais', () => {
  it('um grupo por faixa; o ramo >= 60 é acumulativo', () => {
    // 100 → só alíquota zero; 60 → art. 137 + art. 135 + art. 128; 45 e 0 → um item.
    expect(observacoesLegais('02011000', 100)).toHaveLength(1)
    expect(observacoesLegais('02011000', 60)).toHaveLength(3)
    expect(observacoesLegais('02011000', 45)).toHaveLength(1)
    expect(observacoesLegais('02011000', 0)).toHaveLength(1)
  })

  it('>= 100 → Alíquota Zero', () => {
    const [o] = observacoesLegais('84713012', 100)
    expect(o.titulo).toBe('Alíquota Zero')
    expect(o.cor).toBe('emerald')
  })

  it('>= 60 em capítulo in natura → Art. 137 primeiro, sempre seguido do Art. 128', () => {
    const obs = observacoesLegais('02011000', 60)
    const [o] = obs
    expect(o.titulo).toBe(OBS_ARTIGOS.art137.titulo)
    expect(o.link).toBe(OBS_ARTIGOS.art137.link)
    expect(o.cor).toBe('emerald')
    expect(obs.at(-1)!.titulo).toBe(OBS_ARTIGOS.art128.titulo)
  })

  it('>= 60 em capítulo de alimentos fora in natura → Art. 135 + Art. 128', () => {
    // Capítulo 16 (carnes) está no art. 135 mas não em CAPITULOS_IN_NATURA.
    const obs = observacoesLegais('16010000', 60)
    expect(obs.map((o) => o.titulo)).toEqual([OBS_ARTIGOS.art135.titulo, OBS_ARTIGOS.art128.titulo])
    expect(obs[0].cor).toBe('amber')
  })

  it('>= 60 fora dos dois conjuntos → apenas Art. 128', () => {
    const obs = observacoesLegais('30049099', 60)
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toBe(OBS_ARTIGOS.art128.titulo)
    expect(obs[0].cor).toBe('amber')
  })

  it('capítulo nos dois conjuntos acumula os três artigos (art. 137 → 135 → 128)', () => {
    // Capítulo 02 está em CAPITULOS_IN_NATURA e em CAPITULOS_ART_135.
    expect(observacoesLegais('02011000', 60).map((o) => o.titulo)).toEqual([
      OBS_ARTIGOS.art137.titulo,
      OBS_ARTIGOS.art135.titulo,
      OBS_ARTIGOS.art128.titulo,
    ])
  })

  it('>= 30 e < 60 → Redução parcial', () => {
    const [o] = observacoesLegais('84713012', 30)
    expect(o.titulo).toBe('Redução parcial')
    expect(o.cor).toBe('amber')
  })

  it('< 30 → Regra geral, inclusive com NCM vazio (SPEC R2.21)', () => {
    expect(observacoesLegais('84713012', 0)[0].titulo).toBe('Regra geral')
    expect(observacoesLegais('', 60)[0].titulo).toBe(OBS_ARTIGOS.art128.titulo)
    expect(observacoesLegais('', 0)[0].cor).toBe('slate')
  })

  it('nunca emite art133/art139 (paridade com a v1, SPEC R2.20)', () => {
    const titulos = [100, 60, 30, 0].flatMap((red) =>
      ['30049099', '49019900', '02011000', '84713012'].map((n) => observacoesLegais(n, red)[0].titulo),
    )
    expect(titulos).not.toContain(OBS_ARTIGOS.art133.titulo)
    expect(titulos).not.toContain(OBS_ARTIGOS.art139.titulo)
  })
})

describe('avisoInNatura', () => {
  it('aparece apenas para NCM de 8 dígitos em capítulo in natura', () => {
    const aviso = avisoInNatura('02011000')
    expect(aviso).not.toBeNull()
    expect(aviso!.titulo).toContain('Capítulo 02')
    expect(aviso!.cor).toBe('emerald')
    expect(aviso!.link).toBe(OBS_ARTIGOS.art137.link)
  })

  it('some com NCM inválido ou capítulo fora da lista', () => {
    expect(avisoInNatura('0201100')).toBeNull()
    expect(avisoInNatura('')).toBeNull()
    expect(avisoInNatura('84713012')).toBeNull()
    expect(avisoInNatura('99999999')).toBeNull()
  })

  it('descreve o texto do Art. 137', () => {
    expect(avisoInNatura('07011000')!.texto).toContain('Art. 137 da LC 214/2025')
  })
})
