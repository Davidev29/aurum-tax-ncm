/**
 * Confronto XML × sistema por item + reaplicação da vigente numa nota.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { divergenciaXmlSistema } from '@/infrastructure/nfe/credito'
import { reaplicarClassificacaoNota } from '@/application/notas-xml'
import { salvarReclassificacaoManual } from '@/infrastructure/base/reclassificacao-repo'
import { classificacaoRegraGeral } from '@/infrastructure/base/classificacao-repo'

const NCM = '99999999'

const itemBase = () => ({
  chave: '1'.repeat(44), numItem: '1', codProd: 'SKU-1', descricao: 'Produto teste',
  ncm: NCM, cfop: '5102', cstIcms: '00', qtd: 1, unid: 'UN',
  vlUnit: 100, vlTotal: 100, vlDesc: 0, vlIcms: 18, cstPis: '01', cstCofins: '01',
})

async function semear() {
  await db.cst.put({
    codigo: '200', descricao: 'CST de teste', indIBSCBS: true, indIBSCBSMono: false,
    indReducao: true, indDiferimento: false, indTransferenciaCredito: true, docs: {} as never,
  })
  await db.cstClassTrib.put({
    id: '200|200001', cst: '200', cClassTrib: '200001', nome: 'Redução de teste',
    descricao: 'Redução de teste', lcRedacao: null, lcRef: 'LC 214/2025 art. teste',
    tipoAliquota: 'Reduzida', pRedIBS: 60, pRedCBS: 60, indRedutorBC: 0,
    indTribRegular: 1, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0,
    indMonoDif: 0, creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
  })
  await db.ncmNomenclatura.put({
    codigo: NCM, codigoOriginal: '9999.99.99', descricao: 'Produto sem vínculo',
    dataInicio: null, dataFim: null, ato: null,
  })
}

async function semearNota() {
  const rg = await classificacaoRegraGeral(NCM)
  await db.nfeNotas.add({
    chave: '1'.repeat(44), numero: '1', serie: '1', modelo: '55', natOp: 'VENDA',
    dataEmissao: '2026-01-01', emitCnpj: '11111111000111', emitNome: 'Emit',
    emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: '',
    destDoc: '22222222000122', destNome: 'Dest', destIe: '',
    valorProdutos: 100, valorTotal: 100,
    empresaId: 1, direcao: 'saida', arquivo: null, xmlConteudo: null,
    refIBS: 17.7, refCBS: 8.8, totalIBS: 17.7, totalCBS: 8.8, totalTributos: 26.5,
    importadoEm: new Date().toISOString(),
    itensAnalisados: [{
      ...itemBase(),
      // Emitente destacou CST 000 integral com valores cheios…
      cstIbsCbs: '000', cClassTribIbsCbs: '000001', vBcIbsCbs: 100, vIbsItem: 17.7, vCbsItem: 8.8,
      classificacao: rg, regraGeral: true, manual: false,
      redIBS: 0, redCBS: 0, ibs: 17.7, cbs: 8.8, totalTributos: 26.5, carga: 26.5,
      anexo: 'isento', observacoes: [],
    }],
  } as never)
}

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
  await semear()
})

describe('divergenciaXmlSistema', () => {
  it('sem IBSCBS no XML: nada a confrontar', () => {
    const d = divergenciaXmlSistema({
      classificacao: { cst: '000', cClassTrib: '000001' }, ibs: 1, cbs: 1,
    })
    expect(d).toEqual({ temXml: false, divergeEnquadramento: false, divergeValores: false, diverge: false })
  })

  it('enquadramento igual e valores iguais: confere', () => {
    const d = divergenciaXmlSistema({
      cstIbsCbs: '000', cClassTribIbsCbs: '000001', vIbsItem: 17.7, vCbsItem: 8.8,
      classificacao: { cst: '000', cClassTrib: '000001' }, ibs: 17.7, cbs: 8.8,
    })
    expect(d.temXml).toBe(true)
    expect(d.diverge).toBe(false)
  })

  it('CST do emitente ≠ sistema: diverge enquadramento', () => {
    const d = divergenciaXmlSistema({
      cstIbsCbs: '000', cClassTribIbsCbs: '000001', vIbsItem: 17.7, vCbsItem: 8.8,
      classificacao: { cst: '200', cClassTrib: '200001' }, ibs: 7.08, cbs: 3.52,
    })
    expect(d.divergeEnquadramento).toBe(true)
    expect(d.divergeValores).toBe(true)
    expect(d.diverge).toBe(true)
  })

  it('mesmo enquadramento, valores diferentes: diverge valores', () => {
    const d = divergenciaXmlSistema({
      cstIbsCbs: '000', cClassTribIbsCbs: '000001', vIbsItem: 10, vCbsItem: 5,
      classificacao: { cst: '000', cClassTrib: '000001' }, ibs: 17.7, cbs: 8.8,
    })
    expect(d.divergeEnquadramento).toBe(false)
    expect(d.divergeValores).toBe(true)
    expect(d.diverge).toBe(true)
  })
})

describe('reaplicarClassificacaoNota', () => {
  it('nota inexistente: motivo legível', async () => {
    const r = await reaplicarClassificacaoNota(999)
    expect(r.ok).toBe(false)
  })

  it('aplica a manual salva depois da importação', async () => {
    await semearNota()
    const nota = (await db.nfeNotas.toArray())[0]
    const antes = await reaplicarClassificacaoNota(nota.id!)
    expect(antes).toMatchObject({ ok: true, itens: 1, alterados: 0 })

    await salvarReclassificacaoManual({
      ncm: NCM, cst: '200', cClassTrib: '200001',
      descricao: 'Justificativa', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    const depois = await reaplicarClassificacaoNota(nota.id!)
    expect(depois).toMatchObject({ ok: true, itens: 1, alterados: 1 })

    const atual = await db.nfeNotas.get(nota.id!)
    expect(atual?.itensAnalisados[0].classificacao.cClassTrib).toBe('200001')
    expect(atual?.itensAnalisados[0].manual).toBe(true)
    expect(atual?.totalIBS).toBeCloseTo(7.08, 2)
  })
})
