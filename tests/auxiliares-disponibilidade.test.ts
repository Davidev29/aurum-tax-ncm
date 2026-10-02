/**
 * Disponibilidade das Tabelas auxiliares — regressão da tela em branco.
 *
 * Garante que:
 * 1. `carregar` de todos os tipos nunca lança (banco vazio, store ausente,
 *    linha corrompida) e deixa caches como arrays;
 * 2. `itensVisiveis`/`totalFiltrado` toleram linhas corrompidas e filtros ruins;
 * 3. `celulaAux` nunca lança (inclusive nos campos novos: alíquotas, redução,
 *    atoFim) e os metadados expõem os novos padrões de dados do sistema.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AUX_META, COLUNAS_AUX, celulaAux } from '@/application/aux-meta'
import { itensVisiveis, totalFiltrado, useAuxiliares } from '@/store/auxiliares'
import { TIPOS_AUX } from '@/application/aux-meta'
import { db } from '@/infrastructure/db/schema'

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.ncmNomenclatura.clear().catch(() => undefined),
    db.cfop.clear().catch(() => undefined),
    db.cstIcms.clear().catch(() => undefined),
    db.cstPisCofins.clear().catch(() => undefined),
    db.cest.clear().catch(() => undefined),
  ])
})

describe('carregar — nunca lança, sempre deixa array', () => {
  it.each(TIPOS_AUX)('carregar(%s) com base vazia', async (tipo) => {
    await expect(useAuxiliares.getState().carregar(tipo)).resolves.toBeUndefined()
    const cache = useAuxiliares.getState().caches[tipo]
    expect(Array.isArray(cache)).toBe(true)
  })

  it('recarregarTudo com base vazia', async () => {
    await expect(useAuxiliares.getState().recarregarTudo()).resolves.toBeUndefined()
    for (const t of TIPOS_AUX) {
      expect(Array.isArray(useAuxiliares.getState().caches[t])).toBe(true)
    }
  })
})

describe('filtragem tolerante a linhas corrompidas', () => {
  it('ignora null/undefined sem lançar', () => {
    const meta = AUX_META.cst
    const lista = [
      { codigo: '000', descricao: 'Tributação integral' },
      null,
      undefined,
      { codigo: '010', descricao: 'Outro' },
    ] as unknown as Parameters<typeof totalFiltrado>[0]
    expect(() => totalFiltrado(lista, 'tribut', meta)).not.toThrow()
    expect(() => itensVisiveis(lista, 1, 'tribut', meta)).not.toThrow()
    expect(totalFiltrado(lista, '', meta)).toBe(4)
  })

  it('filtro null/undefined não quebra', () => {
    const meta = AUX_META.cfop
    const lista = [{ codigo: '5102', descricao: 'Venda', tipo: 'Saída' }]
    expect(() =>
      itensVisiveis(lista, 1, null as unknown as string, meta),
    ).not.toThrow()
    expect(() =>
      totalFiltrado(lista, undefined as unknown as string, meta),
    ).not.toThrow()
  })
})

describe('celulaAux — nunca lança e cobre os novos campos', () => {
  it.each([
    ['ncm', 'aliquotaIBS', 0.5],
    ['ncm', 'aliquotaCBS', 1.25],
    ['ncm', 'reducao', 60],
    ['cstct', 'pRedIBS', 100],
    ['ncmnomen', 'dataFim', '31/12/2026'],
    ['ncmnomen', 'ato', null],
    ['ncm', 'codigo', '02011000'],
    ['cst', 'docs', { NFe: true, NFCe: false }],
    ['cst', 'descricao', null],
    ['cest', 'ncm', undefined],
  ] as const)('celulaAux(%s, %s, %s)', (tipo, campo, valor) => {
    expect(() => celulaAux(tipo, campo, valor)).not.toThrow()
    expect(typeof celulaAux(tipo, campo, valor)).toBe('string')
  })

  it('alíquota numérica vira percentual legível', () => {
    expect(celulaAux('ncm', 'aliquotaIBS', 0.5)).toContain('%')
  })
})

describe('metadados refletem os novos padrões de dados', () => {
  it('vínculo NCM expõe redução, alíquotas e documentos', () => {
    const campos = AUX_META.ncm.campos.map((c) => c.nome)
    expect(campos).toContain('reducao')
    expect(campos).toContain('aliquotaIBS')
    expect(campos).toContain('aliquotaCBS')
    expect(campos).toContain('documentos')
    expect(COLUNAS_AUX.ncm).toContain('aliquotaIBS')
    expect(COLUNAS_AUX.ncm).toContain('aliquotaCBS')
  })

  it('nomenclatura expõe vigência completa e ato de extinção', () => {
    const campos = AUX_META.ncmnomen.campos.map((c) => c.nome)
    expect(campos).toContain('dataFim')
    expect(campos).toContain('atoFim')
    expect(COLUNAS_AUX.ncmnomen).toContain('dataFim')
  })

  it('cClassTrib expõe vigência', () => {
    const campos = AUX_META.cstct.campos.map((c) => c.nome)
    expect(campos).toContain('inicioVigencia')
    expect(campos).toContain('fimVigencia')
    expect(COLUNAS_AUX.cstct).toContain('inicioVigencia')
  })
})
