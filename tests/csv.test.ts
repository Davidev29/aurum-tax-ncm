/**
 * Paridade dos CSVs (SPEC §10.3 / R10).
 *
 * - produtos → célula entreaspada **somente** com `"`, `;`, `\n` ou `\r`;
 * - SPED     → **toda** célula entreaspada;
 * - ambos    → separador `;`, quebra `\r\n`, BOM `﻿`.
 */
import { describe, expect, it } from 'vitest'
import {
  CABECALHO_PRODUTOS,
  csvProdutos,
  csvSped,
  montarCSV,
  produtoParaLinha,
  totaisSped,
} from '@/infrastructure/exporters/relatorios'
import { classificacaoNcmInvalido } from '@/domain/services/classificacao'
import { REF_DEFAULT } from '@/domain/constants'
import type { Produto } from '@/domain/entities'
import type { ResultadoItem, ResultadoResumo } from '@/infrastructure/sped/tipos'

const BOM = '\uFEFF'

// Usa as alíquotas de referência padrão do sistema (dinâmicas conforme regras vigentes)
const REF_IBS = REF_DEFAULT.IBS
const REF_CBS = REF_DEFAULT.CBS
const CARGA_PADRAO = REF_IBS + REF_CBS

function produto(alt: Partial<Produto> = {}): Produto {
  return {
    empresaId: null,
    codigo: 'SKU-0001',
    nome: 'Queijo Minas Frescal 500g',
    ncm: '02011000',
    cfop: '5102',
    cstIcms: '000',
    pis: '01',
    cofins: '01',
    quantidade: 2,
    valorUnitario: 19.9,
    cstReforma: '000',
    cClassTrib: '000001',
    regraGeral: true,
    classificacaoSnapshot: {
      codigo: '02011000',
      codigoFormatado: '0201.10.00',
      cst: '000',
      cClassTrib: '000001',
      descricao: 'Queijo',
      baseLegal: 'LC 214/2025',
      pRedIBS: 60,
      pRedCBS: 60,
      anexo: null,
      classificacao: 'Tributação integral',
    },
    baseLegal: 'LC 214/2025',
    criadoEm: '2026-01-01T00:00:00.000Z',
    atualizadoEm: '2026-01-01T00:00:00.000Z',
    ...alt,
  }
}

function resultadoItem(alt: Partial<ResultadoItem> = {}): ResultadoItem {
  return {
    numDoc: '000123',
    chave: 'CHAVE',
    data: '01/02/2026',
    numItem: '1',
    codItem: 'P1',
    descricaoProduto: 'Produto Um',
    ncm: '02011000',
    qtd: 2,
    unid: 'UN',
    vlItem: 250,
    vlDesc: 0,
    cstIcms: '000',
    cfop: '5102',
    vlBcIcms: 250,
    aliqIcms: 18,
    vlIcms: 45,
    indOper: '1',
    tipoDoc: 'C',
    classificacao: classificacaoNcmInvalido('02011000'),
    regraGeral: false,
    redIBS: 0,
    redCBS: 0,
    ibs: 250 * REF_IBS / 100,
    cbs: 250 * REF_CBS / 100,
    totalTributos: 250 * (REF_IBS + REF_CBS) / 100,
    carga: CARGA_PADRAO,
    anexo: 'isento',
    observacoes: [],
    ...alt,
  }
}

function resultadoResumo(alt: Partial<ResultadoResumo> = {}): ResultadoResumo {
  return {
    cstIcms: '000',
    cfop: '5102',
    qtdNotas: 3,
    totalOperacao: 1000,
    totalBcIcms: 1000,
    totalIcms: 180,
    descricaoProduto: 'Resumo CST 000 / CFOP 5102',
    classificacao: classificacaoNcmInvalido(''),
    regraGeral: true,
    redIBS: 0,
    redCBS: 0,
    ibs: 1000 * REF_IBS / 100,
    cbs: 1000 * REF_CBS / 100,
    totalTributos: 1000 * (REF_IBS + REF_CBS) / 100,
    carga: CARGA_PADRAO,
    anexo: 'isento',
    observacoes: [],
    _isResumo: true,
    ...alt,
  }
}

describe('montarCSV', () => {
  it('sempre começa com BOM e usa ; com quebra \\r\\n', () => {
    const csv = montarCSV([['a', 'b'], ['c', 'd']])
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv).toBe(`${BOM}a;b\r\nc;d`)
  })

  it('só entreaspada célula com ", ;, \\n ou \\r (regra dos produtos)', () => {
    expect(montarCSV([['plain', 'com,vírgula']])).toBe(`${BOM}plain;com,vírgula`)
    expect(montarCSV([['tem;ponto']])).toBe(`${BOM}"tem;ponto"`)
    expect(montarCSV([['aspas "aqui"']])).toBe(`${BOM}"aspas ""aqui"""`)
    expect(montarCSV([['linha1\nlinha2']])).toBe(`${BOM}"linha1\nlinha2"`)
    expect(montarCSV([['linha1\r\nlinha2']])).toBe(`${BOM}"linha1\r\nlinha2"`)
  })

  it('não converte vírgula em ponto', () => {
    expect(montarCSV([['1.234,56']])).toBe(`${BOM}1.234,56`)
  })

  it('sempreAspas entreaspada tudo (regra do SPED)', () => {
    expect(montarCSV([['a', 'b;c']], true)).toBe(`${BOM}"a";"b;c"`)
    expect(montarCSV([['plain']], true)).toBe(`${BOM}"plain"`)
  })

  it('trata nulo/undefined como vazio', () => {
    expect(montarCSV([[null, undefined, 0]])).toBe(`${BOM};;0`)
  })
})

describe('produtoParaLinha / csvProdutos', () => {
  it('gera as 16 colunas na ordem do cabeçalho', () => {
    const linha = produtoParaLinha(produto())
    expect(linha).toHaveLength(CABECALHO_PRODUTOS.length)
    expect(linha).toEqual([
      'SKU-0001',
      'Queijo Minas Frescal 500g',
      '0201.10.00',
      '5102',
      '000',
      '01',
      '01',
      2,
      '19.90',
      '39.80',
      '000',
      '000001',
      'Tributação integral',
      60,
      60,
      '',
    ])
  })

  it('snapshot vazio cai em string vazia', () => {
    const p = produto({ classificacaoSnapshot: undefined as never })
    const linha = produtoParaLinha(p)
    expect(linha[12]).toBe('')
    expect(linha[13]).toBe('')
    expect(linha[14]).toBe('')
    expect(linha[15]).toBe('')
  })

  it('cabeçalho não é entreaspado, célula com ; é', () => {
    const csv = csvProdutos([produto({ nome: 'Aço; inox 304' })])
    const [cab, linha] = csv.replace(BOM, '').split('\r\n')
    expect(cab.startsWith('SKU;Nome;NCM')).toBe(true)
    expect(cab.includes('"')).toBe(false)
    expect(linha).toContain('"Aço; inox 304"')
    expect(linha.startsWith('SKU-0001;"Aço; inox 304";0201.10.00')).toBe(true)
  })

  it('lista vazia mantém só o cabeçalho', () => {
    expect(csvProdutos([]).replace(BOM, '').split('\r\n')).toHaveLength(1)
  })
})

describe('csvSped', () => {
  it('modo itens entreaspada todas as células', () => {
    const csv = csvSped([resultadoItem()])
    const linhas = csv.replace(BOM, '').split('\r\n')
    expect(linhas).toHaveLength(2)
    expect(linhas[0]).toBe('"Código";"Produto";"NCM";"CST";"CFOP";"Qtd";"Valor";"CST Reforma";"cClassTrib";"Red. IBS (%)";"Red. CBS (%)";"IBS";"CBS";"Total Tributos";"Anexo"')
    expect(linhas[1]).toBe(`"P1";"Produto Um";"0201.10.00";"000";"5102";"2";"250.00";"000";"000001";"0";"0";"${(250 * REF_IBS / 100).toFixed(2)}";"${(250 * REF_CBS / 100).toFixed(2)}";"${(250 * (REF_IBS + REF_CBS) / 100).toFixed(2)}";""`)
  })

  it('blindagem: coluna Anexo só com o oficial; sem cobertura oficial, vazio (nunca "isento"/"60")', () => {
    // Fixture acima: classificacaoNcmInvalido (anexo oficial null) + item.anexo
    // legado 'isento' → CSV sai vazio, sem afirmar faixa derivada.
    expect(csvSped([resultadoItem()]).split('\r\n')[1]).toMatch(/;""$/)
    // Com anexo oficial na classificação, o valor oficial aparece cru.
    const oficial = resultadoItem({
      classificacao: {
        ...classificacaoNcmInvalido('02011000'),
        cst: '200',
        cClassTrib: '200038',
        resumo: {
          descricaoCClassTrib: 'Anexo IX',
          percentualReducaoIBS: 60,
          percentualReducaoCBS: 60,
          anexo: '9',
          urlLegislacao: null,
          documentosHabilitados: null,
        },
      },
    })
    expect(csvSped([oficial]).split('\r\n')[1]).toMatch(/;"9"$/)
  })

  it('modo resumo usa o cabeçalho de CST/CFOP', () => {
    const csv = csvSped([resultadoResumo()])
    const linhas = csv.replace(BOM, '').split('\r\n')
    expect(linhas[0]).toBe('"CST ICMS";"CFOP";"Notas";"Valor Operação";"BC ICMS";"ICMS";"IBS";"CBS";"Total Tributos"')
    expect(linhas[1]).toBe(`"000";"5102";"3";"1000.00";"1000.00";"180.00";"${(1000 * REF_IBS / 100).toFixed(2)}";"${(1000 * REF_CBS / 100).toFixed(2)}";"${(1000 * (REF_IBS + REF_CBS) / 100).toFixed(2)}"`)
  })

  it('escapa aspas dentro das células', () => {
    expect(csvSped([resultadoResumo({ cfop: '51"02' })])).toContain('"51""02"')
    expect(csvSped([resultadoItem({ descricaoProduto: 'D' })])).toContain('"D"')
  })
})

describe('totaisSped', () => {
  it('soma a base correta para itens e resumos', () => {
    const itens = [
      resultadoItem({ vlItem: 100, ibs: 10, cbs: 5 }),
      resultadoItem({ vlItem: 200, ibs: 20, cbs: 10 }),
    ]
    expect(totaisSped(itens)).toMatchObject({ base: 300, ibs: 30, cbs: 15, trib: 45 })

    const resumos = [resultadoResumo({ totalOperacao: 500, ibs: 10, cbs: 5 })]
    expect(totaisSped(resumos)).toMatchObject({ base: 500, ibs: 10, cbs: 5, trib: 15 })
  })

  it('base nula não divide por zero', () => {
    expect(totaisSped([]).carga).toBe(0)
  })
})
