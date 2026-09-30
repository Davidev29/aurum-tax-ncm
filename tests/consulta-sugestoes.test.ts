/**
 * Regressão da tela **Consulta NCM**: sugestões conforme digita.
 *
 * Cobre `sugerirNomenclatura(repo)` — o motor por trás de
 * `buscarSugestoes(store)`: prefixo curto lista candidatos do prefixo,
 * valor mascarado (`0201.10.00`) resolve para o NCM exato e prefixo
 * com menos de 2 dígitos retorna vazio.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { sugerirNomenclatura } from '@/infrastructure/base/classificacao-repo'

const LINHAS = [
  { codigo: '02', codigoOriginal: '02', descricao: 'Carnes e miudezas', dataInicio: null, dataFim: null, ato: null, atoFim: null },
  { codigo: '0201', codigoOriginal: '0201', descricao: 'Carnes bovinas frescas', dataInicio: null, dataFim: null, ato: null, atoFim: null },
  { codigo: '02011000', codigoOriginal: '0201.10.00', descricao: 'Carcaças e meias-carcaças', dataInicio: null, dataFim: null, ato: null, atoFim: null },
  { codigo: '02012010', codigoOriginal: '0201.20.10', descricao: 'Quartos dianteiros', dataInicio: null, dataFim: null, ato: null, atoFim: null },
  { codigo: '30041011', codigoOriginal: '3004.10.11', descricao: 'Medicamento X', dataInicio: null, dataFim: null, ato: null, atoFim: null },
]

beforeEach(async () => {
  await db.ncmNomenclatura.clear()
  await db.ncmNomenclatura.bulkPut(LINHAS as never[])
})

describe('sugestões da consulta NCM', () => {
  it('lista candidatos ao digitar o prefixo', async () => {
    const res = await sugerirNomenclatura('02')
    expect(res.length).toBeGreaterThan(0)
    expect(res.every((s) => s.codigo.startsWith('02'))).toBe(true)
    expect(res.map((s) => s.codigo)).toContain('02011000')
  })

  it('resolve valor mascarado com pontuação', async () => {
    const res = await sugerirNomenclatura('0201.10.00')
    expect(res.map((s) => s.codigo)).toContain('02011000')
  })

  it('estreita ao refinar o prefixo', async () => {
    const antes = await sugerirNomenclatura('02')
    const depois = await sugerirNomenclatura('020110')
    expect(depois.length).toBeLessThanOrEqual(antes.length)
    expect(depois.map((s) => s.codigo)).toContain('02011000')
  })

  it('prefixo curto retorna vazio', async () => {
    await expect(sugerirNomenclatura('0')).resolves.toEqual([])
    await expect(sugerirNomenclatura('')).resolves.toEqual([])
  })
})
