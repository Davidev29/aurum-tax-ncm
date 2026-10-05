/**
 * Phase 9 / 09-04 — CNPJ enriquecido (Serviços): regra sempre + NBS quando couber.
 *
 * - `0161-0/01` → 1 NBS (mapeado, ano default 2033 + ano opcional);
 * - `4322-3/03` → 98 vereditos com cache por NBS (resolvedor 1×/NBS);
 * - bens (`1011-2/01`) → `bens→NCM` + fallback Phase 7 intacto;
 * - fora-508 (`6201-5/01`) → regra + `sem-mapeamento-NBS` + fallback Phase 7.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { consultarPorCnpj } from '@/application/consultar-por-cnpj'
import {
  estatisticasCacheCnaeNbs,
  limparCacheVereditosNbs,
} from '@/domain/services/cnae-nbs'

const noop = () => undefined

const REFERENCIA = [
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200028',
    'Descrição do Código da Classificação Tributária': 'Fornecimento dos serviços de educação (Anexo II)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '2',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art129',
    'Exige Tributação': 'Sim',
    'Redução BC CST': 'Não',
    'Redução de Alíquota': 'Sim',
    'Transferência de Crédito': 'Não',
    Diferimento: 'Não',
    Monofásica: 'Não',
    'Crédito Presumido IBS Zona Franca de Manaus': 'Não',
    'Ajuste de Competência': 'Não',
    'Tributação Regular': 'Não',
    'Crédito Presumido': 'Não',
    'Estorno de Crédito': 'Não',
    'Tributação Monofásica Normal': 'Não',
    'Tributação Monofásica sujeita a retenção': 'Não',
    'Tributação Monofásica retida anteriormente': 'Não',
    'Tributação Monofásica de Combustível com diferimento': 'Não',
    NFSe: 'Sim',
  },
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '0161-0/01', 'Descrição oficial': 'Serviço de pulverização e controle de pragas agrícolas', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '4322-3/03', 'Descrição oficial': 'Instalações de sistema de prevenção contra incêndio', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '1011-2/01', 'Descrição oficial': 'Frigorífico — abate de bovinos', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
]

/** 98 NBS sintéticas (9 dígitos, sem lastro oficial — redução 0, honestas). */
const NBS_4322 = Array.from({ length: 98 }, (_, i) => `300000${String(i + 1).padStart(3, '0')}`)

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
  await db.cnaeNbs.bulkAdd([
    { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
    ...NBS_4322.map((nbs) => ({ cnae7: '4322303', cnae: '4322-3/03', nbs, fonte: 'por_codigo' as const })),
  ])
}

beforeEach(async () => {
  limparCacheBrasilApi()
  limparCacheVereditosNbs()
  await Promise.all([
    db.cnae.clear().catch(() => undefined),
    db.cnaeNbs.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.classificacoesConsolidadas.clear().catch(() => undefined),
    db.consultasCnpj.clear().catch(() => undefined),
    db.table('audit_log').clear().catch(() => undefined),
  ])
  await semear()
})

/** BrasilAPI com o principal em string de 7 dígitos (preserva o `0` inicial). */
function corpoCnpj(cnae7: string) {
  return {
    cnpj: '11222333000181',
    razao_social: 'EMPRESA EXEMPLO LTDA',
    nome_fantasia: 'EXEMPLO',
    municipio: 'FORTALEZA',
    uf: 'ce',
    cep: '60000000',
    ddd_telefone_1: '8530000000',
    email: 'a@a.com',
    cnae_fiscal: cnae7,
    cnae_fiscal_descricao: 'Atividade principal',
    cnaes_secundarios: [],
    porte: 'MICRO EMPRESA',
    descricao_situacao_cadastral: 'ATIVA',
    opcao_pelo_simples: true,
  }
}

function fetchOk(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

describe('09-04 — CNPJ enriquecido com bens e sem-link', () => {
  it('CNPJ com `0161-0/01` → regra sempre + 1 NBS (ano default 2033)', async () => {
    const v = await consultarPorCnpj('11222333000181', {
      fetchFn: fetchOk(corpoCnpj('0161001')) as unknown as typeof fetch,
    })
    expect(v.anoReferencia).toBe(2033)
    expect(v.atividades).toHaveLength(1)
    const atv = v.atividades[0]
    expect(atv.cnae7).toBe('0161001')
    // Camada 1 sempre.
    expect(atv.regras?.estado).toBe('ok')
    if (atv.regras?.estado !== 'ok') throw new Error('regra esperada')
    expect(atv.regras.anexoSimples).toEqual(['III'])
    expect(atv.regras.situacao).toBe('Permitido')
    // Camada 2: 1 NBS.
    expect(atv.estadoNbs).toBe('mapeado')
    expect(atv.nbsLista).toHaveLength(1)
    expect(atv.nbsLista[0].nbs).toBe('118032100')
    expect(atv.nbsLista[0].anoReferencia).toBe(2033)
    expect(atv.maisProvavel).toBe('118032100')
    expect(atv.nbsComBeneficio).toBe(0)
    expect(atv.anoReferencia).toBe(2033)
    // Fallback Phase 7 intacto (GATE rodou antes do enriquecimento).
    expect(['classificado', 'tributacao-integral', 'manual-obrigatorio', 'falha']).toContain(atv.estado)
  })

  it('aceita ano opcional (2027 precifica no ano certo)', async () => {
    const v = await consultarPorCnpj('11222333000181', {
      fetchFn: fetchOk(corpoCnpj('0161001')) as unknown as typeof fetch,
      anoReferencia: 2027,
    })
    const atv = v.atividades[0]
    expect(v.anoReferencia).toBe(2027)
    expect(atv.anoReferencia).toBe(2027)
    expect(atv.nbsLista[0].anoReferencia).toBe(2027)
  })

  it('`4322-3/03` → 98 vereditos com cache por NBS (resolvedor 1×/NBS)', async () => {
    const fetchFn = fetchOk(corpoCnpj('4322303')) as unknown as typeof fetch
    const v = await consultarPorCnpj('11222333000181', { fetchFn })
    const atv = v.atividades[0]
    expect(atv.estadoNbs).toBe('mapeado')
    expect(atv.nbsLista).toHaveLength(98)
    expect(atv.maisProvavel).not.toBeNull()
    expect(atv.nbsLista.map((x) => x.nbs)).toContain(atv.maisProvavel)
    // 98 NBS únicas = 98 misses (cada NBS resolveu uma única vez).
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(98)
    // 2ª consulta reaproveita o cache — zero novas resoluções.
    await consultarPorCnpj('11222333000181', { fetchFn })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(98)
    expect(estatisticasCacheCnaeNbs.acertos).toBeGreaterThan(0)
  }, 60_000)

  it('bens (`1011-2/01`) → regras + `bens→NCM`, sem NBS, fallback intacto', async () => {
    const v = await consultarPorCnpj('11222333000181', {
      fetchFn: fetchOk(corpoCnpj('1011201')) as unknown as typeof fetch,
    })
    const atv = v.atividades[0]
    expect(atv.regras?.estado).toBe('ok')
    if (atv.regras?.estado !== 'ok') throw new Error('regra esperada')
    expect(atv.regras.ehBens).toBe(true)
    expect(atv.regras.anexoSimples).toEqual(['II'])
    expect(atv.estadoNbs).toBe('bens→NCM')
    expect(atv.nbsLista).toEqual([])
    expect(atv.maisProvavel).toBeNull()
    expect(atv.nbsComBeneficio).toBe(0)
    // Fallback Phase 7: atividade segue classificada pelo GATE, nunca some.
    expect(atv.estado).not.toBe('cnae-desconhecido')
  })

  it('fora-508 (`6201-5/01`) → regra completa + `sem-mapeamento-NBS` + fallback', async () => {
    const v = await consultarPorCnpj('11222333000181', {
      fetchFn: fetchOk(corpoCnpj('6201501')) as unknown as typeof fetch,
    })
    const atv = v.atividades[0]
    expect(atv.regras?.estado).toBe('ok')
    if (atv.regras?.estado !== 'ok') throw new Error('regra esperada')
    expect(atv.regras.anexoSimples).toEqual(['III'])
    expect(atv.regras.ehBens).toBe(false)
    expect(atv.estadoNbs).toBe('sem-mapeamento-NBS')
    expect(atv.nbsLista).toEqual([])
    expect(atv.maisProvavel).toBeNull()
    // Fallback Phase 7 idêntico ao pré-Phase 9 (tributação integral, sem chute).
    expect(atv.estado).toBe('tributacao-integral')
  })
})
