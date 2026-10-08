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
  mapearRespostaCnpja,
  mapearRespostaCnpjWs,
  mapearRespostaReceitaWS,
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

describe('cadeia de fallback', () => {
  const RESP_CNPJA = {
    taxId: '11222333000181',
    alias: 'Exemplo',
    company: { name: 'Empresa Exemplo LTDA', size: { acronym: 'ME' }, simples: { optant: true } },
    address: { street: 'Rua A', number: '100', details: 'Sala 1', district: 'Centro', city: 'São Paulo', state: 'sp', zip: '01001-000' },
    phones: [{ area: '11', number: '99999999' }],
    emails: [{ address: 'a@b.com' }],
    mainActivity: { id: 8550301, text: 'Administração de caixas escolares' },
    sideActivities: [{ id: 9493600, text: 'Associativas' }],
    status: { text: 'Ativa' },
  }

  /** `fetch` que responde por host (simula primário fora + fallback ok). */
  const porHost = (mapa: Record<string, () => Response>) =>
    ((url: string | URL | Request) => {
      const u = String(url)
      for (const [host, fn] of Object.entries(mapa)) if (u.includes(host)) return Promise.resolve(fn())
      return Promise.resolve(new Response('{}', { status: 500 }))
    }) as unknown as typeof fetch

  it('usa o CNPJá quando a BrasilAPI dá 500', async () => {
    limparCacheBrasilApi()
    const f = porHost({
      'brasilapi.com.br': () => new Response('{}', { status: 500 }),
      'open.cnpja.com': () => new Response(JSON.stringify(RESP_CNPJA), { status: 200 }),
    })
    const d = await buscarCnpj('11222333000181', f)
    expect(d.fonte).toBe('cnpja')
    expect(d.razaoSocial).toBe('Empresa Exemplo LTDA')
    expect(d.cnaePrincipal).toBe('8550301')
    expect(d.cnaesSecundarios).toEqual([{ codigo: '9493600', descricao: 'Associativas' }])
    expect(d.opcaoSimples).toBe(true)
    expect(d.uf).toBe('SP')
  })

  it('agrega 404 de todas as bases em "não encontrado"', async () => {
    limparCacheBrasilApi()
    const tudo404 = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch
    await expect(buscarCnpj('11222333000181', tudo404)).rejects.toThrow('não encontrado nas bases')
  })

  it('normaliza CNAE dos fallbacks (formatado, número, string)', () => {
    expect(
      mapearRespostaReceitaWS({ nome: 'X', atividade_principal: [{ code: '06.00-0-01', text: 'Petróleo' }] })?.cnaePrincipal,
    ).toBe('0600001')
    expect(
      mapearRespostaCnpja({ company: { name: 'X' }, mainActivity: { id: 600001, text: 'Petróleo' } })?.cnaePrincipal,
    ).toBe('0600001')
    expect(
      mapearRespostaCnpjWs({
        razao_social: 'X',
        estabelecimento: { atividade_principal: { id: '9430800', descricao: 'Assoc' } },
      })?.cnaePrincipal,
    ).toBe('9430800')
  })
})
