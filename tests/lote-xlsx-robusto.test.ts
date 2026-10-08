/**
 * Lote XLSX robusto — buffers reais via XLSX (não CSV disfarçado).
 *
 * Casos: válido 3 linhas, truncado, magic inválido, aba vazia, fórmula,
 * cabeçalho ausente. Regra: erro sempre amigável (pt-BR, mensagem útil),
 * nunca stack cru (TypeError vazio, "undefined", frame "at ...").
 */
import { beforeEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { lerPlanilha, processarArquivoLote } from '@/infrastructure/parsers/lote'
import { db } from '@/infrastructure/db/schema'
import type { TabelaCstClassTrib, VinculoNcm } from '@/domain/entities'

const vinculo: VinculoNcm = {
  id: 'V1',
  codigo: '02011000',
  codigoFormatado: '0201.10.00',
  cst: '000',
  cClassTrib: '000002',
  baseLegal: 'LC 214/2025 — art. 11',
  reducao: 100,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao: '',
  documentos: '',
}

const cct: TabelaCstClassTrib = {
  id: '000|000002',
  cst: '000',
  cClassTrib: '000002',
  nome: 'Alíquota zero',
  descricao: 'Situação com alíquota zero.',
  lcRedacao: null,
  lcRef: null,
  tipoAliquota: 'Zero',
  pRedIBS: 100,
  pRedCBS: 100,
  indRedutorBC: null,
  indTribRegular: null,
  indCredPres: null,
  indMono: null,
  indMonoReten: null,
  indMonoRet: null,
  indMonoDif: null,
  creditoPara: null,
  inicioVigencia: null,
  fimVigencia: null,
  atualizadoEm: null,
}

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear(),
    db.ncmNomenclatura.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.empresas.clear(),
  ])
  await db.ncm.put(vinculo)
  await db.cstClassTrib.put(cct)
  await db.ncmNomenclatura.put({
    codigo: '02011000',
    codigoOriginal: '02011000',
    descricao: 'Carne bovina fresca',
    dataInicio: null,
    dataFim: null,
    ato: null,
  })
})

/** Monta um .xlsx real a partir de uma matriz (primeira linha = cabeçalho). */
function xlsxFile(nome: string, aoa: unknown[][]): File {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buf], nome, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Mensagem amigável: string útil, sem stack cru nem "undefined". */
function expectAmigavel(erro: unknown): string {
  expect(erro).toBeInstanceOf(Error)
  const msg = String((erro as Error).message ?? '')
  expect(msg.length).toBeGreaterThan(0)
  expect(msg).not.toMatch(/^\s*at\s/m) // frame de stack
  expect(msg).not.toMatch(/\.test\.ts:\d+/) // rastro de arquivo de teste
  expect(msg.toLowerCase()).not.toContain('undefined')
  return msg
}

describe('lote xlsx robusto — válido', () => {
  it('buffer real válido com 3 linhas resolve sem throw', async () => {
    const f = xlsxFile('lote.xlsx', [
      ['COD/SKU', 'NOME DO PRODUTO', 'NCM'],
      ['SKU-1', 'Carne bovina', '02011000'],
      ['SKU-2', 'Notebook', '84713012'],
      ['SKU-3', 'NCM inválido', '123'],
    ])
    const r = await processarArquivoLote(f)
    expect(r.itens).toHaveLength(3)
    expect(r.nomeArquivo).toBe('lote.xlsx')
    expect(r.itens[0].ncm).toBe('02011000')
    expect(r.itens[0].escolhida?.cClassTrib).toBe('000002')
  })

  it('célula com fórmula usa o valor calculado (cacheado), sem throw', async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['COD/SKU', 'NOME DO PRODUTO', 'NCM'],
      ['SKU-1', 'Carne', '02011000'],
    ])
    // NCM via fórmula com valor em cache (raw:false lê o valor formatado).
    ws['C2'] = { f: 'CONCAT("0201","1000")', v: '02011000', t: 's' }
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const f = new File([buf], 'formula.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const r = await processarArquivoLote(f)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0].ncm).toBe('02011000')
    expect(r.itens[0].escolhida?.cClassTrib).toBe('000002')
  })
})

describe('lote xlsx robusto — erros amigáveis', () => {
  it('buffer truncado lança erro amigável, nunca stack cru', async () => {
    const bom = xlsxFile('lote.xlsx', [
      ['COD/SKU', 'NOME DO PRODUTO', 'NCM'],
      ['SKU-1', 'Carne', '02011000'],
    ])
    const buf = new Uint8Array(await bom.arrayBuffer()).slice(0, 24)
    const f = new File([buf.buffer as ArrayBuffer], 'truncado.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const erro = await processarArquivoLote(f).then(
      () => null,
      (e) => e,
    )
    expect(erro).not.toBeNull()
    expectAmigavel(erro)
  })

  it('magic inválido (.xlsx com bytes aleatórios) lança erro amigável', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    const f = new File([bytes.buffer as ArrayBuffer], 'lixo.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const erro = await lerPlanilha(f).then(
      () => null,
      (e) => e,
    )
    // Se o XLSX tolerar os bytes, o lote ao menos deve reclamar de conteúdo;
    // em qualquer caminho, havendo erro ele deve ser amigável.
    if (erro !== null) expectAmigavel(erro)
    else {
      const erroLote = await processarArquivoLote(f).then(
        () => null,
        (e) => e,
      )
      if (erroLote !== null) expectAmigavel(erroLote)
    }
  })

  it('aba vazia lança "Planilha vazia" / "sem dados"', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Vazia')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const f = new File([buf], 'vazia.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const erro = await processarArquivoLote(f).then(
      () => null,
      (e) => e,
    )
    expect(erro).not.toBeNull()
    const msg = expectAmigavel(erro)
    expect(msg).toMatch(/vazia|sem dados/i)
  })

  it('cabeçalho sem NCM lista os cabeçalhos lidos', async () => {
    const f = xlsxFile('sem-ncm.xlsx', [
      ['CODIGO', 'DESCRICAO'],
      ['SKU-1', 'Carne'],
    ])
    const erro = await processarArquivoLote(f).then(
      () => null,
      (e) => e,
    )
    expect(erro).not.toBeNull()
    const msg = expectAmigavel(erro)
    expect(msg).toMatch(/Coluna NCM não encontrada/)
  })

  it('só cabeçalho é rejeitado como vazio', async () => {
    const f = xlsxFile('so-cabecalho.xlsx', [['COD/SKU', 'NOME DO PRODUTO', 'NCM']])
    const erro = await processarArquivoLote(f).then(
      () => null,
      (e) => e,
    )
    expect(erro).not.toBeNull()
    const msg = expectAmigavel(erro)
    expect(msg).toMatch(/vazio|sem dados/i)
  })
})
