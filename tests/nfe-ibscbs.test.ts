import { describe, expect, it } from 'vitest'
import { parseXmlNfe } from '@/infrastructure/nfe/parse'
import { creditoIbsCbsDaNota, creditoIbsCbsDoItem } from '@/infrastructure/nfe/credito'

const CHAVE = '35260912345678000190550010000012341000012340'

const detReforma = `
    <det nItem="1">
      <prod>
        <cProd>P1</cProd><xProd>Produto Reforma</xProd>
        <NCM>02011000</NCM><CFOP>5102</CFOP><uCom>UN</uCom>
        <qCom>2.0000</qCom><vUnCom>100.00</vUnCom><vProd>200.00</vProd>
      </prod>
      <imposto>
        <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>200.00</vBC><vICMS>36.00</vICMS></ICMS00></ICMS>
        <PIS><PISAliq><CST>01</CST></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>01</CST></COFINSAliq></COFINS>
        <IBSCBS>
          <CST>000</CST><cClassTrib>000001</cClassTrib>
          <gIBSCBS>
            <vBC>200.00</vBC>
            <gIBSUF><pIBSUF>0.10</pIBSUF><vIBSUF>0.20</vIBSUF></gIBSUF>
            <gIBSMun><pIBSMun>0.10</pIBSMun><vIBSMun>0.20</vIBSMun></gIBSMun>
            <gCBS><pCBS>1.00</pCBS><vCBS>2.00</vCBS></gCBS>
          </gIBSCBS>
        </IBSCBS>
      </imposto>
    </det>`

const nfeReforma = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${CHAVE}" versao="4.00">
      <ide><cUF>35</cUF><natOp>VENDA</natOp><mod>55</mod>
        <serie>1</serie><nNF>1234</nNF>
        <dhEmi>2026-09-10T10:00:00-03:00</dhEmi>
      </ide>
      <emit><CNPJ>12345678000190</CNPJ><xNome>Emitente Ltda</xNome><CRT>3</CRT></emit>
      <dest><CNPJ>98765432000180</CNPJ><xNome>Dest SA</xNome></dest>
      ${detReforma}
      <total><ICMSTot><vProd>200.00</vProd><vNF>200.00</vNF></ICMSTot>
      <IBSCBSTot><vBCIBSCBS>200.00</vBCIBSCBS>
        <gIBS><gIBSUF><vIBSUF>0.20</vIBSUF></gIBSUF><gIBSMun><vIBSMun>0.20</vIBSMun></gIBSMun><vIBS>0.40</vIBS></gIBS>
        <gCBS><vCBS>2.00</vCBS></gCBS>
      </IBSCBSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`

describe('IBSCBS destacado (Reforma)', () => {
  it('lê CST/cClassTrib e valores por item + totais', () => {
    const r = parseXmlNfe(nfeReforma, 'reforma.xml')
    expect(r.itens[0]).toMatchObject({
      cstIbsCbs: '000',
      cClassTribIbsCbs: '000001',
      vBcIbsCbs: 200,
      vIbsItem: 0.4,
      vCbsItem: 2,
    })
    expect(r.totalIbsXml).toBeCloseTo(0.4, 2)
    expect(r.totalCbsXml).toBeCloseTo(2, 2)
    expect(r.totalCreditoIbsCbsXml).toBeCloseTo(2.4, 2)
  })

  it('agrega o crédito IBS/CBS da nota', () => {
    const r = parseXmlNfe(nfeReforma, 'reforma.xml')
    expect(creditoIbsCbsDoItem(r.itens[0])).toMatchObject({ temCredito: true, vTotal: 2.4 })
    const c = creditoIbsCbsDaNota(r.itens, r)
    expect(c).toMatchObject({ itensComCredito: 1, temDestaque: true, totalDestacado: 2.4 })
  })

  it('XML antigo sem IBSCBS zera sem quebrar', () => {
    const antigo = nfeReforma.replace(/<IBSCBS>[\s\S]*?<\/IBSCBS>/g, '').replace(/<IBSCBSTot>[\s\S]*?<\/IBSCBSTot>/g, '')
    const r = parseXmlNfe(antigo, 'antigo.xml')
    expect(r.itens[0].vIbsItem).toBe(0)
    expect(creditoIbsCbsDaNota(r.itens, r)).toMatchObject({ temDestaque: false, totalDestacado: 0 })
  })
})
