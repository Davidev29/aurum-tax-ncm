/**
 * Regressão da **busca unificada**: roteamento por intenção + skeletons.
 *
 * - `detectarIntencaoConsulta` é pura: números → seção exata, texto → nome,
 *   frase expressiva → predição assistiva, mista → todas;
 * - garante que a predição (worker caro) NÃO dispara em digitação curta.
 */
import { describe, expect, it } from 'vitest'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'

describe('detector da busca unificada', () => {
  it('entrada vazia não dispara nenhum worker', () => {
    const r = detectarIntencaoConsulta('')
    expect(r.tipo).toBe('vazia')
    expect(r.deveBuscarExato).toBe(false)
    expect(r.deveBuscarNome).toBe(false)
    expect(r.deveBuscarDescricao).toBe(false)
  })

  it('dígitos roteiam para a seção exata (sem predição cara)', () => {
    const prefixo = detectarIntencaoConsulta('0201')
    expect(prefixo.tipo).toBe('numerica')
    expect(prefixo.deveBuscarExato).toBe(true)
    expect(prefixo.deveClassificarExato).toBe(false)
    expect(prefixo.deveBuscarNome).toBe(false)
    expect(prefixo.deveBuscarDescricao).toBe(false)

    const exato = detectarIntencaoConsulta('0201.10.00')
    expect(exato.tipo).toBe('numerica')
    expect(exato.deveBuscarExato).toBe(true)
    expect(exato.deveClassificarExato).toBe(true)
    expect(exato.digitos).toBe('02011000')
  })

  it('nome curto já acende nome + predição assistiva (RAG proativo)', () => {
    const r = detectarIntencaoConsulta('queijo')
    expect(r.tipo).toBe('textual')
    expect(r.deveBuscarExato).toBe(false)
    expect(r.deveBuscarNome).toBe(true)
    // 1 palavra relevante basta: "queijo", "celular", "camiseta" já mostram
    // a predição assistiva (antes exigia frase expressiva e a IA "nunca sabia").
    expect(r.deveBuscarDescricao).toBe(true)
  })

  it('stopword pura não acende a predição', () => {
    const r = detectarIntencaoConsulta('para')
    expect(r.deveBuscarDescricao).toBe(false)
  })

  it('frase expressiva acende nome + predição assistiva', () => {
    const r = detectarIntencaoConsulta('boi vivo Nelore para reprodução')
    expect(r.tipo).toBe('textual')
    expect(r.deveBuscarNome).toBe(true)
    expect(r.deveBuscarDescricao).toBe(true)
  })

  it('entrada mista acende número + texto', () => {
    const r = detectarIntencaoConsulta('queijo 0406')
    expect(r.tipo).toBe('mista')
    expect(r.deveBuscarExato).toBe(true)
    expect(r.deveBuscarNome).toBe(true)
  })
})
