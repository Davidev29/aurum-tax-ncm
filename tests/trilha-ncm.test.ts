/**
 * Trilha NCM (breadcrumb) — monta a família do código para exibição:
 * Seção/Família SH6 via hierarquia-fiscal, e o breadcrumb oficial
 * (Cap. → Pos. → Sub → Item) com descrições limpas (sem tags/hífens da TEC).
 */
import { describe, expect, it } from 'vitest'
import {
  fmtPrefixoTrilha,
  trilhaNcm,
  secaoDoNcm,
} from '@/domain/services/hierarquia-fiscal'

describe('trilhaNcm — montagem dos segmentos', () => {
  it('usa o nome oficial do capítulo quando não há descrição própria', () => {
    const trilha = trilhaNcm('04061010')
    expect(trilha[0]).toMatchObject({ nivel: 'capitulo', prefixo: '04', rotulo: 'Cap. 04' })
    expect(trilha[0].descricao.length).toBeGreaterThan(0) // CAPITULOS_NCM['04']
  })

  it('monta Cap. → Pos. → Sub → Item com descrições limpas', () => {
    const ancestrais = new Map([
      ['01', 'Animais vivos.'],
      ['0105', 'Aves da especie Gallus domesticus, vivas'],
      ['010594', 'Aves da especie <i>Gallus domesticus</i>'],
    ])
    const trilha = trilhaNcm('01059400', ancestrais)
    expect(trilha.map((s) => s.prefixo)).toEqual(['01', '0105', '01059', '010594', '0105940'])
    expect(trilha.map((s) => s.nivel)).toEqual(['capitulo', 'posicao', 'heading', 'subposicao', 'item'])
    expect(trilha[3].descricao).toBe('Aves da especie Gallus domesticus')
    // tags <i> removidas: nunca "o <i> aparece" na exibição
    for (const s of trilha) expect(s.descricao).not.toContain('<')
  })

  it('inclui o nível 5 e o item 7 quando presentes na base', () => {
    const ancestrais = new Map([
      ['07', 'Produtos hortícolas'],
      ['0713', 'Legumes de vagem secos, em grão'],
      ['0713331', '- Preto'],
    ])
    const trilha = trilhaNcm('07133319', ancestrais)
    expect(trilha.map((s) => s.prefixo)).toEqual(['07', '0713', '07133', '071333', '0713331'])
    expect(trilha[4].descricao).toBe('Preto')
  })

  it('aceita mapa simples e rótulos formatados', () => {
    const trilha = trilhaNcm('04061010', { '04': 'Leite e lacticínios', '0406': 'Queijos.' })
    expect(trilha[0].descricao.length).toBeGreaterThan(0) // CAPITULOS_NCM['04']
    expect(fmtPrefixoTrilha('04061')).toBe('0406.1')
    expect(fmtPrefixoTrilha('040610')).toBe('0406.10')
    expect(fmtPrefixoTrilha('0713331')).toBe('0713.33.1')
  })

  it('prefixo incompleto degrada com segurança (2-7 dígitos)', () => {
    expect(trilhaNcm('07').map((s) => s.prefixo)).toEqual(['07'])
    expect(trilhaNcm('0713').map((s) => s.prefixo)).toEqual(['07', '0713'])
    expect(trilhaNcm('0713331').map((s) => s.prefixo)).toEqual(['07', '0713', '07133', '071333', '0713331'])
    expect(trilhaNcm('')).toEqual([])
  })
})

describe('secaoDoNcm — Seção do SH para o eyebrow', () => {
  it('resolve capítulo → seção correta', () => {
    expect(secaoDoNcm('01012100')?.numero).toBe('I')
    expect(secaoDoNcm('07133319')?.numero).toBe('II')
    expect(secaoDoNcm('85412390')?.numero).toBe('XVI')
  })
})
