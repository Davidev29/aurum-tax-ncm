/**
 * Revalidação da base gravada após mudança de regra.
 *
 * REGRA: base/CFF/NCM/manual mudou → produtos e notas de XML já gravados são
 * reaplicados pela vigente. Manual do usuário é preservada.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { revalidarBaseGravada, resumirRevalidacao } from '@/application/revalidacao'

const NCM_AUTO = '44444444'
const NCM_MANUAL = '55555555'

async function semear() {
  await db.cst.put({
    codigo: '200', descricao: 'CST de teste', indIBSCBS: true, indIBSCBSMono: false,
    indReducao: true, indDiferimento: false, indTransferenciaCredito: true, docs: {} as never,
  })
  await db.cst.put({
    codigo: '000', descricao: 'Tributação integral', indIBSCBS: true, indIBSCBSMono: false,
    indReducao: false, indDiferimento: false, indTransferenciaCredito: true, docs: {} as never,
  })
  await db.cstClassTrib.put({
    id: '200|200001', cst: '200', cClassTrib: '200001', nome: 'Redução de teste',
    descricao: 'Redução de teste', lcRedacao: null, lcRef: null,
    tipoAliquota: '2 - Padrão', pRedIBS: 60, pRedCBS: 60, indRedutorBC: 0,
    indTribRegular: 0, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0,
    indMonoDif: 0, creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
  })
  await db.cstClassTrib.put({
    id: '000|000001', cst: '000', cClassTrib: '000001', nome: 'Regra geral',
    descricao: 'Regra geral', lcRedacao: null, lcRef: null,
    tipoAliquota: 'Integral', pRedIBS: 0, pRedCBS: 0, indRedutorBC: 0,
    indTribRegular: 1, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0,
    indMonoDif: 0, creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
  })
  const ref = {
    cstDescricao: 'x', descricao: 'x', tipoAliquota: '2 - Padrão', anexo: null,
    urlLegislacao: null, exigeTributacao: true, reducaoBC: false, reducaoAliquota: true,
    transferenciaCredito: false, diferimento: false, monofasica: false,
    creditoPresumidoZFM: false, ajusteCompetencia: false, tributacaoRegular: false,
    creditoPresumido: false, estornoCredito: false, monoNormal: false, monoRetencao: false,
    monoRetida: false, monoDiferimentoCombustivel: false, simplesReceitaBruta: null,
    regimeContribuicaoSocial: null, impostoBensServicos: null, docs: {} as never,
  }
  await db.referencia.put({ ...ref, id: '200|200001', cst: '200', cClassTrib: '200001', pRedIBS: 60, pRedCBS: 60 } as never)
  await db.ncm.put({
    id: `${NCM_AUTO}|200001|0`, codigo: NCM_AUTO, codigoFormatado: '4444.44.44',
    cst: '200', cClassTrib: '200001', baseLegal: '', reducao: null,
    aliquotaIBS: null, aliquotaCBS: null, descricao: 'Auto', documentos: '',
  })
  for (const ncm of [NCM_AUTO, NCM_MANUAL]) {
    await db.ncmNomenclatura.put({
      codigo: ncm, codigoOriginal: ncm, descricao: 'N', dataInicio: null,
      dataFim: null, ato: null, atoFim: null,
    })
  }
  const agora = new Date().toISOString()
  const snapAuto = {
    codigo: NCM_AUTO, codigoFormatado: '4444.44.44', cst: '200', cClassTrib: '200001',
    descricao: 'Auto', baseLegal: '', pRedIBS: 60, pRedCBS: 60, anexo: null,
    classificacao: 'Redução de teste', manual: null,
  }
  await db.produtos.add({
    empresaId: null, codigo: 'SKU-AUTO', nome: 'Auto', ncm: NCM_AUTO,
    cfop: '', cstIcms: '', pis: '', cofins: '', quantidade: 1, valorUnitario: 100,
    cstReforma: '200', cClassTrib: '200001', regraGeral: false, classificacaoManual: false,
    classificacaoSnapshot: snapAuto, baseLegal: '', criadoEm: agora, atualizadoEm: agora,
  })
  await db.produtos.add({
    empresaId: null, codigo: 'SKU-MAN', nome: 'Manual', ncm: NCM_MANUAL,
    cfop: '', cstIcms: '', pis: '', cofins: '', quantidade: 1, valorUnitario: 50,
    cstReforma: '200', cClassTrib: '200001', regraGeral: false, classificacaoManual: true,
    classificacaoSnapshot: {
      ...snapAuto, codigo: NCM_MANUAL, codigoFormatado: NCM_MANUAL,
      manual: {
        ncm: NCM_MANUAL, cst: '200', cClassTrib: '200001', descricao: 'Manual',
        fonteDescricao: 'usuário', fonteUrl: '', criadoEm: agora, atualizadoEm: agora,
      },
    },
    baseLegal: '', criadoEm: agora, atualizadoEm: agora,
  })
  await db.nfeNotas.add({
    chave: '2'.repeat(44), numero: '2', serie: '1', modelo: '55', natOp: 'VENDA',
    dataEmissao: '2026-01-01', emitCnpj: '11111111000111', emitNome: 'Emit',
    emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: '',
    destDoc: '22222222000122', destNome: 'Dest', destIe: '',
    valorProdutos: 100, valorTotal: 100,
    empresaId: 1, direcao: 'saida', arquivo: null, xmlConteudo: null,
    refIBS: 10, refCBS: 10, totalIBS: 4, totalCBS: 4, totalTributos: 8,
    importadoEm: agora,
    itensAnalisados: [{
      chave: '2'.repeat(44), numItem: '1', codProd: 'SKU-AUTO', descricao: 'Auto',
      ncm: NCM_AUTO, cfop: '', cstIcms: '', qtd: 1, unid: 'UN',
      vlUnit: 100, vlTotal: 100, vlDesc: 0, vlIcms: 0, cstPis: '', cstCofins: '',
      classificacao: {} as never, regraGeral: false, manual: false,
      redIBS: 60, redCBS: 60, ibs: 4, cbs: 4, totalTributos: 8, carga: 8,
      anexo: '60', observacoes: [],
    }],
  } as never)
}

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
  await semear()
})

describe('revalidarBaseGravada', () => {
  it('reaplica a vigente em produtos automáticos e itens de XML; preserva manual', async () => {
    // Regra muda: redução 60 → 30 na base oficial.
    await db.cstClassTrib.put({
      id: '200|200001', cst: '200', cClassTrib: '200001', nome: 'Redução de teste',
      descricao: 'Redução de teste', lcRedacao: null, lcRef: null,
      tipoAliquota: '2 - Padrão', pRedIBS: 30, pRedCBS: 30, indRedutorBC: 0,
      indTribRegular: 0, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0,
      indMonoDif: 0, creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    })
    await db.referencia.put({
      id: '200|200001', cst: '200', cstDescricao: 'x', cClassTrib: '200001', descricao: 'x',
      pRedIBS: 30, pRedCBS: 30, tipoAliquota: '2 - Padrão', anexo: null,
      urlLegislacao: null, exigeTributacao: true, reducaoBC: false, reducaoAliquota: true,
      transferenciaCredito: false, diferimento: false, monofasica: false,
      creditoPresumidoZFM: false, ajusteCompetencia: false, tributacaoRegular: false,
      creditoPresumido: false, estornoCredito: false, monoNormal: false, monoRetencao: false,
      monoRetida: false, monoDiferimentoCombustivel: false, simplesReceitaBruta: null,
      regimeContribuicaoSocial: null, impostoBensServicos: null, docs: {} as never,
    } as never)

    const r = await revalidarBaseGravada()
    expect(r.produtos).toBe(1)
    expect(r.notas).toBe(1)
    expect(r.itens).toBe(1)
    expect(r.manuaisPreservados).toBe(1)

    const auto = await db.produtos.where('codigo').equals('SKU-AUTO').first()
    expect(auto?.classificacaoSnapshot.pRedIBS).toBe(30)
    expect(auto?.classificacaoSnapshot.pRedCBS).toBe(30)

    const man = await db.produtos.where('codigo').equals('SKU-MAN').first()
    expect(man?.classificacaoSnapshot.pRedIBS).toBe(60)
    expect(man?.classificacaoManual).toBe(true)

    const nota = await db.nfeNotas.toArray()
    const it = nota[0].itensAnalisados[0]
    expect(it.redIBS).toBe(30)
    expect(it.redCBS).toBe(30)
    // base 100, ref 10, red 30% → aliq 7 → 7.0 cada.
    expect(it.ibs).toBeCloseTo(7, 5)
    expect(it.cbs).toBeCloseTo(7, 5)
    expect(nota[0].totalTributos).toBeCloseTo(14, 5)
  })

  it('sem mudanças, nada a atualizar', async () => {
    const r = await revalidarBaseGravada()
    // Reescreve com os mesmos valores (idempotente), manual preservada.
    expect(r.manuaisPreservados).toBe(1)
    expect(resumirRevalidacao(r)).toContain('manual')
  })
})
