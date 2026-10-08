/**
 * Phase 9 / 09-06 — chaos expandido CNAE → NBS (22 casos, gate ≥85% = 19/22).
 *
 * Cobre o plano 09-06 §5 (rev. 2):
 * - (a) sorteio de CNAEs fora-508 → regra + sem-NBS, nunca sem-regra;
 * - (b–d) veredito 2026/2027/2033 difere (ano explícito em todo veredito);
 * - (e) cache por NBS (contador do resolvedor = nº de NBS únicas);
 * - (f) conferência divergente → `divergencia`, sem consolidar;
 * - (g) template consolidado reutilizado em menu + CNPJ + chat;
 * - (h) CNAE de bens → faixa NCM (badge distinto, sem resolvedor);
 * - (i) 98-NBS com destaque + escolha funcional.
 * Preserva: `__COMPARAR_*__` intactos, rollback v13→v14 aditivo,
 * `npm run base` sem os arquivos-fonte degrada gracioso, três badges
 * distintos, sem-lastro nunca com redução.
 *
 * Fixtures próprios semeados via `importarBase` (padrão Phase 7/09) —
 * nenhuma dependência de rede. NBS sem vínculo oficial cai na regra geral
 * (`semLastro: true`, redução 0 — nunca redução inventada).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DB_VERSION, STORES } from '@/domain/constants'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import {
  consultarPorCnae,
  type ConsultaCnae,
} from '@/application/consultar-por-cnae'
import { consultarPorCnpj } from '@/application/consultar-por-cnpj'
import {
  construirClassificacoesConsolidadas,
} from '../scripts/build-base.mjs'
import {
  blocoNbsDoCnae,
  responderChat,
} from '@/application/aurum-ai-chat'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import {
  estatisticasCacheCnaeNbs,
  limparCacheVereditosNbs,
  regrasDoCnae,
} from '@/domain/services/cnae-nbs'
import {
  filtrarCnaes,
  selecionarVeredito,
  useCnaes,
} from '@/store/consulta-cnaes'
import type { ClassificacaoConsolidada } from '@/domain/entities'

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
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 60, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '0161-0/01', 'Descrição oficial': 'Serviço de pulverização e controle de pragas agrícolas', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '0162-8/99', 'Descrição oficial': 'Atividades de apoio à pecuária não especificadas anteriormente', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '4322-3/03', 'Descrição oficial': 'Instalações de sistema de prevenção contra incêndio', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '8511-2/00', 'Descrição oficial': 'Educação infantil — creche', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  // Fora-508 (serviços, sem links): o sorteio (a) só pode cair aqui ou em bens.
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '7311-4/00', 'Descrição oficial': 'Agências de publicidade', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '9511-8/00', 'Descrição oficial': 'Reparação e manutenção de computadores', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '8599-6/04', 'Descrição oficial': 'Treinamento em desenvolvimento profissional e gerencial', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '5620-1/02', 'Descrição oficial': 'Serviços de alimentação para eventos e recepções', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '6920-6/01', 'Descrição oficial': 'Atividades de contabilidade', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  // Bens (h): indústria + comércio, sem NBS aplicável.
  { CNAE: '1011-2/01', 'Descrição oficial': 'Frigorífico — abate de bovinos', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '4711-3/02', 'Descrição oficial': 'Comércio varejista de mercadorias em geral', Situação: 'Permitido', Anexos: 'I', 'Fator R': 'Não' },
]

/** 24 sintéticas + a compartilhada `118032100` = 25 NBS em `0162-8/99`. */
const NBS_0162 = [...Array.from({ length: 24 }, (_, i) => `2000000${String(i + 1).padStart(2, '0')}`), '118032100']
/** 98 NBS sintéticas em `4322-3/03` (caso i). */
const NBS_4322 = Array.from({ length: 98 }, (_, i) => `300000${String(i + 1).padStart(3, '0')}`)

/** Template consolidado de `0161-0/01` (caso g: mesma fonte p/ menu+CNPJ+chat). */
const TEMPLATE_0161: ClassificacaoConsolidada = {
  cnae7: '0161001',
  codigoFormatado: '0161-0/01',
  descricao: 'Serviço de pulverização e controle de pragas agrícolas',
  fonteDescricao: 'oficial',
  anexoSimples: ['III'],
  situacao: 'Permitido',
  fatorR: false,
  vedacoes: ['Atividade permitida no Simples Nacional (vedação-teste do template).'],
  nbsVinculadas: [
    { nbs: '118032100', descricao: 'Pulverização e controle de pragas (template)', fonteDescricao: 'qualclasstrib', semDescricao: false },
  ],
  beneficiosReforma: [],
  divergencia: null,
  estadoNbs: 'mapeado',
}

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
  await db.cnaeNbs.bulkAdd([
    { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
    ...NBS_0162.map((nbs) => ({ cnae7: '0162899', cnae: '0162-8/99', nbs, fonte: 'por_codigo' as const })),
    ...NBS_4322.map((nbs) => ({ cnae7: '4322303', cnae: '4322-3/03', nbs, fonte: 'por_codigo' as const })),
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011100', fonte: 'por_codigo' },
    { cnae7: '8511200', cnae: '8511-2/00', nbs: '122011200', fonte: 'por_codigo' },
  ])
  await db.classificacoesConsolidadas.put(TEMPLATE_0161)
}

beforeEach(async () => {
  limparCacheBrasilApi()
  limparCacheVereditosNbs()
  useCnaes.getState().limpar()
  useCnaes.setState({ anoReferencia: 2033, lista: [], sugestoes: [] })
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

/** Sorteio determinístico (semente fixa) sobre os CNAEs fora-508 da base. */
function sortearFora508(todas: string[], comNbs: Set<string>, n: number): string[] {
  let s = 42
  const pool = todas.filter((c) => !comNbs.has(c))
  const sorteados: string[] = []
  while (sorteados.length < n && pool.length) {
    s = (s * 1103515245 + 12345) % 2147483648
    sorteados.push(pool.splice(s % pool.length, 1)[0])
  }
  return sorteados
}

async function cnaesComNbs(): Promise<Set<string>> {
  const links = await db.cnaeNbs.toArray()
  return new Set(links.map((l) => l.cnae7))
}

/* ------------------------------------------------- (a) sorteio fora-508 --- */

describe('chaos-09(a) — sorteio fora-508: regra + sem-NBS, nunca sem-regra', () => {
  it('caso 01 — sorteio de 5 CNAEs fora-508: todos com regra + sem-NBS, zero sem-regra', async () => {
    const todas = (await db.cnae.toCollection().primaryKeys()).map(String)
    const sorteados = sortearFora508(todas, await cnaesComNbs(), 5)
    expect(sorteados).toHaveLength(5)
    let semRegra = 0
    for (const cnae7 of sorteados) {
      const c = await consultarPorCnae(cnae7, { anoReferencia: 2033 })
      if (c.regra.estado !== 'ok') {
        semRegra++
        continue
      }
      expect(c.regra.anexoSimples.length).toBeGreaterThan(0)
      expect(c.regra.vedacaoTextual.length).toBeGreaterThan(0)
      expect(['sem-mapeamento-NBS', 'bens→NCM']).toContain(c.estadoNbs)
      expect(c.vereditos).toEqual([])
    }
    expect(semRegra).toBe(0)
  })

  it('caso 02 — fora-508 serviço (6201-5/01): regra completa + sem-mapeamento + fallback Phase 7', async () => {
    const c = await consultarPorCnae('6201-5/01', { anoReferencia: 2033 })
    expect(c.regra.estado).toBe('ok')
    if (c.regra.estado !== 'ok') throw new Error('regra esperada')
    expect(c.regra.anexoSimples).toEqual(['III'])
    expect(c.regra.situacao).toBe('Permitido')
    expect(c.regra.ehBens).toBe(false)
    expect(c.estadoNbs).toBe('sem-mapeamento-NBS')
    expect(c.vereditos).toEqual([])
    // Fallback Phase 7: hipóteses seguem disponíveis, sem inventar NBS.
    expect(Array.isArray(c.hipoteses)).toBe(true)
    expect(c.resumo).toContain('sem mapeamento')
  })
})

/* ------------------------------------------------- (b–d) anos 2026/2027/2033 --- */

describe('chaos-09(b–d) — veredito difere por ano de referência', () => {
  it('caso 03 — 2026/2027/2033 precificam diferente (educação, red. 60%)', async () => {
    const total = async (ano: number) =>
      (await consultarPorCnae('8511-2/00', { anoReferencia: ano })).vereditos.find(
        (v) => v.nbs === '122011100',
      )?.calculo.total
    const t2026 = await total(2026)
    const t2027 = await total(2027)
    const t2033 = await total(2033)
    expect(new Set([t2026, t2027, t2033]).size).toBe(3)
    expect(t2026).toBeLessThan(t2027 ?? 0)
    expect(t2027).toBeLessThan(t2033 ?? 0)
  })

  it('caso 04 — todo veredito carrega anoReferencia (selo do ano, sem ano cego)', async () => {
    for (const ano of [2026, 2027, 2033]) {
      const c = await consultarPorCnae('0161-0/01', { anoReferencia: ano })
      expect(c.anoReferencia).toBe(ano)
      expect(c.vereditos).toHaveLength(1)
      expect(c.vereditos[0].anoReferencia).toBe(ano)
      expect(c.resumo).toContain(`ref. ${ano}`)
    }
  })

  it('caso 05 — transição (2030): valores 2033 + flag emTransicao, nunca número inventado', async () => {
    const c = await consultarPorCnae('8511-2/00', { anoReferencia: 2030 })
    expect(c.emTransicao).toBe(true)
    const v = c.vereditos.find((x) => x.nbs === '122011100')
    expect(v?.emTransicao).toBe(true)
    const pleno = await consultarPorCnae('8511-2/00', { anoReferencia: 2033 })
    const vp = pleno.vereditos.find((x) => x.nbs === '122011100')
    expect(v?.calculo.total).toBe(vp?.calculo.total)
  })
})

/* ------------------------------------------------- (e) cache por NBS --- */

describe('chaos-09(e) — cache de veredito POR NBS', () => {
  it('caso 06 — 2ª consulta do mesmo NBS não re-chama o resolvedor', async () => {
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(1)
    expect(estatisticasCacheCnaeNbs.acertos).toBeGreaterThan(0)
  })

  it('caso 07 — contador do resolvedor = nº de NBS únicas (compartilhada resolve 1×)', async () => {
    await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    await consultarPorCnae('0162-8/99', { anoReferencia: 2033 })
    // 1 (0161) + 24 novas (0162 compartilha `118032100`) = 25, não 26.
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(25)
  })
})

/* ------------------------------------------------- (f) conferência divergente --- */

describe('chaos-09(f) — divergência marca, NÃO consolida', () => {
  const REGRA = (codigo7: string, codigoFormatado: string, descricao = 'Regra oficial do CNAE') => ({
    codigo7,
    codigoFormatado,
    descricao,
    situacao: 'Permitido',
    anexos: ['III'],
    fatorR: false,
  })

  it('caso 08 — divergência de CÓDIGO: estado `divergencia`, sem regra oficial consolidada', () => {
    const { templates, conferencia } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA('0161001', '0161-0/01')],
      porCodigo: {
        '0161-0/01': { descricao: 'Regra oficial do CNAE', vinculos: { NBS: ['1.1803.21.00'] } },
        '9999-9/99': { descricao: 'Código legado sem base oficial', vinculos: { NBS: ['1.1502.10.00'] } },
      },
      descricoesAuxiliares: {},
      mapaDescNbs: new Map(),
    })
    const tpl = templates.find((t: { cnae7: string }) => t.cnae7 === '9999999')
    expect(tpl).toMatchObject({ estadoNbs: 'divergencia', anexoSimples: [] })
    expect(tpl?.divergencia).toMatchObject({ tipo: 'codigo-ausente-oficial' })
    expect(conferencia.codigosDivergentes).toBe(1)
  })

  it('caso 09 — divergência de TEXTO: consolida com a oficial (precedência oficial>ponte>auxiliar)', () => {
    const { templates } = construirClassificacoesConsolidadas({
      cnaeOficial: [REGRA('0161001', '0161-0/01')],
      porCodigo: {
        '0161-0/01': { descricao: 'TEXTO DIVERGENTE DA PONTE', vinculos: { NBS: [] } },
      },
      descricoesAuxiliares: { '0161001': 'texto auxiliar' },
      mapaDescNbs: new Map(),
    })
    const tpl = templates.find((t: { cnae7: string }) => t.cnae7 === '0161001')
    expect(tpl?.descricao).toBe('Regra oficial do CNAE')
    expect(tpl?.divergencia).toMatchObject({ tipo: 'descricao-divergente' })
  })
})

/* ------------------------------------------------- (g) template reutilizado --- */

describe('chaos-09(g) — template consolidado reutilizado em menu + CNPJ + chat', () => {
  it('caso 10 — menu: store consultarCnae(`0161-0/01`) → regra + 1 NBS + ano', async () => {
    await useCnaes.getState().carregarLista(true)
    const achados = filtrarCnaes(useCnaes.getState().lista, '0161-0/01')
    expect(achados.some((l) => l.cnae7 === '0161001')).toBe(true)
    await useCnaes.getState().consultarCnae('0161-0/01')
    const { consulta } = useCnaes.getState()
    expect(consulta?.estadoNbs).toBe('mapeado')
    expect(consulta?.vereditos).toHaveLength(1)
    expect(consulta?.vereditos[0]?.nbs).toBe('118032100')
    expect(consulta?.vereditos[0]?.anoReferencia).toBe(2033)
    if (consulta?.regra.estado !== 'ok') throw new Error('regra esperada')
    expect(consulta.regra.anexoSimples).toEqual(['III'])
    // Vedação veio do template consolidado (mesma fonte do CNPJ/chat).
    expect(consulta.regra.vedacaoTextual).toContain(
      'Atividade permitida no Simples Nacional (vedação-teste do template).',
    )
  })

  it('caso 11 — CNPJ (sem rede, proxy consultarPorCnae/CNPJ): mesma regra + 1 NBS + ano', async () => {
    const fetchOk = vi.fn(async () =>
      new Response(JSON.stringify({
        cnpj: '11222333000181',
        razao_social: 'EMPRESA EXEMPLO LTDA',
        nome_fantasia: 'EXEMPLO',
        municipio: 'FORTALEZA',
        uf: 'ce',
        cep: '60000000',
        ddd_telefone_1: '8530000000',
        email: 'a@a.com',
        cnae_fiscal: '0161001',
        cnae_fiscal_descricao: 'Atividade principal',
        cnaes_secundarios: [],
        porte: 'MICRO EMPRESA',
        descricao_situacao_cadastral: 'ATIVA',
        opcao_pelo_simples: true,
      }), { status: 200 }),
    )
    const v = await consultarPorCnpj('11222333000181', {
      fetchFn: fetchOk as unknown as typeof fetch,
    })
    const atv = v.atividades[0]
    expect(atv.estadoNbs).toBe('mapeado')
    expect(atv.nbsLista).toHaveLength(1)
    expect(atv.nbsLista[0].nbs).toBe('118032100')
    expect(atv.anoReferencia).toBe(2033)
    expect(atv.regras?.estado).toBe('ok')
    if (atv.regras?.estado !== 'ok') throw new Error('regra esperada')
    expect(atv.regras.anexoSimples).toEqual(['III'])
    expect(atv.regras.situacao).toBe('Permitido')
  })

  it('caso 12 — chat: `consultarCnaeNbs` cita NBS + ano + regra (sem rede)', async () => {
    const r = await responderChat('CNAE 0161-0/01 quais NBS e benefícios?')
    expect(r.tipoCodigo).toBe('cnae')
    expect(r.texto).toContain('118.032.100')
    expect(r.texto).toContain('ref. 2033')
    expect(r.texto).toMatch(/Anexo Simples/)
  }, 30000)
})

/* ------------------------------------------------- (h) bens → NCM --- */

describe('chaos-09(h) — CNAE de bens aponta NCM', () => {
  it('caso 13 — bens (1011-2/01): regra completa + `bens→NCM`, zero resolvedor', async () => {
    estatisticasCacheCnaeNbs.resolvidas = 0
    const c = await consultarPorCnae('1011-2/01', { anoReferencia: 2033 })
    expect(c.regra.estado).toBe('ok')
    if (c.regra.estado !== 'ok') throw new Error('regra esperada')
    expect(c.regra.anexoSimples).toEqual(['II'])
    expect(c.regra.ehBens).toBe(true)
    expect(c.estadoNbs).toBe('bens→NCM')
    expect(c.vereditos).toEqual([])
    expect(estatisticasCacheCnaeNbs.resolvidas).toBe(0)
  })

  it('caso 14 — faixa bens: resumo + bloco do chat citam bens→NCM, sem NBS inventado', async () => {
    const c: ConsultaCnae = await consultarPorCnae('4711-3/02', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('bens→NCM')
    expect(c.resumo).toContain('bens')
    expect(c.resumo).toContain('NCM')
    expect(blocoNbsDoCnae(c)).toMatch(/bens.*NCM/)
    expect(blocoNbsDoCnae(c)).not.toMatch(/NBS \d/)
  }, 30000)
})

/* ------------------------------------------------- (i) 98-NBS --- */

describe('chaos-09(i) — 98 NBS: destaque + escolha', () => {
  it('caso 15 — 4322-3/03: 98 vereditos, maisProvavel = ranking[0], ambíguo', async () => {
    const c = await consultarPorCnae('4322-3/03', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('mapeado')
    expect(c.vereditos).toHaveLength(98)
    expect(c.ranking).toHaveLength(98)
    expect(c.maisProvavel).toBe(c.ranking[0].nbs)
    expect(c.ambiguo).toBe(true)
  }, 60_000)

  it('caso 16 — escolha funcional: selecionarVeredito fixa a NBS escolhida', async () => {
    const c = await consultarPorCnae('4322-3/03', { anoReferencia: 2033 })
    expect(selecionarVeredito(c, null)?.nbs).toBe(c.maisProvavel)
    const segunda = c.ranking[1]?.nbs
    expect(selecionarVeredito(c, segunda ?? null)?.nbs).toBe(segunda)
  }, 60_000)
})

/* ------------------------------------------------- preserva --- */

describe('chaos-09 — preserva (regressão zero)', () => {
  it('caso 17 — `__COMPARAR_*__` intactos (nunca viram cnae)', () => {
    expect(
      detectarIntencaoChat('__COMPARAR_ANEXOS__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO_ATUAL=III').intencao,
    ).not.toBe('cnae')
    expect(
      detectarIntencaoChat('__COMPARAR_HIBRIDO__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO=III DESPESA=0').intencao,
    ).not.toBe('cnae')
  })

  it('caso 18 — schema único SQLite: stores Phase 9 intactas, sem cadeia Dexie', async () => {
    expect(DB_VERSION).toBe(1)
    expect(STORES.CNAE_NBS).toBe('cnaeNbs')
    expect(STORES.LC_NBS).toBe('lcNbs')
    expect(STORES.CLASS_CONSOLIDADA).toBe('classificacoesConsolidadas')
    expect(STORES.GRAFOMETA).toBe('grafometa')
    // Stores Phase 9 seguem povoadas junto das demais — nenhum `clear()` destrutivo.
    expect(await db.cnae.count()).toBeGreaterThan(0)
    expect(await db.cnaeNbs.count()).toBeGreaterThan(0)
    expect(await db.classificacoesConsolidadas.count()).toBeGreaterThan(0)
    const schema = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema.prisma'),
      'utf8',
    )
    expect(schema).toContain('model CnaeNbsLink')
    expect(schema).toContain('model GrafoMeta')
    expect(schema).not.toContain('this.version(')
  })

  it('caso 19 — base ausente degrada gracioso: nunca lança, vira `cnae-desconhecido` honesto', async () => {
    await Promise.all([
      db.cnae.clear(),
      db.cnaeNbs.clear(),
      db.classificacoesConsolidadas.clear(),
      db.nbs.clear(),
      db.referencia.clear(),
    ])
    const regra = await regrasDoCnae('0161-0/01')
    expect(regra.estado).toBe('cnae-desconhecido')
    const c = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(c.estadoNbs).toBe('cnae-desconhecido')
    expect(c.vereditos).toEqual([])
    expect(c.resumo).toContain('desconhecido')
    // `npm run base` sem fontes mantém `public/base/` versionado (branch
    // documentada no script — sem ela a build falharia em máquina limpa).
    const build = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-base.mjs'),
      'utf8',
    )
    expect(build).toContain('usando public/base/ versionado')
  })

  it('caso 20 — três badges distintos: sem-mapeamento vs bens→NCM vs sem-lastro-reforma', async () => {
    const fora = await consultarPorCnae('6201-5/01', { anoReferencia: 2033 })
    const bens = await consultarPorCnae('1011-2/01', { anoReferencia: 2033 })
    const mapeado = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    expect(fora.estadoNbs).toBe('sem-mapeamento-NBS')
    expect(bens.estadoNbs).toBe('bens→NCM')
    expect(mapeado.estadoNbs).toBe('mapeado')
    // Terceiro badge: NBS mapeada mas sem vínculo oficial no resolvedor.
    expect(mapeado.vereditos[0].semLastro).toBe(true)
    expect(new Set([fora.estadoNbs, bens.estadoNbs, 'sem-lastro-reforma']).size).toBe(3)
  })

  it('caso 21 — sem lastro nunca tem redução (regra geral honesta, sem benefício inventado)', async () => {
    const c = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    const v = c.vereditos[0]
    expect(v.semLastro).toBe(true)
    expect(v.reducaoIBS).toBe(0)
    expect(v.reducaoCBS).toBe(0)
    expect(v.temBeneficio).toBe(false)
    expect(v.cst).toBe('000')
    expect(v.cClassTrib).toBe('000001')
  })

  it('caso 22 — aceite fim-a-fim: 0161-0/01 exibe Anexo, vedação, 1 NBS e veredito com ano', async () => {
    const c = await consultarPorCnae('0161-0/01', { anoReferencia: 2033 })
    if (c.regra.estado !== 'ok') throw new Error('regra esperada')
    expect(c.regra.rotuloAnexo).toBe('Anexo Simples III')
    expect(c.regra.vedacaoTextual.length).toBeGreaterThan(0)
    expect(c.vereditos).toHaveLength(1)
    expect(c.vereditos[0].nbs).toBe('118032100')
    expect(c.vereditos[0].anoReferencia).toBe(2033)
  })
})
