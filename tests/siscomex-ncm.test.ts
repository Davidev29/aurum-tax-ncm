/**
 * Sincronização da NCM vigente (Portal Único Siscomex).
 *
 * Cobre: diff novos/alterados/extintos, hash canônico (cabeçalho ignorado),
 * marcação de extinto sem apagar, erro preservando a base e importação manual.
 * Rede mockada — sem chamadas ao portal nos testes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  aplicarTabelaNcm,
  buscarTabelaNcm,
  classificarErroRede,
  diagnosticarConexaoNcm,
  importarTabelaNcmJson,
  obterStatusNcm,
  sincronizarNomenclatura,
} from '@/infrastructure/siscomex/ncm-sync'
import { SISCOMEX_NCM_META_KEY, SISCOMEX_SYNC_CONFIG } from '@/domain/constants/siscomex-apis'
import { db } from '@/infrastructure/db/schema'
import type { NomenclaturaNcm } from '@/domain/entities'

const NCM = (
  codigo: string,
  descricao: string,
  extra?: Partial<NomenclaturaNcm>,
): NomenclaturaNcm => ({
  codigo,
  codigoOriginal: `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 8)}`,
  descricao,
  dataInicio: '01/04/2022',
  dataFim: null,
  ato: 'Res Gecex 272/2021',
  atoFim: null,
  ...extra,
})

const LINHA = (codigo: string, descricao: string, fim = '31/12/9999') => ({
  Codigo: codigo,
  Descricao: descricao,
  Data_Inicio: '01/04/2022',
  Data_Fim: fim,
  Tipo_Ato_Ini: 'Res Gecex',
  Numero_Ato_Ini: '272',
  Ano_Ato_Ini: '2021',
})

const REMOTO = (linhas: unknown[], vigencia = 'Vigente em 29/09/2026', ato = 'Resolução Gecex nº 926/2026') => ({
  Data_Ultima_Atualizacao_NCM: vigencia,
  Ato: ato,
  Nomenclaturas: linhas,
})

const fetchJson = (json: unknown, status = 200) =>
  vi.fn(async () =>
    new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }),
  )

/**
 * Enchimento para passar o piso de sanidade (tabela parcial é recusada).
 * 1000 linhas idênticas dos dois lados: não afetam novos/alterados/extintos.
 */
const PAD_N = 1000
const padCodigo = (i: number) => `98${String(i).padStart(4, '0')}`
const padLocal = (): NomenclaturaNcm[] =>
  Array.from({ length: PAD_N }, (_, i) => NCM(padCodigo(i), `Pad ${i}`))
const padRemoto = (): unknown[] =>
  Array.from({ length: PAD_N }, (_, i) => LINHA(padCodigo(i), `Pad ${i}`))

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.ncmNomenclatura.clear()
  await db.meta.clear()
})

// Retry de 10s estouraria o timeout do vitest — zera só nestes testes.
const RETRY_ORIGINAL = SISCOMEX_SYNC_CONFIG.retryDelay
beforeAll(() => {
  ;(SISCOMEX_SYNC_CONFIG as { retryDelay: number }).retryDelay = 0
})
afterAll(() => {
  ;(SISCOMEX_SYNC_CONFIG as { retryDelay: number }).retryDelay = RETRY_ORIGINAL
})

describe('sincronizarNomenclatura', () => {
  it('aplica diff: novos entram, alterados atualizam, sumidos viram extintos', async () => {
    await db.ncmNomenclatura.bulkPut([
      NCM('02011000', 'Carcaças de bovino'),
      NCM('02012000', 'Peças de bovino'),
      NCM('03011100', 'Peixe ornamental'),
      ...padLocal(),
    ])

    vi.stubGlobal(
      'fetch',
      fetchJson(
        REMOTO([
          LINHA('0201.10.00', 'Carcaças de bovino'),
          LINHA('0201.20.00', 'Peças de bovino, frescas'), // descrição mudou
          LINHA('0401.10.00', 'Leite'), // novo
          // 03011100 sumiu → extinto
          ...padRemoto(),
        ]),
      ),
    )

    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('atualizado')
    expect(r.novos).toBe(1)
    expect(r.alterados).toBe(1)
    expect(r.extintos).toBe(1)
    expect(r.total).toBe(PAD_N + 4)

    const extinto = await db.ncmNomenclatura.get('03011100')
    expect(extinto?.dataFim).toBe('Vigente em 29/09/2026')
    expect(extinto?.atoFim).toBe('Resolução Gecex nº 926/2026')
    expect(await db.ncmNomenclatura.get('04011000')).toMatchObject({ descricao: 'Leite' })
    expect(await db.ncmNomenclatura.get('02012000')).toMatchObject({ descricao: 'Peças de bovino, frescas' })

    const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
    expect((meta?.valor as { vigencia?: string })?.vigencia).toBe('Vigente em 29/09/2026')
  })

  it('conteúdo idêntico com rótulo novo = inalterado (sem churn)', async () => {
    await db.ncmNomenclatura.bulkPut([NCM('02011000', 'Carcaças de bovino'), ...padLocal()])
    const linhas = [LINHA('0201.10.00', 'Carcaças de bovino'), ...padRemoto()]

    vi.stubGlobal('fetch', fetchJson(REMOTO(linhas, 'Vigente em 22/09/2026')))
    const r1 = await sincronizarNomenclatura()
    expect(r1.status).toBe('atualizado')

    vi.stubGlobal('fetch', fetchJson(REMOTO(linhas, 'Vigente em 29/09/2026')))
    const r2 = await sincronizarNomenclatura()
    expect(r2.status).toBe('inalterado')
    expect(r2.mensagem).toMatch(/idêntica/i)
    // Rótulo de vigência acompanha mesmo sem mudança de conteúdo.
    expect(r2.vigencia).toBe('Vigente em 29/09/2026')
    expect(await db.ncmNomenclatura.count()).toBe(PAD_N + 1)
  })

  it('erro de rede preserva a base e registra ultimoErro', async () => {
    await db.ncmNomenclatura.bulkPut([NCM('02011000', 'Carcaças de bovino')])
    vi.stubGlobal('fetch', fetchJson({ erro: true }, 500))

    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('erro')
    expect(r.mensagem).toMatch(/HTTP 500/)
    expect(await db.ncmNomenclatura.count()).toBe(1)

    const st = await obterStatusNcm()
    expect(st.status).toBe('erro')
    expect(st.ultimoErro).toMatch(/HTTP 500/)
  })

  it('429 vira mensagem de rate-limit em pt-BR', async () => {
    vi.stubGlobal('fetch', fetchJson({}, 429))
    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('erro')
    expect(r.mensagem).toMatch(/taxa/i)
    expect(r.codigoErro).toBe('limite')
  })

  it('429 com Retry-After informa o tempo de espera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } })),
    )
    const r = await sincronizarNomenclatura()
    expect(r.codigoErro).toBe('limite')
    expect(r.mensagem).toMatch(/120s/)
  })

  it('403 vira orientação de importação manual (filtro de rede/WAF)', async () => {
    vi.stubGlobal('fetch', fetchJson({}, 403))
    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('erro')
    expect(r.codigoErro).toBe('http')
    expect(r.mensagem).toMatch(/manual/i)
  })

  it('500 tenta de novo e recupera; base preservada se tudo falhar', async () => {
    await db.ncmNomenclatura.bulkPut([NCM('02011000', 'Carcaças de bovino'), ...padLocal()])
    const linhas = [LINHA('0201.10.00', 'Carcaças de bovino'), ...padRemoto()]
    let chamadas = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        chamadas++
        if (chamadas === 1) return new Response('{}', { status: 500 })
        return new Response(JSON.stringify(REMOTO(linhas)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const r = await sincronizarNomenclatura()
    expect(chamadas).toBeGreaterThan(1)
    // Primeira sincronização (sem hash anterior): aplica o conteúdo idêntico.
    expect(r.status).toBe('atualizado')
    expect(r.novos).toBe(0)
    expect(r.extintos).toBe(0)
    expect(await db.ncmNomenclatura.count()).toBe(PAD_N + 1)
  })

  it('falha na primeira URL tenta a segunda (fallback ?perfil=PUBLICO)', async () => {
    const urls: string[] = []
    const linhas = [LINHA('0201.10.00', 'Carcaças'), ...padRemoto()]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        urls.push(String(input))
        if (urls.length === 1) throw new TypeError('Failed to fetch')
        return new Response(JSON.stringify(REMOTO(linhas)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('atualizado')
    expect(urls.length).toBeGreaterThan(1)
    expect(urls[1]).toContain('perfil=PUBLICO')
  })

  it('timeout vira codigo timeout com orientação', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const e = new DOMException('The operation was aborted.', 'AbortError')
        throw e
      }),
    )
    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('erro')
    expect(r.codigoErro).toBe('timeout')
  })
})

describe('classificarErroRede', () => {
  it('distingue timeout, TLS e rede/DNS', () => {
    expect(classificarErroRede(new DOMException('aborted', 'AbortError')).codigo).toBe('timeout')
    expect(classificarErroRede(new TypeError('Failed to fetch')).codigo).toBe('rede')
    expect(classificarErroRede(new Error('unable to verify the first certificate')).codigo).toBe('tls')
    expect(classificarErroRede(new Error('EAI_AGAIN portalunico')).codigo).toBe('rede')
  })
})

describe('diagnosticarConexaoNcm', () => {
  const tabelaCheia = () =>
    REMOTO(
      Array.from({ length: 1001 }, (_, i) => LINHA(`0101.${String(i % 100).padStart(2, '0')}.00`, `Item ${i}`)),
    )

  it('ok quando o portal responde a tabela oficial completa', async () => {
    vi.stubGlobal('fetch', fetchJson(tabelaCheia()))
    const d = await diagnosticarConexaoNcm()
    expect(d.ok).toBe(true)
    expect(d.etapas.map((e) => e.etapa)).toEqual(['Alcance', 'HTTP', 'Corpo', 'JSON'])
    expect(d.etapas.every((e) => e.ok)).toBe(true)
  })

  it('falha classificada quando a rede bloqueia', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const d = await diagnosticarConexaoNcm()
    expect(d.ok).toBe(false)
    expect(d.etapas[0].ok).toBe(false)
    expect(d.resumo).toMatch(/proxy\/firewall|Sem acesso/i)
  })

  it('tabela parcial é recusada no diagnóstico', async () => {
    vi.stubGlobal('fetch', fetchJson(REMOTO([LINHA('0201.10.00', 'Carcaças')])))
    const d = await diagnosticarConexaoNcm()
    expect(d.ok).toBe(false)
    expect(d.etapas.find((e) => e.etapa === 'JSON')?.ok).toBe(false)
    expect(d.resumo).toMatch(/parcial/i)
  })

  it('buscarTabelaNcm recusa tabela parcial (não marca extintos por engano)', async () => {
    vi.stubGlobal('fetch', fetchJson(REMOTO([LINHA('0201.10.00', 'Carcaças')])))
    await expect(buscarTabelaNcm()).rejects.toThrow(/incompleta/i)
    expect(await db.ncmNomenclatura.count()).toBe(0)
  })
})
describe('buscarTabelaNcm', () => {
  it('rejeita payload sem Nomenclaturas', async () => {
    vi.stubGlobal('fetch', fetchJson({ Data_Ultima_Atualizacao_NCM: 'x' }))
    await expect(buscarTabelaNcm()).rejects.toThrow(/formato inesperado/i)
  })
})

describe('importarTabelaNcmJson', () => {
  it('usa o mesmo pipeline do sync (manual cobre o blob baixado)', async () => {
    const r = await importarTabelaNcmJson(REMOTO([LINHA('0201.10.00', 'Carcaças de bovino')]))
    expect(r.status).toBe('atualizado')
    expect(r.total).toBe(1)
    expect(await db.ncmNomenclatura.count()).toBe(1)
  })

  it('rejeita arquivo fora do formato oficial', async () => {
    const r = await importarTabelaNcmJson({ foo: 1 })
    expect(r.status).toBe('erro')
    expect(r.mensagem).toMatch(/Nomenclaturas/)
  })
})

describe('aplicarTabelaNcm', () => {
  it('preserva extinto já marcado quando o remoto continua sem ele', async () => {
    await db.ncmNomenclatura.bulkPut([
      NCM('03011100', 'Peixe ornamental', { dataFim: 'Vigente em 20/09/2026', atoFim: 'Resolução Gecex nº 900/2026' }),
    ])
    const diff = await aplicarTabelaNcm(
      REMOTO([LINHA('0201.10.00', 'Carcaças')]),
      'Vigente em 29/09/2026',
      'Resolução Gecex nº 926/2026',
      'hash-teste',
    )
    expect(diff.extintos).toBe(0) // já estava extinto — não conta de novo
    const mantido = await db.ncmNomenclatura.get('03011100')
    expect(mantido?.dataFim).toBe('Vigente em 20/09/2026')
  })
})
