import { afterEach, describe, expect, it, vi } from 'vitest'
import { ativarPorConta, criarCheckout, listarPlanos, loginConta } from '@/aurum/api'

// Contrato real: BFF p/ conta (`https://seu-portal/api/me`), Nest p/ `/v1/*`.
const BFF = 'https://seu-portal/api/me'
const NEST = 'https://api.aurumbit.com/v1'

function mockFetch(respostas: Record<string, { status: number; corpo: unknown }>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    const rota = Object.keys(respostas).find((k) => String(url) === k || String(url).startsWith(k))
    const r = (rota && respostas[rota]) || { status: 404, corpo: { code: 'UNKNOWN' } }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return {
    chamadas,
    restaurar: () => {
      globalThis.fetch = original
    },
  }
}

const ativacaoValida = {
  mode: 'account',
  licenseId: 'lic-1',
  keyMasked: '••••-WXYZ',
  productId: 'AURUM_TAX_NCM',
  expiresAt: '2027-01-01T00:00:00Z',
  graceUntil: '2027-01-15T00:00:00Z',
  device_hash: 'c'.repeat(64),
  offlineToken: 'jwt',
  off_exp: '2027-02-01T00:00:00Z',
  token_version: 1,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('aurum contrato BFF/Nest', () => {
  it('activate por conta vai ao BFF com productId exato (case-sensitive)', async () => {
    const f = mockFetch({ [`${BFF}/licenses/activate`]: { status: 200, corpo: ativacaoValida } })
    try {
      const r = await ativarPorConta({
        token: 'tok',
        productId: 'AURUM_TAX_NCM',
        appInstanceId: 'inst',
        label: 'Desktop',
      })
      expect(r.productId).toBe('AURUM_TAX_NCM')
      expect(f.chamadas).toHaveLength(1)
      expect(f.chamadas[0].url).toBe(`${BFF}/licenses/activate`)
      const corpo = JSON.parse(String(f.chamadas[0].init.body))
      expect(corpo.productId).toBe('AURUM_TAX_NCM')
      expect(corpo.app_instance_id).toBe('inst')
    } finally {
      f.restaurar()
    }
  })

  it('login vai ao auth derivado do portal (BFF sem /me)', async () => {
    const f = mockFetch({ 'https://seu-portal/api/auth/login': { status: 200, corpo: { token: 'tok-1' } } })
    try {
      const r = await loginConta('a@b.c', 'senha')
      expect(r.token).toBe('tok-1')
      expect(f.chamadas[0].url).toBe('https://seu-portal/api/auth/login')
    } finally {
      f.restaurar()
    }
  })

  it('checkout vai ao BFF com items[0] = {productCode, planId} (sem orderId)', async () => {
    const f = mockFetch({ [`${BFF}/checkout`]: { status: 200, corpo: { checkoutId: 'ck-1', status: 'PENDING' } } })
    try {
      const r = await criarCheckout('tok', [{ productCode: 'AURUM_TAX_NCM', planId: 'uuid-plano-1' }])
      expect(r.checkoutId).toBe('ck-1')
      const corpo = JSON.parse(String(f.chamadas[0].init.body))
      expect(corpo).toEqual({ items: [{ productCode: 'AURUM_TAX_NCM', planId: 'uuid-plano-1' }] })
      expect(f.chamadas[0].url).toBe(`${BFF}/checkout`)
    } finally {
      f.restaurar()
    }
  })

  it('planos vêm do Nest e só ACTIVE passa', async () => {
    const f = mockFetch({
      [`${NEST}/products/AURUM_TAX_NCM/plans`]: {
        status: 200,
        corpo: {
          plans: [
            { id: 'uuid-1', name: 'Anual', price: 1188, currency: 'BRL', interval: 'year', status: 'ACTIVE' },
            { id: 'uuid-2', name: 'Antigo', status: 'INACTIVE' },
            { id: 'uuid-3', name: 'Legado', active: false },
            { id: '', name: 'Sem id', status: 'ACTIVE' },
          ],
        },
      },
    })
    try {
      const planos = await listarPlanos('AURUM_TAX_NCM', 'tok')
      expect(f.chamadas[0].url).toBe(`${NEST}/products/AURUM_TAX_NCM/plans`)
      expect(planos).toHaveLength(1)
      expect(planos[0]).toMatchObject({ id: 'uuid-1', nome: 'Anual', preco: 1188, moeda: 'BRL', intervalo: 'year' })
    } finally {
      f.restaurar()
    }
  })

  it('planos aceitam array direto (sem envelope)', async () => {
    const f = mockFetch({
      [`${NEST}/products/AURUM_TAX_NCM/plans`]: {
        status: 200,
        corpo: [{ id: 'uuid-9', status: 'ACTIVE' }],
      },
    })
    try {
      const planos = await listarPlanos('AURUM_TAX_NCM')
      expect(planos).toHaveLength(1)
      expect(planos[0].id).toBe('uuid-9')
    } finally {
      f.restaurar()
    }
  })
})
