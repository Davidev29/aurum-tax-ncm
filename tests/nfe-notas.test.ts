/**
 * Casos de uso das notas XML — importação, filtros, calendário e ranking.
 * Roda sobre o IndexedDB em memória (fake-indexeddb, ver tests/setup.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Empresa } from '@/domain/entities'
import { db } from '@/infrastructure/db/schema'
import {
  contarPorDia,
  importarXmls,
  listarNotas,
  rankingFornecedores,
  totaisNotas,
} from '@/application/notas-xml'
import { FILTROS_NFE_VAZIOS } from '@/infrastructure/nfe/tipos'

const EMPRESA = '12345678000190'
const FORNECEDOR = '11111111000111'

const empresa: Empresa = {
  id: 1,
  razaoSocial: 'Empresa Ativa Ltda',
  cnpj: EMPRESA,
  fantasia: '',
  criadoEm: new Date().toISOString(),
}

const det = (cProd: string, cfop: string, vProd: string): string => `
    <det nItem="1">
      <prod><cProd>${cProd}</cProd><xProd>Produto ${cProd}</xProd><NCM>02011000</NCM>
      <CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>${vProd}</vUnCom><vProd>${vProd}</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${vProd}</vBC><vICMS>18.00</vICMS></ICMS00></ICMS>
      <PIS><PISAliq><CST>01</CST></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST></COFINSAliq></COFINS></imposto>
    </det>`

const xml = (opcoes: { chave: string; emit: string; dest: string; data: string; dets?: string }): string => `
<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${opcoes.chave}" versao="4.00">
      <ide><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>1</nNF>
      <dhEmi>${opcoes.data}T10:00:00-03:00</dhEmi></ide>
      <emit><CNPJ>${opcoes.emit}</CNPJ><xNome>Emit ${opcoes.emit}</xNome></emit>
      <dest><CNPJ>${opcoes.dest}</CNPJ><xNome>Dest</xNome></dest>
      ${opcoes.dets ?? det('P1', '5102', '100.00')}
      <total><ICMSTot><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`

const CHAVE_A = '1'.repeat(44)
const CHAVE_B = '2'.repeat(44)
const CHAVE_C = '3'.repeat(44)

const arq = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/xml' })

beforeEach(async () => {
  await db.nfeNotas.clear()
})

describe('importarXmls', () => {
  it('importa saída e entrada, pula duplicada e reporta erro sem abortar', async () => {
    const r1 = await importarXmls(
      [
        arq('saida.xml', xml({ chave: CHAVE_A, emit: EMPRESA, dest: '99999999000199', data: '2026-09-10' })),
        arq('entrada.xml', xml({ chave: CHAVE_B, emit: FORNECEDOR, dest: EMPRESA, data: '2026-09-11' })),
      ],
      empresa,
    )
    expect(r1).toMatchObject({ novas: 2, duplicadas: 0, quarentena: 0, erros: [] })

    const notas = await db.nfeNotas.toArray()
    expect(notas.find((n) => n.chave === CHAVE_A)?.direcao).toBe('saida')
    expect(notas.find((n) => n.chave === CHAVE_B)?.direcao).toBe('entrada')
    // Modo web (sem bridge): conteúdo integral fica no registro.
    expect(notas[0].xmlConteudo).toContain('nfeProc')
    // Classificação resolvida e totais calculados.
    expect(notas[0].itensAnalisados).toHaveLength(1)
    expect(notas[0].itensAnalisados[0].ncm).toBe('02011000')
    expect(notas[0].totalTributos).toBeGreaterThan(0)

    const r2 = await importarXmls(
      [
        arq('saida.xml', xml({ chave: CHAVE_A, emit: EMPRESA, dest: '99999999000199', data: '2026-09-10' })),
        arq('quarentena.xml', xml({ chave: CHAVE_C, emit: '55555555000155', dest: '66666666000166', data: '2026-09-12' })),
        arq('quebrado.xml', '<NFe><infNFe>'),
      ],
      empresa,
    )
    expect(r2).toMatchObject({ novas: 1, duplicadas: 1, quarentena: 1 })
    expect(r2.erros).toHaveLength(1)
    expect(r2.erros[0].arquivo).toBe('quebrado.xml')
    expect(await db.nfeNotas.count()).toBe(3)
  })

  it('exige empresa com id', async () => {
    await expect(importarXmls([arq('a.xml', 'x')], { ...empresa, id: undefined })).rejects.toThrow()
  })
})

describe('consultas', () => {
  beforeEach(async () => {
    await importarXmls(
      [
        arq('a.xml', xml({ chave: CHAVE_A, emit: EMPRESA, dest: '99999999000199', data: '2026-09-10', dets: det('P1', '5102', '100.00') })),
        arq('b.xml', xml({ chave: CHAVE_B, emit: FORNECEDOR, dest: EMPRESA, data: '2026-09-10', dets: det('P2', '1102', '300.00') })),
        arq('c.xml', xml({ chave: CHAVE_C, emit: FORNECEDOR, dest: EMPRESA, data: '2026-09-15', dets: det('P1', '1102', '200.00') })),
      ],
      empresa,
    )
  })

  it('listarNotas filtra por direção, texto, fornecedor, CFOP e período', async () => {
    const f = { ...FILTROS_NFE_VAZIOS }
    expect(await listarNotas(1, f)).toHaveLength(3)
    expect(await listarNotas(1, { ...f, direcao: 'entrada' })).toHaveLength(2)
    expect(await listarNotas(1, { ...f, texto: 'P2' })).toHaveLength(1)
    expect(await listarNotas(1, { ...f, fornecedor: FORNECEDOR })).toHaveLength(2)
    expect(await listarNotas(1, { ...f, cfop: '5102' })).toHaveLength(1)
    expect(await listarNotas(1, { ...f, inicio: '2026-09-15', fim: '2026-09-15' })).toHaveLength(1)
  })

  it('contarPorDia agrupa o mês para o calendário', async () => {
    const dias = await contarPorDia(1, 2026, 9)
    expect(dias.get(10)).toBe(2)
    expect(dias.get(15)).toBe(1)
    expect(dias.get(11) ?? 0).toBe(0)
  })

  it('rankingFornecedores soma o crédito das entradas', async () => {
    const rank = await rankingFornecedores(1, '2026-09-01', '2026-09-30')
    expect(rank).toHaveLength(1)
    expect(rank[0]).toMatchObject({ cnpj: FORNECEDOR, qtdNotas: 2 })
    expect(rank[0].creditoTotal).toBeGreaterThan(0)
    // Soma o valorTotal da nota (vNF = 100 fixo no fixture × 2 entradas).
    expect(rank[0].totalEntradas).toBe(200)
  })

  it('filtra por CST do ICMS e pelos filtros da Reforma', async () => {
    const f = { ...FILTROS_NFE_VAZIOS }
    // Fixtures usam CST 00 em todos os itens.
    expect(await listarNotas(1, { ...f, cstIcms: '00' })).toHaveLength(3)
    expect(await listarNotas(1, { ...f, cstIcms: '10' })).toHaveLength(0)
    // Reforma: valores dinâmicos lidos da nota importada (independe da base).
    const todas = await listarNotas(1, f)
    const primeiro = todas[0].itensAnalisados[0]
    expect(await listarNotas(1, { ...f, cClassTrib: primeiro.classificacao.cClassTrib })).toHaveLength(3)
    expect(await listarNotas(1, { ...f, cClassTrib: 'ZZZZZZ' })).toHaveLength(0)
    expect(await listarNotas(1, { ...f, cstReforma: primeiro.classificacao.cst })).toHaveLength(3)
    expect(await listarNotas(1, { ...f, reducao: primeiro.anexo })).toHaveLength(3)
    expect(await listarNotas(1, { ...f, reducao: 'SEM_ANEXO' })).toHaveLength(0)
  })

  it('filtros da Reforma casam o CST/cClassTrib destacado no XML', async () => {
    const base = await listarNotas(1, { ...FILTROS_NFE_VAZIOS })
    const sys = base[0].itensAnalisados[0]
    // Escolhe valores do XML garantidamente diferentes dos do sistema.
    const xmlCst = sys.classificacao.cst === '200' ? '201' : '200'
    const sysCct = sys.classificacao.cClassTrib || ''
    const xmlCct = sysCct === '000002' ? '000003' : '000002'
    const detReforma = `
    <det nItem="1">
      <prod><cProd>PR</cProd><xProd>Produto Reforma</xProd><NCM>02011000</NCM>
      <CFOP>1102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.00</vUnCom><vProd>100.00</vProd></prod>
      <imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><vICMS>18.00</vICMS></ICMS00></ICMS>
      <PIS><PISAliq><CST>01</CST></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST></COFINSAliq></COFINS>
      <IBSCBS><CST>${xmlCst}</CST><cClassTrib>${xmlCct}</cClassTrib>
      <gIBSCBS><vBC>100.00</vBC><gIBSUF><vIBSUF>0.10</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.10</vIBSMun></gIBSMun><gCBS><vCBS>1.00</vCBS></gCBS></gIBSCBS></IBSCBS></imposto>
    </det>`
    const r = await importarXmls(
      [arq('reforma.xml', xml({ chave: '4'.repeat(44), emit: FORNECEDOR, dest: EMPRESA, data: '2026-09-10', dets: detReforma }))],
      empresa,
    )
    expect(r.novas).toBe(1)
    const f = { ...FILTROS_NFE_VAZIOS }
    // A tabela exibe o CST/cClassTrib do XML primeiro — o filtro precisa
    // achar a nota por eles (antes da correção, retornava 0).
    expect(await listarNotas(1, { ...f, cstReforma: xmlCst })).toHaveLength(1)
    expect(await listarNotas(1, { ...f, cClassTrib: xmlCct })).toHaveLength(1)
  })

  it('totaisNotas separa entradas e saídas', () => {
    const notas = [
      { direcao: 'entrada', valorTotal: 100, totalIBS: 10, totalCBS: 5, totalTributos: 15 },
      { direcao: 'saida', valorTotal: 200, totalIBS: 20, totalCBS: 10, totalTributos: 30 },
      { direcao: 'quarentena', valorTotal: 50, totalIBS: 0, totalCBS: 0, totalTributos: 0 },
    ]
    expect(totaisNotas(notas as never[])).toMatchObject({
      qtd: 3, entradas: 1, saidas: 1, quarentena: 1, base: 350, trib: 45,
    })
  })
})
