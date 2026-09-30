/**
 * Catálogo de legislação — integridade estrutural.
 *
 * Garante que todo item do menu Legislação tenha URL HTTPS válida, `id`
 * único, grupo conhecido e (quando o portal não tem link profundo, como o
 * SEFAZLEGIS) o termo exato de busca.
 */
import { describe, expect, it } from 'vitest'
import { GRUPOS_LEGISLACAO, LEGISLACOES } from '@/domain/legislacao'

describe('catalogo de legislacao', () => {
  it('tem ids unicos e urls https validas', () => {
    const ids = LEGISLACOES.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of LEGISLACOES) {
      expect(item.titulo.trim().length).toBeGreaterThan(0)
      const u = new URL(item.url)
      expect(u.protocol).toBe('https:')
    }
  })

  it('todo item pertence a um grupo conhecido e todo grupo tem item', () => {
    const grupos = new Set(GRUPOS_LEGISLACAO.map((g) => g.id))
    for (const item of LEGISLACOES) {
      expect(grupos.has(item.grupo)).toBe(true)
    }
    for (const grupo of GRUPOS_LEGISLACAO) {
      expect(LEGISLACOES.some((i) => i.grupo === grupo.id)).toBe(true)
    }
  })

  it('contem os decretos federais e estaduais esperados', () => {
    const ids = new Set(LEGISLACOES.map((i) => i.id))
    for (const esperado of [
      'dec12955',
      'portal-decretos-planalto',
      'dec24569-ce',
      'dec33327-ce',
      'dec35061-ce',
      'dec34605-ce',
      'sefazlegis-ce',
    ]) {
      expect(ids.has(esperado)).toBe(true)
    }
  })

  it('itens do SEFAZLEGIS indicam o termo exato de busca', () => {
    const sefaz = LEGISLACOES.filter((i) => i.buscaPortal)
    expect(sefaz.length).toBeGreaterThanOrEqual(5)
    for (const item of sefaz) {
      expect(item.buscaPortal!.trim().length).toBeGreaterThan(0)
      expect(item.url).toContain('sefazlegis')
    }
  })
})
