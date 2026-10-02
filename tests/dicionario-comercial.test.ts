/**
 * Regressão do **dicionário comercial** (nomes populares → NCM exato).
 *
 * Puro (sem IndexedDB): cobre match, normalização, precedência do termo mais
 * longo e as travas anti-ambiguidade (palavra sozinha só quando inequívoca).
 */
import { describe, expect, it } from 'vitest'
import {
  DICIONARIO_COMERCIAL,
  buscarNoDicionarioComercial,
} from '@/domain/constants/dicionario-comercial'
import { normalizarBusca } from '@/domain/services/busca-texto'

describe('dicionario comercial: pins verificados na TEC', () => {
  it('parmesão (ausente na TEC) ancora 0406.90.10', () => {
    expect(buscarNoDicionarioComercial('parmesão')[0]?.ncm).toBe('04069010')
  })

  it('normalização: caixa, acento e pontuação não importam', () => {
    for (const q of ['Parmesão', 'PARMESAO', '  parmesão!! ', 'Queijo Parmesão']) {
      expect(buscarNoDicionarioComercial(q).map((a) => a.ncm)).toContain('04069010')
    }
  })

  it('termo mais longo vence: parmesão ralado é 0406.20.00, não massa dura', () => {
    const acertos = buscarNoDicionarioComercial('queijo parmesão ralado')
    expect(acertos[0]?.ncm).toBe('04062000')
  })

  it('embutidos: mortadela e presunto resolvem sem a palavra oficial', () => {
    expect(buscarNoDicionarioComercial('mortadela')[0]?.ncm).toBe('16010000')
    expect(buscarNoDicionarioComercial('linguiça calabresa')[0]?.ncm).toBe('16010000')
    expect(buscarNoDicionarioComercial('presunto parma')[0]?.ncm).toBe('02101100')
    expect(buscarNoDicionarioComercial('bacon')[0]?.ncm).toBe('02101200')
    expect(buscarNoDicionarioComercial('charque')[0]?.ncm).toBe('02102000')
  })

  it('ambíguo sozinho não dispara: prato (louça), coalho (enzima), minas (estado)', () => {
    expect(buscarNoDicionarioComercial('prato de vidro')).toHaveLength(0)
    expect(buscarNoDicionarioComercial('coalho')).toHaveLength(0)
    // …mas qualificado, sim:
    expect(buscarNoDicionarioComercial('queijo prato')[0]?.ncm).toBe('04069020')
  })

  it('desconhecido e vazio retornam []', () => {
    expect(buscarNoDicionarioComercial('nave espacial')).toHaveLength(0)
    expect(buscarNoDicionarioComercial('')).toHaveLength(0)
    expect(buscarNoDicionarioComercial('x')).toHaveLength(0)
  })

  it('curadoria válida: NCMs com 8 dígitos, termos normalizados, sem duplicata', () => {
    const termos = new Map<string, string>()
    for (const e of DICIONARIO_COMERCIAL) {
      expect(e.ncm).toMatch(/^\d{8}$/)
      expect(e.termos.length).toBeGreaterThan(0)
      for (const t of e.termos) {
        expect(t).toBe(normalizarBusca(t))
        const dono = termos.get(t)
        expect(dono ?? e.ncm).toBe(e.ncm)
        termos.set(t, e.ncm)
      }
    }
  })
})
