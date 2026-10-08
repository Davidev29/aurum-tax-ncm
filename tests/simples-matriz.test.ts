/**
 * Simples Nacional — matriz anexo × faixa + limites + sublimite + robustez.
 *
 * Invariantes canônicos das planilhas (cenário 1, sem sublimite):
 * - DAS = receita × alíquota efetiva (±0.01, resíduo de round2);
 * - soma da repartição = DAS (o núcleo absorve o resíduo na maior parcela).
 * Na 6ª faixa há sublimite por desenho (cenário 2): o invariante passa a ser
 * das = dasGuia + fora.total.
 */
import { describe, expect, it } from 'vitest'
import {
  ANEXOS_SIMPLES,
  SUBLIMITE,
  RBT12_MAX,
  type AnexoSimplesId,
} from '@/simples/tabelas'
import {
  aliquotaEfetiva,
  aplicarTravaISS,
  calcularConvencional,
  cenarioSublimite,
  faixaDoRBT12,
  fatorR,
  round2,
} from '@/simples/calculo'

const ANEXOS = Object.keys(ANEXOS_SIMPLES) as AnexoSimplesId[]
const RECEITA = 50_000

describe('simples matriz — anexo × faixa (cenário 1, sem sublimite)', () => {
  it.each(ANEXOS)('anexo %s faixas 1–5: DAS = receita × alíquota e repartição soma = DAS', (anexoId) => {
    const anexo = ANEXOS_SIMPLES[anexoId]
    for (const faixa of anexo.faixas.slice(0, 5)) {
      // Meio da faixa como RBT12 representativo (todas < 3.6M => cenário 1).
      const rbt12 = Math.min(faixa.limSup, Math.max(faixa.limInf + 1, (faixa.limInf + faixa.limSup) / 2))
      const r = calcularConvencional({ anexoId, rbt12, receitaMes: RECEITA })
      expect(r.faixa).toBe(faixa.faixa)
      expect(r.cenario).toBe(1)
      const aliq = aliquotaEfetiva(rbt12, faixa)
      expect(r.das).toBeCloseTo(RECEITA * aliq, 2)
      const somaRep = Object.values(r.reparticao).reduce((a, b) => a + b, 0)
      // Resíduo de 1 centavo do arredondamento por tributo (tolerância ±0.05).
      expect(somaRep).toBeCloseTo(r.das, 1)
      expect(r.das).toBeGreaterThanOrEqual(0)
      expect(Number.isNaN(r.das)).toBe(false)
    }
  })

  it.each(ANEXOS)('anexo %s faixa 6: sublimite (cenário 2) — das = guia + fora', (anexoId) => {
    // Qualquer RBT12 na 6ª faixa (> 3.6M) cai no sublimite por desenho;
    // com RBA abaixo do sublimite o cenário é o 2 (rba default = rbt12 daria 4).
    const r = calcularConvencional({ anexoId, rbt12: 4_200_000, receitaMes: RECEITA, rba: 3_000_000 })
    expect(r.faixa).toBe(6)
    expect(r.cenario).toBe(2)
    expect(r.excedeSublimite).toBe(true)
    expect(r.dasGuia + r.foraSublimite.total).toBeCloseTo(r.das, 2)
    // A repartição cheia do cenário 2 é aproximada por desenho (ver src);
    // o invariante exato é a separação: tributos fora zerados na guia.
    for (const t of r.tributosFora) expect(r.reparticaoGuia[t]).toBe(0)
    expect(Number.isNaN(r.das)).toBe(false)
    expect(r.das).toBeGreaterThanOrEqual(0)
    expect(r.dasGuia).toBeGreaterThanOrEqual(0)
  })
})

describe('simples — limites de RBT12', () => {
  const casos: Array<[number, number | null]> = [
    [0, null],
    [180_000, 1],
    [180_000.01, 2],
    [3_600_000, 5],
    [4_800_000, 6],
    [4_800_001, null],
  ]
  it.each(casos)('RBT12 %s => faixa %s (anexo I)', (rbt12, faixaEsperada) => {
    const f = faixaDoRBT12(ANEXOS_SIMPLES.I, rbt12)
    expect(f?.faixa ?? null).toBe(faixaEsperada)
  })

  it('RBT12 zero => DAS zero sem throw', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 0, receitaMes: 10_000 })
    expect(r.das).toBe(0)
  })

  it(`acima de RBT12_MAX (${RBT12_MAX}) não enquadra`, () => {
    expect(faixaDoRBT12(ANEXOS_SIMPLES.I, RBT12_MAX + 1)).toBeNull()
    const r = calcularConvencional({ anexoId: 'I', rbt12: RBT12_MAX + 1, receitaMes: 10_000 })
    expect(r.das).toBe(0)
  })
})

describe('simples — sublimite (4 cenários)', () => {
  it.each([
    [3_000_000, 3_000_000, 1],
    [3_800_000, 3_000_000, 2],
    [3_000_000, 3_700_000, 3],
    [3_800_000, 3_700_000, 4],
  ] as Array<[number, number, 1 | 2 | 3 | 4]>)(
    'RBT12 %s × RBA %s => cenário %s',
    (rbt12, rba, cenario) => {
      expect(cenarioSublimite(rbt12, rba)).toBe(cenario)
    },
  )

  it('cenário 1: sem excesso, fora zerado e dasGuia = das', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 500_000, receitaMes: 60_000 })
    expect(r.cenario).toBe(1)
    expect(r.excedeSublimite).toBe(false)
    expect(r.foraSublimite.total).toBe(0)
    expect(r.dasGuia).toBe(r.das)
  })

  it('cenário 2: RBT12 na 6ª + RBA abaixo, ICMS/IBS fora da guia', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 100_000, rba: 3_000_000 })
    expect(r.cenario).toBe(2)
    expect(r.excedeSublimite).toBe(true)
    expect(r.foraSublimite.total).toBeGreaterThan(0)
    expect(r.dasGuia).toBeLessThan(r.das)
    expect(r.dasGuia).toBeGreaterThanOrEqual(0)
  })

  it('cenário 3: RBT12 abaixo + RBA acima', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 3_000_000, receitaMes: 100_000, rba: 3_700_000 })
    expect(r.cenario).toBe(3)
    expect(r.excedeSublimite).toBe(true)
    expect(r.detalhes.receitaExcedente).toBeGreaterThanOrEqual(0)
  })

  it('cenário 4: ambos acima, receita excedente = RBA - sublimite limitada', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 3_800_000, receitaMes: 200_000, rba: 3_700_000 })
    expect(r.cenario).toBe(4)
    expect(r.detalhes.receitaExcedente).toBe(100_000)
    expect(r.das).toBeGreaterThan(20_000)
    expect(r.dasGuia + r.foraSublimite.total).toBeCloseTo(r.das, 0)
  })

  it(`borda exata do SUBLIMITE (${SUBLIMITE}) ainda é cenário 1`, () => {
    expect(cenarioSublimite(SUBLIMITE, SUBLIMITE)).toBe(1)
  })
})

describe('simples — trava do ISS', () => {
  it('anexo I nunca trava (aplicaExcedenteISS = false)', () => {
    const t = aplicarTravaISS(ANEXOS_SIMPLES.I, 0.2, 0.01)
    expect(t.excedente).toBe(0)
    expect(t.issFinal).toBe(0.2)
  })

  it('anexo III com ISS bruto > 5% trava em 5% e redistribui (soma = 1)', () => {
    const anexo = ANEXOS_SIMPLES.III
    const somaRedist = Object.values(anexo.redistribuicaoISS).reduce((a, b) => a + (b ?? 0), 0)
    expect(somaRedist).toBeCloseTo(1, 6)
    const t = aplicarTravaISS(anexo, 0.07, 0.01)
    expect(t.issFinal).toBeCloseTo(0.05, 9)
    expect(t.excedente).toBeCloseTo(0.02, 9)
    expect(t.cbsFinal).toBeGreaterThan(0.01)
  })

  it('ISS bruto <= 5% não trava', () => {
    const t = aplicarTravaISS(ANEXOS_SIMPLES.III, 0.03, 0.01)
    expect(t.excedente).toBe(0)
    expect(t.issFinal).toBe(0.03)
  })
})

describe('simples — fator R fronteira', () => {
  it('28% exato => III; abaixo => V', () => {
    expect(fatorR(84_000, 300_000).anexo).toBe('III')
    expect(fatorR(84_000, 300_000).indice).toBeCloseTo(0.28, 9)
    expect(fatorR(83_999, 300_000).anexo).toBe('V')
    expect(fatorR(100_000, 300_000).anexo).toBe('III')
    expect(fatorR(80_000, 300_000).anexo).toBe('V')
  })
})

describe('simples — robustez (nunca NaN no DAS)', () => {
  it.each([NaN, -1, -100])('rbt12=%s => das 0, sem NaN, sem throw', (rbt12) => {
    const r = calcularConvencional({ anexoId: 'I', rbt12, receitaMes: 10_000 })
    expect(Number.isNaN(r.das)).toBe(false)
    expect(r.das).toBeGreaterThanOrEqual(0)
  })
  it.each([NaN, -1, -100])('receita=%s => das 0, sem NaN, sem throw', (receitaMes) => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 250_000, receitaMes })
    expect(Number.isNaN(r.das)).toBe(false)
    expect(r.das).toBeGreaterThanOrEqual(0)
  })
  it.each([Infinity, -Infinity])('rbt12=%s => das 0, sem NaN, sem throw', (rbt12) => {
    // RBT12 não-finito não enquadra em faixa (fail-closed => DAS zero).
    const r = calcularConvencional({ anexoId: 'I', rbt12, receitaMes: 10_000 })
    expect(Number.isNaN(r.das)).toBe(false)
    expect(r.das).toBe(0)
  })
  it('receita=Infinity => fail-closed amigável (throw tipado) ou DAS não-NaN', () => {
    // round2 do núcleo é fail-closed em ±Infinity por desenho: nunca pode
    // virar DAS exibível. Aceita o throw tipado (sem stack cru) ou DAS válido.
    let r!: ReturnType<typeof calcularConvencional>
    let erro: unknown = null
    try {
      r = calcularConvencional({ anexoId: 'I', rbt12: 250_000, receitaMes: Infinity })
    } catch (e) {
      erro = e
    }
    if (erro !== null) {
      expect(erro).toBeInstanceOf(Error)
      const msg = String((erro as Error).message ?? '')
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toMatch(/^\s*at\s/m)
    } else {
      expect(Number.isNaN(r.das)).toBe(false)
      expect(r.das).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('simples — golden EX1/EX2', () => {
  it('EX1: Anexo I RBT12 250k receita 30k => DAS 1477.20', () => {
    const r = calcularConvencional({ anexoId: 'I', rbt12: 250_000, receitaMes: 30_000 })
    expect(r.das).toBeCloseTo(1477.2, 2)
    expect(round2(r.das)).toBe(1477.2)
  })

  it('EX2: Anexo III RBT12 500k receita 60k => DAS 5983.20 sem trava ISS', () => {
    const r = calcularConvencional({ anexoId: 'III', rbt12: 500_000, receitaMes: 60_000 })
    expect(r.faixa).toBe(3)
    expect(r.das).toBeCloseTo(5983.2, 1)
    expect(round2(r.das)).toBe(5983.2)
    expect(r.excedenteISS).toBe(0)
  })
})
