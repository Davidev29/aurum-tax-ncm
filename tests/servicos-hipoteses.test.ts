/**
 * Phase 7 — hipóteses legais (conferência contra a tabela da Reforma).
 *
 * A referência oficial tem benefícios de serviços SEM NBS vinculado
 * (restaurantes 40%, hotelaria 40%, turismo 40%, profissões 30%…).
 * O matcher encontra esses benefícios pelo texto do CNAE — como hipótese
 * a verificar, nunca como vínculo inventado.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { buscarHipotesesLegais } from '@/infrastructure/base/classificacao-repo'
import {
  verificarCoerenciaServico,
} from '@/domain/services/verificacao-servicos'

const noop = () => undefined

function linha(cst: string, cct: string, descricao: string, redIBS: number, redCBS: number) {
  return {
    'Código da Situação Tributária': cst,
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': cct,
    'Descrição do Código da Classificação Tributária': descricao,
    'Percentual Redução IBS': redIBS,
    'Percentual Redução CBS': redCBS,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '',
    'Url da Legislação': '',
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
  }
}

const REFERENCIA = [
  linha('200', '200028', 'Fornecimento dos serviços de educação (Anexo II)', 60, 60),
  linha('200', '200047', 'Bares e Restaurantes, observado o art. 275 da LC 214/2025', 40, 40),
  linha('200', '200048', 'Hotelaria, Parques de Diversão e Parques Temáticos, art. 281', 40, 40),
  linha('200', '200051', 'Agências de Turismo, observado o art. 289', 40, 40),
  linha('200', '200052', 'Prestação de serviços das profissões intelectuais: administradores, advogados, contabilistas, engenheiros', 30, 30),
  linha('000', '000001', 'Tributação integral — regra geral', 0, 0),
]

beforeEach(async () => {
  await Promise.all([
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
  ])
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
})

describe('buscarHipotesesLegais', () => {
  it('restaurante → 200047 (40%, sem NBS)', async () => {
    const h = await buscarHipotesesLegais('5611-2/01 Restaurantes e similares')
    expect(h[0]?.cClassTrib).toBe('200047')
    expect(h[0]?.reducaoIBS).toBe(40)
    expect(h[0]?.temNbs).toBe(false)
  })

  it('hotel → 200048', async () => {
    const h = await buscarHipotesesLegais('5510-8/01 Hotéis')
    expect(h[0]?.cClassTrib).toBe('200048')
  })

  it('agência de viagens → 200051', async () => {
    const h = await buscarHipotesesLegais('7911-2/00 Agências de viagens')
    expect(h[0]?.cClassTrib).toBe('200051')
  })

  it('contabilidade → 200052 (profissões intelectuais)', async () => {
    const h = await buscarHipotesesLegais('6920-6/01 Atividades de contabilidade')
    expect(h.map((x) => x.cClassTrib)).toContain('200052')
  })

  it('software não força hipótese fraca', async () => {
    const h = await buscarHipotesesLegais('6201-5/01 Desenvolvimento de programas de computador sob encomenda')
    expect(h).toHaveLength(0)
  })

  it('ignora genéricos ("observado o art", "Lei Complementar")', async () => {
    const h = await buscarHipotesesLegais('observado o art')
    expect(h).toHaveLength(0)
  })
})

describe('verificarCoerenciaServico', () => {
  it('coerente quando o cct está nas hipóteses', () => {
    const h = [{ cClassTrib: '200047' }] as never[]
    expect(verificarCoerenciaServico('200047', h)).toBe('coerente')
  })

  it('divergente quando o cct não está nas hipóteses', () => {
    const h = [{ cClassTrib: '200047' }] as never[]
    expect(verificarCoerenciaServico('200028', h)).toBe('divergente')
  })

  it('sem-base sem hipóteses', () => {
    expect(verificarCoerenciaServico('200028', [])).toBe('sem-base')
  })
})
