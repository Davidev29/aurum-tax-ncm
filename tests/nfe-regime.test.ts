/**
 * Regime tributário do emitente (CRT + CSOSN) e persistência no cadastro.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cadastrarEmpresa, buscarEmpresaPorCnpj } from '@/application/empresas'
import { completarEmpresaComNota } from '@/application/notas-xml'
import { parseXmlNfe } from '@/infrastructure/nfe/parse'
import {
  regimeDoEmitente,
  regimePorCsts,
  transfereCreditoIbsCbs,
} from '@/infrastructure/nfe/regime'
import { db } from '@/infrastructure/db/schema'

describe('regimePorCsts', () => {
  it('CSOSN denuncia Simples; CST clássico indica normal', () => {
    expect(regimePorCsts(['102'])).toBe('simples')
    expect(regimePorCsts(['900'])).toBe('simples')
    expect(regimePorCsts(['00', '20'])).toBe('normal')
    expect(regimePorCsts([])).toBe('desconhecido')
    expect(regimePorCsts(['', '  '])).toBe('desconhecido')
  })

  it('CSOSN vence mesmo misturado com clássicos', () => {
    expect(regimePorCsts(['00', '101'])).toBe('simples')
  })
})

describe('regimeDoEmitente', () => {
  it('CRT manda sobre os itens', () => {
    expect(regimeDoEmitente('1', [{ cstIcms: '00' }])).toBe('simples')
    expect(regimeDoEmitente('2', [])).toBe('simples')
    expect(regimeDoEmitente('4', [{ cstIcms: '00' }])).toBe('mei')
    expect(regimeDoEmitente('3', [{ cstIcms: '102' }])).toBe('normal')
  })

  it('sem CRT, infere pelos itens; aceita lista de strings', () => {
    expect(regimeDoEmitente('', [{ cstIcms: '102' }])).toBe('simples')
    expect(regimeDoEmitente('', ['00'])).toBe('normal')
    expect(regimeDoEmitente(undefined, [])).toBe('desconhecido')
  })
})

describe('transfereCreditoIbsCbs', () => {
  it('só o regime normal transfere', () => {
    expect(transfereCreditoIbsCbs('normal')).toBe(true)
    expect(transfereCreditoIbsCbs('simples')).toBe(false)
    expect(transfereCreditoIbsCbs('mei')).toBe(false)
    expect(transfereCreditoIbsCbs('desconhecido')).toBe(false)
  })
})

const CH = '7'.repeat(44)
const xmlComCrt = (crt: string, cstIcms: string): string =>
  `<?xml version=\"1.0\"?><nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\"><NFe><infNFe Id=\"NFe${CH}\"><ide><mod>55</mod><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>Emitente SN</xNome><CRT>${crt}</CRT></emit><dest><CNPJ>99999999000199</CNPJ></dest><det nItem=\"1\"><prod><cProd>P1</cProd><NCM>02011000</NCM><CFOP>5102</CFOP><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>${cstIcms}</CSOSN></ICMSSN102></ICMS></imposto></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

describe('parse + cadastro', () => {
  beforeEach(async () => {
    await db.empresas.clear()
    await db.nfeNotas.clear()
  })

  it('parse extrai o CRT do emitente', () => {
    expect(parseXmlNfe(xmlComCrt('1', '102'), 'sn.xml').emitCrt).toBe('1')
  })

  it('completarEmpresaComNota grava o regime do emitente', async () => {
    const r = await cadastrarEmpresa({ razaoSocial: 'SN', cnpj: '11222333000181' })
    const bruta = parseXmlNfe(xmlComCrt('1', '102'), 'sn.xml')
    await completarEmpresaComNota(r.empresa!.id!, '11222333000181', bruta)
    const e = (await buscarEmpresaPorCnpj('11222333000181'))!
    expect(e.regimeTributario).toBe('simples')
  })

  it('sem CRT, o CSOSN dos itens define o regime', async () => {
    const r = await cadastrarEmpresa({ razaoSocial: 'SN2', cnpj: '11222333000181' })
    const semCrt = xmlComCrt('', '102').replace('<CRT></CRT>', '')
    const bruta = parseXmlNfe(semCrt, 'sn2.xml')
    expect(bruta.emitCrt).toBe('')
    await completarEmpresaComNota(r.empresa!.id!, '11222333000181', bruta)
    const e = (await buscarEmpresaPorCnpj('11222333000181'))!
    expect(e.regimeTributario).toBe('simples')
  })
})
