/**
 * Reclassificação manual do usuário.
 *
 * Prioridade: manual do usuário > base oficial > regra geral. Existindo
 * manual, todas as telas puxam a que o usuário criou (acima da base oficial),
 * sinalizada — responsabilidade dele, isentando o sistema.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import {
  buscarReclassificacaoManual,
  removerReclassificacaoManual,
  salvarReclassificacaoManual,
} from '@/infrastructure/base/reclassificacao-repo'
import { montarClassificacaoManual } from '@/domain/services/classificacao'
import { analisarItens } from '@/infrastructure/sped/analisar'
import { analisarItensNfe } from '@/infrastructure/nfe/analisar'
import type { ItemSped } from '@/infrastructure/sped/tipos'
import type { ItemNotaXml } from '@/infrastructure/nfe/tipos'

const NCM_SEM_VINCULO = '99999999'
const NCM_COM_VINCULO = '01012100'

const itemSped = (): ItemSped => ({
  numDoc: '1', chave: 'k', data: '2026-01-01', numItem: '1', codItem: 'SKU-1',
  descricaoProduto: 'Produto teste', ncm: NCM_SEM_VINCULO, qtd: 1, unid: 'UN',
  vlItem: 100, vlDesc: 0, cstIcms: '00', cfop: '5102', vlBcIcms: 100,
  aliqIcms: 18, vlIcms: 18, indOper: '1', tipoDoc: '55',
})

const itemNfe = (): ItemNotaXml => ({
  chave: 'k', numItem: '1', codProd: 'SKU-1', descricao: 'Produto teste',
  ncm: NCM_SEM_VINCULO, cfop: '5102', cstIcms: '00', qtd: 1, unid: 'UN',
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
    codigo: NCM_SEM_VINCULO, codigoOriginal: '9999.99.99', descricao: 'Produto sem vínculo',
    dataInicio: null, dataFim: null, ato: null,
  })
  await db.ncm.put({
    id: `v|${NCM_COM_VINCULO}`, codigo: NCM_COM_VINCULO, codigoFormatado: '0101.21.00',
    cst: '200', cClassTrib: '200001', baseLegal: 'base', reducao: null,
    aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
  })
}

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
  await semear()
})

describe('reclassificação manual', () => {
  it('valida NCM, escolha, descrição, fonte e link', async () => {
    const r1 = await salvarReclassificacaoManual({
      ncm: '123', cst: '200', cClassTrib: '200001',
      descricao: 'x', fonteDescricao: 'y', fonteUrl: 'https://example.com/lei',
    })
    expect(r1.ok).toBe(false)

    const r2 = await salvarReclassificacaoManual({
      ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'Enquadrado conforme teste', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    expect(r2.ok).toBe(true)

    const r3 = await salvarReclassificacaoManual({
      ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'x', fonteDescricao: 'y', fonteUrl: 'nota-url',
    })
    expect(r3.ok).toBe(false)
  })

  it('sem manual: NCM sem vínculo cai na regra geral', async () => {
    const r = await resolverClassificacoes(NCM_SEM_VINCULO)
    expect(r.regraGeral).toBe(true)
    expect(r.manual).toBe(false)
    expect(r.lista[0].manual ?? null).toBeNull()
  })

  it('com manual: resolve a manual (regraGeral=false, manual=true)', async () => {
    await salvarReclassificacaoManual({
      ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'Justificativa do usuário', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    const r = await resolverClassificacoes(NCM_SEM_VINCULO)
    expect(r.regraGeral).toBe(false)
    expect(r.manual).toBe(true)
    expect(r.lista).toHaveLength(1)
    expect(r.lista[0].cst).toBe('200')
    expect(r.lista[0].cClassTrib).toBe('200001')
    expect(r.lista[0].manual?.fonteUrl).toBe('https://example.com/lei')
    expect(r.lista[0].resumo.percentualReducaoIBS).toBe(60)
  })

  it('manual do usuário vence a base oficial', async () => {
    await salvarReclassificacaoManual({
      ncm: NCM_COM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'escolha do usuário', fonteDescricao: 'fonte', fonteUrl: 'https://example.com/lei',
    })
    const r = await resolverClassificacoes(NCM_COM_VINCULO)
    expect(r.vinculos.length).toBeGreaterThan(0)
    expect(r.manual).toBe(true)
    expect(r.regraGeral).toBe(false)
    expect(r.lista).toHaveLength(1)
    expect(r.lista[0].manual?.descricao).toBe('escolha do usuário')
  })

  it('SPED e XML usam a manual com indicativo', async () => {
    await salvarReclassificacaoManual({
      ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'Justificativa', fonteDescricao: 'LC 214/2025 art. teste',
      fonteUrl: 'https://example.com/lei',
    })
    const sped = await analisarItens([itemSped()], { refIBS: 17.7, refCBS: 8.8 })
    expect(sped[0].manual).toBe(true)
    expect(sped[0].regraGeral).toBe(false)
    expect(sped[0].classificacao.cClassTrib).toBe('200001')

    const nfe = await analisarItensNfe([itemNfe()], { refIBS: 17.7, refCBS: 8.8 })
    expect(nfe[0].manual).toBe(true)
    expect(nfe[0].regraGeral).toBe(false)
  })

  it('remover volta à regra geral', async () => {
    await salvarReclassificacaoManual({
      ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001',
      descricao: 'x', fonteDescricao: 'y', fonteUrl: 'https://example.com/lei',
    })
    expect(await buscarReclassificacaoManual(NCM_SEM_VINCULO)).not.toBeNull()
    await removerReclassificacaoManual(NCM_SEM_VINCULO)
    expect(await buscarReclassificacaoManual(NCM_SEM_VINCULO)).toBeNull()
    const r = await resolverClassificacoes(NCM_SEM_VINCULO)
    expect(r.regraGeral).toBe(true)
    expect(r.manual).toBe(false)
  })

  it('montarClassificacaoManual carimba isenção e fonte', () => {
    const cl = montarClassificacaoManual(
      {
        ncm: NCM_SEM_VINCULO, cst: '200', cClassTrib: '200001', descricao: 'Just.',
        fonteDescricao: 'LC 214/2025', fonteUrl: 'https://example.com/lei',
        criadoEm: 'x', atualizadoEm: 'x',
      },
      { cstDetalhes: null, cstClassTribDetalhes: null, referencia: null, nomenclatura: null },
    )
    expect(cl.manual?.fonteUrl).toBe('https://example.com/lei')
    expect(cl.regraGeral).toBe(false)
    expect(cl.resumo.urlLegislacao).toBe('https://example.com/lei')
  })
})
