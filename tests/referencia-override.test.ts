/**
 * Override de alíquotas de referência (Configurações → Alíquotas):
 * salvar/persistir/restaurar na tabela `meta` do SQLite.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import {
  lerAliquotasUsuario,
  salvarAliquotasUsuario,
  restaurarAliquotasUsuario,
} from '@/infrastructure/db/override-referencia'

beforeEach(async () => {
  await db.delete()
})

describe('override de alíquotas de referência', () => {
  it('sem override persistido → vige a tabela embutida (null)', async () => {
    expect(await lerAliquotasUsuario()).toBeNull()
  })

  it('salvar valida e persiste; ler devolve o mesmo valor', async () => {
    const gravado = await salvarAliquotasUsuario({ refIBS: 18.5, refCBS: 9.3 })
    expect(gravado.soma).toBeCloseTo(27.8, 10)
    const lido = await lerAliquotasUsuario()
    expect(lido?.refIBS).toBe(18.5)
    expect(lido?.refCBS).toBe(9.3)
  })

  it('rejeita alíquotas fora de 0–100', async () => {
    await expect(salvarAliquotasUsuario({ refIBS: 100.5, refCBS: 9 })).rejects.toThrow(/0%/)
    await expect(salvarAliquotasUsuario({ refIBS: 19, refCBS: -1 })).rejects.toThrow(/0%/)
  })

  it('rejeita soma nula', async () => {
    await expect(salvarAliquotasUsuario({ refIBS: 0, refCBS: 0 })).rejects.toThrow(/soma/i)
  })

  it('restaurar apaga o override', async () => {
    await salvarAliquotasUsuario({ refIBS: 18.5, refCBS: 9.3 })
    await restaurarAliquotasUsuario()
    expect(await lerAliquotasUsuario()).toBeNull()
  })
})
