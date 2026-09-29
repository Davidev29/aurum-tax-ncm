/**
 * Vigência NCM (permitido × negado na tabela vigente).
 *
 * "Negado" = NCM removido da TEC (`Data_Fim` ≠ 31/12/9999): extinto, passa a
 * ser tributado por outro código. O sistema deve sinalizar, nunca apresentar
 * o vínculo antigo como tributação atual.
 */
import { describe, expect, it } from 'vitest'
import { isNcmExtinto, observacaoExtincaoNcm } from '@/domain/services/classificacao'
import { montarAtoFim, normalizarNomenclatura } from '@/infrastructure/base/normalizacao'
import type { NomenclaturaNcm } from '@/domain/entities'

const vigente: NomenclaturaNcm = {
  codigo: '02011000',
  codigoOriginal: '0201.10.00',
  descricao: 'Carcaças e meias-carcaças de bovino',
  dataInicio: '01/04/2022',
  dataFim: null,
  ato: 'Res Gecex 272/2021',
  atoFim: null,
}

const extinto: NomenclaturaNcm = {
  codigo: '39139050',
  codigoOriginal: '3913.90.50',
  descricao: 'Quitosan, seus sais ou seus derivados',
  dataInicio: '01/04/2022',
  dataFim: '30/09/2026',
  ato: 'Res Gecex 272/2021',
  atoFim: 'Res Gecex 926/2026',
}

describe('vigência NCM', () => {
  it('vigente não é extinto e não gera observação', () => {
    expect(isNcmExtinto(vigente)).toBe(false)
    expect(observacaoExtincaoNcm(vigente)).toBeNull()
    expect(isNcmExtinto(null)).toBe(false)
  })

  it('extinto gera observação vermelha com data e ato de extinção', () => {
    expect(isNcmExtinto(extinto)).toBe(true)
    const obs = observacaoExtincaoNcm(extinto)
    expect(obs).not.toBeNull()
    expect(obs?.cor).toBe('red')
    expect(obs?.titulo).toContain('30/09/2026')
    expect(obs?.texto).toContain('926/2026')
    expect(obs?.texto).toContain('outro NCM')
  })

  it('normalizador preserva Data_Fim e ato de extinção', () => {
    const itens = normalizarNomenclatura({
      Nomenclaturas: [
        {
          Codigo: '3913.90.50',
          Descricao: 'Quitosan',
          Data_Inicio: '01/04/2022',
          Data_Fim: '30/09/2026',
          Tipo_Ato_Ini: 'Res Gecex',
          Numero_Ato_Ini: '272',
          Ano_Ato_Ini: '2021',
          Tipo_Ato_Fim: 'Res Gecex',
          Numero_Ato_Fim: '926',
          Ano_Ato_Fim: '2026',
        },
        {
          Codigo: '0201.10.00',
          Descricao: 'Bovino',
          Data_Inicio: '01/04/2022',
          Data_Fim: '31/12/9999',
          Tipo_Ato_Ini: 'Res Gecex',
          Numero_Ato_Ini: '272',
          Ano_Ato_Ini: '2021',
        },
      ],
    })
    expect(itens).toHaveLength(2)
    expect(itens[0].dataFim).toBe('30/09/2026')
    expect(itens[0].atoFim).toBe('Res Gecex 926/2026')
    expect(isNcmExtinto(itens[0])).toBe(true)
    expect(itens[1].dataFim).toBeNull()
    expect(isNcmExtinto(itens[1])).toBe(false)
  })

  it('montarAtoFim retorna null quando vigente', () => {
    expect(montarAtoFim({ Tipo_Ato_Ini: 'Res Gecex' })).toBeNull()
    expect(montarAtoFim({ Tipo_Ato_Fim: 'Res Gecex', Numero_Ato_Fim: '926', Ano_Ato_Fim: '2026' })).toBe(
      'Res Gecex 926/2026',
    )
  })
})
