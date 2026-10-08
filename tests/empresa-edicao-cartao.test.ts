import { describe, expect, it } from 'vitest'
import { normalizarContador, atualizarEmpresa, cadastrarEmpresa } from '@/application/empresas'
import { validarRegistro } from '@/infrastructure/db/validacao'
import { db } from '@/infrastructure/db/schema'

describe('empresas: edicao + contador + cartao', () => {
  it('normalizarContador: vazio limpa, pf exige 11, pj exige 14', () => {
    expect(normalizarContador({}).patch.contadorTipo).toBeNull()
    expect(normalizarContador({ contadorTipo: 'pf', contadorNome: 'Ana', contadorDoc: '123' }).ok).toBe(false)
    expect(normalizarContador({ contadorTipo: 'pj', contadorNome: 'Esc', contadorDoc: '11222333000181' }).ok).toBe(true)
  })
  it('validarRegistro aceita novos campos e recusa doc invalido', () => {
    const base = { razaoSocial: 'X', cnpj: '', fantasia: '', criadoEm: '2026-01-01', contadorTipo: 'pf', contadorNome: 'Ana', contadorDoc: '12345678901' }
    expect(() => validarRegistro('empresas', base)).not.toThrow()
    expect(() => validarRegistro('empresas', { ...base, contadorDoc: '123' })).toThrow()
    expect(() => validarRegistro('empresas', { ...base, contadorTipo: 'xx' })).toThrow()
  })
  it('atualizarEmpresa edita e persiste contador', async () => {
    await db.empresas.clear().catch(() => {})
    const r = await cadastrarEmpresa({ razaoSocial: 'Empresa T', cnpj: '' })
    expect(r.ok).toBe(true)
    const id = r.empresa!.id!
    const up = await atualizarEmpresa(id, { fantasia: 'Fant T', contadorTipo: 'pf', contadorNome: 'Ana', contadorDoc: '12345678901', contadorCrc: 'CRC/SP 1' })
    expect(up.ok).toBe(true)
    expect(up.empresa?.fantasia).toBe('Fant T')
    expect(up.empresa?.contadorNome).toBe('Ana')
    const up2 = await atualizarEmpresa(id, { contadorTipo: null, contadorNome: null, contadorDoc: null, contadorCrc: null, contadorEmail: null, contadorTelefone: null })
    expect(up2.ok).toBe(true)
    expect(up2.empresa?.contadorNome).toBeNull()
    await db.empresas.clear().catch(() => {})
  })
})
