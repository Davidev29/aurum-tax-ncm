import { describe, expect, it } from 'vitest'
import { normalizarFotos, urlBuscaPexels } from '@/infrastructure/fundo/pexels'

describe('fundo Pexels (Aurum AI)', () => {
  it('monta URL de busca codificada', () => {
    const url = urlBuscaPexels('natureza minimalista', 6)
    expect(url).toContain('api.pexels.com/v1/search')
    expect(url).toContain('query=natureza%20minimalista')
    expect(url).toContain('per_page=6')
  })

  it('normaliza fotos e descarta sem URL', () => {
    const fotos = normalizarFotos({
      photos: [
        { src: { large: 'https://images.pexels.com/x.jpg' }, alt: 'Vale', photographer: 'Ana' },
        { src: {}, alt: 'quebrada' },
      ],
    })
    expect(fotos).toHaveLength(1)
    expect(fotos[0].url).toContain('https://')
    expect(fotos[0].autor).toBe('Ana')
  })

  it('resposta inválida vira lista vazia (fundo local)', () => {
    expect(normalizarFotos(null)).toEqual([])
    expect(normalizarFotos({})).toEqual([])
  })

  it('cache de 24 h faz roundtrip por query', async () => {
    const { salvarCacheFundo, lerCacheFundo } = await import('@/infrastructure/fundo/pexels')
    salvarCacheFundo('tema-teste', [{ url: 'https://images.pexels.com/a.jpg', alt: 'A', autor: 'B' }])
    expect(lerCacheFundo('tema-teste')).toHaveLength(1)
    expect(lerCacheFundo('outro-tema')).toEqual([])
  })
})
