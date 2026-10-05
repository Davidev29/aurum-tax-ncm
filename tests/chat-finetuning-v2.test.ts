import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import { ehConversaLeve, temSinalFiscal } from '@/domain/services/escopo-consulta'
import { responderChat } from '@/application/aurum-ai-chat'
import { encontrarConceito } from '@/application/aurum-ai-conhecimento'
import { extrairContextoConversa, toolParaIntencao } from '@/application/aurum-ai-tools'

describe('finetuning v2 — novas intenções', () => {
  it('conceito: "o que é Fator R?"', () => {
    expect(detectarIntencaoChat('o que é Fator R?').intencao).toBe('conceito')
  })
  it('conceito: "o que é sublimite?"', () => {
    expect(detectarIntencaoChat('o que é sublimite?').intencao).toBe('conceito')
  })
  it('conceito: "me explica o que é IBS?"', () => {
    expect(detectarIntencaoChat('me explica o que é IBS?').intencao).toBe('conceito')
  })
  it('comparativo: "qual melhor III ou V?"', () => {
    expect(detectarIntencaoChat('qual melhor: Anexo III ou V?').intencao).toBe('comparativo')
  })
  it('comparativo: "vale a pena migrar para o III?"', () => {
    expect(detectarIntencaoChat('vale a pena migrar para o III?').intencao).toBe('comparativo')
  })
  it('conversa_leve: "obrigado!"', () => {
    expect(detectarIntencaoChat('obrigado!').intencao).toBe('conversa_leve')
  })
  it('NBS não vira conceito: "qual NBS para aula de yoga?"', () => {
    expect(detectarIntencaoChat('qual seria a nbs para aula de yoga?').intencao).toBe('nbs')
  })
  it('"quem é você?" continua capacidades', () => {
    expect(detectarIntencaoChat('quem é você?').intencao).toBe('capacidades')
  })
})

describe('finetuning v2 — escopo 3 níveis', () => {
  it('conversa leve nunca é fora de escopo', () => {
    expect(ehConversaLeve('bom dia')).toBe(true)
    expect(ehConversaLeve('obrigado')).toBe(true)
  })
  it('termo do sistema é lastro (não bloqueia)', () => {
    expect(temSinalFiscal('o que é IBS?')).toBe(true)
    expect(temSinalFiscal('diferença entre anexo III e V')).toBe(true)
  })
})

describe('finetuning v2 — conhecimento simples', () => {
  it('encontra verbete de Fator R', () => {
    expect(encontrarConceito('o que é Fator R?')?.chave).toBe('fator_r')
  })
  it('termo fora do sistema retorna null', () => {
    expect(encontrarConceito('o que é buraco negro?')).toBeNull()
  })
})

describe('finetuning v2 — tool calling', () => {
  it('intenção → tool correta', () => {
    expect(toolParaIntencao('conceito')).toBe('explicarConceito')
    expect(toolParaIntencao('comparativo')).toBe('simularComparativo')
    expect(toolParaIntencao('calculo')).toBe('calcularIBSCBS')
    expect(toolParaIntencao('simples')).toBe('calcularSimples')
  })
  it('contexto: extrai NCM + valor do histórico', () => {
    const ctx = extrairContextoConversa([
      { papel: 'user', texto: 'quanto fica R$ 2.500 no NCM 08031000?' },
      { papel: 'assistant', texto: 'NCM 0803.10.00 sobre base R$ 2.500,00' },
    ])
    expect(ctx.ultimoCodigoNcm).toBe('08031000')
    expect(ctx.houveCalculo).toBe(true)
  })
})

describe('finetuning v2 — orquestrador com contexto', () => {
  it('conceito responde sem inventar número', async () => {
    const r = await responderChat('o que é Fator R?')
    expect(r.texto).toContain('Fator R')
    expect(r.texto).toContain('28%')
  }, 15000)

  it('comparativo explica sem simular quando sem números', async () => {
    const r = await responderChat('qual melhor: Anexo III ou V?')
    expect(r.texto).toContain('III')
    expect(r.botoes?.some((b) => b.alvo === 'simples')).toBe(true)
  }, 15000)

  it('conversa leve responde breve', async () => {
    const r = await responderChat('obrigado!')
    expect(r.texto.toLowerCase()).toContain('por nada')
  })

  it('cálculo herda NCM do contexto ("e para 5 mil?")', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'quanto fica R$ 1.000 no NCM 08031000?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00 sobre base R$ 1.000,00' },
    ]
    const r = await responderChat('e para 5 mil?', hist)
    expect(r.texto).toContain('0803.10.00')
    expect(r.texto).toContain('5.000')
  }, 15000)

  it('simples herda contexto ("e com folha 200 mil?")', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'meu DAS no Anexo III com RBT12 500 mil e receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III · RBT12 R$ 500.000' },
    ]
    const r = await responderChat('e com folha de 200 mil?', hist)
    expect(r.texto).toContain('Anexo III')
    expect(r.texto).toContain('DAS')
  }, 15000)

  it('relatório entende "desse cálculo"', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'quanto fica R$ 1.000 no NCM 08031000?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00 ...' },
    ]
    const r = await responderChat('gera um relatório desse cálculo', hist)
    expect(r.relatorioOpcoes).not.toBeNull()
    expect(r.botoes?.filter((b) => b.acao === 'formato').length).toBe(4)
  }, 15000)

  it('fora do sistema continua recusando', async () => {
    const r = await responderChat('me conta uma piada')
    expect(r.texto).toContain('Aurum AI')
    expect(r.texto.toLowerCase()).toContain('profissional')
  }, 15000)

  it('simples sem valores PERGUNTA (caso do print: só "anexo III")', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'Quanto fica R$ 1.000 no NCM 0803.10.00?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00 sobre base R$ 1.000,00 · IBS ...' },
    ]
    const r = await responderChat('Faça um calculo para mim no simples nacional anexo III.', hist)
    expect(r.texto).toContain('preciso de')
    expect(r.texto).toContain('RBT12')
    expect(r.texto).not.toContain('Contexto usado')
    expect(r.texto).not.toMatch(/DAS \*\*R\$/)
  }, 15000)

  it('base do IBS nunca vira receita do Simples', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'quanto fica R$ 7.500 no NCM 08031000?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00 ... R$ 7.500,00' },
    ]
    const r = await responderChat('e o meu DAS no Anexo III?', hist)
    // pede RBT12 e receita em vez de reaproveitar os 7.500 do IBS
    expect(r.texto).toContain('preciso de')
    expect(r.texto).not.toContain('7.500')
  }, 15000)

  it('pensamento sempre presente (todas as respostas estudam a ação)', async () => {
    const casos = [
      'o que você pode fazer?',
      'obrigado!',
      'oi',
      'me conta uma piada',
      'xyzblt',
      'o que é Fator R?',
      'qual melhor: Anexo III ou V?',
    ]
    for (const c of casos) {
      const r = await responderChat(c)
      expect(r.pensamento?.etapas.length, c).toBeGreaterThan(0)
    }
  }, 30000)

  it('conversa social responde com limite (sem recusar)', async () => {
    const r = await responderChat('como você está?')
    expect(r.texto.toLowerCase()).toContain('tudo bem')
    expect(r.texto.toLowerCase()).not.toContain('foge do meu escopo')
  })

  it('outra área é recusada (ex.: cirurgia)', async () => {
    const r = await responderChat('como fazer uma cirurgia de apendicite?')
    expect(r.texto.toLowerCase()).toContain('profissional')
  }, 15000)

  it('saudação varia (mesmo "oi" não repete o template)', async () => {
    const r1 = await responderChat('oi')
    const r2 = await responderChat('oi')
    expect(r1.texto).toContain('Aurum AI')
    expect(r2.texto).toContain('Aurum AI')
    expect(r1.texto).not.toBe(r2.texto)
  }, 15000)

  it('conversa leve varia ("obrigado" mantém ponte, muda o texto)', async () => {
    const r1 = await responderChat('obrigado!')
    const r2 = await responderChat('obrigado!')
    expect(r1.texto.toLowerCase()).toContain('por nada')
    expect(r2.texto.toLowerCase()).toContain('por nada')
    expect(r1.texto).not.toBe(r2.texto)
  }, 15000)
})
