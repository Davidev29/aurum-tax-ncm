/**
 * Contexto personalizado por NBS (LC 214) — cada item estudado alimenta a
 * descrição preditiva.
 *
 * Garante:
 * - os 107 NBS da base viva têm contexto (grupo + cluster + vínculos reais);
 * - os 5 códigos duplos (200043×200044) expõem a nota de duplo enquadramento;
 * - sugestões (determinística + preditivas) carregam o contexto;
 * - a camada `origem: 'contexto-personalizado'` do preditivo funciona;
 * - JSON curado e espelho TS consistentes.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import {
  GRUPOS_CONTEXTO_NBS,
  ITENS_CONTEXTO_NBS,
  NOTA_DUAL_XI,
  obterContextoNbs,
  type GrupoNbsId,
} from '@/domain/constants/contexto-nbs'
import { pontuarAlvoPreditivo, sugerirPreditivoServicos } from '@/domain/services/preditivo-servicos'
import { classificarServicoPorDescricao } from '@/application/classificacao-inteligente-servicos'

const noop = () => undefined

function refRow(cst: string, cct: string, desc: string, anexo: string) {
  return {
    'Código da Situação Tributária': cst,
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': cct,
    'Descrição do Código da Classificação Tributária': desc,
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': anexo,
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art',
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
    NFe: 'Sim',
    NFCe: 'Não',
    CTe: 'Não',
    'CTe OS': 'Não',
    BPe: 'Não',
    'BPe TM': 'Não',
    NF3e: 'Não',
    NFCom: 'Não',
    NFSe: 'Sim',
  }
}

const REFERENCIA = [
  refRow('200', '200028', 'Fornecimento dos serviços de educação (Anexo II)', '2'),
  refRow('200', '200029', 'Fornecimento dos serviços de saúde humana (Anexo III)', '3'),
  refRow('200', '200039', 'Fornecimento dos serviços e o licenciamento ou cessão dos direitos destinados às produções nacionais artísticas (Anexo X)', '10'),
  refRow('200', '200043', 'Fornecimento à administração pública dos serviços e bens relativos à soberania (Anexo XI)', '11'),
  refRow('200', '200044', 'Operações e prestações de serviços de segurança da informação e cibernética por sociedade com sócio brasileiro (Anexo XI)', '11'),
]

function nbsRow(nbs: string, cct: string, base: string, desc: string) {
  return { NBS: nbs, CST: '200', CclassTrib: cct, 'Base Legal': base, Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': desc }
}

const NBS_BASE = [
  nbsRow('122011100', '200028', 'Fornecimento dos serviços de educação (Anexo II)', 'Serviços de educação do Anexo II.'),
  nbsRow('123011100', '200029', 'Fornecimento dos serviços de saúde humana (Anexo III)', 'Serviços de saúde ambulatorial.'),
  nbsRow('111031000', '200039', 'Fornecimento dos serviços destinados às produções nacionais artísticas (Anexo X)', 'Espetáculos teatrais, shows musicais, filmes.'),
  nbsRow('115012000', '200043', 'Fornecimento à administração pública dos serviços relativos à soberania (Anexo XI)', 'Segurança e soberania.'),
  nbsRow('115012000', '200044', 'Operações de segurança da informação e cibernética com sócio brasileiro (Anexo XI)', 'Segurança da informação.'),
]

async function semear() {
  await db.nbs.clear().catch(() => undefined)
  await db.referencia.clear().catch(() => undefined)
  await db.cst.clear().catch(() => undefined)
  await db.cstClassTrib.clear().catch(() => undefined)
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_BASE, 'NBS SERVIÇOS.json', noop)
}

function codigosDaBaseViva(): string[] {
  const p = path.resolve(__dirname, '..', 'bases-fonte', 'NBS SERVIÇOS.json')
  const dados = JSON.parse(fs.readFileSync(p, 'utf-8')) as { NBS?: unknown }[]
  const set = new Set<string>()
  for (const r of dados) {
    const dig = String(r.NBS ?? '').replace(/\D+/g, '')
    if (/^\d{9}$/.test(dig)) set.add(dig)
  }
  return [...set].sort()
}

describe('cobertura dos 107 itens', () => {
  it('todo NBS da base viva tem contexto personalizado', () => {
    const base = codigosDaBaseViva()
    expect(base).toHaveLength(107)
    const sem: string[] = []
    for (const cod of base) {
      if (!obterContextoNbs(cod)) sem.push(cod)
    }
    expect(sem).toEqual([])
  })

  it('índice TS tem 107 itens únicos em 5 grupos válidos', () => {
    expect(ITENS_CONTEXTO_NBS).toHaveLength(107)
    const cods = ITENS_CONTEXTO_NBS.map((i) => i.nbs)
    expect(new Set(cods).size).toBe(107)
    for (const i of ITENS_CONTEXTO_NBS) {
      expect(Object.keys(GRUPOS_CONTEXTO_NBS)).toContain(i.grupo)
      expect(i.ccts.length).toBeGreaterThan(0)
      expect(i.cluster).toMatch(/^\d{5}$/)
    }
  })

  it('fora da base não há contexto (sem invenção)', () => {
    expect(obterContextoNbs('999999999')).toBeNull()
    expect(obterContextoNbs('123')).toBeNull()
    expect(obterContextoNbs('')).toBeNull()
  })
})

describe('duplo enquadramento XI', () => {
  it('os 5 códigos duplos expõem as duas leituras', () => {
    for (const cod of ['115012000', '115029000', '115100000', '120013500', '120018300']) {
      const ctx = obterContextoNbs(cod)!
      expect(ctx).not.toBeNull()
      expect(ctx.multiEnquadramento).toBe(true)
      expect(ctx.ccts).toEqual(expect.arrayContaining(['200043', '200044']))
      expect(ctx.nota).toBe(NOTA_DUAL_XI)
    }
  })

  it('código simples não carrega nota dual', () => {
    const ctx = obterContextoNbs('122011100')!
    expect(ctx.multiEnquadramento).toBe(false)
    expect(ctx.nota).toBeNull()
    expect(ctx.ccts).toEqual(['200028'])
  })
})

describe('contexto na descrição preditiva', () => {
  it('sugestão determinística carrega o contexto do item', async () => {
    await semear()
    const s = await classificarServicoPorDescricao({ descricao: 'aula de inglês online' })
    expect(s.nbs_provavel).toBe('122.011.100')
    expect(s.contextoNbs?.grupo).toBe('EDU')
    expect(s.contextoNbs?.anexo).toBe('II')
    expect(s.contextoNbs?.resumo.length).toBeGreaterThan(50)
    expect(s.contextoNbs?.quandoSeAplica.length).toBeGreaterThan(0)
    expect(s.contextoNbs?.quandoNaoSeAplica.length).toBeGreaterThan(0)
  })

  it('preditivas carregam contexto (dual XI expõe a nota de duplo enquadramento)', async () => {
    await semear()
    const lista = await sugerirPreditivoServicos('firewall gerenciado')
    expect(lista.length).toBeGreaterThan(0)
    const top = lista[0]
    expect(top.contexto).not.toBeNull()
    // Seed com 115012000 dual: o contexto carrega a nota dos dois enquadramentos.
    expect(top.codigo).toBe('115012000')
    expect(top.contexto?.multiEnquadramento).toBe(true)
    expect(top.contexto?.nota).toMatch(/DOIS enquadramentos/)
  })

  it('camada contexto-personalizado pontua (puro)', () => {
    const r = pontuarAlvoPreditivo(
      ['mensalidade'],
      new Map(),
      {
        toksTitulo: new Set(['fornecimento', 'servicos', 'educacao']),
        toksRico: new Set(['fornecimento', 'educacao', 'anexo']),
        toksContexto: new Set(['mensalidade', 'escola', 'curso']),
      },
    )
    expect(r.casados).toContain('mensalidade')
    expect(r.fontes).toContain('contexto')
  })
})

describe('JSON curado × espelho TS', () => {
  it('grupos consistentes (cct, anexo, redução)', () => {
    const p = path.resolve(__dirname, '..', 'recursos-ia', 'conhecimento', 'contexto-nbs.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      versao: string
      total_itens: number
      grupos: { grupo: GrupoNbsId; cct: string; anexo: string; reducao_ibs: number }[]
      itens: { nbs: string; grupo: GrupoNbsId }[]
    }
    expect(j.versao).toBe('contexto-nbs-v1')
    expect(j.total_itens).toBe(107)
    expect(j.itens).toHaveLength(107)
    for (const g of j.grupos) {
      const ts = GRUPOS_CONTEXTO_NBS[g.grupo]
      expect(ts.cct).toBe(g.cct)
      expect(ts.anexo).toBe(g.anexo)
      expect(ts.reducaoIBS).toBe(g.reducao_ibs)
    }
    const tsCods = new Set(ITENS_CONTEXTO_NBS.map((i) => i.nbs))
    for (const it of j.itens) {
      expect(tsCods.has(it.nbs)).toBe(true)
    }
  })
})
