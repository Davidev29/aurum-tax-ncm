/**
 * Regra do produto (SKU + empresa) como fonte da escolha.
 *
 * - salvar a regra (conferência/lote) → apuração assistida adota;
 * - conferência do XML pré-seleciona a regra salva;
 * - consultas (motor puro) não são influenciadas.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { analisarItensNfe } from '@/infrastructure/nfe/analisar'
import { mapaRegrasProdutos } from '@/application/regra-produto'
import { prepararConferenciaXml } from '@/application/xml-conferencia'
import {
  propagarRegrasProdutosParaNotas,
  reaplicarClassificacaoNota,
} from '@/application/notas-xml'
import { salvarProdutosEmLote } from '@/application/produtos'
import { origemLinhaLote } from '@/domain/services/salvamento-lote'
import type { ItemNotaXml, NotaXml } from '@/infrastructure/nfe/tipos'

const NCM = '02011000'
const EMPRESA_ID = 7
const REF = { refIBS: 10, refCBS: 10 }

function itemNfe(codProd: string, ncm = NCM): ItemNotaXml {
  return {
    chave: 'X',
    numItem: '1',
    codProd,
    descricao: `Produto ${codProd}`,
    ncm,
    cfop: '5102',
    cstIcms: '00',
    qtd: 1,
    unid: 'UN',
    vlUnit: 100,
    vlTotal: 100,
    vlDesc: 0,
    vlIcms: 0,
    cstPis: '01',
    cstCofins: '01',
  }
}

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear(),
    db.ncmNomenclatura.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.produtos.clear(),
    db.nfeNotas.clear(),
    db.reclassificacoesManuais.clear().catch(() => undefined),
  ])
  await db.ncm.bulkPut([
    {
      id: 'A', codigo: NCM, codigoFormatado: '0201.10.00',
      cst: '000', cClassTrib: '000002', baseLegal: 'LC 214/2025 — Anexo II',
      reducao: 100, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    },
    {
      id: 'B', codigo: NCM, codigoFormatado: '0201.10.00',
      cst: '200', cClassTrib: '200038', baseLegal: 'LC 214/2025 — Anexo IX',
      reducao: 60, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    },
  ] as never[])
  await db.cstClassTrib.bulkPut([
    {
      id: '000|000002', cst: '000', cClassTrib: '000002', nome: 'Alíquota zero',
      descricao: 'Alíquota zero', lcRedacao: null, lcRef: null, tipoAliquota: 'Zero',
      pRedIBS: 100, pRedCBS: 100, indRedutorBC: null, indTribRegular: null, indCredPres: null,
      indMono: null, indMonoReten: null, indMonoRet: null, indMonoDif: null,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
    {
      id: '200|200038', cst: '200', cClassTrib: '200038', nome: 'Redução 60%',
      descricao: 'Redução de 60%', lcRedacao: null, lcRef: null, tipoAliquota: 'Padrão',
      pRedIBS: 60, pRedCBS: 60, indRedutorBC: null, indTribRegular: null, indCredPres: null,
      indMono: null, indMonoReten: null, indMonoRet: null, indMonoDif: null,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
  ] as never[])
  await db.ncmNomenclatura.put({
    codigo: NCM, codigoOriginal: NCM,
    descricao: 'Carne bovina fresca', dataInicio: null, dataFim: null, ato: null,
  })
})

/** Salva o SKU-1 no cadastro com a regra B (200/200038), como a conferência faria. */
async function salvarSkuComRegraB() {
  const r = await resolverClassificacoes(NCM)
  const regraB = r.lista.find((c) => c.cClassTrib === '200038')!
  expect(regraB).toBeDefined()
  const c = await salvarProdutosEmLote(
    [{ codigo: 'SKU-1', nome: 'Produto SKU-1', ncm: NCM, classificacao: regraB }],
    EMPRESA_ID,
  )
  expect(c.salvos).toBe(1)
}

function notaComStale(): NotaXml {
  return {
    chave: '9'.repeat(44),
    numero: '1',
    serie: '1',
    modelo: '55',
    natOp: 'VENDA',
    dataEmissao: '2026-09-10',
    emitCnpj: '11111111000111',
    emitNome: 'Fornecedor',
    emitCrt: '3',
    emitIe: '',
    emitIm: '',
    emitEndereco: '',
    emitCidade: '',
    emitUf: '',
    destDoc: '12345678000190',
    destNome: 'Empresa',
    destIe: '',
    valorProdutos: 100,
    valorTotal: 100,
    itens: [],
    empresaId: EMPRESA_ID,
    direcao: 'entrada',
    arquivo: null,
    xmlConteudo: null,
    refIBS: REF.refIBS,
    refCBS: REF.refCBS,
    totalIBS: 0,
    totalCBS: 0,
    totalTributos: 0,
    importadoEm: new Date().toISOString(),
    itensAnalisados: [],
  }
}

describe('regra do produto (SKU + empresa)', () => {
  it('análise pura usa a 1ª opção; com regra salva usa o cadastro', async () => {
    const puro = await analisarItensNfe([itemNfe('SKU-1')], REF)
    expect(puro[0].classificacao.cClassTrib).toBe('000002')
    expect(puro[0].regraDoProduto).toBe(false)

    await salvarSkuComRegraB()
    const regras = await mapaRegrasProdutos(EMPRESA_ID)
    expect(regras.get('SKU-1')).toMatchObject({ ncm: NCM, cst: '200', cClassTrib: '200038' })

    const comRegra = await analisarItensNfe([itemNfe('SKU-1')], REF, undefined, { regras })
    expect(comRegra[0].classificacao.cClassTrib).toBe('200038')
    expect(comRegra[0].regraDoProduto).toBe(true)
    // Reduções e IBS/CBS vêm da regra salva (60% de redução, não zero).
    expect(comRegra[0].redIBS).toBe(60)
    expect(comRegra[0].ibs).toBeGreaterThan(0)
    expect(puro[0].ibs).toBe(0)
  })

  it('regra de outro NCM ou outro SKU não contamina', async () => {
    await salvarSkuComRegraB()
    const regras = await mapaRegrasProdutos(EMPRESA_ID)
    const outroSku = await analisarItensNfe([itemNfe('SKU-9')], REF, undefined, { regras })
    expect(outroSku[0].classificacao.cClassTrib).toBe('000002')
    expect(outroSku[0].regraDoProduto).toBe(false)
  })

  it('consulta (motor puro) não é influenciada pelo cadastro', async () => {
    await salvarSkuComRegraB()
    const r = await resolverClassificacoes(NCM)
    expect(r.lista[0].cClassTrib).toBe('000002')
    expect(r.manual).toBe(false)
  })

  it('conferência do XML pré-seleciona a regra salva', async () => {
    const notas = [{ ...notaComStale(), itensAnalisados: await analisarItensNfe([itemNfe('SKU-1')], REF) }]
    const semCadastro = await prepararConferenciaXml(notas, 'XML')
    expect(semCadastro.comRegraDoCadastro).toBe(0)
    // Múltipla sem cadastro: integral de segurança pré-selecionada.
    expect(semCadastro.itens[0].escolhida?.cClassTrib).toBe('000001')

    await salvarSkuComRegraB()
    const comCadastro = await prepararConferenciaXml(notas, 'XML', undefined, EMPRESA_ID)
    expect(comCadastro.comRegraDoCadastro).toBe(1)
    expect(comCadastro.itens[0].usouRegraDoCadastro).toBe(true)
    expect(comCadastro.itens[0].escolhida?.cClassTrib).toBe('200038')
    expect(origemLinhaLote(comCadastro.itens[0])).toMatch(/do cadastro/)
  })

  it('salvar propaga para a apuração (reaplica as notas com o SKU)', async () => {
    // Nota gravada "stale": análise pura (1ª opção, IBS zerado pela redução de 100%).
    const stale = await analisarItensNfe([itemNfe('SKU-1')], REF)
    const nota = { ...notaComStale(), itensAnalisados: stale, totalIBS: 0, totalCBS: 0, totalTributos: 0 }
    await db.nfeNotas.add(nota as never)
    const gravada = (await db.nfeNotas.toArray()).find((n) => n.chave === nota.chave)!
    expect(gravada.id).toBeDefined()

    await salvarSkuComRegraB()
    const prop = await propagarRegrasProdutosParaNotas(EMPRESA_ID, ['SKU-1'])
    expect(prop.notas).toBe(1)

    const atual = (await db.nfeNotas.get(gravada.id!))!
    expect(atual!.itensAnalisados[0].classificacao.cClassTrib).toBe('200038')
    expect(atual!.itensAnalisados[0].regraDoProduto).toBe(true)
    // Totais da nota (base da apuração assistida) acompanharam a regra salva.
    expect(atual!.totalIBS).toBeGreaterThan(0)
    expect(atual!.totalTributos).toBe(atual!.totalIBS + atual!.totalCBS)
  })

  it('reaplicar adota a regra salva sem precisar reimportar', async () => {
    const stale = await analisarItensNfe([itemNfe('SKU-1')], REF)
    await db.nfeNotas.add({ ...notaComStale(), itensAnalisados: stale } as never)
    const gravada = (await db.nfeNotas.toArray()).find((n) => n.chave === notaComStale().chave)!
    await salvarSkuComRegraB()
    const r = await reaplicarClassificacaoNota(gravada.id!)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.alterados).toBeGreaterThan(0)
  })
})
