/**
 * Auditoria NBS — precisão da classificação de SERVIÇOS e da ponte CNAE→NBS.
 * Casos-ouro lidos de reforma.json / nbs-nomenclatura.json / dicionario-servicos.ts.
 * Regra de ouro: todo código com benefício deve ter lastro em db.nbs; sem lastro
 * => CST 000 / cClassTrib 000001, redução 0 e nenhum NBS inventado.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { semearBaseEmbutida } from '@/infrastructure/base/base-service'
import { invalidarCacheBuscaTextoNbs } from '@/infrastructure/base/classificacao-repo'
import { limparCacheVereditosNbs } from '@/domain/services/cnae-nbs'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'
import { classificarComBuscaServicos } from '@/infrastructure/busca/classificacao-servicos-repo'
import { consultarPorCnae } from '@/application/consultar-por-cnae'

vi.mock('@/application/log-rotacao', () => ({ acrescentarLog: async () => undefined }))

const BASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'base')

beforeAll(async () => {
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async (entrada: unknown) => {
    const nome = String(entrada).replace(/^base\//, '')
    return { ok: true, status: 200, text: async () => readFileSync(path.join(BASE_DIR, nome), 'utf8') }
  }) as unknown as typeof fetch
  try {
    await semearBaseEmbutida(undefined, true)
  } finally {
    globalThis.fetch = fetchOriginal
    invalidarCacheBuscaTextoNbs()
  }
}, 120_000)

beforeEach(async () => {
  limparCacheVereditosNbs()
  invalidarCacheBuscaTextoNbs()
  await db.consultasCnpj.clear().catch(() => undefined)
})

interface CasoNbs {
  id: string
  desc: string
  nbs: string | null
  cct: string | null
  anexo: string | null
}

const CASOS: CasoNbs[] = [
  { id: 'D01', desc: 'aula de inglês online', nbs: '122.011.100', cct: '200028', anexo: 'II' },
  { id: 'D02', desc: 'formação de condutores', nbs: '122.011.100', cct: '200028', anexo: 'II' },
  { id: 'D03', desc: 'creche', nbs: '122.011.100', cct: '200028', anexo: 'II' },
  { id: 'D04', desc: 'consulta médica', nbs: '123.011.100', cct: '200029', anexo: 'III' },
  { id: 'D05', desc: 'dentista', nbs: '123.011.100', cct: '200029', anexo: 'III' },
  { id: 'D06', desc: 'cirurgia', nbs: '123.011.100', cct: '200029', anexo: 'III' },
  { id: 'D07', desc: 'exame de sangue', nbs: '123.011.100', cct: '200029', anexo: 'III' },
  { id: 'D08', desc: 'psicologia', nbs: '123.011.100', cct: '200029', anexo: 'III' },
  { id: 'D09', desc: 'show ao vivo', nbs: '111.031.000', cct: '200039', anexo: 'X' },
  { id: 'D10', desc: 'peça de teatro', nbs: '111.031.000', cct: '200039', anexo: 'X' },
  { id: 'D11', desc: 'espetáculo teatral', nbs: '101.057.000', cct: '200039', anexo: 'X' },
  { id: 'D12', desc: 'frete de mudança', nbs: null, cct: null, anexo: null },
  { id: 'D13', desc: 'transporte com tomador no exterior', nbs: null, cct: null, anexo: null },
  { id: 'D14', desc: 'construção de edificação residencial', nbs: null, cct: null, anexo: null },
  { id: 'D15', desc: 'desenvolvimento de software sob encomenda', nbs: null, cct: null, anexo: null },
  { id: 'D16', desc: 'teste de software', nbs: null, cct: null, anexo: null },
  { id: 'D17', desc: 'firewall gerenciado', nbs: '120.013.500', cct: '200043', anexo: 'XI' },
  { id: 'D18', desc: 'vigilância patrimonial', nbs: '115.012.000', cct: '200043', anexo: 'XI' },
  { id: 'D19', desc: 'fornecimento de insumos agropecuários', nbs: '111.051.000', cct: '200038', anexo: 'IX' },
  { id: 'D21', desc: '1.2302.10.00', nbs: null, cct: null, anexo: null },
  { id: 'D22', desc: '1.2701.20.00', nbs: null, cct: null, anexo: null },
  { id: 'D24', desc: '122011', nbs: null, cct: null, anexo: null },
  { id: 'D25', desc: 'serviço', nbs: null, cct: null, anexo: null },
  { id: 'D26', desc: 'nave espacial quântica', nbs: null, cct: null, anexo: null },
  { id: 'D27', desc: 'conte uma piada', nbs: null, cct: null, anexo: null },
  { id: 'D28', desc: 'receita de bolo', nbs: null, cct: null, anexo: null },
  { id: 'D29', desc: '123.012.300', nbs: '123.012.300', cct: '200029', anexo: 'III' },
  { id: 'D30', desc: '1.2502.20.00', nbs: null, cct: null, anexo: null },
]

describe('ouro NBS — classificação por descrição', () => {
  it.each(CASOS)('$id — $desc', async (c) => {
    const s = await classificarServicoPorDescricao({ descricao: c.desc })
    expect(s.nbs_provavel).toBe(c.nbs)
    expect(s.cst ?? null).toBe(c.nbs ? '200' : null)
    expect(s.cClassTrib ?? null).toBe(c.cct)
    expect(s.anexo).toBe(c.anexo)
    if (c.nbs === null) {
      expect(s.excecao_enquadravel).toBe(false)
    } else {
      expect(s.excecao_enquadravel).toBe(true)
      expect(s.nbs_provavel!.replace(/\D/g, '')).toHaveLength(9)
    }
  })

  it('aula de inglês online: trilha auditável + decisão numérica', async () => {
    const r = await classificarComBuscaServicos('aula de inglês online', { valorBase: 100 })
    expect(r).toMatchObject({ via: 'deterministico', codigoEscolhido: '122011100', regraGeral: false, confianca: 0.85 })
    expect(r.decisao?.resumo).toMatchObject({ percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: '2' })
    expect(r.sugestao.trilha.map((t) => t.etapa)).toContain('Verificação de exceções (base da Reforma)')
  })

  it.each(['frete de mudança', 'construção de edificação residencial',
    'desenvolvimento de software sob encomenda', 'nave espacial quântica'])(
    'sem lastro: %s não inventa NBS', async (desc) => {
      const s = await classificarServicoPorDescricao({ descricao: desc })
      expect(s.nbs_provavel).toBeNull()
      const r = await classificarComBuscaServicos(desc)
      expect(r).toMatchObject({ via: 'sem-resultado', codigoEscolhido: null, decisao: null, confianca: 0 })
    })

  it('fora de escopo zera campos fiscais', async () => {
    const s = await classificarServicoPorDescricao({ descricao: 'conte uma piada' })
    expect(s.foraDeEscopo).toBe(true)
    expect([s.nbs_provavel, s.cst, s.cClassTrib, s.anexo]).toEqual([null, null, null, null])
  })
})

describe('ouro NBS — ponte CNAE→NBS', () => {
  it.each([
    ['8599601', 4, '122051300', '200028', '2'],
    ['8630501', 8, '123011100', '200029', '3'],
    ['6920601', 3, '113022100', '000001', null],
    ['4930201', 7, '104011119', '000001', null],
  ] as const)('%s → %i vereditos, maisProvavel %s', async (cnae7, total, maisProvavel, cct, anexo) => {
    const c = await consultarPorCnae(cnae7, { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(total)
    expect(c.maisProvavel).toBe(maisProvavel)
    const v = c.vereditos.find((x) => x.nbs === maisProvavel)!
    expect(v).toMatchObject({ cClassTrib: cct, anexoLC214: anexo, anoReferencia: 2033 })
    if (cct === '000001') {
      expect(v).toMatchObject({ semLastro: true, reducaoIBS: 0, reducaoCBS: 0, temBeneficio: false })
    }
  })

  it('sem mapeamento / bens / desconhecido: nunca NBS inventado', async () => {
    const rest = await consultarPorCnae('5611201')
    expect(rest.estadoNbs).toBe('sem-mapeamento-NBS')
    expect(rest.vereditos).toEqual([])
    expect(rest.maisProvavel).toBeNull()

    const bens = await consultarPorCnae('1011201')
    expect(bens.estadoNbs).toBe('bens→NCM')
    expect(bens.vereditos).toEqual([])

    const ruim = await consultarPorCnae('9999-9/99')
    expect(ruim.estadoNbs).toBe('cnae-desconhecido')
    expect(ruim.maisProvavel).toBeNull()
  })

  it('resumo e coerência honestos (art. 127 é hipótese, não NBS)', async () => {
    const c = await consultarPorCnae('6920601')
    expect(c.coerencia).toBe('divergente')
    expect(c.hipoteses.map((h) => h.cClassTrib)).toContain('200052')
    expect(c.resumo).toContain('6920-6/01')
    expect(c.resumo).toContain('(ref. 2033)')
  })

  it('invariante: sem lastro nunca gera benefício', async () => {
    const c = await consultarPorCnae('4322303', { anoReferencia: 2033 })
    for (const v of c.vereditos) {
      if (v.semLastro) {
        expect(v.reducaoIBS).toBe(0)
        expect(v.reducaoCBS).toBe(0)
        expect(v.temBeneficio).toBe(false)
        expect(v.cClassTrib).toBe('000001')
      }
    }
  })
})
