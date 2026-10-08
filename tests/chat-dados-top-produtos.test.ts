import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat, ehSinalDadosAvancado } from '@/domain/services/detector-chat'
import {
  avaliarAcoesDados,
  ehProvavelDados,
  temAnaforaDados,
} from '@/domain/services/acoes-dados'
import {
  extrairFiltrosDados,
  mesclarFiltrosComContexto,
  temAnaforaFiltro,
} from '@/application/aurum-ai-dados'
import { refinarIntencaoComContexto } from '@/application/aurum-ai-tools'

describe('bug: "quais top produtos desse cliente?" ia para NCM (semLastro)', () => {
  it('roteia direto para dados (sem histórico)', () => {
    expect(detectarIntencaoChat('quais top produtos desse cliente?').intencao).toBe('dados')
  })
  it('portão avançado reconhece top/ranking/lista com produto', () => {
    expect(ehSinalDadosAvancado('quais top produtos desse cliente')).toBe(true)
    expect(ehSinalDadosAvancado('lista os produtos vendidos')).toBe(true)
    expect(ehSinalDadosAvancado('quais produtos mais vendidos')).toBe(true)
    expect(ehSinalDadosAvancado('ranking de produtos por credito')).toBe(true)
    // Classificação pura continua fora.
    expect(ehSinalDadosAvancado('tem algum ncm de banana')).toBe(false)
    expect(ehSinalDadosAvancado('camiseta 100 algodao')).toBe(false)
  })
  it('variações do usuário vão para dados', () => {
    const casos = [
      'quais produtos mais vendidos?',
      'quais produtos mais comprados?',
      'quais produtos geraram mais crédito?',
      'quais produtos geraram mais débito?',
      'lista os produtos vendidos',
      'listar os produtos comprados',
      'quais os top produtos desse cliente?',
      'top 5 produtos desse cliente',
      'ranking de produtos',
      'produtos mais vendidos e comprados',
    ]
    for (const c of casos) {
      expect(detectarIntencaoChat(c).intencao, `"${c}"`).toBe('dados')
    }
  })
  it('não rouba NCM clássico', () => {
    expect(detectarIntencaoChat('tem algum ncm de banana').intencao).toBe('ncm')
    expect(detectarIntencaoChat('camiseta de algodão').intencao).toBe('ncm')
  })
})

describe('motor determinístico de ações (probabilidades por histórico)', () => {
  it('"quais top produtos desse cliente?" → rank-produtos no topo', () => {
    const r = avaliarAcoesDados('quais top produtos desse cliente?', { houveDados: true })
    expect(r[0].acao).toBe('ranking_produtos_geral')
    expect(r[0].score).toBeGreaterThanOrEqual(0.8)
    const soma = r.reduce((t, a) => t + a.probabilidade, 0)
    expect(soma).toBeGreaterThan(0.99)
    expect(soma).toBeLessThan(1.01)
  })
  it('sem histórico ainda pontua (primeira pergunta sobre movimento)', () => {
    const r = avaliarAcoesDados('quais top produtos desse cliente?', { houveDados: false })
    expect(r[0].acao).toBe('ranking_produtos_geral')
    expect(ehProvavelDados('quais top produtos desse cliente?', { houveDados: false })).toBe(true)
  })
  it('"lista os produtos vendidos" → listar + débito', () => {
    const r = avaliarAcoesDados('lista os produtos vendidos', { houveDados: true })
    const acoes = r.filter((a) => a.score >= 0.5).map((a) => a.acao)
    expect(acoes).toContain('listar_produtos')
    expect(acoes).toContain('ranking_produtos_debito')
  })
  it('"mais vendidos, comprados, crédito e débito" → ambos os lados', () => {
    const r = avaliarAcoesDados('quais produtos mais vendidos, comprados, geraram mais credito e debito?', {
      houveDados: true,
    })
    const mapa = new Map(r.map((a) => [a.acao, a.score]))
    expect(mapa.get('ranking_produtos_credito')).toBeGreaterThanOrEqual(0.7)
    expect(mapa.get('ranking_produtos_debito')).toBeGreaterThanOrEqual(0.7)
  })
  it('classificação pura zera o motor (não rouba o RAG)', () => {
    const r = avaliarAcoesDados('tem algum ncm de banana', { houveDados: true })
    expect(r[0].score).toBe(0)
    expect(ehProvavelDados('tem algum ncm de banana', { houveDados: true })).toBe(false)
  })
  it('anáfora detectada', () => {
    expect(temAnaforaDados('quais top produtos desse cliente')).toBe(true)
    expect(temAnaforaDados('tem algum ncm de banana')).toBe(false)
  })
})

describe('filtros: ranking não vira nome de produto + herança de escopo', () => {
  it('"produtos desse cliente" não vira filtro de produto', () => {
    const f = extrairFiltrosDados('quais top produtos desse cliente?')
    expect(f.produto).toBeNull()
  })
  it('"produtos mais vendidos" não vira filtro de produto', () => {
    expect(extrairFiltrosDados('lista os produtos vendidos').produto).toBeNull()
    expect(extrairFiltrosDados('quais produtos mais vendidos?').produto).toBeNull()
  })
  it('produto real continua extraído', () => {
    expect(extrairFiltrosDados('produto queijo minas').produto).toContain('queijo')
  })
  it('direção: vendido → saída, comprado → entrada', () => {
    expect(extrairFiltrosDados('quais produtos mais vendidos?').direcao).toBe('saida')
    expect(extrairFiltrosDados('quais produtos mais comprados?').direcao).toBe('entrada')
    // Genérico "top produtos" cobre os dois lados.
    expect(extrairFiltrosDados('quais top produtos desse cliente?').direcao).toBe('todas')
  })
  it('anáfora herda cliente/CNPJ do filtro anterior', () => {
    expect(temAnaforaFiltro('quais top produtos desse cliente?')).toBe(true)
    const anterior = { ...extrairFiltrosDados('tudo'), clienteTexto: 'Padaria Pao Dourado' }
    const atual = extrairFiltrosDados('quais top produtos desse cliente?')
    expect(atual.clienteTexto).toBeNull()
    const mesclado = mesclarFiltrosComContexto(atual, anterior)
    expect(mesclado.clienteTexto).toBe('Padaria Pao Dourado')
  })
})

describe('integração: diálogo do usuário (panorama → top produtos)', () => {
  it('responde ranking de produtos, não "sem referência"', async () => {
    const { db } = await import('@/infrastructure/db/schema')
    const { responderChat } = await import('@/application/aurum-ai-chat')
    await db.delete().catch(() => undefined)
    await db.open()
    const empresaId = (await db.empresas.add({
      razaoSocial: 'RR FRIOS LTDA',
      cnpj: '11111111000111',
      fantasia: 'RR Frios',
      criadoEm: new Date().toISOString(),
      uf: 'SP',
    } as never)) as unknown as number
    const itemBase = {
      chave: 'x', numItem: '1', codProd: 'P1', descricao: 'FRANGO DE CORTE',
      ncm: '02071100', cfop: '5102', cstIcms: '00', qtd: 10, unid: 'KG',
      vlUnit: 100, vlTotal: 1000, vlDesc: 0, vlIcms: 0, cstPis: '01', cstCofins: '01',
      classificacao: {
        cst: '000', cClassTrib: '000001',
        resumo: { percentualReducaoIBS: 0, percentualReducaoCBS: 0 }, referencia: {},
      },
      regraGeral: true, redIBS: 0, redCBS: 0, ibs: 100, cbs: 50,
      totalTributos: 150, carga: 15, anexo: '0', observacoes: [],
    }
    await db.nfeNotas.add({
      chave: '1'.repeat(44), numero: '1', serie: '1', modelo: '55', natOp: 'COMPRA',
      dataEmissao: '2026-01-10', emitCnpj: '22222222000122', emitNome: 'NICOLAS ALENCAR VASCONCELOS',
      emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: 'SP',
      destDoc: '11111111000111', destNome: 'RR FRIOS LTDA', destIe: '',
      valorProdutos: 1000, valorTotal: 1000, empresaId, direcao: 'entrada',
      arquivo: null, xmlConteudo: null, refIBS: 19, refCBS: 9,
      totalIBS: 100, totalCBS: 50, totalTributos: 150,
      importadoEm: new Date().toISOString(), itensAnalisados: [itemBase],
    } as never)
    await db.nfeNotas.add({
      chave: '2'.repeat(44), numero: '2', serie: '1', modelo: '55', natOp: 'VENDA',
      dataEmissao: '2026-01-12', emitCnpj: '11111111000111', emitNome: 'RR FRIOS LTDA',
      emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: 'SP',
      destDoc: '33333333000133', destNome: 'CLIENTE FINAL', destIe: '',
      valorProdutos: 2000, valorTotal: 2000, empresaId, direcao: 'saida',
      arquivo: null, xmlConteudo: null, refIBS: 19, refCBS: 9,
      totalIBS: 200, totalCBS: 100, totalTributos: 300,
      importadoEm: new Date().toISOString(),
      itensAnalisados: [{ ...itemBase, codProd: 'P2', descricao: 'FRANGO ABATIDO IN NATURA', vlTotal: 2000, ibs: 200, cbs: 100, totalTributos: 300 }],
    } as never)
    const hist = [
      { papel: 'user' as const, texto: 'Tem XML de algum cliente?' },
      { papel: 'assistant' as const, texto: '2 nota(s) no recorte todo o movimento — RR FRIOS LTDA' },
    ]
    const r = await responderChat('quais top produtos desse cliente?', hist)
    expect(r.texto).not.toContain('não achei referência')
    expect(r.texto).toContain('FRANGO')
    expect(r.texto).toMatch(/crédito|débito/)
    expect(r.pensamento?.detalhe).toContain('rank-produtos')
  }, 20000)
})

describe('refino com contexto: ncm aparente + histórico de dados → dados', () => {
  const hist = [
    { papel: 'user' as const, texto: 'Tem XML de algum cliente?' },
    { papel: 'assistant' as const, texto: '325 nota(s) no recorte todo o movimento' },
  ]
  it('promove "quais top produtos desse cliente?" a dados', () => {
    const det = detectarIntencaoChat('quais top produtos desse cliente?')
    // Já vem como dados pelo portão; o refino mantém.
    const ref = refinarIntencaoComContexto(det, 'quais top produtos desse cliente?', hist)
    expect(ref.intencao).toBe('dados')
  })
  it('não rouba refino de classificação ("100% algodão")', () => {
    const det = detectarIntencaoChat('100% algodão')
    const ref = refinarIntencaoComContexto(det, '100% algodão', hist)
    expect(ref.intencao).not.toBe('dados')
  })
})
