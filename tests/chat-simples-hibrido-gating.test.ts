import { describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { calcularConvencional, calcularHibrido, debitoCBS } from '@/simples/calculo'
import { CBS_REF_PADRAO } from '@/simples/tabelas'
import { fmtMoeda } from '@/domain/services/format'

describe('v8 — duelo com o híbrido só sob demanda', () => {
  it('exploratório sem pedido mostra só o convencional + convite com botão', async () => {
    const r = await responderChat('não tenho empresa, RBT12 500 mil e receita 40 mil, quanto pagaria em cada anexo?', [])
    expect(r.texto).toMatch(/Menor carga/)
    expect(r.texto).not.toContain('DAS reduzido')
    expect(r.texto).toMatch(/regime híbrido.*só aparece se você pedir|Comparar com regime híbrido/i)
    expect(r.botoes?.some((b) => /híbrido/i.test(b.rotulo))).toBe(true)
    expect(r.grafico?.titulo).toMatch(/Comparativo DAS/)
  }, 15000)

  it('exploratório com pedido explícito mostra a tabela Conv×Híb', async () => {
    const r = await responderChat('não tenho empresa, RBT12 500 mil e receita 40 mil, quero ver o regime híbrido', [])
    expect(r.texto).toContain('DAS reduzido')
    expect(r.texto).toMatch(/usar referência/i)
  }, 15000)

  it('pedido só no híbrido entrega as 2 guias (DAS sem CBS + DARF da CBS)', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil no híbrido', [])
    expect(r.texto).toContain('Guia DAS (sem CBS)')
    expect(r.texto).toContain('Guia DARF (CBS por fora)')
    const conv = calcularConvencional({ anexoId: 'III', rbt12: 500000, receitaMes: 40000 })
    const hib = calcularHibrido({
      convencional: conv,
      debitosCBS: debitoCBS(40000, 'cheia', CBS_REF_PADRAO),
      creditosCBS: 0,
    })
    expect(r.texto).toContain(fmtMoeda(hib.dasReduzido))
    expect(r.texto).toContain(fmtMoeda(hib.cbsFora))
  }, 15000)

  it('"aluguel 2000" em thread híbrida recalcula o híbrido (não vira folha)', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil no híbrido' },
      { papel: 'assistant' as const, texto: 'Híbrido — Anexo III · Guia DAS' },
    ]
    const r = await responderChat('aluguel 2000', hist)
    expect(r.texto).toContain('Guia DARF')
    expect(r.texto).toContain('Aluguel')
    expect(r.texto).not.toMatch(/Alterado: folha/i)
  }, 15000)

  it('"comparar com híbrido" com números calcula em vez de despistar', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III calculado' },
    ]
    const r = await responderChat('comparar com híbrido', hist)
    expect(r.texto).toContain('Guia DAS (sem CBS)')
    expect(r.texto).toContain('Guia DARF')
  }, 15000)

  it('convencional continua sem número híbrido (só botões)', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil', [])
    expect(r.texto).toContain('DAS')
    expect(r.texto).not.toContain('DAS reduzido')
    expect(r.texto).not.toContain('DARF')
    expect(r.botoes?.some((b) => /híbrido/i.test(b.rotulo))).toBe(true)
  }, 15000)
})
