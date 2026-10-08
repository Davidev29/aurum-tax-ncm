/**
 * Portão de boot `baseCompleta()` — exige as 5 stores nucleares do reseed.
 *
 * Regressão: o portão antigo (`ncm > 0 && referencia > 0`) aprovava uma base
 * mista quando o seed era interrompido entre tabelas (ex.: nomenclatura
 * vazia), e a base ficava incompleta para sempre. O portão novo reprova a
 * base parcial, que cai no reseed total no próximo boot (auto-cura).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { baseCompleta, semearBaseEmbutida } from '@/infrastructure/base/base-service'
import {
  normalizarCst,
  normalizarCstClassTrib,
  normalizarNcm,
  normalizarNomenclatura,
  normalizarReferencia,
} from '@/infrastructure/base/normalizacao'
import { bulkPut, db, INSERIR } from '@/infrastructure/db/schema'

const BASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'base',
)

const ler = (nome: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(BASE_DIR, nome), 'utf8')) as Record<string, any>

// Fatias mínimas reais (shapes válidos, sem custo de seed total).
const referencia = normalizarReferencia(ler('classificacao-tributaria.json').itens).slice(0, 2)
const reforma = ler('reforma.json')
const cst = normalizarCst(reforma.cst).slice(0, 2)
const cstct = normalizarCstClassTrib(reforma.cstClassTrib).slice(0, 2)
const ncm = normalizarNcm(reforma.ncm).slice(0, 2)
const nomenclatura = normalizarNomenclatura(ler('nomenclatura.json')).slice(0, 2)

function mockArquivosBase() {
  globalThis.fetch = (async (entrada: unknown) => {
    const nome = String(entrada).replace(/^base\//, '')
    const conteudo = readFileSync(path.join(BASE_DIR, nome), 'utf8')
    return { ok: true, status: 200, text: async () => conteudo }
  }) as unknown as typeof fetch
}

async function limparNucleares() {
  await Promise.all([
    db.ncm.clear(),
    db.referencia.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.ncmNomenclatura.clear(),
  ])
}

beforeEach(async () => {
  mockArquivosBase()
  await limparNucleares()
})

describe('baseCompleta (portão de boot)', () => {
  it('base vazia → false', async () => {
    expect(await baseCompleta()).toBe(false)
  })

  it('só ncm + referencia → false (regressão do portão antigo)', async () => {
    await bulkPut(db.ncm, ncm, INSERIR)
    await bulkPut(db.referencia, referencia, INSERIR)
    expect(await db.ncm.count()).toBeGreaterThan(0)
    expect(await db.referencia.count()).toBeGreaterThan(0)
    // O portão antigo aprovava este estado; o novo reprova.
    expect(await baseCompleta()).toBe(false)
  })

  it('as 5 nucleares preenchidas → true', async () => {
    await bulkPut(db.ncm, ncm, INSERIR)
    await bulkPut(db.referencia, referencia, INSERIR)
    await bulkPut(db.cst, cst, INSERIR)
    await bulkPut(db.cstClassTrib, cstct, INSERIR)
    await bulkPut(db.ncmNomenclatura, nomenclatura, INSERIR)
    expect(await baseCompleta()).toBe(true)
  })

  it('cada nuclear vazia sozinha reprova o portão', async () => {
    await bulkPut(db.ncm, ncm, INSERIR)
    await bulkPut(db.referencia, referencia, INSERIR)
    await bulkPut(db.cst, cst, INSERIR)
    await bulkPut(db.cstClassTrib, cstct, INSERIR)
    await bulkPut(db.ncmNomenclatura, nomenclatura, INSERIR)
    expect(await baseCompleta()).toBe(true)

    await db.ncm.clear()
    expect(await baseCompleta()).toBe(false)
    await bulkPut(db.ncm, ncm, INSERIR)

    await db.referencia.clear()
    expect(await baseCompleta()).toBe(false)
    await bulkPut(db.referencia, referencia, INSERIR)

    await db.cst.clear()
    expect(await baseCompleta()).toBe(false)
    await bulkPut(db.cst, cst, INSERIR)

    await db.cstClassTrib.clear()
    expect(await baseCompleta()).toBe(false)
    await bulkPut(db.cstClassTrib, cstct, INSERIR)

    await db.ncmNomenclatura.clear()
    expect(await baseCompleta()).toBe(false)
    await bulkPut(db.ncmNomenclatura, nomenclatura, INSERIR)

    expect(await baseCompleta()).toBe(true)
  })

  it('auto-cura: nomenclatura apagada é refeita pelo seed sem forçar', async () => {
    await semearBaseEmbutida(undefined, true)
    expect(await baseCompleta()).toBe(true)

    // Simula o seed interrompido: só a nomenclatura se perdeu.
    await db.ncmNomenclatura.clear()
    expect(await db.ncmNomenclatura.count()).toBe(0)
    expect(await baseCompleta()).toBe(false)

    // Boot normal (sem forçar): o portão reprova e o reseed total refaz tudo.
    await semearBaseEmbutida()
    expect(await db.ncmNomenclatura.count()).toBeGreaterThan(0)
    expect(await baseCompleta()).toBe(true)
  }, 120_000)
})
