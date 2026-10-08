/**
 * Classificação em lote (SPEC §6) — mapeamento de cabeçalho, resolução por
 * NCM com cache e importação de empresas.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  importarEmpresasDoArquivo,
  mapearColunas,
  processarArquivoLote,
} from '@/infrastructure/parsers/lote'
import { db } from '@/infrastructure/db/schema'
import type { TabelaCstClassTrib, VinculoNcm } from '@/domain/entities'

/* --------------------------------------------------------------- fixtures -- */

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

const arquivo = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/csv' })

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

/* -------------------------------------------------------- mapearColunas -- */

describe('mapearColunas', () => {
  it('reconhece o cabeçalho do próprio modelo do app (COD/SKU)', () => {
    const map = mapearColunas(['COD/SKU', 'NOME DO PRODUTO', 'NCM', 'CFOP', 'CST', 'PIS', 'COFINS'])
    expect(map).toEqual({ codigo: 0, nome: 1, ncm: 2, cfop: 3, cstIcms: 4, pis: 5, cofins: 6 })
  })

  it('mantém os sinônimos aceitos pela v1', () => {
    expect(mapearColunas(['cod', 'nome', 'ncm', 'cfop', 'cst', 'pis', 'cofins'])).toEqual({
      codigo: 0, nome: 1, ncm: 2, cfop: 3, cstIcms: 4, pis: 5, cofins: 6,
    })
    expect(mapearColunas(['CÓDIGO', 'Descrição', 'Código NCM', 'Código CFOP', 'CST ICMS'])).toEqual({
      codigo: 0, nome: 1, ncm: 2, cfop: 3, cstIcms: 4,
    })
  })

  it('acrescenta sinônimos reais de planilha brasileira', () => {
    expect(mapearColunas(['Referência', 'Código de Barras'])).toEqual({ codigo: 0 })
    expect(mapearColunas(['ref', 'desc', 'cod.produto'])).toEqual({ codigo: 0, nome: 1 })
    // `cod.produto` é capturado pelo ALIASES de codigo, não pelo de nome.
    expect(mapearColunas(['Cod. Produto']).codigo).toBe(0)
  })

  it('a primeira ocorrência vence quando há colunas repetidas', () => {
    expect(mapearColunas(['NCM', 'outro', 'NCM']).ncm).toBe(0)
    expect(mapearColunas(['nome', 'NOME']).nome).toBe(0)
  })

  it('ignora cabeçalhos desconhecidos', () => {
    expect(mapearColunas(['', 'preço', 'localização'])).toEqual({})
  })
})

/* ------------------------------------------------- processarArquivoLote -- */

describe('processarArquivoLote', () => {
  const csv = [
    'COD/SKU;NOME DO PRODUTO;NCM;CFOP;CST;PIS;COFINS',
    'SKU-1;Queijo Minas;02011000;5102;000;01;01',
    'SKU-2;Notebook;84713012;5102;000;01;01',
    'SKU-3;NCM inválido;123;5102;000;01;01',
    '',
  ].join('\r\n')

  it('resolve vínculo, regra geral e NCM inválido', async () => {
    const r = await processarArquivoLote(arquivo('lote.csv', csv))

    expect(r.itens).toHaveLength(3)
    expect(r.comClassificacao).toBe(2)
    expect(r.regraGeral).toBe(1)
    expect(r.semNcm).toBe(1)
    expect(r.ambiguos).toBe(0)
    expect(r.nomeArquivo).toBe('lote.csv')

    const [comVinculo, regraGeral, invalido] = r.itens

    expect(comVinculo).toMatchObject({
      indice: 2,
      codigo: 'SKU-1',
      nome: 'Queijo Minas',
      ncm: '02011000',
      cfop: '5102',
      cstIcms: '000',
      pis: '01',
      cofins: '01',
      regraGeral: false,
    })
    expect(comVinculo.classificacoes).toHaveLength(2)
    // Único oficial fixado + integral de segurança trocável (última opção).
    expect(comVinculo.escolhida?.cClassTrib).toBe('000002')
    expect(comVinculo.escolhida?.regraGeral).toBe(false)
    expect(comVinculo.escolhida?.integralFallback).not.toBe(true)
    expect(comVinculo.classificacoes.at(-1)?.integralFallback).toBe(true)
    expect(comVinculo.analiseIA?.situacao).toBe('unica')
    expect(comVinculo.analiseIA?.maisProvavelIndice).toBe(0)

    expect(regraGeral.regraGeral).toBe(true)
    // Motor único: o cartão de regra geral aparece na lista, como na Consulta.
    expect(regraGeral.classificacoes).toHaveLength(1)
    expect(regraGeral.escolhida?.regraGeral).toBe(true)
    expect(regraGeral.escolhida?.cst).toBe('000')

    expect(invalido.ncm).toBe('123')
    expect(invalido.escolhida).toBeNull()
    expect(invalido.regraGeral).toBe(false)
  })

  it('traz a nomenclatura resolvida para o cartão', async () => {
    const r = await processarArquivoLote(arquivo('lote.csv', csv))
    expect(r.itens[0].escolhida?.descricao).toBe('Carne bovina fresca')
  })

  it('reporta progresso', async () => {
    const chamadas: [number, number][] = []
    await processarArquivoLote(arquivo('lote.csv', csv), (feito, total) => chamadas.push([feito, total]))
    expect(chamadas.length).toBeGreaterThan(0)
    expect(chamadas.at(-1)).toEqual([3, 3])
    expect(chamadas[0][1]).toBe(3)
  })

  it('sem coluna NCM lança erro listando os cabeçalhos', async () => {
    await expect(
      processarArquivoLote(arquivo('x.csv', 'SKU;Nome\n1;Produto\r\n')),
    ).rejects.toThrow(/Coluna NCM não encontrada/)
  })

  it('arquivo só com cabeçalho é rejeitado', async () => {
    await expect(
      processarArquivoLote(arquivo('x.csv', 'SKU;Nome;NCM\r\n')),
    ).rejects.toThrow('Arquivo vazio ou sem dados.')
  })

  it('cacheia a consulta por NCM (10 linhas iguais = 1 ida à base)', async () => {
    const linhas = ['COD/SKU;NOME DO PRODUTO;NCM']
    for (let i = 0; i < 10; i++) linhas.push(`SKU-${i};Produto;02011000`)
    const r = await processarArquivoLote(arquivo('cache.csv', `${linhas.join('\r\n')}\r\n`))
    expect(r.itens).toHaveLength(10)
    expect(r.itens.every((i) => i.escolhida?.cClassTrib === '000002')).toBe(true)
  })
})

/* -------------------------------------------------- importarEmpresas -- */

describe('importarEmpresasDoArquivo', () => {
  it('lê razão social, CNPJ e fantasia', async () => {
    const csv = ['Razão Social;CNPJ;Nome Fantasia', 'Empresa Exemplo Ltda;12345678000190;Exemplo', ''].join('\r\n')
    const lote = await importarEmpresasDoArquivo(arquivo('empresas.csv', csv))
    expect(lote).toHaveLength(1)
    expect(lote[0]).toMatchObject({
      razaoSocial: 'Empresa Exemplo Ltda',
      cnpj: '12.345.678/0001-90',
      fantasia: 'Exemplo',
    })
    expect(lote[0].criadoEm).toBeTruthy()
  })

  it('aceita sinônimos de cabeçalho', async () => {
    const csv = ['Nome Empresa;Numero CNPJ', 'Fulano de Tal;11222333000181', ''].join('\r\n')
    const lote = await importarEmpresasDoArquivo(arquivo('e.csv', csv))
    expect(lote[0].razaoSocial).toBe('Fulano de Tal')
    expect(lote[0].cnpj).toBe('11.222.333/0001-81')
    expect(lote[0].fantasia).toBe('')
  })

  it('sem coluna razão social o erro lista o cabeçalho lido', async () => {
    await expect(
      importarEmpresasDoArquivo(arquivo('e.csv', 'Fantasia;CNPJ\r\nExemplo;1\r\n')),
    ).rejects.toThrow(/Razão Social/)
  })

  it('linhas sem razão social são descartadas', async () => {
    const csv = ['Razão Social;CNPJ', ';12345678000190', ';11222333000181', ''].join('\r\n')
    await expect(importarEmpresasDoArquivo(arquivo('e.csv', csv))).rejects.toThrow('Nenhuma empresa válida encontrada.')
  })
})
