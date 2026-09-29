/**
 * Sincronização da NCM vigente (Portal Único Siscomex).
 *
 * Cobre: diff novos/alterados/extintos, hash canônico (cabeçalho ignorado),
 * marcação de extinto sem apagar, erro preservando a base e importação manual.
 * Rede mockada — sem chamadas ao portal nos testes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  aplicarTabelaNcm,
  buscarTabelaNcm,
  importarTabelaNcmJson,
  obterStatusNcm,
  sincronizarNomenclatura,
} from '@/infrastructure/siscomex/ncm-sync'
import { SISCOMEX_NCM_META_KEY } from '@/domain/constants/siscomex-apis'
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

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.ncmNomenclatura.clear()
  await db.meta.clear()
})

describe('sincronizarNomenclatura', () => {
  it('aplica diff: novos entram, alterados atualizam, sumidos viram extintos', async () => {
    await db.ncmNomenclatura.bulkPut([
      NCM('02011000', 'Carcaças de bovino'),
      NCM('02012000', 'Peças de bovino'),
      NCM('03011100', 'Peixe ornamental'),
    ])

    vi.stubGlobal(
      'fetch',
      fetchJson(
        REMOTO([
          LINHA('0201.10.00', 'Carcaças de bovino'),
          LINHA('0201.20.00', 'Peças de bovino, frescas'), // descrição mudou
          LINHA('0401.10.00', 'Leite'), // novo
          // 03011100 sumiu → extinto
        ]),
      ),
    )

    const r = await sincronizarNomenclatura()
    expect(r.status).toBe('atualizado')
    expect(r.novos).toBe(1)
    expect(r.alterados).toBe(1)
    expect(r.extintos).toBe(1)
    expect(r.total).toBe(4)

    const extinto = await db.ncmNomenclatura.get('03011100')
    expect(extinto?.dataFim).toBe('Vigente em 29/09/2026')
    expect(extinto?.atoFim).toBe('Resolução Gecex nº 926/2026')
    expect(await db.ncmNomenclatura.get('04011000')).toMatchObject({ descricao: 'Leite' })
    expect(await db.ncmNomenclatura.get('02012000')).toMatchObject({ descricao: 'Peças de bovino, frescas' })

    const meta = await db.meta.get(SISCOMEX_NCM_META_KEY)
    expect((meta?.valor as { vigencia?: string })?.vigencia).toBe('Vigente em 29/09/2026')
  })

  it('conteúdo idêntico com rótulo novo = inalterado (sem churn)', async () => {
    await db.ncmNomenclatura.bulkPut([NCM('02011000', 'Carcaças de bovino')])
    const linhas = [LINHA('0201.10.00', 'Carcaças de bovino')]

    vi.stubGlobal('fetch', fetchJson(REMOTO(linhas, 'Vigente em 22/09/2026')))
    const r1 = await sincronizarNomenclatura()
    expect(r1.status).toBe('atualizado')

    vi.stubGlobal('fetch', fetchJson(REMOTO(linhas, 'Vigente em 29/09/2026')))
    const r2 = await sincronizarNomenclatura()
    expect(r2.status).toBe('inalterado')
    expect(r2.mensagem).toMatch(/idêntica/i)
    // Rótulo de vigência acompanha mesmo sem mudança de conteúdo.
    expect(r2.vigencia).toBe('Vigente em 29/09/2026')
    expect(await db.ncmNomenclatura.count()).toBe(1)
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
