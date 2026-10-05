import { describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import {
  extrairPercentualRobusto,
  regraCreditoDePercentual,
  regraDebitoDePercentual,
  temRegraIntegral,
  temVedacaoCredito,
} from '@/domain/services/percentual-chat'
import {
  classificarRotuloDespesaLexical,
  detectarRegraDebitoReceita,
  extrairDespesasDoTexto,
  mencionaReducaoReceita,
} from '@/application/aurum-ai-simples-exploratorio'

describe('v9 — motor de porcentagem eficiente', () => {
  it('extrai frações PT-BR com contexto', () => {
    expect(extrairPercentualRobusto('30%')).toMatchObject({ fracao: 0.3, contexto: 'direto' })
    expect(extrairPercentualRobusto('30 por cento')).toMatchObject({ fracao: 0.3 })
    expect(extrairPercentualRobusto('redução de 30%')).toMatchObject({ fracao: 0.3, contexto: 'reducao_de' })
    expect(extrairPercentualRobusto('red30')).toMatchObject({ fracao: 0.3, contexto: 'reducao_de' })
    expect(extrairPercentualRobusto('70% da alíquota')).toMatchObject({ fracao: 0.7, contexto: 'paga_x' })
    expect(extrairPercentualRobusto('alíquota zero')).toMatchObject({ fracao: 0 })
    expect(extrairPercentualRobusto('sem número aqui')).toBeNull()
  })
  it('mapeia fração → regra de crédito e débito', () => {
    expect(regraCreditoDePercentual(0.3, 'reducao_de')).toBe('red30')
    expect(regraCreditoDePercentual(0.6, 'reducao_de')).toBe('red60')
    expect(regraCreditoDePercentual(0.3, 'paga_x')).toBeNull()
    expect(regraCreditoDePercentual(0.7, 'paga_x')).toBe('red30')
    expect(regraDebitoDePercentual(0.3, 'reducao_de')).toBe('red30')
    expect(regraDebitoDePercentual(0.3, 'paga_x')).toBe('red70')
    expect(regraDebitoDePercentual(0.5, 'direto')).toBe('red50')
    expect(temVedacaoCredito('sem crédito')).toBe(true)
    expect(temRegraIntegral('integral')).toBe(true)
  })
})

describe('v9 — léxico de despesas (RAG + LEXICAL)', () => {
  it('sinônimo e typo caem no tipo canônico', () => {
    expect(classificarRotuloDespesaLexical('locação 2000')?.rotulo).toBe('Aluguel')
    expect(classificarRotuloDespesaLexical('conta de luz 300')?.rotulo).toBe('Energia elétrica')
    expect(classificarRotuloDespesaLexical('marketing 1200')).toBeNull()
  })
  it('typo via "adicionar" canonicaliza', () => {
    const d = extrairDespesasDoTexto('adicionar alugel 1500')
    expect(d.find((x) => x.rotulo === 'Aluguel')?.valor).toBe(1500)
  })
  it('regra com fonte: explícita vs assumida', () => {
    const ass = extrairDespesasDoTexto('energia 300')
    expect(ass[0]?.regra).toBe('integral')
    expect(ass[0]?.regraExplicita).toBe(false)
    const exp = extrairDespesasDoTexto('energia 300 com redução de 30%')
    expect(exp[0]?.regra).toBe('red30')
    expect(exp[0]?.regraExplicita).toBe(true)
    const alu = extrairDespesasDoTexto('aluguel 2000')
    expect(alu[0]?.regra).toBe('integral')
    expect(alu[0]?.regraExplicita).toBe(false)
  })
  it('receita com redução: regra, incerta e guarda do RBT', () => {
    expect(detectarRegraDebitoReceita('receita com redução de 30%')).toMatchObject({ regra: 'red30', incerta: false })
    expect(detectarRegraDebitoReceita('receita tem redução')).toMatchObject({ regra: null, incerta: true })
    expect(detectarRegraDebitoReceita('aumenta folha pra 30% do RBT')).toMatchObject({ regra: null, incerta: false })
    expect(mencionaReducaoReceita('Anexo III, RBT12 500 mil, receita 40 mil')).toBe(false)
    expect(mencionaReducaoReceita('faturamento com 70% da alíquota')).toBe(true)
  })
})

describe('v9 — pergunta de redução por tipo + análise final', () => {
  const base = [
    { papel: 'user' as const, texto: 'Anexo III, RBT12 500 mil, receita 40 mil no híbrido' },
    { papel: 'assistant' as const, texto: 'Híbrido — Anexo III · Guia DAS' },
  ]
  it('"energia 300" pergunta se tem redução e entrega a análise com 2 guias', async () => {
    const r = await responderChat('energia 300', base)
    expect(r.texto).toContain('tem redução')
    expect(r.texto).toContain('assumido')
    expect(r.texto).toContain('Guia DAS (sem CBS)')
    expect(r.texto).toContain('Guia DARF')
    expect(r.botoes?.some((b) => /redução de 30%/i.test(b.alvo))).toBe(true)
  }, 15000)
  it('"energia 300 com redução de 30%" aplica e não pergunta de novo', async () => {
    const r = await responderChat('energia 300 com redução de 30%', base)
    expect(r.texto).toContain('R$ 18,48')
    expect(r.texto).not.toContain('Sobre **Energia')
  }, 15000)
  it('"aluguel 2000" usa 30% da categoria sem perguntar', async () => {
    const r = await responderChat('aluguel 2000', base)
    expect(r.texto).toContain('padrão da categoria')
    expect(r.texto).not.toContain('tem redução')
    expect(r.texto).toContain('Guia DARF')
  }, 15000)
  it('"receita com redução de 30%" reduz o débito', async () => {
    const r = await responderChat('receita com redução de 30%', base)
    expect(r.texto).toContain('R$ 2.464,00')
    expect(r.texto).toContain('receita com redução de 30%')
  }, 15000)
  it('"receita tem redução" pergunta qual porcentagem', async () => {
    const r = await responderChat('receita tem redução', base)
    expect(r.texto).toContain('qual porcentagem')
    expect(r.botoes?.some((b) => b.alvo === 'receita com redução de 60%')).toBe(true)
  }, 15000)
})
