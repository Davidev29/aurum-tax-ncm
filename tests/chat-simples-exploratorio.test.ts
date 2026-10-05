/**
 * Simples exploratório sem empresa — matriz I–V + híbrido com despesas.
 *
 * Cobre o pedido: usuário sem empresa quer saber quanto pagaria no Simples
 * em todos os anexos, com diferenças/particularidades, comparação híbrida
 * (despesas/créditos STEP-BY-STEP), gráficos e relatório customizado.
 */
import { describe, expect, it } from 'vitest'
import { responderChat, montarRelatorioSimplesChat } from '@/application/aurum-ai-chat'
import {
  acumularDespesas,
  detectarModoExploratorio,
  extrairCbsRef,
  extrairDespesasDoTexto,
  orquestrarTodosAnexos,
  reconstruirEstadoColeta,
  textoExploratorioCompleto,
  DESPESAS_REFERENCIA,
  totalCreditosChat,
} from '@/application/aurum-ai-simples-exploratorio'
import { graficoConvHibTodosAnexos } from '@/application/aurum-ai-graficos'

describe('exploratório: detecção sem empresa', () => {
  it('sem empresa + simples sem anexo abre exploratório', () => {
    expect(detectarModoExploratorio('não tenho empresa, quanto pagaria no simples nacional?', null)).toBe(true)
  })
  it('todos os anexos abre exploratório', () => {
    expect(detectarModoExploratorio('quanto fica em todos os anexos? RBT12 500 mil receita 40 mil', null)).toBe(true)
  })
  it('anexo explícito I continua individual (guard Fator R)', () => {
    expect(detectarModoExploratorio('Quanto vou pagar de imposto no Anexo I do simples? RBT12 12 mil receita 36 mil', 'I')).toBe(false)
  })
  it('anexo explícito + plural forte abre matriz', () => {
    expect(detectarModoExploratorio('Anexo III, mas compara todos os anexos? RBT12 500 mil receita 40 mil', 'III')).toBe(true)
  })
})

describe('exploratório: coletor STEP-BY-STEP', () => {
  it('sem números pede Passo 1 (RBT12), sem projetar DAS', async () => {
    const r = await responderChat('não tenho empresa, quanto pagaria no simples nacional?', [])
    expect(r.texto).toMatch(/Passo 1 de 4/)
    expect(r.texto).toMatch(/RBT12/)
    expect(r.texto).not.toMatch(/Menor carga/)
  })
  it('só RBT12 pede Passo 2 (receita)', async () => {
    const r = await responderChat('RBT12 500 mil', [
      { papel: 'user', texto: 'não tenho empresa, quanto pagaria no simples nacional?' },
      { papel: 'assistant', texto: 'Passo 1 de 4 — RBT12' },
    ])
    expect(r.texto).toMatch(/Passo 2 de 4/)
    expect(r.texto).toMatch(/receita/i)
  })
  it('RBT12 + receita gera matriz I–V com particularidades e híbrido pessimista', async () => {
    const r = await responderChat('não tenho empresa, RBT12 500 mil e receita 40 mil, quanto pagaria em cada anexo?', [])
    expect(r.texto).toMatch(/cada anexo/)
    expect(r.texto).toMatch(/Anexo I/)
    expect(r.texto).toMatch(/Anexo V/)
    expect(r.texto).toMatch(/Menor carga/)
    expect(r.texto).toMatch(/O que muda entre os anexos/)
    expect(r.texto).toMatch(/Híbrido/)
    expect(r.grafico).not.toBeNull()
    expect(r.relatorioOpcoes?.base).toBe('simples')
  })
  it('matriz traz 5 anexos ordenáveis e vencedor determinístico', () => {
    const res = orquestrarTodosAnexos({ rbt12: 500000, receitaMes: 40000, folha12: null, cbsRef: 0.088, despesas: [] })
    expect(res.linhas).toHaveLength(5)
    const txt = textoExploratorioCompleto({ rbt12: 500000, receitaMes: 40000, folha12: null, cbsRef: 0.088, despesas: [] }, res, { mostrarHibrido: true })
    expect(txt).toContain(`Anexo ${res.vencedorConvId}`)
  })
})

describe('híbrido: despesas de referência + novas', () => {
  it('extrai despesas conhecidas com valores PT-BR', () => {
    const d = extrairDespesasDoTexto('aluguel 2000, energia R$ 350')
    expect(d.find((x) => x.rotulo === 'Aluguel')?.valor).toBe(2000)
    expect(d.find((x) => x.rotulo === 'Energia elétrica')?.valor).toBe(350)
  })
  it('acumula falas e última menção vence', () => {
    const d = acumularDespesas(['aluguel 1500', 'aluguel 2000'])
    expect(d.find((x) => x.rotulo === 'Aluguel')?.valor).toBe(2000)
  })
  it('adicionar nova despesa genérica', () => {
    const d = extrairDespesasDoTexto('adicionar contador 800 integral')
    // "contador" cai no bucket Contabilidade (regra do plano de contas)
    expect(d.some((x) => /contab|contador/i.test(x.rotulo) && x.valor === 800)).toBe(true)
  })
  it('total de créditos da referência bate com a planilha (110,00 a 8,8%)', () => {
    // 1500×30% + 300 + 150 + 50 + 300 = 1250 base × 8,8% = 110,00
    expect(totalCreditosChat([...DESPESAS_REFERENCIA], 0.088)).toBeCloseTo(110, 2)
  })
  it('CBS ref extrai percentual', () => {
    expect(extrairCbsRef('cbs de referência 9%')).toBeCloseTo(0.09, 4)
  })
  it('híbrido sem despesas pede referência STEP-BY-STEP (não chuta crédito)', async () => {
    const r = await responderChat('__COMPARAR_HIBRIDO__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO=III CBSREF=0.088', [])
    expect(r.texto).toMatch(/referência/i)
    expect(r.texto).toMatch(/usar referência/i)
  })
  it('híbrido com despesas mostra débitos − créditos (débito = receita × ref)', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'aluguel 1500, energia 300, telefone 150, água 50, material 300' },
      { papel: 'assistant' as const, texto: 'anotado' },
    ]
    const r = await responderChat('__COMPARAR_HIBRIDO__ RBT12=500000 RECEITA=40000 FOLHA=0 ANEXO=III CBSREF=0.088', hist)
    expect(r.texto).toMatch(/débitos.*−.*créditos|débitos.*-.*créditos/i)
    // débito cheio = 40000 × 8,8% = 3520,00 (nunca cbsDentroDAS)
    expect(r.texto).toContain('R$ 3.520,00')
  })
  it('reconstruir estado acumula despesas da conversa', () => {
    const s = reconstruirEstadoColeta('e aluguel 2000?', ['RBT12 500 mil receita 40 mil', 'aluguel 1500'])
    expect(s.rbt12).toBe(500000)
    expect(s.despesas.find((d) => d.rotulo === 'Aluguel')?.valor).toBe(2000)
  })
})

describe('exploratório: gráficos e relatório customizado', () => {
  it('gráfico Conv×Híb por anexo tem 2 séries e tabela', () => {
    const res = orquestrarTodosAnexos({ rbt12: 500000, receitaMes: 40000, folha12: null, cbsRef: 0.088, despesas: [] })
    const g = graficoConvHibTodosAnexos(res.linhas.map((l) => ({ id: l.anexo, conv: l.das, hib: l.totalHibrido })))
    expect(g.series).toHaveLength(2)
    expect(g.labels).toHaveLength(5)
    expect(g.colunas?.length).toBeGreaterThan(0)
  })
  it('relatório simples gera CSV/JSON/TXT com os 5 anexos', () => {
    const entrada = { rbt12: 500000, receitaMes: 40000, folha12: null, cbsRef: 0.088, despesas: [] }
    const resultado = orquestrarTodosAnexos(entrada)
    const base = { titulo: 't', pergunta: 'p', geradoEm: 'agora', entrada, resultado }
    const csv = montarRelatorioSimplesChat(base, 'csv')
    expect(csv.nome).toMatch(/\.csv$/)
    expect(csv.conteudo).toContain('Anexo I')
    const json = montarRelatorioSimplesChat(base, 'json')
    expect(() => JSON.parse(json.conteudo)).not.toThrow()
    const txt = montarRelatorioSimplesChat(base, 'txt')
    expect(txt.mime).toContain('text/plain')
  })
  it('"gera relatório dessa simulação" congela os números (base simples)', async () => {
    const hist = [
      { papel: 'user' as const, texto: 'não tenho empresa, RBT12 500 mil e receita 40 mil' },
      { papel: 'assistant' as const, texto: 'matriz I–V' },
    ]
    const r = await responderChat('gera relatório dessa simulação do Simples', hist)
    expect(r.relatorioOpcoes?.base).toBe('simples')
    expect(r.botoes?.some((b) => b.acao === 'formato')).toBe(true)
  })
})
