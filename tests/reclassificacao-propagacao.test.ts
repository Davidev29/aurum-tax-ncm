/**
 * Propagação de reclassificação manual para a base já gravada.
 *
 * Ao classificar um NCM manualmente, produtos e itens de XML com aquele NCM
 * devem passar a refletir a classificação vigente (e voltar à regra geral ao
 * remover a manual).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { propagarClassificacaoNcm } from '@/application/reclassificacao'
import {
  removerReclassificacaoManual,
  salvarReclassificacaoManual,
} from '@/infrastructure/base/reclassificacao-repo'
import { classificacaoRegraGeral } from '@/infrastructure/base/classificacao-repo'
import { REF_DEFAULT } from '@/domain/constants'

// Usa as alíquotas de referência padrão do sistema (dinâmicas conforme regras vigentes)
const REF_IBS = REF_DEFAULT.IBS
const REF_CBS = REF_DEFAULT.CBS

const NCM = '99999999'

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
  const rg = await classificacaoRegraGeral(NCM)
  await db.produtos.add({
    empresaId: null, codigo: 'SKU-1', nome: 'Produto teste', ncm: NCM,
    cfop: '5102', cstIcms: '00', pis: '01', cofins: '01',
    quantidade: 1, valorUnitario: 100,
    cstReforma: rg.cst, cClassTrib: rg.cClassTrib, regraGeral: true,
    classificacaoManual: false,
    classificacaoSnapshot: {
      codigo: rg.codigo, codigoFormatado: rg.codigoFormatado, cst: rg.cst,
      cClassTrib: rg.cClassTrib, descricao: rg.descricao, baseLegal: rg.baseLegal,
      pRedIBS: 0, pRedCBS: 0, anexo: null, classificacao: 'regra geral', manual: null,
    },
    baseLegal: rg.baseLegal, criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
  })
  await db.nfeNotas.add({
    chave: '1'.repeat(44), numero: '1', serie: '1', modelo: '55', natOp: 'VENDA',
    dataEmissao: '2026-01-01', emitCnpj: '11111111000111', emitNome: 'Emit',
    emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: '',
    destDoc: '22222222000122', destNome: 'Dest', destIe: '',
    valorProdutos: 100, valorTotal: 100,
    empresaId: 1, direcao: 'saida', arquivo: null, xmlConteudo: null,
    refIBS: REF_IBS, refCBS: REF_CBS, totalIBS: REF_IBS, totalCBS: REF_CBS, totalTributos: REF_IBS + REF_CBS,
    importadoEm: new Date().toISOString(),
    itensAnalisados: [{
      chave: '1'.repeat(44), numItem: '1', codProd: 'SKU-1', descricao: 'Produto teste',
      ncm: NCM, cfop: '5102', cstIcms: '00', qtd: 1, unid: 'UN',
      vlUnit: 100, vlTotal: 100, vlDesc: 0, vlIcms: 18, cstPis: '01', cstCofins: '01',
      classificacao: rg, regraGeral: true, manual: false,
      redIBS: 0, redCBS: 0, ibs: REF_IBS, cbs: REF_CBS, totalTributos: REF_IBS + REF_CBS, carga: REF_IBS + REF_CBS,
      anexo: 'isento', observacoes: [],
    }],
  } as never)
}

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
  await semear()
})

describe('propagarClassificacaoNcm', () => {
  it('aplica a manual em produtos e itens de XML já gravados', async () => {
    const s = await salvarReclassificacaoManual({
      ncm: NCM, cst: '200', cClassTrib: '200001',
      descricao: 'Justificativa', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    expect(s.ok).toBe(true)

    const prop = await propagarClassificacaoNcm(NCM)
    expect(prop.produtos).toBe(1)
    expect(prop.notas).toBe(1)
    expect(prop.itens).toBe(1)

    const p = (await db.produtos.toArray())[0]
    expect(p.cstReforma).toBe('200')
    expect(p.cClassTrib).toBe('200001')
    expect(p.regraGeral).toBe(false)
    expect(p.classificacaoManual).toBe(true)
    expect(p.classificacaoSnapshot.cClassTrib).toBe('200001')
    expect(p.classificacaoSnapshot.manual?.fonteUrl).toBe('https://example.com/lei')

    const n = (await db.nfeNotas.toArray())[0]
    const it = n.itensAnalisados[0]
    expect(it.classificacao.cClassTrib).toBe('200001')
    expect(it.regraGeral).toBe(false)
    expect(it.manual).toBe(true)
    expect(it.redIBS).toBe(60)
    // 100 × (1-0.6) × REF_IBS% = 100 × 0.4 × REF_IBS / 100
    expect(it.ibs).toBeCloseTo(100 * 0.4 * REF_IBS / 100, 2)
    expect(it.cbs).toBeCloseTo(100 * 0.4 * REF_CBS / 100, 2)
    expect(n.totalIBS).toBeCloseTo(100 * 0.4 * REF_IBS / 100, 2)
  })

  it('remover a manual volta produtos e notas à regra geral', async () => {
    await salvarReclassificacaoManual({
      ncm: NCM, cst: '200', cClassTrib: '200001',
      descricao: 'Justificativa', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    await propagarClassificacaoNcm(NCM)
    await removerReclassificacaoManual(NCM)
    const prop = await propagarClassificacaoNcm(NCM)
    expect(prop.produtos).toBe(1)
    const p = (await db.produtos.toArray())[0]
    expect(p.regraGeral).toBe(true)
    expect(p.classificacaoManual).toBe(false)
    expect(p.cstReforma).toBe('000')
    const n = (await db.nfeNotas.toArray())[0]
    expect(n.itensAnalisados[0].regraGeral).toBe(true)
  })

  it('NCM inválido não toca em nada', async () => {
    const prop = await propagarClassificacaoNcm('123')
    expect(prop).toEqual({ produtos: 0, notas: 0, itens: 0 })
  })

  it('regra geral carrega o link oficial da LC 214/2025', async () => {
    const { LINK_LC214 } = await import('@/domain/constants')
    const rg = await classificacaoRegraGeral(NCM)
    expect(rg.cst).toBe('000')
    expect(rg.cClassTrib).toBe('000001')
    expect(rg.resumo.urlLegislacao).toBe(LINK_LC214)
    expect(rg.referencia?.urlLegislacao).toBe(LINK_LC214)
  })
})
