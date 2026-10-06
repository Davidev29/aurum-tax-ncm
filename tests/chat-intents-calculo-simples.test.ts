/**
 * Cobertura de intenções CÁLCULO e SIMPLES (curadoria multiagente, 80 formas).
 * Oráculo: detector (intenção/código/valor) + slots do Simples.
 * Segue o molde de `tests/chat-valores.test.ts` (valores PT-BR já provados).
 */
import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import {
  extrairSlotsSimples,
  extrairTodosValores,
  resolverFolhaPercentual,
  detectarPerguntaAliquota,
} from '@/domain/services/valores-chat'

describe('cálculo IBS/CBS — 40 formas (âncora NCM 08031000)', () => {
  it.each([
    ['quanto fica o NCM 08031000 com R$ 2.500?', 2500],
    ['calcula o NCM 08031000 no valor de R$ 2.500,00', 2500],
    ['simula NCM 08031000 valor 2500', 2500],
    ['R$ 2500 no NCM 08031000 quanto dá?', 2500],
    ['2500 no 08031000', 2500],
    ['08031000 com valor de 2500', 2500],
    ['2,5 mil no NCM 08031000', 2500],
    ['calcula 08031000 de 5 mil', 5000],
    ['quanto fica 08031000 de R$ 10.000?', 10000],
    ['qual o valor com imposto do NCM 08031000 de 1000 reais?', 1000],
    ['IBS/CBS do 08031000 sobre 2500', 2500],
    ['simulação IBS e CBS NCM 08031000 base R$ 7.500,50', 7500.5],
    ['base de 2500 para o código 08031000', 2500],
    ['calcula pra mim 2.500 no 08031000 por favor', 2500],
    ['quanto fica o ncm 08031000 de 1 milhão?', 1000000],
    ['quanto fica 08031000 de 1,5 mi?', 1500000],
    ['R$ 5.000 reais no NCM 08031000', 5000],
    ['calcula o produto 08031000 vendido por 2.500', 2500],
    ['NCM 08031000, valor base 2.500, quanto dá de imposto?', 2500],
    ['de 2500 quanto fica no 08031000?', 2500],
    ['08031000 — R$ 0,99', 0.99],
    ['quanto fica 2.500,00 no NCM: 08031000?', 2500],
    ['refaz o cálculo do 08031000 com 3.000', 3000],
    ['carga tributária do NCM 08031000 em 2.500 reais', 2500],
  ])('%s → calculo, valor %s', (pergunta, valor) => {
    const a = detectarIntencaoChat(pergunta)
    expect(a.intencao).toBe('calculo')
    expect(a.codigoDigitos).toBe('08031000')
    expect(a.valorBase).toBe(valor)
  })

  it('código formatado com pontos é extraído', () => {
    const a = detectarIntencaoChat('R$ 2,5 mil para o NCM 0803.10.00')
    expect(a.intencao).toBe('calculo')
    expect(a.codigoDigitos).toBe('08031000')
    expect(a.valorBase).toBe(2500)
  })

  it('follow-up herda contexto (sem código na frase)', () => {
    const a = detectarIntencaoChat('e para 5 mil?')
    expect(extrairTodosValores('e para 5 mil?').pop()?.valor).toBe(5000)
    expect(a.codigoDigitos).toBeNull()
  })

  it('negativos: conceito e NCM sem valor não são cálculo', () => {
    expect(detectarIntencaoChat('o que é IBS?').intencao).toBe('conceito')
    const ncm = detectarIntencaoChat('qual NCM da banana?')
    expect(ncm.intencao).toBe('ncm')
    expect(ncm.valorBase).toBeNull()
  })

  it('pergunta de alíquota efetiva é detectada', () => {
    expect(detectarPerguntaAliquota('qual a alíquota efetiva desse cálculo?')).not.toBeNull()
  })
})

describe('Simples Nacional — 40 formas (slots anexo/RBT/receita/folha)', () => {
  it.each([
    ['meu DAS anexo III, RBT12 500 mil, receita 40 mil', 'III', 500000, 40000, null],
    ['simula simples anexo 3 RBT12 R$ 500.000 receita R$ 40.000', 'III', 500000, 40000, null],
    ['calcula anexo III com rbt 500k e fatura 40k', 'III', 500000, 40000, null],
    ['anexo V, RBT12 1 milhão, receita 80 mil, folha 200 mil', 'V', 1000000, 80000, 200000],
    ['receita 40 mil e RBT12 500 mil no anexo III', 'III', 500000, 40000, null],
    ['sou comércio, anexo I, RBT12 200 mil, receita 30 mil', 'I', 200000, 30000, null],
    ['anexo IV com RBT12 800 mil e receita 70 mil', 'IV', 800000, 70000, null],
    ['anexo II, RBT12 400 mil, receita 35 mil', 'II', 400000, 35000, null],
    ['folha 12 de 150 mil, anexo III, RBT12 500 mil, receita 40 mil', 'III', 500000, 40000, 150000],
    ['corrige RBT12 para 600 mil', null, 600000, null, null],
    ['corrige receita para 45 mil', null, null, 45000, null],
    ['RBT 500mil receita 40mil anexo III calcula meu DAS', 'III', 500000, 40000, null],
  ])('%s → slots', (pergunta, anexo, rbt, rec, folha) => {
    expect(detectarIntencaoChat(pergunta).intencao).toBe('simples')
    const s = extrairSlotsSimples(pergunta)
    expect(s.anexo).toBe(anexo)
    expect(s.rbt12).toBe(rbt)
    expect(s.receitaMes).toBe(rec)
    expect(s.folha12).toBe(folha)
  })

  it('folha percentual resolve contra o RBT', () => {
    expect(resolverFolhaPercentual('folha 30% do RBT', 500000)).toBe(150000)
    const s = extrairSlotsSimples('anexo III, RBT12 500 mil, receita 40 mil, folha 30% do RBT')
    expect(s.folha12).toBe(150000)
  })

  it('"outro anexo" ambíguo não chuta destino', () => {
    const s = extrairSlotsSimples('e no outro anexo?')
    expect(s.anexo).toBeNull()
  })

  it('comparativo não é edição do Simples', () => {
    expect(detectarIntencaoChat('qual melhor, III ou V?').intencao).toBe('comparativo')
  })

  it('conceito não é Simples', () => {
    expect(detectarIntencaoChat('o que é Fator R?').intencao).toBe('conceito')
  })

  it('prolabore conta como folha', () => {
    const s = extrairSlotsSimples('prolabore 10 mil no anexo III, RBT12 500 mil, receita 40 mil')
    expect(s.folha12).toBe(10000)
  })

  it('intervalo vira média como referência', () => {
    const s = extrairSlotsSimples('fatura entre 63 e 65 mil no anexo III com RBT12 500 mil')
    expect(s.receitaMes).toBe(64000)
    expect(s.rbt12).toBe(500000)
  })
})
