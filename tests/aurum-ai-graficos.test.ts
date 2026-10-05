import { describe, expect, it } from 'vitest'
import {
  alvoGraficoDados,
  aplicarTipoPreferido,
  detectarPedidoGrafico,
  ehPedidoVisualPuro,
  graficoApuracao,
  graficoCalculoIBS,
  graficoClientes,
  graficoComparativoAnexos,
  graficoConvXHibrido,
  graficoDiferidos,
  graficoEvolucaoMensal,
  graficoFornecedores,
  graficoNcms,
  graficoProdutos,
  graficoReducoes,
  graficoReparticaoDAS,
  planejarGraficoDados,
  sugestaoGrafico,
} from '@/application/aurum-ai-graficos'
import { anexarPedidoGrafico, refinarIntencaoComContexto } from '@/application/aurum-ai-tools'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'

describe('graficos — agente 1: pedido visual', () => {
  it('detecta pizza/barra/linha/tabela', () => {
    expect(detectarPedidoGrafico('mostra em gráfico pizza os fornecedores')).toEqual({ quer: true, tipo: 'pizza' })
    expect(detectarPedidoGrafico('gráfico de barras do DAS')).toEqual({ quer: true, tipo: 'barra' })
    expect(detectarPedidoGrafico('evolução mensal em linha')).toEqual({ quer: true, tipo: 'linha' })
    expect(detectarPedidoGrafico('tabela dos produtos que mais vendi')).toEqual({ quer: true, tipo: 'tabela' })
    expect(detectarPedidoGrafico('mostra em gráfico')).toEqual({ quer: true, tipo: null })
  })
  it('ignora navegar para telas e texto sem visual', () => {
    expect(detectarPedidoGrafico('me leva para tabelas auxiliares').quer).toBe(false)
    expect(detectarPedidoGrafico('qual o NCM de banana?').quer).toBe(false)
    expect(detectarPedidoGrafico('').quer).toBe(false)
  })
  it('anexarPedidoGrafico preserva a intenção fiscal', () => {
    const base = detectarIntencaoChat('qual fornecedor me dá mais crédito? mostra em gráfico pizza')
    expect(base.intencao).toBe('dados')
    const comMod = anexarPedidoGrafico(base, 'qual fornecedor me dá mais crédito? mostra em gráfico pizza')
    expect(comMod.intencao).toBe('dados')
    expect(comMod.querGrafico).toBe(true)
    expect(comMod.tipoGrafico).toBe('pizza')
  })
  it('follow-up "mostra em pizza" herda dados do contexto', () => {
    const hist = [
      { papel: 'user' as const, texto: 'qual fornecedor me dá mais crédito?' },
      { papel: 'assistant' as const, texto: 'Top crédito: Fornecedor A' },
    ]
    const base = detectarIntencaoChat('mostra em pizza')
    const refinada = refinarIntencaoComContexto(base, 'mostra em pizza', hist)
    expect(refinada.intencao).toBe('dados')
    const comMod = anexarPedidoGrafico(refinada, 'mostra em pizza')
    expect(comMod.querGrafico).toBe(true)
    expect(comMod.tipoGrafico).toBe('pizza')
  })
  it('follow-up visual herda simples/calculo', () => {
    const histS = [
      { papel: 'user' as const, texto: 'meu DAS no Anexo III com RBT12 500 mil e receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III · DAS' },
    ]
    expect(refinarIntencaoComContexto(detectarIntencaoChat('mostra em gráfico'), 'mostra em gráfico', histS).intencao).toBe('simples')
    const histC = [
      { papel: 'user' as const, texto: 'quanto fica R$ 1.000 no NCM 08031000?' },
      { papel: 'assistant' as const, texto: 'NCM 0803.10.00 sobre base R$ 1.000,00' },
    ]
    expect(refinarIntencaoComContexto(detectarIntencaoChat('e em gráfico de barras?'), 'e em gráfico de barras?', histC).intencao).toBe('calculo')
  })
  it('pedido visual puro herda o domínio mesmo quando o detector mira o RAG', () => {
    expect(ehPedidoVisualPuro('mostra em tabela')).toBe(true)
    expect(ehPedidoVisualPuro('e em pizza?')).toBe(true)
    expect(ehPedidoVisualPuro('tabela dos produtos que mais vendi')).toBe(false)
    expect(ehPedidoVisualPuro('qual o NCM de banana?')).toBe(false)
    const histS = [
      { papel: 'user' as const, texto: 'meu DAS no Anexo III com RBT12 500 mil e receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III · DAS' },
    ]
    // "mostra em tabela" sozinho cai em ncm pelo lastro — o refino promove a simples.
    const base = detectarIntencaoChat('mostra em tabela')
    expect(refinarIntencaoComContexto(base, 'mostra em tabela', histS).intencao).toBe('simples')
  })
})

describe('graficos — agente 2: builders puros', () => {
  it('repartição: 8 fatias somam o DAS', () => {
    const g = graficoReparticaoDAS({ IRPJ: 100, CSLL: 50, CBS: 80, IBS: 20, CPP: 60, ICMS: 30, IPI: 10, ISS: 50 }, 'III')
    expect(g.tipo).toBe('pizza')
    expect(g.labels).toHaveLength(8)
    const soma = g.series[0].valores.reduce((a, b) => a + b, 0)
    expect(soma).toBeCloseTo(400, 2)
    expect(g.origem).toBe('simples:reparticao')
    expect(g.alternativas).toContain('tabela')
  })
  it('comparativo anexos: 5 barras + menor carga no insight', () => {
    const g = graficoComparativoAnexos(
      [{ id: 'I', das: 1000 }, { id: 'II', das: 1200 }, { id: 'III', das: 800 }, { id: 'IV', das: 1100 }, { id: 'V', das: 1500 }],
      500000,
      40000,
    )
    expect(g.labels).toEqual(['Anexo I', 'Anexo II', 'Anexo III', 'Anexo IV', 'Anexo V'])
    expect(g.insight).toContain('III')
  })
  it('conv×híb: veredito coerente com economia', () => {
    const g = graficoConvXHibrido({ anexo: 'III', dasConv: 5000, dasReduzido: 4200, cbsFora: 300, totalHib: 4500, economia: 500 })
    expect(g.series[0].valores).toEqual([5000, 4500])
    expect(g.insight).toContain('Híbrido vence')
  })
  it('cálculo IBS×CBS com tabela de 3 linhas', () => {
    const g = graficoCalculoIBS('0803.10.00', 190, 90, 1000)
    expect(g.labels).toEqual(['IBS', 'CBS'])
    expect(g.linhasTabela).toHaveLength(3)
  })
  it('fornecedores ordena desc e ignora vazio', () => {
    expect(graficoFornecedores([])).toBeNull()
    const g = graficoFornecedores([
      { nome: 'B', creditoTotal: 100 },
      { nome: 'A', creditoTotal: 900 },
    ])!
    expect(g.labels[0]).toContain('A')
    expect(g.insight).toContain('A')
  })
  it('produtos/reduções/diferidos/ncm/clientes/evolução', () => {
    expect(graficoProdutos([], 'débito (vendas)')).toBeNull()
    expect(graficoProdutos([{ nome: 'Queijo', trib: 150 }], 'débito (vendas)')!.tipo).toBe('barra')
    expect(graficoReducoes([{ rotulo: 'redução 60%', base: 500 }])!.tipo).toBe('pizza')
    expect(graficoDiferidos([{ nome: 'Feijão', base: 200 }])!.tipo).toBe('barra')
    expect(graficoNcms([{ ncm: '04061000', base: 300 }])!.tipo).toBe('barra')
    expect(graficoClientes([{ razaoSocial: 'Padaria', base: 1000, qtdNotas: 3 }])!.tipo).toBe('barra')
    expect(graficoEvolucaoMensal([{ rotulo: '01/26', baseEntradas: 10, baseSaidas: 20 }])).toBeNull()
    const ev = graficoEvolucaoMensal([
      { rotulo: '01/26', baseEntradas: 10, baseSaidas: 20 },
      { rotulo: '02/26', baseEntradas: 15, baseSaidas: 18 },
    ])!
    expect(ev.tipo).toBe('linha')
    expect(ev.series).toHaveLength(2)
    const ap = graficoApuracao({ credito: 100, debito: 250, saldo: 150, resultado: 'a pagar' })
    expect(ap.insight).toContain('cobrem')
  })
  it('aplicarTipoPreferido troca e preserva alternativa', () => {
    const g = graficoCalculoIBS('0803.10.00', 190, 90, 1000)
    const pizza = aplicarTipoPreferido(g, 'pizza')
    expect(pizza.tipo).toBe('pizza')
    expect(pizza.alternativas).toContain('barra')
    // linha com 2 categorias é válida (IBS × CBS)
    expect(aplicarTipoPreferido(g, 'linha').tipo).toBe('linha')
    // linha com 1 ponto não troca (proteção)
    const unit = graficoFornecedores([{ nome: 'Só', creditoTotal: 10 }])!
    expect(aplicarTipoPreferido(unit, 'linha').tipo).toBe('barra')
  })
  it('payload é serializável (persiste no Dexie)', () => {
    const g = graficoReparticaoDAS({ IRPJ: 1, CSLL: 1, CBS: 1, IBS: 1, CPP: 1, ICMS: 1, IPI: 1, ISS: 1 }, 'I')
    expect(() => JSON.parse(JSON.stringify(g))).not.toThrow()
    expect(JSON.stringify(g).length).toBeLessThan(8000)
  })
  it('sem sinal (tudo zerado) força tabela e bloqueia pizza vazia', () => {
    const z = graficoProdutos(
      [
        { nome: 'FRANGO', trib: 0 },
        { nome: 'FIGADO', trib: 0 },
      ],
      'débito (vendas)',
    )!
    expect(z.tipo).toBe('tabela')
    expect(z.alternativas).toContain('barra')
    expect(aplicarTipoPreferido(z, 'pizza').tipo).toBe('tabela')
  })
  it('valores pequenos mantêm barra visível (caso do print R$ 0–1)', () => {
    const g = graficoProdutos(
      [
        { nome: 'FRANGO ABATIDO IN NATURA', trib: 0.4 },
        { nome: 'FIGADO BOVINO FRIGOCAL', trib: 0.3 },
        { nome: 'PORCO BANDA', trib: 0.2 },
      ],
      'débito (vendas)',
    )!
    expect(g.tipo).toBe('barra')
    expect(g.series[0].valores).toEqual([0.4, 0.3, 0.2])
  })
})

describe('graficos — agente 2: roteador dados', () => {
  const agg = {
    fornecedores: [{ nome: 'Fornecedor A', creditoTotal: 900 }],
    produtosCred: [{ nome: 'Queijo', trib: 100 }],
    produtosDeb: [{ nome: 'Arroz', trib: 300 }],
    reducoes: [{ rotulo: 'sem redução', base: 1000 }],
    diferidosEfetivos: [{ nome: 'Feijão', base: 200 }],
    diferidosCondicionais: [],
    ncms: [{ ncm: '04061000', exemplo: 'Queijo', base: 500 }],
    resumo: { credito: 900, debito: 1200, saldo: 300, resultado: 'a pagar' },
  }
  it('fornecedor → dados:fornecedores', () => {
    expect(planejarGraficoDados('qual fornecedor me dá mais crédito?', agg)!.origem).toBe('dados:fornecedores')
  })
  it('produto vendido → debito; comprado → credito', () => {
    expect(planejarGraficoDados('quais produtos vendi mais?', agg)!.origem).toContain('debito')
    expect(planejarGraficoDados('o que mais comprei?', agg)!.origem).toContain('credito')
  })
  it('quais produtos cliente X vendeu mais → débito do escopo', () => {
    const g = planejarGraficoDados('quais produtos o cliente Padaria vendeu mais?', agg)!
    expect(g.origem).toContain('produtos')
  })
  it('diferidos/reduções/ncm/apuração roteiam certo', () => {
    expect(planejarGraficoDados('existe produto diferido?', agg)!.origem).toBe('dados:diferidos')
    expect(planejarGraficoDados('quais reduções nas notas?', agg)!.origem).toBe('dados:reducoes')
    expect(planejarGraficoDados('tributação por NCM', agg)!.origem).toBe('dados:ncm')
    expect(planejarGraficoDados('quanto comprei e vendi?', agg)!.origem).toBe('dados:apuracao')
  })
  it('tipo preferido sobrescreve o padrão', () => {
    const g = planejarGraficoDados('qual fornecedor me dá mais crédito?', agg, 'pizza')!
    expect(g.tipo).toBe('pizza')
  })
})

describe('graficos — agente 3: sugestão rotineira', () => {
  it('sugestão tem frase + 2 botões perguntar com contexto', () => {
    const s = sugestaoGrafico(alvoGraficoDados('compras (entradas)'))
    expect(s.frase).toContain('gráfico')
    expect(s.botoes).toHaveLength(2)
    expect(s.botoes[0].acao).toBe('perguntar')
    expect(s.botoes[0].alvo).toContain('compras')
  })
})

describe('graficos — integração no orquestrador', () => {
  it('simples gera visual preditivo (sem pedido)', async () => {
    const { responderChat } = await import('@/application/aurum-ai-chat')
    const r = await responderChat('meu DAS no Anexo III com RBT12 500 mil e receita 40 mil')
    expect(r.texto).toContain('DAS')
    // Preditivo: o artefato já vem anexado, com alternador no cartão.
    expect(r.grafico?.origem).toBe('simples:reparticao')
    expect(r.texto).toContain('Gráfico')
    expect(r.botoes?.some((b) => b.rotulo === '📊 Ver gráfico')).toBe(true)
  }, 15000)
  it('simples com pedido anexa pizza da repartição', async () => {
    const { responderChat } = await import('@/application/aurum-ai-chat')
    const r = await responderChat('meu DAS no Anexo III com RBT12 500 mil e receita 40 mil, mostra em gráfico pizza')
    expect(r.grafico?.origem).toBe('simples:reparticao')
    expect(r.grafico?.tipo).toBe('pizza')
    expect(r.grafico?.labels).toHaveLength(8)
  }, 15000)
  it('follow-up "mostra em tabela" herda o DAS e anexa tabela', async () => {
    const { responderChat } = await import('@/application/aurum-ai-chat')
    const hist = [
      { papel: 'user' as const, texto: 'meu DAS no Anexo III com RBT12 500 mil e receita 40 mil' },
      { papel: 'assistant' as const, texto: 'Anexo III · DAS R$ 1,00' },
    ]
    const r = await responderChat('mostra em tabela', hist)
    expect(r.grafico?.origem).toBe('simples:reparticao')
    expect(r.grafico?.tipo).toBe('tabela')
    expect(r.grafico?.colunas?.length).toBeGreaterThan(0)
  }, 15000)
  it('comparativo de anexos já sai com gráfico', async () => {
    const { responderChat } = await import('@/application/aurum-ai-chat')
    const r = await responderChat('__COMPARAR_ANEXOS__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO_ATUAL=III')
    expect(r.grafico?.origem).toBe('simples:comparativo-anexos')
    expect(r.grafico?.labels).toHaveLength(5)
  }, 15000)
})
