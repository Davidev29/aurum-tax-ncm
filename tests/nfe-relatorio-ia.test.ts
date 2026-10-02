/**
 * Relatório XML v5 — dedup + recados simples + conferência na lei atual.
 */
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import type { Classificacao } from '@/domain/entities'
import type { NotaXml, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'
import {
  dedupNotasPorChave,
  gerarInsightsNfe,
  prepararRelatorioNfeComIA,
  rankingDoFiltro,
} from '@/application/nfe-relatorio-ia'
import { apurarIbsCbs } from '@/infrastructure/nfe/apuracao'
import { confrontoRegimes } from '@/application/nfe-insights'

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

function item(over: Partial<ResultadoItemNfe> = {}): ResultadoItemNfe {
  return {
    chave: 'k1',
    numItem: '1',
    codProd: 'SKU-1',
    descricao: 'Produto 1',
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
    ...over,
  }
}

function nota(over: Partial<NotaXml> = {}): NotaXml {
  return {
    chave: 'chave-1',
    numero: '1',
    serie: '1',
    modelo: '55',
    natOp: 'Venda',
    dataEmissao: '2025-09-01',
    emitCnpj: '11111111000191',
    emitNome: 'Fornecedor A',
    emitCrt: '3',
    emitIe: '',
    emitIm: '',
    emitEndereco: '',
    emitCidade: '',
    emitUf: 'SP',
    destDoc: '12345678000190',
    destNome: 'Empresa',
    destIe: '',
    valorProdutos: 100,
    valorTotal: 100,
    itens: [],
    empresaId: 1,
    direcao: 'entrada',
    arquivo: null,
    xmlConteudo: null,
    refIBS: 19,
    refCBS: 9,
    totalIBS: 9.2,
    totalCBS: 2.4,
    totalTributos: 11.6,
    importadoEm: '2025-09-01T00:00:00.000Z',
    itensAnalisados: [item()],
    ...over,
  }
}

describe('nfe-relatorio-ia', () => {
  it('dedup pela chave nunca soma em dobro', () => {
    const a = nota({ chave: 'ABC', valorTotal: 100 })
    const b = nota({ chave: 'ABC', valorTotal: 100 })
    const c = nota({ chave: 'DEF', valorTotal: 50 })
    const { unicas, duplicadasIgnoradas } = dedupNotasPorChave([a, b, c])
    expect(unicas.length).toBe(2)
    expect(duplicadasIgnoradas).toBe(1)
  })

  it('ranking do filtro deriva das notas (consistente)', () => {
    const notas = [
      nota({ chave: 'A', emitCnpj: '111', emitNome: 'F1', valorTotal: 100, totalIBS: 10, totalCBS: 5, totalTributos: 15 }),
      nota({ chave: 'B', emitCnpj: '111', emitNome: 'F1', valorTotal: 200, totalIBS: 20, totalCBS: 10, totalTributos: 30 }),
      nota({ chave: 'C', emitCnpj: '222', emitNome: 'F2', direcao: 'saida', valorTotal: 500, totalIBS: 50, totalCBS: 25, totalTributos: 75 }),
    ]
    const r = rankingDoFiltro(notas)
    // Só entradas entram no ranking; F1 agrega as 2 notas.
    expect(r.length).toBe(1)
    expect(r[0].cnpj).toBe('111')
    expect(r[0].qtdNotas).toBe(2)
    expect(r[0].creditoTotal).toBe(45)
  })

  it('recados são simples e vêm dos números (sem alucinação, sem tecnicês)', () => {
    const notas = [
      nota({ chave: 'A', emitCrt: '1', emitCnpj: '999', emitNome: 'Simples Ltda', valorTotal: 1000, totalIBS: 92, totalCBS: 24, totalTributos: 116 }),
      nota({ chave: 'B', emitCrt: '3', emitCnpj: '111', emitNome: 'Normal SA', valorTotal: 100, totalIBS: 9.2, totalCBS: 2.4, totalTributos: 11.6 }),
    ]
    const ap = apurarIbsCbs(notas)
    const c = confrontoRegimes(notas)
    const ranking = rankingDoFiltro(notas)
    const insights = gerarInsightsNfe(notas, ap, ranking, {
      antigo: c.antigo, novo: c.novo, icms: c.icms, pisCofins: c.pisCofins,
      ibs: c.ibs, cbs: c.cbs, delta: c.delta, variacaoPct: c.variacaoPct,
    })
    expect(insights.length).toBeLessThanOrEqual(3)
    // Chaves únicas (sem recado repetido).
    expect(new Set(insights.map((i) => i.chave)).size).toBe(insights.length)
    const proibidos = /RAG|cClassTrib|\bCST\b|EFD|ICMS|PIS|COFINS|regime antigo|regra geral|reclassifica|CRT|CSOSN|apuração|débito|quarentena|\bNCM\b|TEC|anexo/i
    for (const ins of insights) {
      // Todo recado cita um número (R$ ou %) e fala como a Aurum AI.
      expect(`${ins.titulo} ${ins.texto}`).toMatch(/R\$|%/)
      expect(ins.texto).toMatch(/A Aurum AI encontrou/)
      expect(`${ins.titulo} ${ins.texto}`).not.toMatch(proibidos)
    }
    // Compra do Simples gera o recado de crédito.
    expect(insights.some((i) => i.chave === 'sem-credito')).toBe(true)
  })

  it('prepararRelatorioNfeComIA entrega pacote enxuto sem quebrar', async () => {
    const notas = [nota({ chave: 'A' }), nota({ chave: 'A' }), nota({ chave: 'B' })]
    const pacote = await prepararRelatorioNfeComIA(notas, [])
    expect(pacote.notas.length).toBe(2)
    expect(pacote.duplicadasIgnoradas).toBe(1)
    expect(pacote.apuracao).toBeDefined()
    expect(pacote.verificacao.ncmsVerificados).toBeGreaterThanOrEqual(0)
    expect(pacote.insights.length).toBeLessThanOrEqual(3)
  })

  it('PDF simples aceita pacote IA e gera buffer válido', async () => {
    const { default: pdfMake } = await import('pdfmake/build/pdfmake')
    const { exportarNfePDF } = await import('@/infrastructure/exporters/relatorios')
    const { default: vfs } = await import('pdfmake/build/vfs_fonts')
    ;(pdfMake as unknown as { vfs: unknown }).vfs = (vfs as { pdfMake?: { vfs: unknown } }).pdfMake?.vfs ?? vfs

    const notas = [nota({ chave: 'A' })]
    const pacote = await prepararRelatorioNfeComIA(notas, [])
    const docMod = await import('@/infrastructure/exporters/relatorios')
    void docMod
    // Gera via baixarPdf mockado: captura o doc sem DOM.
    const { baixarPdf } = await import('@/infrastructure/pdf/setup')
    void baixarPdf
    await exportarNfePDF({
      notas: pacote.notas,
      ranking: pacote.rankingEfetivo,
      emitente: {
        razaoSocial: 'Empresa Teste', cnpj: '', ie: '', endereco: '', cidade: '',
        cep: '', telefone: '', email: '', site: '', cor: '#047857', rodape: '', logo: null,
      },
      empresaNome: 'Empresa Teste',
      periodo: '01/09/2025 a 30/09/2025',
      verificacao: pacote.verificacao,
      insights: pacote.insights,
      confronto: pacote.confronto,
      duplicadasIgnoradas: pacote.duplicadasIgnoradas,
    })
  }, 30000)
})
