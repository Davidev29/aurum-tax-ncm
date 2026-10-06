import { describe, expect, it } from 'vitest'
import { executarFerramenta } from '@/application/aurum-ai-registro-ferramentas'
import { calcularConvencionalEstrito } from '@/simples/calculo'

// C-004/C-005/C-006: dispatcher fail-closed — sem número/código inválido exibível
describe('dispatcher fail-closed (C-004/C-005/C-006)', () => {
  it('NCM parcial (<8d) não vai ao resolvedor — erro tipado', async () => {
    const r = await executarFerramenta('consultarNCM', { codigo: '4061010' })
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('ncm-incompleto')
  })

  it('NCM >8d não trunca — erro tipado', async () => {
    const r = await executarFerramenta('consultarNCM', { codigo: '123456789' })
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('ncm-invalido')
  })

  it('NBS parcial (<9d) não vai ao pipeline — erro tipado', async () => {
    const r = await executarFerramenta('consultarNBS', { codigo: '12345678' })
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('nbs-incompleto')
  })

  it('CNAE com 6/8 dígitos não faz lookup fantasma', async () => {
    const r = await executarFerramenta('consultarCNAE', { cnae: '620101' })
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('cnae-invalido')
  })

  it('calcularSimples sem inputs não devolve DAS zero exibível', async () => {
    const r = await executarFerramenta('calcularSimples', {})
    expect(r.ok).toBe(false)
    expect(r.erro).toBe('anexo-rbt-receita-ausentes')
  })

  it('simularComparativo III×V exige par e relata Fator-R/folha', async () => {
    const semFolha = await executarFerramenta('simularComparativo', {
      anexos: 'III,V', rbt12: 500000, receitaMes: 50000,
    })
    expect(semFolha.ok).toBe(true)
    expect((semFolha.dados as { resultados: unknown[] }).resultados.length).toBe(2)
    expect((semFolha.dados as { aviso: string }).aviso).toMatch(/folha12/)
    const comFolha = await executarFerramenta('simularComparativo', {
      anexos: 'III,V', rbt12: 500000, receitaMes: 50000, folha12: 150000,
    })
    expect(comFolha.ok).toBe(true)
    expect((comFolha.dados as { fatorR: unknown }).fatorR).toBeDefined()
  })
})

describe('calcularConvencionalEstrito (C-006)', () => {
  it('lança em vez de DAS zero: rbt/receita <= 0', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 0, receitaMes: 50000 } as never)).toThrow(/rbt12/)
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 500000, receitaMes: 0 } as never)).toThrow(/receita/)
  })
  it('lança acima de 4.8M (desenquadramento)', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'III', rbt12: 5000000, receitaMes: 50000 } as never)).toThrow(/desenquadramento/)
  })
  it('lança com anexo inválido', () => {
    expect(() => calcularConvencionalEstrito({ anexoId: 'XX', rbt12: 500000, receitaMes: 50000 } as never)).toThrow(/anexo-invalido/)
  })
  it('caso válido calcula', () => {
    const r = calcularConvencionalEstrito({ anexoId: 'III', rbt12: 500000, receitaMes: 50000 } as never)
    expect(r.das).toBeGreaterThan(0)
  })
})
