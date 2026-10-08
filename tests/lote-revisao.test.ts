/**
 * Revisão obrigatória antes de salvar — a divisão exibida no modal é
 * exatamente a gravada pelo `salvarTodos` (sem surpresa).
 */
import { describe, expect, it } from 'vitest'
import { dividirLoteParaSalvamento, origemLinhaLote } from '@/domain/services/salvamento-lote'
import type { ItemLote } from '@/infrastructure/parsers/lote'

function item(parcial: Partial<ItemLote>): ItemLote {
  return {
    indice: 2, codigo: 'SKU-1', nome: 'Produto', ncm: '02011000',
    cest: '', cfop: '', cstIcms: '', pis: '', cofins: '',
    classificacoes: [], escolhida: null, regraGeral: false,
    ...parcial,
  } as ItemLote
}

const comEscolhida = { id: 'X', cst: '000', cClassTrib: '000001' } as unknown as ItemLote['escolhida']

describe('dividirLoteParaSalvamento', () => {
  it('separa graváveis de ignorados com motivo', () => {
    const itens = [
      item({ codigo: 'SKU-1', ncm: '02011000', escolhida: comEscolhida }),
      item({ codigo: '', ncm: '02011000', escolhida: comEscolhida }),
      item({ codigo: 'SKU-3', ncm: '123', escolhida: null }),
      item({ codigo: 'SKU-4', ncm: '02011000', escolhida: null }),
    ]
    const { gravaveis, ignorados } = dividirLoteParaSalvamento(itens)
    expect(gravaveis).toHaveLength(1)
    expect(gravaveis[0].codigo).toBe('SKU-1')
    expect(ignorados).toHaveLength(3)
    expect(ignorados.map((i) => i.motivo).join(' | ')).toMatch(/sem SKU/)
    expect(ignorados.map((i) => i.motivo).join(' | ')).toMatch(/NCM inválido/)
    expect(ignorados.map((i) => i.motivo).join(' | ')).toMatch(/sem classificação/)
  })

  it('origem da linha diferencia integral de segurança de escolha própria', () => {
    const base = item({
      codigo: 'SKU-1', ncm: '02011000', escolhida: comEscolhida,
      classificacoes: [
        { id: 'A', cst: '000', cClassTrib: '000001' },
        { id: 'B', cst: '200', cClassTrib: '200038' },
      ] as unknown as ItemLote['classificacoes'],
      analiseIA: {
        situacao: 'multipla', maisProvavelIndice: 0,
      } as unknown as ItemLote['analiseIA'],
    })
    // escolhida = integral sugerida (0) → pílula de segurança
    expect(origemLinhaLote(base)).toMatch(/integral sugerida/)
    const beneficio = item({
      ...base,
      escolhida: { id: 'B', cst: '200', cClassTrib: '200038' } as unknown as ItemLote['escolhida'],
    })
    // trocou a integral por um benefício → sua escolha
    expect(origemLinhaLote(beneficio)).toMatch(/sua escolha/)
  })

  it('origem da única com integral trocável: confirmada ou troca do usuário', () => {
    const oficial = { id: 'A', cst: '200', cClassTrib: '200007' }
    const integral = { id: 'INTEGRAL|x', cst: '000', cClassTrib: '000001', integralFallback: true }
    const fixada = item({
      codigo: 'SKU-9', ncm: '83024100',
      escolhida: oficial as unknown as ItemLote['escolhida'],
      classificacoes: [oficial, integral] as unknown as ItemLote['classificacoes'],
      analiseIA: { situacao: 'unica', maisProvavelIndice: 0 } as unknown as ItemLote['analiseIA'],
    })
    expect(origemLinhaLote(fixada)).toBe('única · confirmada')
    const trocada = item({
      ...fixada,
      escolhida: integral as unknown as ItemLote['escolhida'],
    })
    expect(origemLinhaLote(trocada)).toMatch(/sua escolha: integral/)
  })
})
