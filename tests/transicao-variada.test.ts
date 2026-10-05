/**
 * Carrossel de transições de menu: cada troca de view usa um preset diferente
 * do anterior (`PRESETS_TRANSICAO` + `transicaoSeq`), sem repetição em
 * sequência.
 */
import { describe, expect, it } from 'vitest'
import { PRESETS_TRANSICAO, presetTransicao } from '@/ui/motion'
import { useUi, type ViewId } from '@/store/ui'

describe('PRESETS_TRANSICAO', () => {
  it('tem ao menos 3 presets com nomes distintos', () => {
    expect(PRESETS_TRANSICAO.length).toBeGreaterThanOrEqual(3)
    const nomes = new Set(PRESETS_TRANSICAO.map((p) => p.nome))
    expect(nomes.size).toBe(PRESETS_TRANSICAO.length)
  })

  it('nunca repete o preset em duas posições consecutivas (carrossel longo)', () => {
    for (let seq = 0; seq < PRESETS_TRANSICAO.length * 4; seq += 1) {
      expect(presetTransicao(seq + 1).nome).not.toBe(presetTransicao(seq).nome)
    }
  })

  it('percorre todos os presets antes de repetir o ciclo', () => {
    const ciclo = PRESETS_TRANSICAO.map((_, i) => presetTransicao(i).nome)
    expect(new Set(ciclo).size).toBe(PRESETS_TRANSICAO.length)
    expect(presetTransicao(PRESETS_TRANSICAO.length).nome).toBe(presetTransicao(0).nome)
  })
})

describe('trocarView + transicaoSeq', () => {
  it('avança o carrossel a cada troca real e nunca repete em sequência', () => {
    const passeio: ViewId[] = ['calculadora', 'consulta', 'simples', 'lote', 'nfe', 'produtos', 'consulta']
    const nomes: string[] = []
    for (const v of passeio) {
      useUi.getState().trocarView(v)
      nomes.push(presetTransicao(useUi.getState().transicaoSeq).nome)
    }
    for (let i = 1; i < nomes.length; i += 1) {
      expect(nomes[i]).not.toBe(nomes[i - 1])
    }
  })

  it('tocar na view atual não avança o carrossel', () => {
    useUi.getState().trocarView('calculadora')
    const antes = useUi.getState().transicaoSeq
    useUi.getState().trocarView('calculadora')
    expect(useUi.getState().transicaoSeq).toBe(antes)
  })
})
