/**
 * Teste de fumaça da exportação de PDF.
 *
 * Gera os quatro relatórios (Produtos, SPED itens, SPED resumo, Lote e NFe)
 * com dados de exemplo e valida que o pdfMake consegue serializar cada
 * documento em um buffer PDF válido — ou seja, a exportação funciona de
 * ponta a ponta (montagem do documento + fontes + layout).
 *
 * O módulo `pdf/setup` é mockado para capturar o documento e gerar o buffer
 * com o pdfMake real, sem precisar de DOM (o ambiente de teste é Node).
 */
import { describe, it, expect, vi } from 'vitest'
import pdfMake from 'pdfmake/build/pdfmake'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Emitente, Empresa, Produto, Classificacao } from '@/domain/entities'
import type { ResultadoItem, ResultadoResumo } from '@/infrastructure/sped/tipos'
import type { LinhaLote } from '@/infrastructure/exporters/relatorios'
import type { NotaXml, CreditoFornecedor, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'

/* ------------------------------------------------------------ mock do PDF --- */

interface Gerado {
  nome: string
  buf: Buffer
}

const gerados: Gerado[] = []

vi.mock('@/infrastructure/pdf/setup', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/infrastructure/pdf/setup')>()
  return {
    ...mod,
    baixarPdf: (doc: TDocumentDefinitions, nomeArquivo: string): Promise<void> =>
      pdfMake.createPdf(doc).getBuffer().then((buf: Buffer) => {
        gerados.push({ nome: nomeArquivo, buf })
      }),
  }
})

/* --------------------------------------------------------- dados de exemplo --- */

const emitente: Emitente = {
  razaoSocial: 'Empresa Teste Ltda',
  cnpj: '12345678000190',
  ie: '123456',
  endereco: 'Rua Teste, 123',
  cidade: 'São Paulo',
  cep: '01001000',
  telefone: '11 3333-4444',
  email: 'teste@empresa.com',
  site: 'https://empresa.com',
  cor: '#0f215c',
  rodape: 'Empresa Teste Ltda',
  logo: null,
}

const empresa: Empresa = {
  id: 1,
  razaoSocial: 'Empresa Teste Ltda',
  cnpj: '12345678000190',
  fantasia: 'Teste',
  criadoEm: '2025-01-01T00:00:00.000Z',
}

const classificacao: Classificacao = {
  id: '02011000|000|000001',
  codigo: '02011000',
  codigoFormatado: '0201.10.00',
  cst: '000',
  cClassTrib: '000001',
  baseLegal: 'LC 214/2025',
  descricao: 'Regra geral',
  vinculo: null,
  cstDetalhes: null,
  cstClassTribDetalhes: null,
  referencia: null,
  resumo: {
    descricaoCClassTrib: 'Regra geral',
    percentualReducaoIBS: 0,
    percentualReducaoCBS: 0,
    anexo: null,
    urlLegislacao: null,
    documentosHabilitados: null,
  },
  regraGeral: true,
}

const produto: Produto = {
  id: 1,
  empresaId: 1,
  codigo: 'SKU-0001',
  nome: 'Queijo Minas Frescal 500g',
  ncm: '02011000',
  cfop: '5102',
  cstIcms: '000',
  pis: '01',
  cofins: '01',
  quantidade: 10,
  valorUnitario: 10,
  cstReforma: '000',
  cClassTrib: '000001',
  regraGeral: true,
  classificacaoSnapshot: {
    codigo: '02011000',
    codigoFormatado: '0201.10.00',
    cst: '000',
    cClassTrib: '000001',
    descricao: 'Regra geral',
    baseLegal: 'LC 214/2025',
    pRedIBS: 0,
    pRedCBS: 0,
    anexo: null,
    classificacao: 'Regra geral — LC 214/2025',
  },
  criadoEm: '2025-09-01T10:00:00.000Z',
  atualizadoEm: '2025-09-01T10:00:00.000Z',
}

const resultadoItem: ResultadoItem = {
  numDoc: '12345',
  chave: '352509123456780001905500100000012345678901234',
  data: '2025-09-01',
  numItem: '1',
  codItem: 'SKU-0001',
  descricaoProduto: 'Queijo Minas Frescal 500g',
  ncm: '02011000',
  qtd: 10,
  unid: 'UN',
  vlItem: 100,
  vlDesc: 0,
  cstIcms: '000',
  cfop: '5102',
  vlBcIcms: 100,
  aliqIcms: 18,
  vlIcms: 18,
  cstPis: '01',
  vlBcPis: 100,
  vlPis: 1.65,
  cstCofins: '01',
  vlBcCofins: 100,
  vlCofins: 7.6,
  indOper: '1',
  tipoDoc: '55',
  classificacao,
  regraGeral: true,
  redIBS: 0,
  redCBS: 0,
  ibs: 9.2,
  cbs: 2.4,
  totalTributos: 11.6,
  carga: 11.6,
  anexo: '0',
  observacoes: [],
}

const resultadoResumo: ResultadoResumo = {
  cstIcms: '000',
  cfop: '5102',
  qtdNotas: 5,
  totalOperacao: 1000,
  totalBcIcms: 1000,
  totalIcms: 180,
  descricaoProduto: 'Diversos',
  classificacao,
  regraGeral: true,
  redIBS: 0,
  redCBS: 0,
  ibs: 92,
  cbs: 24,
  totalTributos: 116,
  carga: 11.6,
  anexo: '0',
  observacoes: [],
  _isResumo: true,
}

const linhaLote: LinhaLote = {
  linha: 1,
  sku: 'SKU-0001',
  produto: 'Queijo Minas Frescal 500g',
  ncmOriginal: '02011000',
  ncmSugerido: '02011000',
  cfop: '5102',
  cst: '000',
  cClassTrib: '000001',
  situacao: 'classificada',
  regraGeral: true,
}

const itemNfe: ResultadoItemNfe = {
  chave: '352509123456780001905500100000012345678901234',
  numItem: '1',
  codProd: 'SKU-0001',
  descricao: 'Queijo Minas Frescal 500g',
  ncm: '02011000',
  cfop: '5102',
  cstIcms: '000',
  qtd: 10,
  unid: 'UN',
  vlUnit: 10,
  vlTotal: 100,
  vlDesc: 0,
  vlIcms: 18,
  cstPis: '01',
  cstCofins: '01',
  classificacao,
  regraGeral: true,
  redIBS: 0,
  redCBS: 0,
  ibs: 9.2,
  cbs: 2.4,
  totalTributos: 11.6,
  carga: 11.6,
  anexo: '0',
  observacoes: [],
}

const nota: NotaXml = {
  chave: '352509123456780001905500100000012345678901234',
  numero: '12345',
  serie: '1',
  modelo: '55',
  natOp: 'Venda',
  dataEmissao: '2025-09-01',
  emitCnpj: '98765432000190',
  emitNome: 'Fornecedor Teste',
  emitCrt: '3',
  emitIe: '123456',
  emitIm: '',
  emitEndereco: 'Rua Fornecedor, 100',
  emitCidade: 'São Paulo',
  emitUf: 'SP',
  destDoc: '12345678000190',
  destNome: 'Empresa Teste Ltda',
  destIe: '123456',
  valorProdutos: 100,
  valorTotal: 118,
  itens: [],
  empresaId: 1,
  direcao: 'entrada',
  arquivo: null,
  xmlConteudo: null,
  refIBS: 9.2,
  refCBS: 2.4,
  totalIBS: 9.2,
  totalCBS: 2.4,
  totalTributos: 11.6,
  importadoEm: '2025-09-01T10:00:00.000Z',
  itensAnalisados: [itemNfe],
}

const fornecedor: CreditoFornecedor = {
  cnpj: '98765432000190',
  nome: 'Fornecedor Teste',
  qtdNotas: 1,
  totalEntradas: 100,
  creditoIBS: 9.2,
  creditoCBS: 2.4,
  creditoTotal: 11.6,
  simples: false,
}

/* ------------------------------------------------------------------ testes --- */

describe('Exportação de PDF', { timeout: 60000 }, () => {
  it('gera o PDF de produtos com buffer válido', async () => {
    const { exportarProdutosPDF } = await import('@/infrastructure/exporters/relatorios')
    await exportarProdutosPDF({ produtos: [produto], empresa, emitente, refIBS: 19, refCBS: 9 })

    const g = gerados.find((x) => x.nome.startsWith('classificacao_'))
    expect(g, 'PDF de produtos foi gerado').toBeDefined()
    expect(g!.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(g!.buf.length).toBeGreaterThan(1000)
  })

  it('gera o PDF do SPED (modo itens) com buffer válido', async () => {
    const { exportarSpedPDF } = await import('@/infrastructure/exporters/relatorios')
    await exportarSpedPDF({
      resultados: [resultadoItem],
      emitente,
      tipo: 'icmsipi',
      arquivo: 'sped.txt',
    })

    const g = gerados.find((x) => x.nome.startsWith('SPED_Tributacao_'))
    expect(g, 'PDF do SPED foi gerado').toBeDefined()
    expect(g!.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(g!.buf.length).toBeGreaterThan(1000)
  })

  it('gera o PDF do SPED (modo resumo) com buffer válido', async () => {
    const { exportarSpedPDF } = await import('@/infrastructure/exporters/relatorios')
    await exportarSpedPDF({
      resultados: [resultadoResumo],
      emitente,
      tipo: 'contribuicoes',
      arquivo: 'sped.txt',
    })

    const g = gerados.filter((x) => x.nome.startsWith('SPED_Tributacao_'))
    expect(g.length).toBe(2)
    expect(g[1].buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('gera o PDF do lote com buffer válido', async () => {
    const { exportarLotePDF } = await import('@/infrastructure/exporters/relatorios')
    await exportarLotePDF([linhaLote], emitente, 'lote.csv')

    const g = gerados.find((x) => x.nome.startsWith('classificacao_lote_'))
    expect(g, 'PDF do lote foi gerado').toBeDefined()
    expect(g!.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(g!.buf.length).toBeGreaterThan(1000)
  })

  it('gera o PDF das notas fiscais (XML) com buffer válido', async () => {
    const { exportarNfePDF } = await import('@/infrastructure/exporters/relatorios')
    await exportarNfePDF({
      notas: [nota],
      ranking: [fornecedor],
      emitente,
      empresaNome: empresa.razaoSocial,
      periodo: 'Setembro/2025',
    })

    const g = gerados.find((x) => x.nome.startsWith('NFe_Apuracao_'))
    expect(g, 'PDF das notas foi gerado').toBeDefined()
    expect(g!.buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(g!.buf.length).toBeGreaterThan(1000)
  })

  it('gera PDFs mesmo com listas vazias (não quebra)', async () => {
    const { exportarProdutosPDF, exportarNfePDF } = await import('@/infrastructure/exporters/relatorios')

    await exportarProdutosPDF({ produtos: [], empresa, emitente, refIBS: 19, refCBS: 9 })
    await exportarNfePDF({
      notas: [],
      ranking: [],
      emitente,
      empresaNome: empresa.razaoSocial,
      periodo: 'Setembro/2025',
    })

    const todos = gerados.filter((x) => x.buf.subarray(0, 5).toString('latin1') === '%PDF-')
    expect(todos.length).toBeGreaterThanOrEqual(6)
  })
})
