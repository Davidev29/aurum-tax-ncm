/** Autocomplete inline (sem SELECT): filtro puro das sugestões. */
import { describe, expect, it } from 'vitest'
import { filtrarSugestoesAux } from '@/application/aux-sugestao'

const CFOPS = [
  { codigo: '1102', descricao: 'Compra para comercialização', tipo: 'Entrada' },
  { codigo: '5102', descricao: 'Venda de mercadoria adquirida', tipo: 'Saída' },
  { codigo: '5101', descricao: 'Venda de produção do estabelecimento', tipo: 'Saída' },
  { codigo: '2102', descricao: 'Compra para comercialização interestadual', tipo: 'Entrada' },
]

describe('filtrarSugestoesAux', () => {
  it('código que começa com o termo vem primeiro', () => {
    const r = filtrarSugestoesAux(CFOPS, '51')
    expect(r.map((o) => o.codigo)).toEqual(['5102', '5101'])
  })
  it('descrição também sugere (ex.: "venda")', () => {
    const r = filtrarSugestoesAux(CFOPS, 'venda')
    expect(r.map((o) => o.codigo).sort()).toEqual(['5101', '5102'])
  })
  it('termo vazio não sugere nada', () => {
    expect(filtrarSugestoesAux(CFOPS, '  ')).toEqual([])
  })
  it('respeita o limite', () => {
    expect(filtrarSugestoesAux(CFOPS, 'a', 2)).toHaveLength(2)
  })
  it('excluirNbs descarta 9 dígitos (NBS, serviços)', () => {
    const comNbs = [...CFOPS, { codigo: '123456789', descricao: 'Serviço qualquer', tipo: 'Outros' }]
    expect(filtrarSugestoesAux(comNbs, '123', 8)).toHaveLength(1)
    expect(filtrarSugestoesAux(comNbs, '123', 8, { excluirNbs: true })).toHaveLength(0)
  })
  it('insensível a acento/caixa', () => {
    const r = filtrarSugestoesAux(
      [{ codigo: '000', descricao: 'Comercialização de produção' }],
      'comercializacao',
    )
    expect(r).toHaveLength(1)
  })
})
