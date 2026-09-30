/**
 * Garantia do motor único: o mesmo NCM entrega a mesma tributação em todas
 * as telas (Consulta, Lote, XML, SPED, Produtos, Calculadora).
 *
 * Regressão dos casos em que telas divergiam:
 * - Lote decidia sozinho pelo `vinculos` crus (ignorando extinto/revogado);
 * - `produtoParaCalculadora` recomputava `regraGeral` por heurística
 *   (`cst === '000'`) em vez da flag do motor;
 * - gravação via calculadora congelava reduções antigas sem re-resolver;
 * - a "1ª opção" de NCM com N vínculos dependia da ordem de importação.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { interpretarEntradaNcm } from '@/domain/services/classificacao'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { processarArquivoLote } from '@/infrastructure/parsers/lote'
import { analisarItensNfe } from '@/infrastructure/nfe/analisar'
import { analisarItens } from '@/infrastructure/sped/analisar'
import {
  produtoParaCalculadora,
  reresolverClassificacao,
  salvarProduto,
} from '@/application/produtos'
import { salvarReclassificacaoManual } from '@/infrastructure/base/reclassificacao-repo'
import { propagarClassificacaoNcm } from '@/application/reclassificacao'
import { db } from '@/infrastructure/db/schema'
import type { TabelaCstClassTrib, VinculoNcm } from '@/domain/entities'

const NCM_2VINC = '11111111'
const NCM_EXTINTO = '22222222'
const NCM_REVOGADO = '33333333'
const NCM_MANUAL = '44444444'
const NCM_CST000 = '55555555'

const vinculo = (codigo: string, cst: string, cClassTrib: string): VinculoNcm => ({
  id: `${codigo}|${cst}|${cClassTrib}`,
  codigo,
  codigoFormatado: codigo,
  cst,
  cClassTrib,
  baseLegal: `${cst}/${cClassTrib}`,
  reducao: null,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao: '',
  documentos: '',
})

const cct = (cst: string, cClassTrib: string, pRed: number): TabelaCstClassTrib => ({
  id: `${cst}|${cClassTrib}`,
  cst,
  cClassTrib,
  nome: `Classe ${cClassTrib}`,
  descricao: `Descrição ${cClassTrib}.`,
  lcRedacao: null,
  lcRef: 'Art. 999',
  tipoAliquota: 'Padrão',
  pRedIBS: pRed,
  pRedCBS: pRed,
  indRedutorBC: 0,
  indTribRegular: 0,
  indCredPres: 0,
  indMono: 0,
  indMonoReten: 0,
  indMonoRet: 0,
  indMonoDif: 0,
  creditoPara: null,
  inicioVigencia: null,
  fimVigencia: null,
  atualizadoEm: null,
})

const nomen = (codigo: string, dataFim: string | null = null) => ({
  codigo,
  codigoOriginal: codigo,
  descricao: `Produto ${codigo}`,
  dataInicio: null as string | null,
  dataFim,
  ato: null as string | null,
})

const arquivo = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/csv' })

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear(),
    db.ncmNomenclatura.clear(),
    db.cst.clear(),
    db.cstClassTrib.clear(),
    db.referencia.clear(),
    db.reclassificacoesManuais.clear(),
    db.produtos.clear(),
    db.meta.clear(),
  ])
  const { invalidarCacheBuscaTexto } = await import('@/infrastructure/base/classificacao-repo')
  invalidarCacheBuscaTexto()

  await db.cst.bulkPut([
    {
      codigo: '200', descricao: 'Alíquota reduzida', indIBSCBS: true, indIBSCBSMono: false,
      indReducao: true, indDiferimento: false, indTransferenciaCredito: false,
      docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
    },
    {
      codigo: '000', descricao: 'Tributação integral', indIBSCBS: true, indIBSCBSMono: false,
      indReducao: false, indDiferimento: false, indTransferenciaCredito: false,
      docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
    },
  ])
  await db.cstClassTrib.bulkPut([
    cct('200', '200003', 100),
    cct('200', '200038', 60),
    cct('000', '000001', 0),
    cct('000', '000002', 0),
  ])
  await db.ncmNomenclatura.bulkPut([
    nomen(NCM_2VINC),
    nomen(NCM_EXTINTO, '01/01/2020'),
    nomen(NCM_REVOGADO),
    nomen(NCM_MANUAL),
    nomen(NCM_CST000),
  ])
  // Ordem de gravação REVERSA à determinística: sem o sort do motor, [0]
  // seria 200038. O motor ordena por (cst, cClassTrib) → [0] é 200003.
  await db.ncm.bulkPut([
    vinculo(NCM_2VINC, '200', '200038'),
    vinculo(NCM_2VINC, '200', '200003'),
    vinculo(NCM_EXTINTO, '200', '200003'),
    vinculo(NCM_REVOGADO, '200', '200038'),
    vinculo(NCM_CST000, '000', '000002'),
  ])
  // Revogação via CFF (fonte dinâmica do resolvedor).
  await db.meta.put({
    chave: 'cff_sync_anexos',
    valor: { dadosBrutos: [{ cClassTrib: '200038', status: 'revogado', ato: 'Teste motor único' }] },
  })
  await db.reclassificacoesManuais.put({
    ncm: NCM_MANUAL,
    cst: '200',
    cClassTrib: '200038',
    descricao: 'Manual de teste',
    fonteDescricao: 'Teste',
    fonteUrl: 'https://example.com/lei',
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  })
})

describe('interpretarEntradaNcm (intérprete único)', () => {
  it('ok / truncado / invalido', () => {
    expect(interpretarEntradaNcm('0201.10.00')).toEqual({ kind: 'ok', codigo: '02011000', digitos: 8 })
    expect(interpretarEntradaNcm('0201100012')).toEqual({ kind: 'truncado', codigo: '02011000', digitos: 10 })
    expect(interpretarEntradaNcm('123')).toEqual({ kind: 'invalido', codigo: '123', digitos: 3 })
    expect(interpretarEntradaNcm('')).toEqual({ kind: 'invalido', codigo: '', digitos: 0 })
  })
})

describe('mesmo NCM, mesma tributação em todas as telas', () => {

  it('Consulta (resolvedor) escolhe o vínculo vivo determinístico', async () => {
    const r = await resolverClassificacoes(NCM_2VINC)
    expect(r.regraGeral).toBe(false)
    expect(r.lista[0]).toMatchObject({ cst: '200', cClassTrib: '200003' })
    expect(r.lista[0].resumo.percentualReducaoIBS).toBe(100)
  })

  it('Lote entrega o mesmo veredito da Consulta', async () => {
    const csv = ['SKU;Nome;NCM', `A;Item;${NCM_2VINC}`, `B;Extinto;${NCM_EXTINTO}`, `C;Revogado;${NCM_REVOGADO}`].join('\n')
    const r = await processarArquivoLote(arquivo('l.csv', csv))
    const [a, b, c] = r.itens
    expect(a.escolhida).toMatchObject({ cst: '200', cClassTrib: '200003' })
    expect(a.regraGeral).toBe(false)
    // Extinto com vínculo: regra geral com flag, como na Consulta.
    expect(b.escolhida?.regraGeral).toBe(true)
    expect(b.regraGeral).toBe(true)
    // Revogado: sem redução vigente, como na Consulta.
    expect(c.escolhida?.regraGeral).toBe(true)
    expect(c.escolhida?.resumo.percentualReducaoIBS).toBe(0)
  })

  it('XML e SPED entregam o mesmo veredito da Consulta', async () => {
    const nfe = await analisarItensNfe(
      [{ chave: 'k', numItem: '1', codProd: 'p', descricao: 'd', ncm: NCM_2VINC, cfop: '5102', cstIcms: '000', qtd: 1, unid: 'UN', vlUnit: 100, vlTotal: 100, vlDesc: 0 } as never],
      { refIBS: 19, refCBS: 9 },
    )
    expect(nfe[0].classificacao).toMatchObject({ cst: '200', cClassTrib: '200003' })
    expect(nfe[0].regraGeral).toBe(false)
    expect(nfe[0].redIBS).toBe(100)

    const sped = await analisarItens(
      [{ numDoc: '1', chave: 'k', data: '01/01/2026', numItem: '1', codItem: 'p', descricaoProduto: 'd', ncm: NCM_2VINC, qtd: 1, unid: 'UN', vlItem: 100, vlDesc: 0, cstIcms: '000', cfop: '5102', vlBcIcms: 0, aliqIcms: 0, vlIcms: 0 } as never],
      { refIBS: 19, refCBS: 9 },
    )
    expect(sped[0].classificacao).toMatchObject({ cst: '200', cClassTrib: '200003' })
    expect(sped[0].redIBS).toBe(100)
  })

  it('XML/SPED truncam >8 dígitos para o mesmo NCM do motor (com aviso)', async () => {
    const nfe = await analisarItensNfe(
      [{ chave: 'k', numItem: '1', codProd: 'p', descricao: 'd', ncm: `${NCM_2VINC}99`, cfop: '5102', cstIcms: '000', qtd: 1, unid: 'UN', vlUnit: 10, vlTotal: 10, vlDesc: 0 } as never],
      { refIBS: 19, refCBS: 9 },
    )
    expect(nfe[0].ncm).toBe(NCM_2VINC)
    expect(nfe[0].ncmTruncado).toBe(true)
    expect(nfe[0].classificacao).toMatchObject({ cst: '200', cClassTrib: '200003' })
  })

  it('manual do usuário vence vínculo oficial vivo em todas as telas', async () => {
    const s = await salvarReclassificacaoManual({
      ncm: NCM_2VINC, cst: '200', cClassTrib: '200038',
      descricao: 'escolha do usuário', fonteDescricao: 'LC 214/2025',
      fonteUrl: 'https://example.com/lei',
    })
    expect(s.ok).toBe(true)

    const r = await resolverClassificacoes(NCM_2VINC)
    expect(r.manual).toBe(true)
    expect(r.lista).toHaveLength(1)
    expect(r.lista[0].manual?.descricao).toBe('escolha do usuário')

    const csv = `SKU;Nome;NCM\nA;Item;${NCM_2VINC}`
    const lote = await processarArquivoLote(arquivo('m.csv', csv))
    expect(lote.itens[0].escolhida?.manual?.descricao).toBe('escolha do usuário')
    expect(lote.itens[0].manual).toBe(true)

    const nfe = await analisarItensNfe(
      [{ chave: 'k', numItem: '1', codProd: 'p', descricao: 'd', ncm: NCM_2VINC, cfop: '5102', cstIcms: '000', qtd: 1, unid: 'UN', vlUnit: 10, vlTotal: 10, vlDesc: 0 } as never],
      { refIBS: 19, refCBS: 9 },
    )
    expect(nfe[0].manual).toBe(true)
    expect(nfe[0].classificacao.cClassTrib).toBe('200038')

    const sped = await analisarItens(
      [{ numDoc: '1', chave: 'k', data: '01/01/2026', numItem: '1', codItem: 'p', descricaoProduto: 'd', ncm: NCM_2VINC, qtd: 1, unid: 'UN', vlItem: 10, vlDesc: 0, cstIcms: '000', cfop: '5102', vlBcIcms: 0, aliqIcms: 0, vlIcms: 0 } as never],
      { refIBS: 19, refCBS: 9 },
    )
    expect(sped[0].manual).toBe(true)
    expect(sped[0].classificacao.cClassTrib).toBe('200038')

    // Propagação leva a manual ao gravado.
    const prop = await propagarClassificacaoNcm(NCM_2VINC)
    expect(prop).toEqual({ produtos: 0, notas: 0, itens: 0 })
    const gravado = await salvarProduto(
      { empresaId: null, codigo: 'SKU-M', nome: 'N', ncm: NCM_2VINC, classificacao: r.lista[0] },
      { forcar: true },
    )
    expect(gravado.ok && gravado.produto.classificacaoManual).toBe(true)
    expect(gravado.ok && gravado.produto.cClassTrib).toBe('200038')
  })

  it('manual sem vínculo oficial vale em toda parte e nunca é substituída', async () => {
    const r = await resolverClassificacoes(NCM_MANUAL)
    expect(r.manual).toBe(true)
    expect(r.lista[0]).toMatchObject({ cst: '200', cClassTrib: '200038' })
    // reresolver preserva a manual mesmo com vínculo ausente.
    const viva = await reresolverClassificacao(NCM_MANUAL, { cst: '200', cClassTrib: '200038' })
    expect(viva).toMatchObject({ cst: '200', cClassTrib: '200038' })
  })

  it('vínculo oficial com CST 000 NÃO é "regra geral" na calculadora', async () => {
    const r = await resolverClassificacoes(NCM_CST000)
    expect(r.regraGeral).toBe(false)
    const item = produtoParaCalculadora({
      id: 1, empresaId: null, codigo: 'SKU', nome: 'N', ncm: NCM_CST000,
      cfop: '', cstIcms: '', pis: '', cofins: '', quantidade: 1, valorUnitario: 10,
      cstReforma: '000', cClassTrib: '000002', regraGeral: false,
      classificacaoSnapshot: {
        codigo: NCM_CST000, codigoFormatado: NCM_CST000, cst: '000', cClassTrib: '000002',
        descricao: 'd', baseLegal: 'b', pRedIBS: 0, pRedCBS: 0, anexo: null, classificacao: 'c',
      },
      baseLegal: 'b', criadoEm: '', atualizadoEm: '',
    } as never)
    expect(item.regraGeral).toBe(false)
  })

  it('gravação re-resolve: escolha válida preservada, divergente corrigida', async () => {
    const r = await resolverClassificacoes(NCM_2VINC)
    const viva = r.lista[0]
    // Escolha ainda válida → preservada, sem flag de ajuste.
    const ok = await salvarProduto(
      { empresaId: null, codigo: 'SKU-OK', nome: 'N', ncm: NCM_2VINC, classificacao: viva },
      { forcar: true, reresolver: true },
    )
    expect(ok.ok && ok.produto.cClassTrib).toBe('200003')
    expect(ok.ok && ok.revalidada).toBe(false)

    // Snapshot congelado divergente (200038 revogado) → corrigido para a vigente.
    const SIS = { ...viva, cst: '200', cClassTrib: '200038' }
    const fix = await salvarProduto(
      { empresaId: null, codigo: 'SKU-FIX', nome: 'N', ncm: NCM_2VINC, classificacao: SIS },
      { forcar: true, reresolver: true },
    )
    expect(fix.ok && fix.produto.cClassTrib).toBe('200003')
    expect(fix.ok && fix.revalidada).toBe(true)
  })

})
