/**
 * Phase 7 — top-up de bancos legados (regressão do "CNAE fora da tabela viva").
 *
 * Cenário real: usuário com base NCM já semeada atualiza o app; o seed
 * completo é pulado (`baseCompleta()`), e a store `cnae` nasce vazia —
 * todo CNAE caía em "fora da tabela viva". `semearBaseEmbutida()` no caminho
 * rápido agora completa as stores novas via `completarStoresFase7()`.
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import {
  completarStoresFase7,
  semearBaseEmbutida,
  statusBase,
} from '@/infrastructure/base/base-service'

const BASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'base',
)

function mockArquivosBase() {
  globalThis.fetch = (async (entrada: unknown) => {
    const nome = String(entrada).replace(/^base\//, '')
    const conteudo = readFileSync(path.join(BASE_DIR, nome), 'utf8')
    return { ok: true, status: 200, text: async () => conteudo }
  }) as unknown as typeof fetch
}

beforeEach(async () => {
  mockArquivosBase()
  await Promise.all([
    db.ncm.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.ncmNomenclatura.clear().catch(() => undefined),
    db.cnae.clear().catch(() => undefined),
    db.consultasCnpj.clear().catch(() => undefined),
  ])
})

describe('completarStoresFase7 (banco legado)', () => {
  it('seed rápido preenche cnae vazia sem resemear tudo', async () => {
    // 1. Banco "legado": só NCM + referência (como quem atualizou o app).
    await semearBaseEmbutida(undefined, true)
    const antes = await statusBase()
    expect(antes.cnae).toBeGreaterThan(0)

    // 2. Simula o legado: esvazia só a store nova.
    await db.cnae.clear()
    expect(await db.cnae.count()).toBe(0)

    // 3. Boot normal (sem forçar): completa sem apagar o resto.
    const ncmAntes = await db.ncm.count()
    const depois = await semearBaseEmbutida()
    expect(depois.cnae).toBe(antes.cnae)
    expect(await db.ncm.count()).toBe(ncmAntes)
    expect(completarStoresFase7).toBeTypeOf('function')
  })

  it('completarStoresFase7 é idempotente (não duplica)', async () => {
    await semearBaseEmbutida(undefined, true)
    const total = await db.cnae.count()
    expect(await completarStoresFase7()).toBe(false)
    expect(await db.cnae.count()).toBe(total)
  })

  it('CNAE contábil 6920-6/01 existe após o top-up', async () => {
    await semearBaseEmbutida(undefined, true)
    await db.cnae.clear()
    await semearBaseEmbutida()
    const cnae = await db.cnae.get('6920601')
    expect(cnae?.descricao).toContain('contabilidade')
    expect(cnae?.situacao).toBeDefined()
  })
})
