/**
 * Phase 9 / 09-02 — motor CNAE → NBS em duas camadas + ano + cache por NBS.
 *
 * Fixtures mínimos semeados via `importarBase` (padrão Phase 7) + links
 * `db.cnaeNbs` diretos. NBS sem vínculo oficial cai na regra geral
 * (`semLastro: true`, redução 0 — nunca redução inventada).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { REF_DEFAULT } from '@/domain/constants'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import {
  ANO_REFERENCIA_PADRAO,
  BASE_OPERACAO_NBS,
  CBS_REF_PADRAO,
  DIVISOES_BENS,
  LIMIAR_AMBIGUIDADE_NBS,
  cacheVereditosNbs,
  escolherClassificacaoPrimaria,
  enriquecerNbsDoCnae,
  estatisticasCacheCnaeNbs,
  limparCacheVereditosNbs,
  ranquearNbs,
  refPorAno,
  regrasDoCnae,
  vereditoPorNbs,
  type RegraCnaeOk,
} from '@/domain/services/cnae-nbs'
import { consultarPorCnae, resumirCnae } from '@/application/consultar-por-cnae'

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
    NFe: 'Não',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  },
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200039',
    'Descrição do Código da Classificação Tributária': 'Serviços culturais e artísticos (Anexo X)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '10',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art141',
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
    NFe: 'Não',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  },
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 60, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
  { NBS: '125011100', CST: '200', CclassTrib: '200039', 'Base Legal': 'Serviços culturais (Anexo X)', Redução: 60, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços culturais e artísticos do Anexo X.' },
]

const CNAE_VIVO = [
  { CNAE: '0161-0/01', 'Descrição oficial': 'Serviço de pulverização e controle de pragas agrícolas', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '0162-8/99', 'Descrição oficial': 'Atividades de apoio à pecuária não especificadas anteriormente', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '4322-3/03', 'Descrição oficial': 'Instalações de sistema de prevenção contra incêndio', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '1011-2/01', 'Descrição oficial': 'Frigorífico — abate de bovinos', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '8511-2/00', 'Descrição oficial': 'Educação infantil — creche', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '1340-5/01', 'Descrição oficial': 'Estamparia e texturização em fios, tecidos e artigos têxteis', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
]

/** 24 NBS sintéticas (9 dígitos) + a compartilhada `118032100` = 25. */
const NBS_0162 = [...Array.from({ length: 24 }, (_, i) => `2000000${String(i + 1).padStart(2, '0')}`), '118032100']
/** 98 NBS sintéticas. */
const NBS_4322 = Array.from({ length: 98 }, (_, i) => `300000${String(i + 1).padStart(3, '0')}`)

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
  await db.cnaeNbs.bulkAdd([
    { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
    ...NBS_0162.map((nbs) => ({ cnae7: '0162899', cnae: '0162-8/99', nbs, fonte: 'por_codigo' as const })),
    ...NBS_4322.map((nbs) => ({ cnae7: '4322303', cnae: '4322-3/03', nbs, fonte: 'por_codigo' as const })),
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '125011100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011200', fonte: 'por_codigo' },
    { cnae7: '1340501', cnae: '1340-5/01', nbs: '114056000', fonte: 'por_codigo' },
  ])
}

beforeEach(async () => {
  limparCacheVereditosNbs()
  await Promise.all([
    db.cnae.clear().catch(() => undefined),
    db.cnaeNbs.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.classificacoesConsolidadas.clear().catch(() => undefined),
    db.table('audit_log').clear().catch(() => undefined),
  ])
  await semear()
})

/* ------------------------------------------------- camada 1: regrasDoCnae --- */

describe('camada 1 — regrasDoCnae (sempre retorna regra)', () => {
  it('0161-0/01: Anexo Simples III, Permitido, vedação textual, 1 NBS, não é bens', async () => {
    const r = await regrasDoCnae('0161-0/01')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(r.cnae7).toBe('0161001')
    expect(r.codigoFormatado).toBe('0161-0/01')
    expect(r.anexoSimples).toEqual(['III'])
    expect(r.rotuloAnexo).toBe('Anexo Simples III')
    expect(r.situacao).toBe('Permitido')
    expect(r.fatorR).toBe(false)
    expect(r.vedacaoTextual.length).toBeGreaterThan(0)
    expect(r.temMapeamentoNbs).toBe(true)
    expect(r.totalNbs).toBe(1)
    expect(r.ehBens).toBe(false)
  })

  it('bens 1011-2/01 (divisão 10, sem links): regra completa + ehBens', async () => {
    const r = await regrasDoCnae('1011201')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(r.anexoSimples).toEqual(['II'])
    expect(r.rotuloAnexo).toBe('Anexo Simples II')
    expect(r.vedacaoTextual.length).toBeGreaterThan(0)
    expect(r.temMapeamentoNbs).toBe(false)
    expect(r.totalNbs).toBe(0)
    expect(r.ehBens).toBe(true)
  })

  it('indústria COM link (1340-5/01, facção) NÃO é bens — segue enriquecimento', async () => {
    const r = await regrasDoCnae('1340-5/01')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(r.ehBens).toBe(false)
    expect(r.temMapeamentoNbs).toBe(true)
    expect(r.totalNbs).toBe(1)
  })

  it('serviço fora dos 508 (6201-5/01): regra ok, sem bens, sem mapeamento', async () => {
    const r = await regrasDoCnae('6201501')
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(r.ehBens).toBe(false)
    expect(r.temMapeamentoNbs).toBe(false)
    expect(r.anexoSimples).toEqual(['III'])
  })

  it('CNAE inexistente → cnae-desconhecido (manual), nunca `sem regra`', async () => {
    for (const bruto of ['9999-9/99', 'ABC', '']) {
      const r = await regrasDoCnae(bruto)
      expect(r.estado).toBe('cnae-desconhecido')
      if (r.estado === 'cnae-desconhecido') expect(r.mensagem.length).toBeGreaterThan(0)
    }
  })

  it('máscara `0161-0/01` ≡ dígitos `0161001`', async () => {
    const a = await regrasDoCnae('0161-0/01')
    const b = await regrasDoCnae('0161001')
    expect(a).toEqual(b)
  })

  it('divisões de bens cobrem C/10–33 e G/45–47', () => {
    expect(DIVISOES_BENS.has('10')).toBe(true)
    expect(DIVISOES_BENS.has('33')).toBe(true)
    expect(DIVISOES_BENS.has('45')).toBe(true)
    expect(DIVISOES_BENS.has('47')).toBe(true)
    expect(DIVISOES_BENS.has('62')).toBe(false)
    expect(DIVISOES_BENS.has('85')).toBe(false)
  })
})

/* ------------------------------------------------- refPorAno --- */

describe('refPorAno (ano explícito, REF_DEFAULT intacto)', () => {
  it('2026 → ano-teste 0,1% + 0,1%', () => {
    expect(refPorAno(2026)).toMatchObject({ refIBS: 0.1, refCBS: 0.1, emTransicao: false })
  })

  it('2027 → IBS teste + CBS plena 8,8%', () => {
    expect(refPorAno(2027)).toMatchObject({ refIBS: 0.1, refCBS: CBS_REF_PADRAO, emTransicao: false })
    expect(CBS_REF_PADRAO).toBe(8.8)
  })

  it('2033 → REF_DEFAULT {19, 9} (fixo, nunca muda)', () => {
    expect(REF_DEFAULT).toEqual({ IBS: 19, CBS: 9 })
    expect(refPorAno(2033)).toMatchObject({ refIBS: 19, refCBS: 9, emTransicao: false })
    expect(refPorAno(ANO_REFERENCIA_PADRAO)).toMatchObject({ refIBS: REF_DEFAULT.IBS, refCBS: REF_DEFAULT.CBS })
  })

  it('2030 (transição) → valores 2033 + flag, nunca número inventado', () => {
    const r = refPorAno(2030)
    expect(r.emTransicao).toBe(true)
    expect(r.refIBS).toBe(REF_DEFAULT.IBS)
    expect(r.refCBS).toBe(REF_DEFAULT.CBS)
  })

  it('consultarPorCnae sem ano usa 2033 por padrão', async () => {
    const c = await consultarPorCnae('0161-0/01')
    expect(c.anoReferencia).toBe(2033)
    expect(c.emTransicao).toBe(false)
    expect(c.vereditos[0]?.anoReferencia).toBe(2033)
  })
})

/* ------------------------------------------------- camada 2: enriquecimento --- */

describe('camada 2 — enriquecimento NBS (só 508, via resolvedor)', () => {
  it('0161-0/01 → 1 veredito com ano; sem vínculo oficial = semLastro, redução 0', async () => {
    const c = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(1)
    const v = c.vereditos[0]
    expect(v.nbs).toBe('118032100')
    expect(v.anoReferencia).toBe(2033)
    expect(v.semLastro).toBe(true)
    expect(v.reducaoIBS).toBe(0)
    expect(v.reducaoCBS).toBe(0)
    expect(v.temBeneficio).toBe(false)
    expect(v.cst).toBe('000')
    expect(v.cClassTrib).toBe('000001')
    expect(c.ambiguo).toBe(false)
  })

  it('0162-8/99 → 25 vereditos ranqueados, ambíguo', async () => {
    const c = await consultarPorCnae('0162-8/99', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(25)
    expect(c.ranking).toHaveLength(25)
    expect(c.ambiguo).toBe(true)
    expect(c.maisProvavel).toBe(c.ranking[0].nbs)
    // Ranking ordenado por score desc (empate: menor NBS).
    const scores = c.ranking.map((r) => r.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('4322-3/03 → 98 com maisProvavel destacado; sem lastro nunca tem redução', async () => {
    const c = await consultarPorCnae('4322-3/03', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(98)
    expect(c.maisProvavel).toBe(c.ranking[0].nbs)
    expect(c.ambiguo).toBe(true)
    expect(c.vereditos.every((v) => v.semLastro)).toBe(true)
    expect(c.vereditos.every((v) => v.reducaoIBS === 0 && v.reducaoCBS === 0)).toBe(true)
  }, 60_000)

  it('educação 8511-2/00 → veredito com benefício do resolvedor (60%, anexo LC 2)', async () => {
    const c = await consultarPorCnae('8511-2/00', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(3)
    const edu = c.vereditos.find((v) => v.nbs === '122011100')
    expect(edu).toMatchObject({
      temBeneficio: true,
      semLastro: false,
      reducaoIBS: 60,
      reducaoCBS: 60,
      cst: '200',
      cClassTrib: '200028',
      anexoLC214: '2',
    })
    expect(edu?.baseLegal).toContain('Anexo II')
    expect(edu?.calculo.base).toBe(BASE_OPERACAO_NBS)
    // NBS sem vínculo na mesma consulta segue honesta (sem lastro, sem benefício).
    const sem = c.vereditos.find((v) => v.nbs === '122011200')
    expect(sem).toMatchObject({ semLastro: true, temBeneficio: false })
    // Coerência reaproveitada da Phase 7: decisão entre as hipóteses.
    expect(c.coerencia).toBe('coerente')
  })

  it('bens → badge bens→NCM distinto, sem chamar o resolvedor', async () => {
    estatisticasCacheCnaeNbs.resolvidas = 0
    const c = await consultarPorCnae('1011-2/01', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('bens→NCM')
    expect(c.vereditos).toEqual([])
    expect(c.maisProvavel).toBeNull()
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(0)
    expect(c.resumo).toContain('bens')
    expect(c.resumo).toContain('NCM')
  })

  it('fora dos 508 → regra completa + sem-mapeamento-NBS + fallback Phase 7', async () => {
    const c = await consultarPorCnae('6201-5/01', { anoReferencia: 2033 })
    expect(c.regra.estado).toBe('ok')
    expect(c.estadoNbs).toBe('sem-mapeamento-NBS')
    expect(c.vereditos).toEqual([])
    if (c.regra.estado !== 'ok') throw new Error('regra esperada')
    expect(c.regra.anexoSimples).toEqual(['III'])
    expect(c.resumo).toContain('6201-5/01')
  })

  it('enriquecerNbsDoCnae com bens retorna bens→NCM sem tocar no resolvedor', async () => {
    const regra = await regrasDoCnae('1011-2/01')
    if (regra.estado !== 'ok') throw new Error('regra esperada')
    estatisticasCacheCnaeNbs.resolvidas = 0
    const enr = await enriquecerNbsDoCnae(regra, { anoReferencia: 2033 })
    expect(enr.estadoNbs).toBe('bens→NCM')
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(0)
  })
})

/* ------------------------------------------------- cache POR NBS --- */

describe('cache de veredito POR NBS (chave nbs+ano)', () => {
  it('2ª consulta do mesmo NBS não re-chama o resolvedor', async () => {
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    expect(estatisticasCacheCnaeNbs.acertos).toBeGreaterThan(0)
    expect(cacheVereditosNbs.has('118032100|2033')).toBe(true)
  })

  it('NBS compartilhado entre CNAEs resolve uma vez (cache por NBS, não por CNAE)', async () => {
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    await consultarPorCnae('0162-8/99', { anoReferencia: 2033 })
    // 1 (0161) + 24 novas (0162 compartilha `118032100`) = 25, não 26.
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(25)
  })

  it('ano diferente = chave diferente (re-resolve e precifica no ano certo)', async () => {
    const a = await consultarPorCnae('0161-0/01', { anoReferencia: 2026 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    const b = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(2)
    expect(a.vereditos[0].anoReferencia).toBe(2026)
    expect(b.vereditos[0].anoReferencia).toBe(2033)
    expect(a.vereditos[0].calculo.total).not.toBe(b.vereditos[0].calculo.total)
  })

  it('vereditoPorNbs direto usa o mesmo cache', async () => {
    const v1 = await vereditoPorNbs('118032100', 2033)
    const v2 = await vereditoPorNbs('118032100', 2033)
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    expect(v1).toBe(v2)
    await expect(vereditoPorNbs('123')).rejects.toThrow()
  })
})

/* ------------------------------------------------- anos precificam diferente --- */

describe('anos 2026/2027/2033 precificam diferente (com benefício real)', () => {
  it('totais 2026 < 2027 < 2033 para o NBS de educação (red. 60%)', async () => {
    const t = async (ano: number) =>
      (await consultarPorCnae('8511-2/00', { anoReferencia: ano })).vereditos.find(
        (v) => v.nbs === '122011100',
      )?.calculo.total
    const t2026 = await t(2026)
    const t2027 = await t(2027)
    const t2033 = await t(2033)
    expect(new Set([t2026, t2027, t2033]).size).toBe(3)
    expect(t2026).toBeLessThan(t2027 ?? 0)
    expect(t2027).toBeLessThan(t2033 ?? 0)
  })

  it('ano em transição (2030) precifica como 2033 mas carimba o flag', async () => {
    const c = await consultarPorCnae('8511-2/00', { anoReferencia: 2030 })
    expect(c.emTransicao).toBe(true)
    const v = c.vereditos.find((x) => x.nbs === '122011100')
    expect(v?.emTransicao).toBe(true)
    const pleno = await consultarPorCnae('8511-2/00', { anoReferencia: 2033 })
    const vp = pleno.vereditos.find((x) => x.nbs === '122011100')
    expect(v?.calculo.total).toBe(vp?.calculo.total)
  })
})

/* ------------------------------------------------- ranking puro --- */

describe('ranquearNbs (puro: setor + teto + benefício)', () => {
  const itens = [
    { nbs: '125011100', descricao: 'Serviços culturais e artísticos', cct: '200039', temBeneficio: true },
    { nbs: '122011100', descricao: 'Serviços de educação', cct: '200028', temBeneficio: true },
    { nbs: '999999999', descricao: 'Serviços genéricos sem lastro', cct: '000001', temBeneficio: false },
  ]

  it('pin curado + palavra-chave do setor vencem (educação 85 → 122011100)', () => {
    const r = ranquearNbs('8511200', 'Permitido', itens)
    expect(r.maisProvavel).toBe('122011100')
    expect(r.ranking[0].score).toBeGreaterThan(r.ranking[1].score)
    expect(r.ambiguo).toBe(false)
  })

  it('teto da Situação pondera: `Depende da atividade` zera a âncora', () => {
    const ok = ranquearNbs('8511200', 'Permitido', itens)
    const dep = ranquearNbs('8511200', 'Depende da atividade', itens)
    expect(dep.ranking[0].score).toBeLessThan(ok.ranking[0].score)
    expect(dep.maisProvavel).toBe(ok.maisProvavel)
  })

  it(`acima de ${LIMIAR_AMBIGUIDADE_NBS} candidatas → ambiguo`, () => {
    const muitas = Array.from({ length: LIMIAR_AMBIGUIDADE_NBS + 1 }, (_, i) => ({
      nbs: `40000000${i}`,
      descricao: null,
      cct: null,
      temBeneficio: false,
    }))
    expect(ranquearNbs('4322303', 'Permitido', muitas).ambiguo).toBe(true)
    expect(ranquearNbs('4322303', 'Permitido', []).maisProvavel).toBeNull()
  })

  it('escolherClassificacaoPrimaria pega o maior benefício (empate: primeira)', async () => {
    const { resolverClassificacoesNbs } = await import('@/infrastructure/base/classificacao-repo')
    const r = await resolverClassificacoesNbs('122011100')
    expect(escolherClassificacaoPrimaria(r.lista)?.cClassTrib).toBe('200028')
    expect(escolherClassificacaoPrimaria([])).toBeNull()
  })
})

/* ------------------------------------------------- orquestração + auditoria --- */

describe('consultarPorCnae (orquestração)', () => {
  it('cnae-desconhecido via orquestrador + resumo honesto', async () => {
    const c = await consultarPorCnae('9999-9/99')
    expect(c.estadoNbs).toBe('cnae-desconhecido')
    expect(c.vereditos).toEqual([])
    expect(c.resumo).toContain('desconhecido')
  })

  it('resumirCnae cobre os 4 estados com código + ano', () => {
    const regra: RegraCnaeOk = {
      estado: 'ok',
      cnae7: '0161001',
      codigoFormatado: '0161-0/01',
      descricao: 'Pulverização',
      anexoSimples: ['III'],
      rotuloAnexo: 'Anexo Simples III',
      situacao: 'Permitido',
      fatorR: false,
      vedacaoTextual: ['x'],
      ehBens: false,
      temMapeamentoNbs: true,
      totalNbs: 1,
    }
    expect(resumirCnae(regra, 'mapeado', 1, 2033)).toBe(
      '0161-0/01 · Anexo Simples III · Permitido · 1 NBS (ref. 2033)',
    )
    expect(resumirCnae(regra, 'mapeado', 98, 2027)).toContain('98 NBS (ref. 2027)')
    expect(resumirCnae(regra, 'sem-mapeamento-NBS', 0, 2033)).toContain('sem mapeamento')
    expect(resumirCnae(regra, 'bens→NCM', 0, 2033)).toContain('bens')
  })

  it('registra auditoria por consulta (padrão consultar-por-cnpj)', async () => {
    await consultarPorCnae('0161-0/01')
    const n = await db.table('audit_log').where('tabela').equals('consultas_cnae').count()
    expect(n).toBeGreaterThan(0)
  })
})
