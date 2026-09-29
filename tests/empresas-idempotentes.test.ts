/**
 * Cadastro idempotente + enriquecimento via SPED/XML.
 * Roda sobre o IndexedDB em memória (fake-indexeddb, ver tests/setup.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buscarEmpresaPorCnpj,
  cadastrarEmpresa,
  completarEmpresa,
  mesclarEmpresa,
} from '@/application/empresas'
import { completarEmpresaComNota } from '@/application/notas-xml'
import { extrairEstabelecimentoSped } from '@/infrastructure/sped/parse'
import { parseXmlNfe } from '@/infrastructure/nfe/parse'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { db } from '@/infrastructure/db/schema'

beforeEach(async () => {
  await db.empresas.clear()
  await db.nfeNotas.clear()
  limparCacheBrasilApi()
})

describe('cadastro idempotente', () => {
  it('mesmo CNPJ não duplica — completa os vazios', async () => {
    const r1 = await cadastrarEmpresa({ razaoSocial: 'Exemplo LTDA', cnpj: '11222333000181' })
    expect(r1.ok).toBe(true)
    expect(r1.atualizada).toBeFalsy()
    const r2 = await cadastrarEmpresa({
      razaoSocial: 'Exemplo LTDA',
      cnpj: '11.222.333/0001-81',
      fantasia: 'Exemplo',
      ie: '123456',
    })
    expect(r2.ok).toBe(true)
    expect(r2.atualizada).toBe(true)
    expect(await db.empresas.count()).toBe(1)
    const e = (await buscarEmpresaPorCnpj('11222333000181'))!
    expect(e.fantasia).toBe('Exemplo')
    expect(e.ie).toBe('123456')
  })

  it('mesclarEmpresa nunca apaga dado existente', () => {
    const base = {
      razaoSocial: 'A',
      cnpj: '11222333000181',
      fantasia: 'F',
      ie: '111',
      criadoEm: '',
    }
    const out = mesclarEmpresa(base, { fantasia: 'Outra', ie: '222', im: '333' })
    expect(out.fantasia).toBe('F')
    expect(out.ie).toBe('111')
    expect(out.im).toBe('333')
  })

  it('completarEmpresa é silencioso com id inexistente', async () => {
    await expect(completarEmpresa(999999, { ie: '1' })).resolves.toBe(false)
  })
})

describe('enriquecimento via SPED', () => {
  it('extrai 0000/0005 (CNPJ, IE, IM, UF, fantasia)', () => {
    const sped =
      '|0000|006|0|01012026|31012026|EMPRESA EXEMPLO LTDA|11222333000181||SP|123456|3550308|654321|||\n' +
      '|0005|Exemplo Fantasia|01001000|Rua A|100||Centro|1199999999||a@b.com|\n' +
      '|C100|1|1|1|001|55|00|1|123|chave|10/01/2026|10/01/2026|100,00|0|||||||||\n'
    const est = extrairEstabelecimentoSped(sped)
    expect(est).toMatchObject({
      nome: 'EMPRESA EXEMPLO LTDA',
      cnpj: '11222333000181',
      ie: '123456',
      im: '654321',
      uf: 'SP',
      fantasia: 'Exemplo Fantasia',
    })
  })

  it('retorna null sem 0000', () => {
    expect(extrairEstabelecimentoSped('|C100|1|1|1|\n')).toBeNull()
    expect(extrairEstabelecimentoSped('')).toBeNull()
  })
})

describe('enriquecimento via XML', () => {
  const CH = '9'.repeat(44)
  const XML = `<?xml version=\"1.0\"?><nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\"><NFe><infNFe Id=\"NFe${CH}\"><ide><mod>55</mod><dhEmi>2026-09-10T10:00:00-03:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>Emitente</xNome><IE>123456</IE><IM>654321</IM><enderEmit><xLgr>Rua A</xLgr><nro>100</nro><xMun>Sao Paulo</xMun><UF>SP</UF></enderEmit></emit><dest><CNPJ>99999999000199</CNPJ><IE>777</IE></dest><det nItem=\"1\"><prod><cProd>P1</cProd><NCM>02011000</NCM><CFOP>5102</CFOP><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod><imposto/></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`

  it('parse extrai IE/IM/endereço do emitente e IE do destinatário', () => {
    const b = parseXmlNfe(XML, 'a.xml')
    expect(b.emitIe).toBe('123456')
    expect(b.emitIm).toBe('654321')
    expect(b.emitEndereco).toContain('Rua A')
    expect(b.emitUf).toBe('SP')
    expect(b.destIe).toBe('777')
  })

  it('completarEmpresaComNota preenche a empresa pelo lado coincidente', async () => {
    const r = await cadastrarEmpresa({ razaoSocial: 'Emitente', cnpj: '11222333000181' })
    const b = parseXmlNfe(XML, 'a.xml')
    const mudou = await completarEmpresaComNota(r.empresa!.id!, '11222333000181', b)
    expect(mudou).toBe(true)
    const e = (await buscarEmpresaPorCnpj('11222333000181'))!
    expect(e.ie).toBe('123456')
    expect(e.im).toBe('654321')
    // Segunda passada não muda nada (idempotente).
    const mudou2 = await completarEmpresaComNota(r.empresa!.id!, '11222333000181', b)
    expect(mudou2).toBe(false)
  })
})
