/**
 * Modal de novidades: integridade das notas + regras de exibição (puras).
 */
import { describe, expect, it } from 'vitest'
import { NOTAS_VERSAO, notasDaVersao } from '@/domain/constants/notas-versao'
import { deveExibirNovidades, deveNotificarDisponivel } from '@/store/novidades'

describe('NOTAS_VERSAO', () => {
  it('tem ao menos a versão inicial com bullets em linguagem de usuário', () => {
    expect(Object.keys(NOTAS_VERSAO).length).toBeGreaterThanOrEqual(1)
    for (const [versao, notas] of Object.entries(NOTAS_VERSAO)) {
      expect(versao).toMatch(/^\d+\.\d+\.\d+$/)
      expect(notas.novidades.length).toBeGreaterThanOrEqual(1)
      for (const n of notas.novidades) expect(n.trim().length).toBeGreaterThan(0)
      if (notas.comentario != null) expect(notas.comentario.trim().length).toBeGreaterThan(0)
    }
  })

  it('notasDaVersao devolve null para versão sem entrada', () => {
    expect(notasDaVersao('9.9.9')).toBeNull()
    expect(notasDaVersao('1.0.0')?.novidades.length).toBeGreaterThan(0)
  })
})

describe('deveExibirNovidades (pós-atualização)', () => {
  it('primeira instalação nunca exibe (carimba em silêncio)', () => {
    expect(deveExibirNovidades(null, '1.0.0')).toBe(false)
    expect(deveExibirNovidades('', '1.0.0')).toBe(false)
  })

  it('mesma versão não reexibe', () => {
    expect(deveExibirNovidades('1.0.0', '1.0.0')).toBe(false)
  })

  it('versão nova com notas exibe; sem notas não exibe', () => {
    expect(deveExibirNovidades('0.9.0', '1.0.0')).toBe(true)
    // '9.9.9' não tem entrada em NOTAS_VERSAO → nunca abre modal vazio
    expect(deveExibirNovidades('1.0.0', '9.9.9')).toBe(false)
  })

  it('navegador sem versão (—) nunca exibe', () => {
    expect(deveExibirNovidades('1.0.0', '—')).toBe(false)
    expect(deveExibirNovidades('1.0.0', '')).toBe(false)
  })
})

describe('deveNotificarDisponivel (background)', () => {
  it('só notifica uma vez por versão', () => {
    expect(deveNotificarDisponivel(null, '1.0.1')).toBe(true)
    expect(deveNotificarDisponivel('1.0.0', '1.0.1')).toBe(true)
    expect(deveNotificarDisponivel('1.0.1', '1.0.1')).toBe(false)
  })

  it('sem versão nova não notifica', () => {
    expect(deveNotificarDisponivel(null, null)).toBe(false)
  })
})
