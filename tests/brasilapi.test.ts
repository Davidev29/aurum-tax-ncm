/**
 * BrasilAPI: mapeamento, erros em pt-BR e extração de CNPJs.
 * O `fetch` é injetado (sem rede nos testes).
 */
import { describe, expect, it } from 'vitest'
import {
  buscarCnpj,
  buscarCnpjsEmLote,
  extrairCnpjsDeTexto,
  limparCacheBrasilApi,
  mapearRespostaBrasilApi,
} from '@/infrastructure/receita/brasilapi'

const RESPOSTA = {
  cnpj: '11222333000181',
  razao_social: 'Empresa Exemplo LTDA',
  nome_fantasia: 'Exemplo',
  logradouro: 'Rua A',
  numero: '100',
  complemento: 'Sala 1',
  bairro: 'Centro',
  municipio: 'São Paulo',
  uf: 'sp',
  cep: '01001-000',
  ddd_telefone_1: '11 9999-9999',
  email: 'a@b.com',
}

const okFetch = (json: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

describe('mapearRespostaBrasilApi', () => {
  it('normaliza endereço, cidade/UF e dígitos', () => {
    const d = mapearRespostaBrasilApi(RESPOSTA)
    expect(d).toMatchObject({
      cnpj: '11222333000181',
      razaoSocial: 'Empresa Exemplo LTDA',
      fantasia: 'Exemplo',
      cidade: 'São Paulo',
      uf: 'SP',
      cep: '01001000',
    })
    expect(d.endereco).toContain('Rua A')
    expect(d.endereco).toContain('100')
  })
})

describe('buscarCnpj', () => {
  it('rejeita CNPJ curto sem rede', async () => {
    limparCacheBrasilApi()
    await expect(buscarCnpj('123', okFetch({}))).rejects.toThrow('14 dígitos')
  })

  it('mapeia 404/429/timeout em pt-BR', async () => {
    limparCacheBrasilApi()
    await expect(buscarCnpj('11222333000181', okFetch({}, 404))).rejects.toThrow('não encontrado')
    limparCacheBrasilApi()
    await expect(buscarCnpj('11222333000181', okFetch({}, 429))).rejects.toThrow('Limite')
    limparCacheBrasilApi()
    const lento = (() => new Promise(() => {})) as unknown as typeof fetch
    // Não aguarda o timeout real: aborta de imediato simulando AbortError.
    const abort = (async () => {
      throw new DOMException('x', 'AbortError')
    }) as unknown as typeof fetch
    await expect(buscarCnpj('11222333000181', abort)).rejects.toThrow('12 s')
    void lento
  })

  it('retorna os dados e usa cache na segunda chamada', async () => {
    limparCacheBrasilApi()
    let chamadas = 0
    const contando = (async () => {
      chamadas++
      return new Response(JSON.stringify(RESPOSTA), { status: 200 })
    }) as unknown as typeof fetch
    const a = await buscarCnpj('11222333000181', contando)
    const b = await buscarCnpj('11222333000181', contando)
    expect(a.razaoSocial).toBe('Empresa Exemplo LTDA')
    expect(b.razaoSocial).toBe('Empresa Exemplo LTDA')
    expect(chamadas).toBe(1)
  })
})

describe('buscarCnpjsEmLote', () => {
  it('deduplica e nunca lança por item', async () => {
    limparCacheBrasilApi()
    const itens = await buscarCnpjsEmLote(
      ['11.222.333/0001-81', '11222333000181', '00000000000000'],
      undefined,
      (async (url: string | URL | Request) => {
        const u = String(url)
        if (u.endsWith('00000000000000')) return new Response('{}', { status: 404 })
        return new Response(JSON.stringify(RESPOSTA), { status: 200 })
      }) as unknown as typeof fetch,
    )
    expect(itens).toHaveLength(2)
    expect(itens.find((i) => i.cnpj === '11222333000181')?.ok).toBe(true)
    expect(itens.find((i) => i.cnpj === '00000000000000')?.ok).toBe(false)
  })
})

describe('extrairCnpjsDeTexto', () => {
  it('extrai mascarados e puros, sem duplicar', () => {
    const out = extrairCnpjsDeTexto('11.222.333/0001-81\n11222333000181\n04.252.011/0001-10')
    expect(out).toEqual(['11222333000181', '04252011000110'])
  })

  it('ignora fragmentos curtos', () => {
    expect(extrairCnpjsDeTexto('nada aqui 12345')).toEqual([])
  })
})
