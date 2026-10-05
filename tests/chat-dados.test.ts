import { describe, expect, it } from 'vitest'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import {
  agregarDiferidos,
  agregarFornecedores,
  agregarNcm,
  agregarProdutos,
  agregarReducoes,
  extrairFiltrosDados,
  resumirEscopo,
  rotuloFiltros,
  FILTROS_SUPORTADOS,
} from '@/application/aurum-ai-dados'
import { blocosParaPergunta, descreverEstrutura, montarDocumentoDadosPDF } from '@/application/aurum-ai-dados-pdf'
import { montarRelatorioDados, responderChat } from '@/application/aurum-ai-chat'
import { EMITENTE_PADRAO } from '@/domain/entities'
import type { NotaXml } from '@/infrastructure/nfe/tipos'

function nota(over: Partial<NotaXml> = {}): NotaXml {
  return {
    chave: 'x',
    numero: '1',
    serie: '1',
    modelo: '55',
    natOp: 'venda',
    dataEmissao: '2026-01-10',
    emitCnpj: '11111111111111',
    emitNome: 'Fornecedor A',
    emitCrt: '3',
    emitIe: '',
    emitIm: '',
    emitEndereco: '',
    emitCidade: '',
    emitUf: 'SP',
    destDoc: '22222222222222',
    destNome: 'Cliente',
    destIe: '',
    valorProdutos: 1000,
    valorTotal: 1000,
    itens: [],
    empresaId: 1,
    direcao: 'entrada',
    arquivo: null,
    xmlConteudo: null,
    refIBS: 19,
    refCBS: 9,
    totalIBS: 100,
    totalCBS: 50,
    totalTributos: 150,
    importadoEm: new Date().toISOString(),
    itensAnalisados: [],
    ...over,
  } as NotaXml
}

function item(over: Record<string, unknown> = {}): NotaXml['itensAnalisados'][number] {
  return {
    chave: 'x',
    numItem: '1',
    codProd: 'P1',
    descricao: 'Queijo minas',
    ncm: '04061000',
    cfop: '5102',
    cstIcms: '00',
    qtd: 10,
    unid: 'KG',
    vlUnit: 100,
    vlTotal: 1000,
    vlDesc: 0,
    vlIcms: 0,
    cstPis: '01',
    cstCofins: '01',
    classificacao: {
      cst: '000',
      cClassTrib: '000001',
      resumo: { percentualReducaoIBS: 0, percentualReducaoCBS: 0 },
      referencia: {},
    },
    regraGeral: true,
    redIBS: 0,
    redCBS: 0,
    ibs: 100,
    cbs: 50,
    totalTributos: 150,
    carga: 15,
    anexo: '0',
    observacoes: [],
    ...over,
  } as unknown as NotaXml['itensAnalisados'][number]
}

describe('chat-dados (detector)', () => {
  it('roteia "tem algum XML de algum cliente?" para dados (não NCM)', () => {
    expect(detectarIntencaoChat('Tem algum XML de algum cliente?').intencao).toBe('dados')
  })
  it('roteia fornecedor-crédito para dados (não conceito)', () => {
    expect(detectarIntencaoChat('qual fornecedor tá me dando mais crédito?').intencao).toBe('dados')
  })
  it('roteia produto débito/crédito para dados', () => {
    expect(detectarIntencaoChat('qual produto tá gerando mais débito?').intencao).toBe('dados')
    expect(detectarIntencaoChat('quais produtos têm redução?').intencao).toBe('dados')
    expect(detectarIntencaoChat('existe algum produto diferido?').intencao).toBe('dados')
  })
  it('roteia inventário de clientes para clientes', () => {
    expect(detectarIntencaoChat('quais meus clientes?').intencao).toBe('clientes')
    expect(detectarIntencaoChat('quantos clientes tenho?').intencao).toBe('clientes')
  })
  it('roteia filtros para dados', () => {
    expect(detectarIntencaoChat('quais filtros posso usar?').intencao).toBe('dados')
  })
  it('não rouba NCM clássico', () => {
    expect(detectarIntencaoChat('tem algum ncm de banana').intencao).toBe('ncm')
  })
})

describe('aurum-ai-dados (filtros)', () => {
  it('extrai direção de crédito/débito', () => {
    expect(extrairFiltrosDados('qual fornecedor me dá mais crédito?').direcao).toBe('entrada')
    expect(extrairFiltrosDados('qual produto gera mais débito?').direcao).toBe('saida')
  })
  it('extrai diferido, NCM, CFOP, período e top', () => {
    const f = extrairFiltrosDados('existe produto diferido no NCM 04061000 CFOP 5102 em janeiro/2026 top 5?')
    expect(f.soDiferidos).toBe(true)
    expect(f.ncm).toBe('04061000')
    expect(f.cfop).toBe('5102')
    expect(f.periodo.inicio).toBe('2026-01-01')
    expect(f.topN).toBe(5)
  })
  it('"de algum cliente" genérico não vira filtro de cliente', () => {
    expect(extrairFiltrosDados('Tem algum XML de algum cliente?').clienteTexto).toBeNull()
  })
  it('lista filtros suportados', () => {
    expect(FILTROS_SUPORTADOS.length).toBeGreaterThan(8)
  })
  it('rotula filtros', () => {
    const f = extrairFiltrosDados('qual fornecedor me dá mais crédito?')
    expect(rotuloFiltros(f)).toContain('compras')
  })
})

describe('aurum-ai-dados (agregações puras)', () => {
  const notas = [
    nota({ direcao: 'entrada', emitNome: 'Fornecedor A', valorTotal: 1000, totalIBS: 100, totalCBS: 50, totalTributos: 150, itensAnalisados: [item()] }),
    nota({ direcao: 'saida', emitNome: 'Nós', valorTotal: 2000, totalIBS: 200, totalCBS: 100, totalTributos: 300, itensAnalisados: [item({ codProd: 'P2', descricao: 'Venda X', vlTotal: 2000, ibs: 200, cbs: 100, totalTributos: 300 })] }),
  ]
  it('fornecedores por crédito (só entradas)', () => {
    const r = agregarFornecedores(notas)
    expect(r.length).toBe(1)
    expect(r[0].nome).toBe('Fornecedor A')
    expect(r[0].creditoTotal).toBe(150)
  })
  it('produtos por direção', () => {
    expect(agregarProdutos(notas, 'entrada')[0].codigo).toBe('P1')
    expect(agregarProdutos(notas, 'saida')[0].codigo).toBe('P2')
  })
  it('reduções e NCM', () => {
    expect(agregarReducoes(notas).length).toBeGreaterThan(0)
    expect(agregarNcm(notas)[0].ncm).toBe('04061000')
  })
  it('resumo do escopo', () => {
    const r = resumirEscopo(notas)
    expect(r.qtd).toBe(2)
    expect(r.credito).toBe(150)
    expect(r.debito).toBe(300)
  })
  it('sem diferidos no fixture', () => {
    const d = agregarDiferidos(notas)
    expect(d.efetivos.length).toBe(0)
  })
})

describe('aurum-ai-dados-pdf (estrutura)', () => {
  it('escolhe blocos pela pergunta', () => {
    expect(blocosParaPergunta('qual fornecedor me dá mais crédito?', extrairFiltrosDados('fornecedor'))).toContain('fornecedores')
    expect(blocosParaPergunta('existe produto diferido?', extrairFiltrosDados('diferido'))).toContain('diferidos')
    expect(descreverEstrutura(['fornecedores', 'apuracao']).length).toBe(2)
  })
  it('monta documento no padrão do sistema (timbrado + tabelas)', () => {
    const doc = montarDocumentoDadosPDF(
      {
        titulo: 'Aurum AI — dados (teste)',
        escopo: 'todo o movimento',
        empresaNome: 'Empresa Teste',
        qtdNotas: 2,
        filtro: extrairFiltrosDados('tudo'),
        resumo: { qtd: 2, entradas: 1, saidas: 1, base: 3000, credito: 150, debito: 300, saldo: 150, resultado: 'a pagar' },
        fornecedores: [{ cnpj: '1', nome: 'Fornecedor A', qtdNotas: 1, base: 1000, creditoIBS: 100, creditoCBS: 50, creditoTotal: 150, simples: false }],
        produtos: [],
        reducoes: [],
        diferidosEfetivos: [],
        diferidosCondicionais: [],
        ncms: [],
        blocos: ['fornecedores', 'apuracao'],
        geradoEm: 'agora',
      },
      EMITENTE_PADRAO,
    )
    expect(doc.pageSize).toBe('A4')
    expect(Array.isArray(doc.content)).toBe(true)
  })
  it('builders csv/json/txt', () => {
    const d = {
      titulo: 't', pergunta: 'p', escopo: 'todo o movimento', geradoEm: 'agora',
      payload: {
        titulo: 't', escopo: 'todo o movimento', empresaNome: 'E', qtdNotas: 0,
        filtro: extrairFiltrosDados('tudo'),
        resumo: { qtd: 0, entradas: 0, saidas: 0, base: 0, credito: 0, debito: 0, saldo: 0, resultado: 'zerado' },
        fornecedores: [], produtos: [], reducoes: [], diferidosEfetivos: [], diferidosCondicionais: [], ncms: [],
        blocos: ['apuracao'] as never[], geradoEm: 'agora',
      },
    }
    expect(montarRelatorioDados(d as never, 'json').mime).toContain('json')
    expect(montarRelatorioDados(d as never, 'csv').mime).toContain('csv')
    expect(montarRelatorioDados(d as never, 'txt').mime).toContain('text/plain')
  })
})

describe('aurum-ai-chat (dados, sem banco)', () => {
  it('"tem XML de algum cliente?" responde honesto com fontes e botões', async () => {
    const r = await responderChat('Tem algum XML de algum cliente?')
    expect(r.texto).not.toContain('não achei referência')
    expect(r.fontes.length).toBeGreaterThan(0)
    expect(r.pensamento?.etapas.length).toBeGreaterThan(0)
  }, 15000)
  it('"quais meus clientes?" responde inventário', async () => {
    const r = await responderChat('quais meus clientes?')
    expect(r.texto.toLowerCase()).toContain('cliente')
  }, 15000)
})

describe('aurum-ai-chat (opções + follow-up compacto)', () => {
  it('refino "só tem um?" herda a classificação (não vira genérico)', async () => {
    const { detectarIntencaoChat } = await import('@/domain/services/detector-chat')
    const { refinarIntencaoComContexto } = await import('@/application/aurum-ai-tools')
    const hist = [
      { papel: 'user' as const, texto: 'quais NCMs para tangerina?' },
      { papel: 'assistant' as const, texto: '**Classificação sugerida: NCM 0805.21.00** — teste' },
    ]
    const det = detectarIntencaoChat('só tem um?')
    expect(det.intencao).toBe('generico')
    const ref = refinarIntencaoComContexto(det, 'só tem um?', hist)
    expect(ref.intencao).toBe('ncm')
  })

  it('"só tem esse 08052100?" lista os enquadramentos (sem agregado repetido)', async () => {
    const { db } = await import('@/infrastructure/db/schema')
    await db.ncmNomenclatura.put({
      codigo: '08052100',
      codigoOriginal: '0805.21.00',
      descricao: 'Mandarinas (incluindo tangerinas)',
      dataInicio: null,
      dataFim: null,
      ato: null,
    } as never)
    await db.ncm.bulkPut([
      {
        id: '08052100-200-200014', codigo: '08052100', codigoFormatado: '0805.21.00',
        cst: '200', cClassTrib: '200014', baseLegal: 'Anexo XV', reducao: 100,
        aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
      },
      {
        id: '08052100-000-000001', codigo: '08052100', codigoFormatado: '0805.21.00',
        cst: '000', cClassTrib: '000001', baseLegal: 'LC 214/2025', reducao: 0,
        aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
      },
    ] as never[])
    const r = await responderChat('só tem esse 08052100?')
    expect(r.texto).toContain('enquadramento')
    expect(r.texto).toContain('2 enquadramentos')
    expect(r.texto).not.toContain('Próximo passo sugerido')
    expect(r.fontes.length).toBeGreaterThan(0)
  }, 20000)

  it('follow-up usa o código do contexto e fecha curto ("Quer detalhar?")', async () => {
    const { db } = await import('@/infrastructure/db/schema')
    await db.ncmNomenclatura.put({
      codigo: '08031000',
      codigoOriginal: '0803.10.00',
      descricao: 'Bananas frescas',
      dataInicio: null,
      dataFim: null,
      ato: null,
    } as never)
    await db.ncm.put({
      id: '08031000-000-000001', codigo: '08031000', codigoFormatado: '0803.10.00',
      cst: '000', cClassTrib: '000001', baseLegal: 'LC 214/2025', reducao: 0,
      aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    } as never)
    const hist = [
      { papel: 'user' as const, texto: 'NCM 08031000' },
      { papel: 'assistant' as const, texto: '**Classificação sugerida: NCM 0803.10.00** — teste' },
    ]
    const r = await responderChat('só tem um?', hist)
    expect(r.texto).not.toContain('Não entendi bem')
    expect(r.texto).toContain('enquadramento')
    expect(r.texto).not.toContain('Próximo passo sugerido')
    expect((r.botoes ?? []).length).toBeLessThanOrEqual(2)
  }, 20000)
})
