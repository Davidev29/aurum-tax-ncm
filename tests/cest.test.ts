/**
 * CEST × ST — lookup estático + parse do `<CEST>` no XML.
 */
import { describe, expect, it } from 'vitest'
import { CEST_DADOS } from '@/domain/constants/cest-dados'
import {
  buscarCest,
  formatarCest,
  normalizarCest,
  resumoStNota,
  temSt,
  TOTAL_CEST_ST,
} from '@/domain/services/cest'
import { parseXmlNfe } from '@/infrastructure/nfe/parse'

describe('cest — normalização e formato', () => {
  it('normaliza com/sem máscara e formata em AA.BBB.CC', () => {
    expect(normalizarCest('01.001.00')).toBe('0100100')
    expect(normalizarCest('0100100')).toBe('0100100')
    expect(normalizarCest('')).toBe('')
    expect(formatarCest('0100100')).toBe('01.001.00')
    expect(formatarCest('01.001.00')).toBe('01.001.00')
  })
})

describe('cest — lista ST embutida', () => {
  it('tem 1010 registros únicos de 7 dígitos', () => {
    expect(CEST_DADOS).toHaveLength(1010)
    expect(TOTAL_CEST_ST).toBe(1010)
    const codigos = CEST_DADOS.map((r) => normalizarCest(r.cest))
    expect(codigos.every((c) => c.length === 7)).toBe(true)
    expect(new Set(codigos).size).toBe(1010)
  })

  it('bate com a lista e expõe segmento + descrição', () => {
    const info = buscarCest('0100100')
    expect(info).not.toBeNull()
    expect(info?.formatado).toBe('01.001.00')
    expect(info?.segmento).toBe('01. Autopeças')
    expect(info?.descricao.length).toBeGreaterThan(10)
    // tolera máscara e sufixo
    expect(buscarCest('01.001.00')?.codigo).toBe('0100100')
    expect(temSt('0100100')).toBe(true)
  })

  it('fora da lista não marca (sem afirmar nada)', () => {
    expect(buscarCest('9999999')).toBeNull()
    expect(buscarCest('')).toBeNull()
    expect(buscarCest('123')).toBeNull()
    expect(temSt('9999999')).toBe(false)
  })

  it('resume a nota: conta itens ST e segmentos', () => {
    const r = resumoStNota([{ cest: '0100100' }, { cest: '9999999' }, { cest: '' }])
    expect(r).toMatchObject({ total: 3, comSt: 1 })
    expect(r.segmentos).toEqual(['01. Autopeças'])
    expect(resumoStNota([{ cest: '' }]).comSt).toBe(0)
  })
})

describe('cest — parse do XML', () => {
  const CHAVE = '35260912345678000190550010000012341000012340'
  const xmlComCest = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><cUF>35</cUF><cNF>00012340</cNF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>12345678000190</CNPJ><xNome>Emitente Ltda</xNome></emit><det nItem="1"><prod><cProd>P1</cProd><xProd>Peça ST</xProd><NCM>87089990</NCM><CEST>01.001.00</CEST><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.00</vUnCom><vProd>100.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS></imposto></det><total><ICMSTot><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

  it('lê o CEST do item e o lookup encontra a ST', () => {
    const r = parseXmlNfe(xmlComCest, 'com-cest.xml')
    expect(r.itens[0].cest).toBe('0100100')
    expect(buscarCest(r.itens[0].cest)?.segmento).toBe('01. Autopeças')
  })
})
