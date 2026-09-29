/**
 * Parser de NF-e/NFC-e — fixtures no layout real da SEFAZ.
 */
import { describe, expect, it } from 'vitest'
import { classificarDirecao, parseXmlNfe } from '@/infrastructure/nfe/parse'

const CHAVE = '35260912345678000190550010000012341000012340'

const det = (
  nItem: string,
  cProd: string,
  xProd: string,
  ncm: string,
  cfop: string,
  icmsGrupo: string,
  pisCst = '01',
  cofinsCst = '01',
): string => `
    <det nItem="${nItem}">
      <prod>
        <cProd>${cProd}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd>
        <NCM>${ncm}</NCM><CFOP>${cfop}</CFOP><uCom>UN</uCom>
        <qCom>2.0000</qCom><vUnCom>100.00</vUnCom><vProd>200.00</vProd>
      </prod>
      <imposto>
        <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>200.00</vBC><pICMS>18.00</pICMS><vICMS>36.00</vICMS></ICMS00></ICMS>
        <PIS><PISAliq><CST>${pisCst}</CST><vBC>200.00</vBC><pPIS>1.65</pPIS><vPIS>3.30</vPIS></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>${cofinsCst}</CST><vBC>200.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>15.20</vCOFINS></COFINSAliq></COFINS>
      </imposto>
    </det>`.replace('<CST>00</CST>', `<CST>${icmsGrupo}</CST>`)

const nfe = (opcoes: {
  emitCnpj: string
  destCnpj?: string
  dets?: string
  mod?: string
  avulsa?: boolean
  dhEmi?: string
}): string => {
  const corpo = `
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${CHAVE}" versao="4.00">
      <ide>
        <cUF>35</cUF><cNF>00012340</cNF><natOp>VENDA</natOp><mod>${opcoes.mod ?? '55'}</mod>
        <serie>1</serie><nNF>1234</nNF>
        <dhEmi>${opcoes.dhEmi ?? '2026-09-10T10:00:00-03:00'}</dhEmi>
        <tpNF>1</tpNF><idDest>1</idDest><cMunFG>3550308</cMunFG><tpImp>1</tpImp>
        <tpEmis>1</tpEmis><cDV>0</cDV><tpAmb>1</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal>
      </ide>
      <emit><CNPJ>${opcoes.emitCnpj}</CNPJ><xNome>Emitente Ltda</xNome></emit>
      ${opcoes.destCnpj ? `<dest><CNPJ>${opcoes.destCnpj}</CNPJ><xNome>Destinatario SA</xNome></dest>` : ''}
      ${opcoes.dets ?? det('1', 'P1', 'Produto Um', '02011000', '5102', '00')}
      <total><ICMSTot>
        <vBC>200.00</vBC><vICMS>36.00</vICMS><vProd>200.00</vProd><vNF>200.00</vNF>
      </ICMSTot></total>
    </infNFe>
  </NFe>`
  if (opcoes.avulsa) return `<?xml version="1.0" encoding="UTF-8"?>${corpo}`
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${corpo}<protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe></infProt></protNFe></nfeProc>`
}

describe('parseXmlNfe', () => {
  it('lê nfeProc com cabeçalho, emitente, destinatário e totais', () => {
    const r = parseXmlNfe(nfe({ emitCnpj: '12345678000190', destCnpj: '98765432000180' }), 'nota.xml')
    expect(r.chave).toBe(CHAVE)
    expect(r.numero).toBe('1234')
    expect(r.modelo).toBe('55')
    expect(r.dataEmissao).toBe('2026-09-10')
    expect(r.emitCnpj).toBe('12345678000190')
    expect(r.emitNome).toBe('Emitente Ltda')
    expect(r.destDoc).toBe('98765432000180')
    expect(r.valorTotal).toBe(200)
    expect(r.itens).toHaveLength(1)
    expect(r.itens[0]).toMatchObject({
      codProd: 'P1',
      descricao: 'Produto Um',
      ncm: '02011000',
      cfop: '5102',
      cstIcms: '00',
      qtd: 2,
      vlUnit: 100,
      vlTotal: 200,
      vlIcms: 36,
      vBcIcms: 200,
      pIcms: 18,
      cstPis: '01',
      cstCofins: '01',
      vPis: 3.3,
      vCofins: 15.2,
    })
  })

  it('prefere o grupo de ICMS com valor destacado quando há mais de um', () => {
    // ST + próprio: o CST vem do grupo com destaque (ICMS60 sem vICMS não
    // pode "vencer" o ICMS00 que efetivamente calcula o imposto).
    const detDuplo = `
    <det nItem="1">
      <prod><cProd>P1</cProd><xProd>Misto</xProd><NCM>02011000</NCM><CFOP>5102</CFOP>
      <uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>100.00</vUnCom><vProd>100.00</vProd></prod>
      <imposto>
        <ICMS>
          <ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>100.00</vBCSTRet><vICMSSTRet>0.00</vICMSSTRet></ICMS60>
          <ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00>
        </ICMS>
        <PIS><PISNT><CST>07</CST></PISNT></PIS>
        <COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>
      </imposto>
    </det>`
    const r = parseXmlNfe(nfe({ emitCnpj: '12345678000190', dets: detDuplo }), 'duplo.xml')
    expect(r.itens[0]).toMatchObject({ cstIcms: '00', vBcIcms: 100, pIcms: 18, vlIcms: 18, vPis: 0, vCofins: 0 })
  })

  it('lê NFe avulsa e múltiplos itens em sequência', () => {
    const xml = nfe({
      emitCnpj: '12345678000190',
      avulsa: true,
      dets: det('1', 'P1', 'Um', '02011000', '5102', '00') + det('2', 'P2', 'Dois', '84713012', '5102', '00'),
    })
    const r = parseXmlNfe(xml, 'avulsa.xml')
    expect(r.itens).toHaveLength(2)
    expect(r.itens[1]).toMatchObject({ numItem: '2', codProd: 'P2', ncm: '84713012' })
  })

  it('lê CSOSN do Simples e dEmi sem hora', () => {
    const detSn = `
    <det nItem="1">
      <prod><cProd>P9</cProd><xProd>SN</xProd><NCM>30049099</NCM><CFOP>5102</CFOP>
      <uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>50.00</vUnCom><vProd>50.00</vProd></prod>
      <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
      <PIS><PISNT><CST>04</CST></PISNT></PIS>
      <COFINS><COFINSNT><CST>04</CST></COFINSNT></COFINS></imposto>
    </det>`
    const xml = nfe({ emitCnpj: '12345678000190', dets: detSn, dhEmi: '2026-09-11' })
    const r = parseXmlNfe(xml, 'sn.xml')
    expect(r.dataEmissao).toBe('2026-09-11')
    expect(r.itens[0]).toMatchObject({ cstIcms: '102', cstPis: '04', cstCofins: '04', vlIcms: 0 })
  })

  it('rejeita CT-e, modelo não suportado e XML malformado', () => {
    expect(() => parseXmlNfe('<cteProc><CTe/></cteProc>', 'cte.xml')).toThrow('CT-e')
    expect(() => parseXmlNfe(nfe({ emitCnpj: '12345678000190', mod: '57' }), 'cte57.xml')).toThrow('modelo 57')
    expect(() => parseXmlNfe('<NFe><infNFe>', 'quebrado.xml')).toThrow('malformado')
    expect(() => parseXmlNfe('', 'vazio.xml')).toThrow('vazio')
  })

  it('exige chave de 44 dígitos e ao menos um item com cProd', () => {
    const semChave = nfe({ emitCnpj: '12345678000190' }).replace(`Id="NFe${CHAVE}"`, 'Id="NFe123"')
    expect(() => parseXmlNfe(semChave, 'sem-chave.xml')).toThrow('chave de acesso')
    const semDet = nfe({ emitCnpj: '12345678000190', dets: '' })
    expect(() => parseXmlNfe(semDet, 'sem-det.xml')).toThrow('sem itens')
  })
})

describe('classificarDirecao', () => {
  it('saída quando o emitente é a empresa; entrada quando é a destinatária', () => {
    expect(classificarDirecao('12345678000190', '98765432000180', '12.345.678/0001-90')).toBe('saida')
    expect(classificarDirecao('11111111000111', '12345678000190', '12345678000190')).toBe('entrada')
  })

  it('quarentena sem CNPJ cadastrado ou sem coincidência', () => {
    expect(classificarDirecao('12345678000190', '98765432000180', '')).toBe('quarentena')
    expect(classificarDirecao('12345678000190', '98765432000180', null)).toBe('quarentena')
    expect(classificarDirecao('11111111000111', '22222222000122', '12345678000190')).toBe('quarentena')
  })
})
