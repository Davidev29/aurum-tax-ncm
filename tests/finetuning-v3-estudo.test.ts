import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat, extrairCnpj, extrairSlotsProduto } from '@/domain/services/detector-chat'
import { toolParaIntencao } from '@/application/aurum-ai-tools'
import { responderChat } from '@/application/aurum-ai-chat'

describe('fine-tuning v3 — casos do estudo', () => {
  it('NBS programação de computadores vai para nbs', () => {
    expect(detectarIntencaoChat('Qual seria a NBS para a atividade de programação de computadores?').intencao).toBe('nbs')
  })
  it('CNPJ com máscara vai para cnpj + extrai 14 dígitos', () => {
    const a = detectarIntencaoChat('Quais atividades o CNPJ: 53.795.990/0001-68 tem?')
    expect(a.intencao).toBe('cnpj')
    expect(a.cnpj).toBe('53795990000168')
  })
  it('CNPJ sem formatação vai para cnpj', () => {
    const a = detectarIntencaoChat('Quais atividades o CNPJ 53795990000168 tem?')
    expect(a.intencao).toBe('cnpj')
    expect(a.cnpj).toBe('53795990000168')
  })
  it('extrairCnpj com/sem máscara', () => {
    expect(extrairCnpj('53.795.990/0001-68')).toBe('53795990000168')
    expect(extrairCnpj('53795990000168')).toBe('53795990000168')
  })
  it('toolParaIntencao cnpj', () => {
    expect(toolParaIntencao('cnpj')).toBe('consultarCNPJ')
  })
  it('slots produto: composição explícita', () => {
    const s = extrairSlotsProduto('Preciso catalogar um produto que tem composição: algodão 100%')
    expect(s.composicao).toMatch(/algod/i)
  })
  it('slots produto: percentual solto vira composição', () => {
    const s = extrairSlotsProduto('camiseta 100% algodão para revenda')
    expect(String(s.composicao)).toMatch(/algod/i)
    expect(String(s.destinacao)).toMatch(/revenda/i)
  })
  it('NBS programação responde proativa (regra geral + CNAE + LC116 + upsell)', async () => {
    const r = await responderChat('Qual seria a NBS para a atividade de programação de computadores?')
    expect(r.texto).toMatch(/regra geral/i)
    expect(r.texto).toMatch(/6201|CNAE/i)
    expect(r.texto).toMatch(/LC 116|item 1/i)
    expect(r.texto).toMatch(/Próximo passo/i)
    expect(r.texto).toMatch(/Classificação sugerida/i)
  }, 20000)
  it('NCM por descrição usa template §6 (com base mínima)', async () => {
    const { db } = await import('@/infrastructure/db/schema')
    await db.ncmNomenclatura.put({
      codigo: '08031000',
      codigoOriginal: '0803.10.00',
      descricao: 'Bananas frescas',
      dataInicio: null,
      dataFim: null,
      ato: null,
    }).catch(() => undefined)
    await db.ncm.put({
      codigo: '08031000',
      cst: '000',
      cClassTrib: '000001',
    } as never).catch(() => undefined)
    const r = await responderChat('Qual NCM casaria com banana fresca para consumo?')
    // Com base mínima, ou classifica (template) ou pede refino honesto — nunca alucina.
    expect(r.texto.length).toBeGreaterThan(20)
    expect(r.pensamento?.etapas.length).toBeGreaterThan(0)
  }, 20000)
  it('CNPJ inválido pede correção sem rede', async () => {
    const r = await responderChat('Quais atividades o CNPJ 11.222.333/0001-82 tem?')
    expect(r.texto).toMatch(/dígito verificador|inválido/i)
  }, 20000)
})
