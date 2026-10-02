/**
 * Regressão do timbre premium: todos os relatórios em PDF precisam sair com
 * a marca d'água do escudo Aurum (background) + cabeçalho/rodapé timbrados.
 *
 * O `pdf/setup` é mockado para capturar as definições do documento sem
 * precisar de DOM — o ambiente de teste é Node.
 */
import { describe, it, expect, vi } from 'vitest'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { Emitente, Empresa, Produto, Classificacao } from '@/domain/entities'
import type { ResultadoItem } from '@/infrastructure/sped/tipos'
import type { LinhaLote } from '@/infrastructure/exporters/relatorios'
import type { NotaXml, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'
import { MARCA_DAGUA_AURUM } from '@/infrastructure/pdf/marca-dagua'

const capturados: TDocumentDefinitions[] = []

vi.mock('@/infrastructure/pdf/setup', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/infrastructure/pdf/setup')>()
  return {
    ...mod,
    baixarPdf: (doc: TDocumentDefinitions): Promise<void> => {
      capturados.push(doc)
      return Promise.resolve()
    },
  }
})

const emitente: Emitente = {
  razaoSocial: 'Empresa Teste Ltda',
  cnpj: '12345678000190',
  ie: '',
  endereco: '',
  cidade: '',
  cep: '',
  telefone: '',
  email: '',
  site: '',
  cor: '#0f215c',
  rodape: '',
  logo: null,
}

const empresa: Empresa = {
  id: 1,
  razaoSocial: 'Empresa Teste Ltda',
  cnpj: '12345678000190',
  fantasia: 'Teste',
  criadoEm: '2025-01-01T00:00:00.000Z',
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
  quantidade: 1,
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

const itemNfe: ResultadoItemNfe = {
  chave: 'chave-teste',
  numItem: '1',
  codProd: 'SKU-0001',
  descricao: 'Queijo Minas Frescal 500g',
  ncm: '02011000',
  cfop: '5102',
  cstIcms: '000',
  qtd: 1,
  unid: 'UN',
  vlUnit: 10,
  vlTotal: 10,
  vlDesc: 0,
  vlIcms: 1.8,
  cstPis: '01',
  cstCofins: '01',
  classificacao,
  regraGeral: true,
  redIBS: 0,
  redCBS: 0,
  ibs: 0.92,
  cbs: 0.24,
  totalTributos: 1.16,
  carga: 11.6,
  anexo: '0',
  observacoes: [],
}

function marcaDaguaValida(doc: TDocumentDefinitions, rotulo: string): void {
  expect(doc.background, `${rotulo}: tem marca d'água (background)`).toBeDefined()
  expect(typeof doc.background, `${rotulo}: background é função por página`).toBe('function')
  const fundo = (doc.background as (p: number, s: { width: number; height: number }) => unknown)(
    1,
    { width: 595.28, height: 841.89 },
  ) as { image: string; opacity: number }
  expect(fundo.image, `${rotulo}: usa o escudo Aurum`).toBe(MARCA_DAGUA_AURUM)
  expect(fundo.opacity, `${rotulo}: marca d'água sutil`).toBeGreaterThan(0)
  expect(fundo.opacity, `${rotulo}: marca d'água não cobre o conteúdo`).toBeLessThanOrEqual(0.1)
  expect(doc.header, `${rotulo}: tem cabeçalho timbrado`).toBeDefined()
  expect(doc.footer, `${rotulo}: tem rodapé timbrado`).toBeDefined()
}

describe('Timbre premium dos PDFs', () => {
  it('produtos, SPED, lote e NFe saem com marca d’água Aurum + timbre', async () => {
    const { exportarProdutosPDF, exportarSpedPDF, exportarLotePDF, exportarNfePDF } =
      await import('@/infrastructure/exporters/relatorios')

    await exportarProdutosPDF({ produtos: [produto], empresa, emitente, refIBS: 19, refCBS: 9 })

    const itemSped: ResultadoItem = {
      numDoc: '1',
      chave: 'chave-teste',
      data: '2025-09-01',
      numItem: '1',
      codItem: 'SKU-0001',
      descricaoProduto: 'Queijo Minas Frescal 500g',
      ncm: '02011000',
      qtd: 1,
      unid: 'UN',
      vlItem: 10,
      vlDesc: 0,
      cstIcms: '000',
      cfop: '5102',
      vlBcIcms: 10,
      aliqIcms: 18,
      vlIcms: 1.8,
      cstPis: '01',
      vlBcPis: 10,
      vlPis: 0.16,
      cstCofins: '01',
      vlBcCofins: 10,
      vlCofins: 0.76,
      indOper: '1',
      tipoDoc: '55',
      classificacao,
      regraGeral: true,
      redIBS: 0,
      redCBS: 0,
      ibs: 0.92,
      cbs: 0.24,
      totalTributos: 1.16,
      carga: 11.6,
      anexo: '0',
      observacoes: [],
    }
    await exportarSpedPDF({ resultados: [itemSped], emitente, tipo: 'icmsipi' })

    const linha: LinhaLote = {
      linha: 1,
      sku: 'SKU-0001',
      produto: 'Queijo Minas Frescal 500g',
      ncmOriginal: '02011000',
      ncmSugerido: '02011000',
      situacao: 'ok',
    }
    await exportarLotePDF([linha], emitente, 'lote.csv')

    const nota: NotaXml = {
      chave: 'chave-teste',
      numero: '1',
      serie: '1',
      modelo: '55',
      natOp: 'Venda',
      dataEmissao: '2025-09-01',
      emitCnpj: '98765432000190',
      emitNome: 'Fornecedor Teste',
      emitCrt: '3',
      emitIe: '',
      emitIm: '',
      emitEndereco: '',
      emitCidade: '',
      emitUf: 'SP',
      destDoc: '12345678000190',
      destNome: 'Empresa Teste Ltda',
      destIe: '',
      valorProdutos: 10,
      valorTotal: 11.8,
      itens: [],
      empresaId: 1,
      direcao: 'entrada',
      arquivo: null,
      xmlConteudo: null,
      refIBS: 9.2,
      refCBS: 2.4,
      totalIBS: 0.92,
      totalCBS: 0.24,
      totalTributos: 1.16,
      importadoEm: '2025-09-01T10:00:00.000Z',
      itensAnalisados: [itemNfe],
    }
    await exportarNfePDF({
      notas: [nota],
      ranking: [],
      emitente,
      empresaNome: empresa.razaoSocial,
      periodo: 'Setembro/2025',
    })

    expect(capturados.length).toBe(4)
    const rotulos = ['produtos', 'SPED', 'lote', 'NFe']
    capturados.forEach((doc, i) => marcaDaguaValida(doc, rotulos[i]))
  })
})
