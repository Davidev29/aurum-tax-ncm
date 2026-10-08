/**
 * Integração lote × IA assistida — a sugestão (nome + NCM) já nasce
 * pré-selecionada (escolha assistida), sem criar tributação nova.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { processarArquivoLote } from '@/infrastructure/parsers/lote'
import { db } from '@/infrastructure/db/schema'

const arquivo = (nome: string, conteudo: string): File =>
  new File([conteudo], nome, { type: 'text/csv' })

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear(), db.ncmNomenclatura.clear(), db.cst.clear(),
    db.cstClassTrib.clear(), db.referencia.clear(),
  ])
  await db.ncm.bulkPut([
    {
      id: 'A', codigo: '02011000', codigoFormatado: '0201.10.00',
      cst: '000', cClassTrib: '000002', baseLegal: 'LC 214/2025 — Anexo II',
      reducao: 100, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    },
    {
      id: 'B', codigo: '02011000', codigoFormatado: '0201.10.00',
      cst: '200', cClassTrib: '200038', baseLegal: 'LC 214/2025 — Anexo IX',
      reducao: 60, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    },
  ] as never[])
  await db.cstClassTrib.bulkPut([
    {
      id: '000|000002', cst: '000', cClassTrib: '000002', nome: 'Alíquota zero — carne bovina',
      descricao: 'Alíquota zero — carne bovina', lcRedacao: null, lcRef: null, tipoAliquota: 'Zero',
      pRedIBS: 100, pRedCBS: 100, indRedutorBC: null, indTribRegular: null, indCredPres: null,
      indMono: null, indMonoReten: null, indMonoRet: null, indMonoDif: null,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
    {
      id: '200|200038', cst: '200', cClassTrib: '200038', nome: 'Redução de 60% — insumo agropecuário',
      descricao: 'Redução de 60% — insumo agropecuário', lcRedacao: null, lcRef: null, tipoAliquota: 'Padrão',
      pRedIBS: 60, pRedCBS: 60, indRedutorBC: null, indTribRegular: null, indCredPres: null,
      indMono: null, indMonoReten: null, indMonoRet: null, indMonoDif: null,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
  ] as never[])
  await db.ncmNomenclatura.put({
    codigo: '02011000', codigoOriginal: '02011000',
    descricao: 'Carne bovina fresca', dataInicio: null, dataFim: null, ato: null,
  })
})

describe('lote com IA assistida', () => {
  it('com 2+ tributações sugere a integral de segurança (nunca fixa benefício)', async () => {
    const csv = [
      'COD/SKU;NOME DO PRODUTO;NCM',
      'SKU-1;Insumo agropecuário para plantio;02011000',
    ].join('\r\n')
    const r = await processarArquivoLote(arquivo('lote.csv', csv))
    const it = r.itens[0]
    // 2 oficiais + hipótese de diferimento (Anexo IX condicional) + integral.
    expect(it.classificacoes).toHaveLength(4)
    expect(it.classificacoes.at(-1)?.integralFallback).toBe(true)
    expect(it.classificacoes.at(-1)).toMatchObject({ cst: '000', cClassTrib: '000001' })
    expect(it.analiseIA?.situacao).toBe('multipla')
    // Segurança: a sugestão é a integral, mesmo com nome aderente ao benefício.
    expect(it.analiseIA?.maisProvavelIndice).toBe(3)
    expect(it.escolhida?.cClassTrib).toBe('000001')
    expect(it.escolhida?.integralFallback).toBe(true)
    expect(r.assistidas).toBe(1)
  })

  it('mantém contadores assistidas/divergentes/unicas', async () => {
    const csv = [
      'COD/SKU;NOME DO PRODUTO;NCM',
      'SKU-1;Insumo agropecuário para plantio;02011000',
      'SKU-2;Carne bovina fresca;02011000',
    ].join('\r\n')
    const r = await processarArquivoLote(arquivo('l.csv', csv))
    expect(r.ambiguos).toBe(2)
    expect(r.assistidas).toBeGreaterThanOrEqual(1)
    expect(r.unicas).toBe(0)
  })

  it('benefício único fixa o oficial mas oferece a integral trocável', async () => {
    // NCM com 1 vínculo oficial de benefício: oficial fixado + integral.
    await db.ncm.clear()
    await db.ncm.put({
      id: 'U', codigo: '83024100', codigoFormatado: '8302.41.00',
      cst: '200', cClassTrib: '200007', baseLegal: 'LC 214/2025 — Anexo XIII',
      reducao: 60, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '',
    } as never)
    await db.cstClassTrib.put({
      id: '200|200007', cst: '200', cClassTrib: '200007', nome: 'Dispositivos de acessibilidade',
      descricao: 'Fornecimento dos dispositivos de acessibilidade próprios para pessoas com deficiência',
      lcRedacao: null, lcRef: null, tipoAliquota: 'Padrão',
      pRedIBS: 60, pRedCBS: 60, indRedutorBC: null, indTribRegular: null, indCredPres: null,
      indMono: null, indMonoReten: null, indMonoRet: null, indMonoDif: null,
      creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    } as never)
    await db.ncmNomenclatura.put({
      codigo: '83024100', codigoOriginal: '83024100',
      descricao: 'Guarnições para móveis', dataInicio: null, dataFim: null, ato: null,
    })
    const csv = [
      'COD/SKU;NOME DO PRODUTO;NCM',
      'SKU-9;ARMADOR GROSSO COM 12 PARES;83024100',
    ].join('\r\n')
    const r = await processarArquivoLote(arquivo('u.csv', csv))
    const it = r.itens[0]
    expect(it.classificacoes).toHaveLength(2)
    expect(it.classificacoes.at(-1)?.integralFallback).toBe(true)
    expect(it.analiseIA?.situacao).toBe('unica')
    // Oficial fixado (não a integral), mas trocável.
    expect(it.analiseIA?.maisProvavelIndice).toBe(0)
    expect(it.escolhida?.cClassTrib).toBe('200007')
    // Nome incoerente com o benefício → alerta de finalidade/descrição.
    expect(it.analiseIA?.alertas.join(' ')).toMatch(/finalidade|integral/i)
    expect(r.unicas).toBe(1)
    expect(r.ambiguos).toBe(0)
  })
})
