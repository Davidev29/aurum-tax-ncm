/**
 * Phase 9 / 09-03 — UI Consulta de CNAEs (store + invariantes).
 *
 * - Invariante A: TODOS os CNAEs da base têm regra (1.090 com regra, zero
 *   `sem regra`); Anexo Simples e Situação sempre preenchidos nas linhas;
 * - busca `0161` / `4322-3/03` / descrição;
 * - `4322-3/03`: destaque (mais provável) + escolha funcional;
 * - bens → NCM (`1011-2/01`: regra + `bens→NCM`, sem vereditos);
 * - ano de referência default 2033 + troca re-precifica.
 *
 * Fixtures espelham `cnae-nbs-motor.test.ts` (mesmos CNAEs/NBS/links) +
 * completude sintética até 1.090 linhas para provar a invariante em escala.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { regrasDoCnae, limparCacheVereditosNbs } from '@/domain/services/cnae-nbs'
import { consultarPorCnae } from '@/application/consultar-por-cnae'
import {
  ANOS_REFERENCIA_CNAE,
  filtrarCnaes,
  selecionarVeredito,
  useCnaes,
  type LinhaCnae,
} from '@/store/consulta-cnaes'
import type { CnaeAnexo } from '@/domain/entities'

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
  { NBS: '118032100', CST: '000', CclassTrib: '000001', 'Base Legal': '', Redução: 0, 'Aliq. IBS': 0.19, 'Aliq. CBS': 0.09, 'DFes Relac.': 'NFSE', 'Descrição completa': 'NBS avulsa de teste.' },
]

const CNAE_VIVO = [
  { CNAE: '0161-0/01', 'Descrição oficial': 'Serviço de pulverização e controle de pragas agrícolas', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '0162-8/99', 'Descrição oficial': 'Atividades de apoio à pecuária não especificadas anteriormente', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '4322-3/03', 'Descrição oficial': 'Instalações de sistema de prevenção contra incêndio', Situação: 'Permitido', Anexos: 'III', 'Fator R': 'Não' },
  { CNAE: '1011-2/01', 'Descrição oficial': 'Frigorífico — abate de bovinos', Situação: 'Permitido', Anexos: 'II', 'Fator R': 'Não' },
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido com ressalvas', Anexos: 'III / V', 'Fator R': 'Sim' },
]

/** 98 NBS sintéticas para `4322-3/03`. */
const NBS_4322 = Array.from({ length: 98 }, (_, i) => `300000${String(i + 1).padStart(3, '0')}`)

const SITUACOES = ['Permitido', 'Permitido com ressalvas', 'Depende da atividade'] as const
const ANEXOS = [['I'], ['II'], ['III'], ['IV'], ['V'], ['III', 'V']]

/** Completa a base até 1.090 CNAEs com linhas sintéticas determinísticas. */
function sinteticos(quantidade: number, evitar: Set<string>): CnaeAnexo[] {
  const saidas: CnaeAnexo[] = []
  let semente = 1000001
  while (saidas.length < quantidade) {
    semente = (semente * 7919 + 13) % 9000000 + 1000000
    const cnae7 = String(semente).padStart(7, '0')
    if (evitar.has(cnae7)) continue
    evitar.add(cnae7)
    const i = saidas.length
    saidas.push({
      codigo7: cnae7,
      codigoFormatado: `${cnae7.slice(0, 4)}-${cnae7.slice(4, 5)}/${cnae7.slice(5)}`,
      descricao: `Atividade sintética de teste ${i + 1}`,
      situacao: SITUACOES[i % SITUACOES.length],
      anexos: ANEXOS[i % ANEXOS.length],
      fatorR: i % 2 === 0,
    })
  }
  return saidas
}

async function semear() {
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
  const existentes = new Set((await db.cnae.toCollection().primaryKeys()).map(String))
  const total = await db.cnae.count()
  await db.cnae.bulkPut(sinteticos(1090 - total, existentes))
  await db.cnaeNbs.bulkAdd([
    { cnae7: '0161001', cnae: '0161-0/01', nbs: '118032100', fonte: 'por_codigo' },
    ...NBS_4322.map((nbs) => ({ cnae7: '4322303', cnae: '4322-3/03', nbs, fonte: 'por_codigo' as const })),
  ])
}

beforeEach(async () => {
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
    db.table('audit_log').clear().catch(() => undefined),
  ])
  await semear()
})

/* ------------------------------------------------- invariante A (1.090 com regra) --- */

describe('invariante — todo CNAE tem regra (1.090, zero `sem regra`)', () => {
  it('base tem 1.090 CNAEs', async () => {
    expect(await db.cnae.count()).toBe(1090)
  })

  it('todos os 1.090 retornam regra `ok` com anexo/situação/vedação', async () => {
    const chaves = await db.cnae.toCollection().primaryKeys()
    expect(chaves.length).toBe(1090)
    let semRegra = 0
    for (const chave of chaves) {
      const r = await regrasDoCnae(String(chave))
      if (r.estado !== 'ok') {
        semRegra++
        continue
      }
      expect(r.anexoSimples.length).toBeGreaterThan(0)
      expect(r.rotuloAnexo.startsWith('Anexo Simples')).toBe(true)
      expect(r.situacao).toBeTruthy()
      expect(r.vedacaoTextual.length).toBeGreaterThan(0)
    }
    expect(semRegra).toBe(0)
  }, 120000)

  it('linhas da store: Anexo/Situação nunca vazios nos 1.090', async () => {
    await useCnaes.getState().carregarLista(true)
    const { lista } = useCnaes.getState()
    expect(lista.length).toBe(1090)
    for (const l of lista) {
      expect(l.rotuloAnexo, l.cnae7).toBeTruthy()
      expect(l.situacao, l.cnae7).toBeTruthy()
    }
  })
})

/* ------------------------------------------------- busca --- */

describe('busca por código e descrição', () => {
  it('`0161` acha `0161-0/01`', async () => {
    await useCnaes.getState().carregarLista(true)
    const achados = filtrarCnaes(useCnaes.getState().lista, '0161')
    expect(achados.some((l) => l.cnae7 === '0161001')).toBe(true)
  })

  it('`4322-3/03` máscara completa casa exato', async () => {
    await useCnaes.getState().carregarLista(true)
    const achados = filtrarCnaes(useCnaes.getState().lista, '4322-3/03')
    expect(achados.some((l) => l.cnae7 === '4322303')).toBe(true)
  })

  it('descrição (`pulverização`) acha `0161-0/01`', async () => {
    await useCnaes.getState().carregarLista(true)
    const achados = filtrarCnaes(useCnaes.getState().lista, 'pulverização')
    expect(achados.some((l) => l.cnae7 === '0161001')).toBe(true)
  })

  it('sugerirCnae(`0161`) preenche sugestões com `0161-0/01`', async () => {
    await useCnaes.getState().sugerirCnae('0161')
    const { sugestoes } = useCnaes.getState()
    expect(sugestoes.length).toBeGreaterThan(0)
    expect(sugestoes.some((s) => s.cnae7 === '0161001')).toBe(true)
  })

  it('filtrarCnaes nunca lança (linha corrompida é ignorada)', () => {
    const suja = [null, undefined, {}] as unknown as LinhaCnae[]
    expect(() => filtrarCnaes(suja, '0161')).not.toThrow()
    expect(filtrarCnaes(suja, '0161')).toEqual([])
  })
})

/* ------------------------------------------------- painel: destaque + escolha + bens --- */

describe('painel do CNAE — destaque, escolha e bens→NCM', () => {
  it('`0161` consulta 1 NBS com ano de referência', async () => {
    await useCnaes.getState().consultarCnae('0161-0/01')
    const { consulta } = useCnaes.getState()
    expect(consulta?.estadoNbs).toBe('mapeado')
    expect(consulta?.vereditos).toHaveLength(1)
    expect(consulta?.vereditos[0]?.anoReferencia).toBe(2033)
    expect(consulta?.ambiguo).toBe(false)
  })

  it('`4322-3/03`: 98 vereditos, mais provável em destaque, escolha funcional', async () => {
    await useCnaes.getState().consultarCnae('4322-3/03')
    const { consulta } = useCnaes.getState()
    expect(consulta?.estadoNbs).toBe('mapeado')
    expect(consulta?.vereditos).toHaveLength(98)
    expect(consulta?.ambiguo).toBe(true)
    expect(consulta?.maisProvavel).toBe(consulta?.ranking[0]?.nbs)

    // Sem escolha: o destaque é o mais provável.
    const padrao = selecionarVeredito(consulta, null)
    expect(padrao?.nbs).toBe(consulta?.maisProvavel)

    // Escolha funcional: fixa a 2ª do ranking e o destaque a segue.
    const segunda = consulta?.ranking[1]?.nbs
    expect(segunda).toBeTruthy()
    useCnaes.getState().setNbsEscolhida(segunda ?? null)
    const escolhida = selecionarVeredito(useCnaes.getState().consulta, useCnaes.getState().nbsEscolhida)
    expect(escolhida?.nbs).toBe(segunda)
  })

  it('bens `1011-2/01`: regra completa + `bens→NCM`, sem vereditos', async () => {
    await useCnaes.getState().consultarCnae('1011-2/01')
    const { consulta } = useCnaes.getState()
    expect(consulta?.regra.estado).toBe('ok')
    if (consulta?.regra.estado !== 'ok') return
    expect(consulta.regra.ehBens).toBe(true)
    expect(consulta.estadoNbs).toBe('bens→NCM')
    expect(consulta.vereditos).toHaveLength(0)
    expect(selecionarVeredito(consulta, null)).toBeNull()
  })

  it('fora-508 com regra (`6201-5/01`): `sem-mapeamento-NBS` + vedação/Fator R', async () => {
    const c = await consultarPorCnae('6201-5/01', { anoReferencia: 2033 })
    expect(c.regra.estado).toBe('ok')
    expect(c.estadoNbs).toBe('sem-mapeamento-NBS')
    if (c.regra.estado !== 'ok') return
    expect(c.regra.fatorR).toBe(true)
    expect(c.regra.vedacaoTextual.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------- ano de referência --- */

describe('ano de referência (2026/2027/2033, default 2033)', () => {
  it('anos suportados e default 2033', () => {
    expect([...ANOS_REFERENCIA_CNAE]).toEqual([2026, 2027, 2033])
    expect(useCnaes.getState().anoReferencia).toBe(2033)
  })

  it('trocar o ano re-consulta o CNAE ativo com o novo ano', async () => {
    await useCnaes.getState().consultarCnae('0161-0/01')
    expect(useCnaes.getState().consulta?.anoReferencia).toBe(2033)
    await useCnaes.getState().setAnoReferencia(2026)
    const { consulta, anoReferencia } = useCnaes.getState()
    expect(anoReferencia).toBe(2026)
    expect(consulta?.anoReferencia).toBe(2026)
    expect(consulta?.vereditos[0]?.anoReferencia).toBe(2026)
  })
})
