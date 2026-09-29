/**
 * Motor de cálculo tributário — LC 214/2025 (redução de ALÍQUOTA) / R2.18–R2.22.
 *
 * Verifica a fórmula `aliq = referência × (1 − red/100)` sobre a base cheia e
 * `tributo = base × aliq/100`, as faixas oficiais 100/80/70/60/50/40/30
 * (incluindo o caso assimétrico IBS ≠ CBS), o badge de redução e as
 * observações legais por faixa.
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

  it('reduz a ALÍQUOTA (LC 214/2025): base cheia, débito = base × alíquota reduzida', () => {
    const r = calcularTributos(50, 60, 60, 17.7, 8.8)
    // BC preservada (valor cheio da operação)
    expect(r.bcIBS).toBeCloseTo(50, 9)
    expect(r.bcCBS).toBeCloseTo(50, 9)
    // Alíquota efetiva = referência × (1 − red)
    expect(r.aliqIBS).toBeCloseTo(17.7 * 0.4, 9)
    expect(r.aliqCBS).toBeCloseTo(8.8 * 0.4, 9)
    // Débito = base cheia × alíquota reduzida
    expect(r.vIBS).toBeCloseTo(50 * 17.7 * 0.4 / 100, 9)
    expect(r.vCBS).toBeCloseTo(50 * 8.8 * 0.4 / 100, 9)
    expect(r.total).toBeCloseTo(r.vIBS + r.vCBS, 9)
  })

  it('reduz cada tributo de forma linear e independente', () => {
    const r = calcularTributos(1000, 60, 60, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(1000, 9)
    expect(r.aliqIBS).toBeCloseTo(17.7 * 0.4, 9)
    expect(r.aliqCBS).toBeCloseTo(8.8 * 0.4, 9)
    expect(r.vIBS).toBeCloseTo(1000 * (17.7 * 0.4) / 100, 9)
    expect(r.total).toBeCloseTo(r.vIBS + r.vCBS, 9)
  })

  it('aplica reduções parciais oficiais sobre a alíquota (30/40/50/70/80)', () => {
    const casos: Array<[number, number, number]> = [
      [30, 17.7 * 0.7, 8.8 * 0.7],
      [40, 17.7 * 0.6, 8.8 * 0.6],
      [50, 17.7 * 0.5, 8.8 * 0.5],
      [70, 17.7 * 0.3, 8.8 * 0.3],
      [80, 17.7 * 0.2, 8.8 * 0.2],
    ]
    for (const [red, espIBS, espCBS] of casos) {
      const r = calcularTributos(1000, red, red, 17.7, 8.8)
      expect(r.bcIBS).toBeCloseTo(1000, 9)
      expect(r.aliqIBS).toBeCloseTo(espIBS, 9)
      expect(r.aliqCBS).toBeCloseTo(espCBS, 9)
      expect(r.vIBS).toBeCloseTo(1000 * espIBS / 100, 9)
      expect(r.vCBS).toBeCloseTo(1000 * espCBS / 100, 9)
    }
  })

  it('redução 100% zera a ALÍQUOTA e o tributo, preservando a BC', () => {
    const r = calcularTributos(50, 100, 100, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(50, 9)
    expect(r.bcCBS).toBeCloseTo(50, 9)
    expect(r.aliqIBS).toBeCloseTo(0, 9)
    expect(r.aliqCBS).toBeCloseTo(0, 9)
    expect(r.vIBS).toBeCloseTo(0, 9)
    expect(r.vCBS).toBeCloseTo(0, 9)
    expect(r.total).toBeCloseTo(0, 9)
  })

  it('mantém reduções assimétricas (Prouni: IBS 60% / CBS 100%)', () => {
    const r = calcularTributos(1000, 60, 100, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(1000, 9)
    expect(r.bcCBS).toBeCloseTo(1000, 9)
    expect(r.aliqIBS).toBeCloseTo(17.7 * 0.4, 9)
    expect(r.aliqCBS).toBeCloseTo(0, 9)
    expect(r.vIBS).toBeCloseTo(1000 * 17.7 * 0.4 / 100, 9)
    expect(r.vCBS).toBeCloseTo(0, 9)
  })

  it('mantém reduções assimétricas gerais', () => {
    const r = calcularTributos(1000, 100, 0, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(1000, 9)
    expect(r.bcCBS).toBeCloseTo(1000, 9)
    expect(r.vIBS).toBeCloseTo(0, 9)
    expect(r.vCBS).toBeCloseTo(88, 9)
    expect(r.total).toBeCloseTo(88, 9)
  })

  it('clampa red > 100 em 100 (alíquota zerada, sem alíquota negativa)', () => {
    const r = calcularTributos(1000, 150, 0, 17.7, 8.8)
    expect(r.bcIBS).toBeCloseTo(1000, 9)
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
  it('usa as faixas oficiais sobre IBS/CBS', () => {
    expect(anexoDeReducao(100, 100)).toBe('0')
    expect(anexoDeReducao(150, 150)).toBe('0')
    expect(anexoDeReducao(80, 80)).toBe('80')
    expect(anexoDeReducao(70, 70)).toBe('70')
    expect(anexoDeReducao(60, 60)).toBe('60')
    expect(anexoDeReducao(50, 50)).toBe('50')
    expect(anexoDeReducao(40, 40)).toBe('40')
    expect(anexoDeReducao(30, 30)).toBe('30')
    expect(anexoDeReducao(0, 0)).toBe('isento')
    expect(anexoDeReducao(NaN)).toBe('isento')
  })

  it('sinaliza redução assimétrica IBS ≠ CBS como misto (Prouni 60/100)', () => {
    expect(anexoDeReducao(60, 100)).toBe('misto')
    expect(anexoDeReducao(100, 60)).toBe('misto')
    expect(anexoDeReducao(60, 59)).toBe('misto')
  })

  it('não infla valores intermediários (piso da faixa)', () => {
    expect(anexoDeReducao(99.99, 99.99)).toBe('80')
    expect(anexoDeReducao(59.99, 59.99)).toBe('50')
    expect(anexoDeReducao(29.99, 29.99)).toBe('isento')
  })
})

describe('badgeReducao', () => {
  it('sinaliza alíquota zero em vermelho', () => {
    expect(badgeReducao(100)).toEqual({ rotulo: '⚡ Alíquota zero', cor: 'red' })
  })

  it('formata a redução com sinal menos tipográfico e 2 casas', () => {
    expect(badgeReducao(60)).toEqual({ rotulo: '−60,00%', cor: 'amber' })
    expect(badgeReducao(12.5)).toEqual({ rotulo: '−12,50%', cor: 'amber' })
  })

  it('usa "Sem redução" quando não há redução', () => {
    expect(badgeReducao(0)).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
    expect(badgeReducao('abc')).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
    expect(badgeReducao(null)).toEqual({ rotulo: 'Sem redução', cor: 'emerald' })
  })
})

describe('observacoesLegais', () => {
  it('um grupo por faixa; o ramo 60 é acumulativo', () => {
    // 100 → só alíquota zero; 60 → art. 137 + art. 135 + art. 128; demais → um item.
    expect(observacoesLegais('02011000', 100, 100)).toHaveLength(1)
    expect(observacoesLegais('02011000', 60, 60)).toHaveLength(3)
    expect(observacoesLegais('02011000', 40, 40)).toHaveLength(1)
    expect(observacoesLegais('02011000', 0, 0)).toHaveLength(1)
  })

  it('>= 100 → Alíquota Zero', () => {
    const [o] = observacoesLegais('84713012', 100, 100)
    expect(o.titulo).toBe('Alíquota Zero')
    expect(o.cor).toBe('emerald')
  })

  it('60 em capítulo in natura → Art. 137 primeiro, sempre seguido do Art. 128', () => {
    const obs = observacoesLegais('02011000', 60, 60)
    const [o] = obs
    expect(o.titulo).toBe(OBS_ARTIGOS.art137.titulo)
    expect(o.link).toBe(OBS_ARTIGOS.art137.link)
    expect(o.cor).toBe('emerald')
    expect(obs.at(-1)!.titulo).toBe(OBS_ARTIGOS.art128.titulo)
  })

  it('60 em capítulo de alimentos fora in natura → Art. 135 + Art. 128', () => {
    // Capítulo 16 (carnes) está no art. 135 mas não em CAPITULOS_IN_NATURA.
    const obs = observacoesLegais('16010000', 60, 60)
    expect(obs.map((o) => o.titulo)).toEqual([OBS_ARTIGOS.art135.titulo, OBS_ARTIGOS.art128.titulo])
    expect(obs[0].cor).toBe('amber')
  })

  it('60 fora dos dois conjuntos → apenas Art. 128', () => {
    const obs = observacoesLegais('30049099', 60, 60)
    expect(obs).toHaveLength(1)
    expect(obs[0].titulo).toBe(OBS_ARTIGOS.art128.titulo)
    expect(obs[0].cor).toBe('amber')
  })

  it('capítulo nos dois conjuntos acumula os três artigos (art. 137 → 135 → 128)', () => {
    // Capítulo 02 está em CAPITULOS_IN_NATURA e em CAPITULOS_ART_135.
    expect(observacoesLegais('02011000', 60, 60).map((o) => o.titulo)).toEqual([
      OBS_ARTIGOS.art137.titulo,
      OBS_ARTIGOS.art135.titulo,
      OBS_ARTIGOS.art128.titulo,
    ])
  })

  it('30 → Art. 127 (profissões regulamentadas)', () => {
    const [o] = observacoesLegais('84713012', 30, 30)
    expect(o.titulo).toBe(OBS_ARTIGOS.art127.titulo)
    expect(o.cor).toBe('amber')
  })

  it('40 → arts. 275–289', () => {
    const [o] = observacoesLegais('84713012', 40, 40)
    expect(o.titulo).toContain('40%')
    expect(o.cor).toBe('amber')
  })

  it('50 e 70 → Art. 261; 80 → Art. 158', () => {
    expect(observacoesLegais('84713012', 50, 50)[0].titulo).toBe(OBS_ARTIGOS.art261.titulo)
    expect(observacoesLegais('84713012', 70, 70)[0].titulo).toBe(OBS_ARTIGOS.art261.titulo)
    expect(observacoesLegais('84713012', 80, 80)[0].titulo).toBe(OBS_ARTIGOS.art158.titulo)
  })

  it('assimétrico 60/100 → Art. 308 (Prouni)', () => {
    const [o] = observacoesLegais('84713012', 60, 100)
    expect(o.titulo).toContain('60%')
    expect(o.link).toBe(OBS_ARTIGOS.art308.link)
  })

  it('0 → Regra geral, inclusive com NCM vazio (SPEC R2.21)', () => {
    expect(observacoesLegais('84713012', 0, 0)[0].titulo).toBe('Regra geral')
    expect(observacoesLegais('', 60, 60)[0].titulo).toBe(OBS_ARTIGOS.art128.titulo)
    expect(observacoesLegais('', 0, 0)[0].cor).toBe('slate')
  })

  it('nunca emite art133/art139 (paridade com a v1, SPEC R2.20)', () => {
    const titulos = [100, 60, 30, 0].flatMap((red) =>
      ['30049099', '49019900', '02011000', '84713012'].map((n) => observacoesLegais(n, red, red)[0].titulo),
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
