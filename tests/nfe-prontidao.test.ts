/**
 * Prontidão: escolher a tributação move o item para Conferem e a apuração
 * acompanha (inclusive crédito).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { bucketProntidaoItem } from '@/application/nfe-insights'
import { propagarClassificacaoNcm } from '@/application/reclassificacao'
import { salvarReclassificacaoManual } from '@/infrastructure/base/reclassificacao-repo'
import { classificacaoRegraGeral } from '@/infrastructure/base/classificacao-repo'
import { apurarIbsCbs } from '@/infrastructure/nfe/apuracao'
import { REF_DEFAULT } from '@/domain/constants'

const REF_IBS = REF_DEFAULT.IBS
const REF_CBS = REF_DEFAULT.CBS
const NCM = '02011000'
const FORN = '11111111000111'
const ATIVA = '12345678000190'

const itemBase = (extra: Record<string, unknown> = {}) => ({
  chave: '2'.repeat(44),
  numItem: '1',
  codProd: 'P1',
  descricao: 'Produto P1',
  ncm: NCM,
  cfop: '1102',
  cstIcms: '00',
  qtd: 1,
  unid: 'UN',
  vlUnit: 100,
  vlTotal: 100,
  vlDesc: 0,
  vlIcms: 18,
  cstPis: '01',
  cstCofins: '01',
  // XML destaca 200/200001 com os valores cheios; o sistema aplicou a regra
  // geral (000/000001) — item pendente em A comparar até a sua escolha.
  cstIbsCbs: '200',
  cClassTribIbsCbs: '200001',
  vIbsItem: REF_IBS,
  vCbsItem: REF_CBS,
  classificacao: null,
  ...extra,
})

describe('bucketProntidaoItem', () => {
  it('divergente sem escolha vai para A comparar', () => {
    const r = bucketProntidaoItem(
      itemBase({ cstIbsCbs: '200', cClassTribIbsCbs: '200001' }) as never,
    )
    expect(r.temXml).toBe(true)
    expect(r.manual).toBe(false)
    expect(r.bucket).toBe('divergentes')
  })

  it('leitura igual nos dois lados vai para Conferem', () => {
    const r = bucketProntidaoItem(
      itemBase({
        classificacao: { cst: '200', cClassTrib: '200001' },
        ibs: REF_IBS,
        cbs: REF_CBS,
      }) as never,
    )
    expect(r.temXml).toBe(true)
    expect(r.manual).toBe(false)
    expect(r.bucket).toBe('conferem')
  })

  it('escolha sua (manual) vai para Conferem mesmo divergindo do XML', () => {
    const r = bucketProntidaoItem(
      itemBase({ cstIbsCbs: '200', cClassTribIbsCbs: '200001', manual: true }) as never,
    )
    expect(r.manual).toBe(true)
    expect(r.bucket).toBe('conferem')
  })

  it('classificacao.manual também conta como escolha sua', () => {
    const r = bucketProntidaoItem(
      itemBase({
        cstIbsCbs: '200',
        classificacao: { cst: '000', cClassTrib: '000001', manual: { ncm: NCM } },
      }) as never,
    )
    expect(r.bucket).toBe('conferem')
  })

  it('sem grupo no XML vai para Sem grupo (sem escolha)', () => {
    const r = bucketProntidaoItem(
      itemBase({ cstIbsCbs: '', cClassTribIbsCbs: '', vIbsItem: 0, vCbsItem: 0 }) as never,
    )
    expect(r.temXml).toBe(false)
    expect(r.bucket).toBe('semXml')
  })
})

describe('escolha da tributação ajusta Conferem + apuração', () => {
  beforeEach(async () => {
    await db.delete().catch(() => undefined)
    await db.open()
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
    const rg = await classificacaoRegraGeral(NCM)
    await db.nfeNotas.add({
      chave: '2'.repeat(44), numero: '7', serie: '1', modelo: '55', natOp: 'VENDA',
      dataEmissao: '2026-09-10', emitCnpj: FORN, emitNome: 'Fornecedor',
      emitCrt: '3', emitIe: '', emitIm: '', emitEndereco: '', emitCidade: '', emitUf: '',
      destDoc: ATIVA, destNome: 'Ativa', destIe: '',
      valorProdutos: 100, valorTotal: 100,
      empresaId: 1, direcao: 'entrada', arquivo: null, xmlConteudo: null,
      refIBS: REF_IBS, refCBS: REF_CBS, totalIBS: REF_IBS, totalCBS: REF_CBS,
      totalTributos: REF_IBS + REF_CBS,
      importadoEm: new Date().toISOString(),
      itensAnalisados: [{
        ...itemBase(),
        classificacao: rg, regraGeral: true, manual: false,
        redIBS: 0, redCBS: 0, ibs: REF_IBS, cbs: REF_CBS,
        totalTributos: REF_IBS + REF_CBS, carga: REF_IBS + REF_CBS,
        anexo: 'isento', observacoes: [],
      }],
    } as never)
  })

  it('escolher regra com crédito move para Conferem e ajusta a apuração', async () => {
    const antes = (await db.nfeNotas.toArray())[0]
    // XML (200/200001) × sistema (regra geral 000): pendente em A comparar.
    expect(bucketProntidaoItem(antes.itensAnalisados[0] as never).bucket).toBe('divergentes')

    const s = await salvarReclassificacaoManual({
      ncm: NCM, cst: '200', cClassTrib: '200001',
      descricao: 'Escolha da análise', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    expect(s.ok).toBe(true)
    const prop = await propagarClassificacaoNcm(NCM)
    expect(prop.itens).toBe(1)

    const depois = (await db.nfeNotas.toArray())[0]
    const it = depois.itensAnalisados[0]
    // Foi para Conferem como validado por você…
    const b = bucketProntidaoItem(it as never)
    expect(b.manual).toBe(true)
    expect(b.bucket).toBe('conferem')
    // …e a apuração acompanha a tributação escolhida (60% de redução):
    // o informativo segue a regra eleita; o efetivo mantém o destacado no
    // XML (fato da nota) — a diferença fica na divergência para decisão.
    const ap = apurarIbsCbs([depois] as never)
    expect(ap.creditoInformativoTotal).toBeCloseTo(0.4 * (REF_IBS + REF_CBS), 2)
    expect(ap.creditoEfetivoTotal).toBeCloseTo(REF_IBS + REF_CBS, 2)
    expect(ap.divergenciaCreditoTotal).toBeCloseTo(0.6 * (REF_IBS + REF_CBS), 2)
  })
})
