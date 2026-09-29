/**
 * Tabelas CFF por DFe (permitido × negado por sistema) + vigência do cClassTrib.
 *
 * Cobre: normalizador tolerante, vigência `dIniVig/dFimVig`, mapeamento de
 * 401/403 para "certificado" e persistência do sync na store dedicada
 * (com `fetch` mockado — sem rede nos testes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sistemaDoEndpoint } from '@/domain/constants/cff-apis'
import {
  observacaoVigenciaCct,
  parseDataVigencia,
  statusVigenciaCct,
} from '@/domain/services/classificacao'
import {
  normalizarClassificacaoProduto,
} from '@/infrastructure/base/normalizacao'
import {
  importarClassificacaoProduto,
  obterBloqueiosParaCcts,
  sincronizarEndpoint,
} from '@/infrastructure/cff/cff-sync'
import { CFF_ENDPOINTS } from '@/domain/constants/cff-apis'
import { db } from '@/infrastructure/db/schema'

const HOJE = new Date(2026, 8, 29) // 29/09/2026

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.classificacaoProduto.clear()
  await db.meta.clear()
})

/* ---------------------------------------------------------- normalizador --- */

describe('normalizarClassificacaoProduto', () => {
  it('aceita array direto com flags Sim/Não e vigência', () => {
    const out = normalizarClassificacaoProduto(
      [
        { cClassTrib: '000001', descricao: 'Integral', permitido: 'Sim', dIniVig: '01/01/2026', dFimVig: '31/12/2026' },
        { cClassTrib: '200038', descricao: 'Anexo IX', permitido: 'Não' },
      ],
      'NFCom',
      '2026-09-29T00:00:00.000Z',
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({
      id: 'NFCom|000001',
      sistema: 'NFCom',
      permitido: true,
      confianca: 'explicita',
      inicioVigencia: '01/01/2026',
      fimVigencia: '31/12/2026',
    })
    expect(out[1]).toMatchObject({ id: 'NFCom|200038', permitido: false, confianca: 'explicita' })
  })

  it('aceita envelope { itens } e chaves alternativas, com presença = permitido', () => {
    const out = normalizarClassificacaoProduto(
      { itens: [{ codClassificacao: '000002', nome: 'Via', indRetencao: 1 }] },
      'NFGas',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'NFGas|000002',
      permitido: true,
      confianca: 'presenca',
      descricao: 'Via',
    })
    expect(out[0].flags).toMatchObject({ indRetencao: true })
  })

  it('nega explícito em caixa variada e ignora linha sem código', () => {
    const out = normalizarClassificacaoProduto(
      [
        { CCLASSTRIB: '000003', PERMITIDO: 'NEGADO' },
        { descricao: 'sem código' },
        { cClassTrib: '000003', permitido: 'Sim' },
      ],
      'NF3e',
    )
    // Dedup por sistema|cClassTrib: última linha vence.
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'NF3e|000003', permitido: true })
  })
})

/* --------------------------------------------------------------- sistema --- */

describe('sistemaDoEndpoint', () => {
  it('extrai NFCom/NFAg/NF3e/NFGas da URL ou metaKey', () => {
    expect(sistemaDoEndpoint('https://x/ConsultaClassificacaoProduto?sistema=NFCom', 'k')).toBe('NFCom')
    expect(sistemaDoEndpoint('https://x/classTrib', 'cff_sync_classProd_NFAg')).toBe('NFAg')
    expect(sistemaDoEndpoint('https://x/classTrib', 'cff_sync_classTrib')).toBeNull()
  })
})

/* --------------------------------------------------------------- vigencia --- */

describe('vigência do cClassTrib', () => {
  it('parseia DD/MM/AAAA e ISO', () => {
    expect(parseDataVigencia('30/09/2026')).toEqual(new Date(2026, 8, 30))
    expect(parseDataVigencia('2026-09-30T10:00:00')).toEqual(new Date(2026, 8, 30))
    expect(parseDataVigencia(null)).toBeNull()
    expect(parseDataVigencia('')).toBeNull()
    expect(parseDataVigencia('invalida')).toBeNull()
  })

  it('vigente sem datas; futura antes do início; expirada após o fim', () => {
    expect(statusVigenciaCct(null, null, HOJE)).toBe('vigente')
    expect(statusVigenciaCct('01/10/2026', null, HOJE)).toBe('futura')
    expect(statusVigenciaCct(null, '30/09/2026', new Date(2026, 9, 1))).toBe('expirada')
    expect(statusVigenciaCct('01/01/2026', '31/12/2026', HOJE)).toBe('vigente')
  })

  it('observação nula quando vigente; amber/red caso contrário', () => {
    const base = { cClassTrib: '000001', inicioVigencia: null, fimVigencia: null }
    expect(observacaoVigenciaCct(base, HOJE)).toBeNull()
    expect(observacaoVigenciaCct(null, HOJE)).toBeNull()
    const fut = observacaoVigenciaCct({ ...base, inicioVigencia: '01/01/2027' }, HOJE)
    expect(fut?.cor).toBe('amber')
    expect(fut?.titulo).toContain('01/01/2027')
    const exp = observacaoVigenciaCct({ ...base, fimVigencia: '30/09/2026' }, new Date(2026, 9, 1))
    expect(exp?.cor).toBe('red')
    expect(exp?.titulo).toContain('30/09/2026')
  })
})

/* ------------------------------------------------------------------- sync --- */

const endpointNFCom = CFF_ENDPOINTS.find((e) => e.metaKey === 'cff_sync_classProd_NFCom')!

describe('sincronizarEndpoint (classProd)', () => {
  it('persiste linhas normalizadas e conta negados', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { cClassTrib: '000001', descricao: 'Integral', permitido: 'Sim' },
            { cClassTrib: '200038', descricao: 'Anexo IX', permitido: 'Não' },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    const r = await sincronizarEndpoint(endpointNFCom)
    expect(r.status).toBe('atualizado')
    expect(r.registros).toBe(2)

    const linhas = await db.classificacaoProduto.where('sistema').equals('NFCom').toArray()
    expect(linhas).toHaveLength(2)
    const meta = await db.meta.get(endpointNFCom.metaKey)
    expect((meta?.valor as { totalNegados?: number })?.totalNegados).toBe(1)

    const bloqueios = await obterBloqueiosParaCcts(['000001', '200038'])
    expect(bloqueios['200038']?.[0]).toMatchObject({ sistema: 'NFCom', permitido: false })
    expect(bloqueios['000001']?.[0]).toMatchObject({ sistema: 'NFCom', permitido: true })
  })

  it('403 vira status certificado com meta precisaCert (sem apagar base válida)', async () => {
    await importarClassificacaoProduto('NFCom', [{ cClassTrib: '000001', permitido: 'Sim' }])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))

    const r = await sincronizarEndpoint(endpointNFCom)
    expect(r.status).toBe('certificado')
    expect(r.mensagem).toMatch(/certificado digital/i)

    // Linhas válidas preservadas; meta marca a tentativa bloqueada.
    expect(await db.classificacaoProduto.where('sistema').equals('NFCom').count()).toBe(1)
    const meta = await db.meta.get(endpointNFCom.metaKey)
    expect((meta?.valor as { precisaCert?: boolean })?.precisaCert).toBe(true)
  })
})
