/**
 * Fallback integral multi-opção + escopo por produto (SKU + empresa + NCM).
 *
 * - NCM com 2+ vínculos oficiais ganha a tributação integral (000/000001)
 *   como ÚLTIMA opção (`integralFallback`), além das regras existentes;
 * - NCM com 1 vínculo, sem vínculo, manual, extinto ou herança: sem fallback;
 * - a sugestão automática nunca elege o fallback como provável;
 * - a escolha do lote vale só para o cadastro daquele produto
 *   (SKU + empresaId + NCM): o resolvedor continua sugerindo todas as regras
 *   na Consulta normal.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { observacaoIntegralFallback } from '@/domain/services/classificacao'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { processarArquivoLote } from '@/infrastructure/parsers/lote'
import { salvarProdutosEmLote } from '@/application/produtos'
import { db } from '@/infrastructure/db/schema'
import type { TabelaCstClassTrib, VinculoNcm } from '@/domain/entities'

const NCM_2 = '11111111'
const NCM_1 = '22222222'
const NCM_0 = '33333333'

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

const nomen = (codigo: string) => ({
  codigo,
  codigoOriginal: codigo,
  descricao: `Produto ${codigo}`,
  dataInicio: null as string | null,
  dataFim: null as string | null,
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
    db.empresas.clear(),
  ])
  await db.cstClassTrib.bulkPut([
    cct('200', '200003', 100),
    cct('200', '200038', 60),
    cct('000', '000001', 0),
  ])
  await db.ncmNomenclatura.bulkPut([nomen(NCM_2), nomen(NCM_1), nomen(NCM_0)])
  await db.ncm.bulkPut([
    vinculo(NCM_2, '200', '200038'),
    vinculo(NCM_2, '200', '200003'),
    vinculo(NCM_1, '200', '200003'),
  ])
})

describe('fallback integral multi-opção (motor único)', () => {
  it('anexa integral como ÚLTIMA opção quando há 2+ vínculos', async () => {
    const r = await resolverClassificacoes(NCM_2)
    expect(r.regraGeral).toBe(false)
    expect(r.manual).toBe(false)
    // 2 oficiais (ordem determinística) + integral de segurança.
    expect(r.lista).toHaveLength(3)
    expect(r.lista[0]).toMatchObject({ cst: '200', cClassTrib: '200003' })
    expect(r.lista[1]).toMatchObject({ cst: '200', cClassTrib: '200038' })
    const ultimo = r.lista[2]
    expect(ultimo).toMatchObject({ cst: '000', cClassTrib: '000001' })
    expect(ultimo.integralFallback).toBe(true)
    expect(r.temIntegralFallback).toBe(true)
    // Estimativa (lista[0]) continua oficial — o fallback não rouba a 1ª posição.
    expect(r.lista[0].integralFallback).not.toBe(true)
  })

  it('não anexa com 1 vínculo nem sem vínculo', async () => {
    const um = await resolverClassificacoes(NCM_1)
    expect(um.lista).toHaveLength(1)
    expect(um.lista[0].integralFallback).not.toBe(true)
    expect(um.temIntegralFallback).not.toBe(true)

    const zero = await resolverClassificacoes(NCM_0)
    expect(zero.regraGeral).toBe(true)
    expect(zero.lista).toHaveLength(1)
    expect(zero.lista[0].integralFallback).not.toBe(true)
  })

  it('não duplica quando os oficiais já contêm a integral 000/000001', async () => {
    const NCM_DUP = '99999999'
    await db.ncmNomenclatura.put(nomen(NCM_DUP))
    await db.ncm.bulkPut([vinculo(NCM_DUP, '200', '200003'), vinculo(NCM_DUP, '000', '000001')])
    const r = await resolverClassificacoes(NCM_DUP)
    expect(r.lista).toHaveLength(2)
    expect(r.lista.some((c) => c.integralFallback)).toBe(false)
    expect(r.temIntegralFallback).not.toBe(true)
  })

  it('legenda do fallback tem cor e texto próprios', () => {
    const r = resolverClassificacoes
    void r
    const obs = observacaoIntegralFallback({ integralFallback: true })
    expect(obs).not.toBeNull()
    expect(obs?.cor).toBe('slate')
    expect(obs?.titulo).toMatch(/tributação integral/i)
    expect(obs?.texto).toMatch(/realmente atende/i)
    expect(observacaoIntegralFallback({ integralFallback: false })).toBeNull()
    expect(observacaoIntegralFallback(null)).toBeNull()
  })

  it('lote recebe o fallback e nunca o sugere como provável', async () => {
    const csv = ['SKU;Nome;NCM', `A;Insumo agropecuário;${NCM_2}`].join('\n')
    const lote = await processarArquivoLote(arquivo('l.csv', csv))
    const item = lote.itens[0]
    expect(item.classificacoes).toHaveLength(3)
    expect(item.classificacoes.at(-1)?.integralFallback).toBe(true)
    // Sugestão automática recai sobre oficial, nunca sobre o fallback.
    expect(item.analiseIA?.situacao).toBe('multipla')
    const sugerida = item.classificacoes[item.analiseIA?.maisProvavelIndice ?? 0]
    expect(sugerida?.integralFallback).not.toBe(true)
    expect(item.escolhida?.integralFallback).not.toBe(true)
    expect(item.analiseIA?.porqueMultiplas).toMatch(/segurança/i)
  })
})

describe('escopo por produto: escolha do lote não vaza para a Consulta', () => {
  it('dois SKUs do mesmo NCM salvam escolhas diferentes; resolver segue global', async () => {
    const csv = ['SKU;Nome;NCM', `A;Item A;${NCM_2}`, `B;Item B;${NCM_2}`].join('\n')
    const lote = await processarArquivoLote(arquivo('l.csv', csv))
    expect(lote.itens).toHaveLength(2)
    // Linha A mantém a oficial sugerida; linha B opta pela integral de segurança.
    const idxIntegral = lote.itens[1].classificacoes.findIndex((c) => c.integralFallback)
    expect(idxIntegral).toBeGreaterThanOrEqual(2)
    const escolhaA = lote.itens[0].escolhida!
    const escolhaB = lote.itens[1].classificacoes[idxIntegral]!
    expect(escolhaA.integralFallback).not.toBe(true)
    expect(escolhaB.integralFallback).toBe(true)

    const empresaId = null
    const cont = await salvarProdutosEmLote(
      [
        { codigo: 'A', nome: 'Item A', ncm: NCM_2, classificacao: escolhaA },
        { codigo: 'B', nome: 'Item B', ncm: NCM_2, classificacao: escolhaB },
      ],
      empresaId,
    )
    expect(cont.salvos).toBe(2)

    const todos = await db.produtos.toArray()
    const pa = todos.find((p) => p.codigo === 'A')!
    const pb = todos.find((p) => p.codigo === 'B')!
    // Mesmo NCM, cadastros distintos: A oficial, B integral — escopo SKU+NCM.
    expect(pa.ncm).toBe(NCM_2)
    expect(pb.ncm).toBe(NCM_2)
    expect(pa.cClassTrib).not.toBe(pb.cClassTrib)
    expect(pb.cstReforma).toBe('000')
    expect(pb.cClassTrib).toBe('000001')

    // Consulta normal continua sugerindo TODAS as regras (oficiais + fallback).
    const r = await resolverClassificacoes(NCM_2)
    expect(r.lista).toHaveLength(3)
    expect(r.lista.filter((c) => !c.integralFallback)).toHaveLength(2)
    expect(r.manual).toBe(false)
  })
})
