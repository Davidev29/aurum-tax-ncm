/**
 * Base embutida (`public/base/*.json`, gerada por `scripts/build-base.mjs`).
 *
 * Os artefatos já chegam **normalizados** (3NF). Os normalizadores do runtime
 * precisam, portanto, ser idempotentes: reaplicá-los sobre os próprios
 * arquivos tem que reproduzir exatamente as linhas do MANIFEST — sem essa
 * tolerância a semente gravava `cst = 0`, `cstClassTrib = 0`,
 * `referencia = 0`, `nomenclatura = 0` e NCMs sem descrição.
 *
 * Também cobrem a importação em tempo de execução, que continua recebendo os
 * JSON oficiais brutos.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  detectarFormato,
  semearBaseEmbutida,
  statusBase,
} from '@/infrastructure/base/base-service'
import {
  normalizarCst,
  normalizarCstClassTrib,
  normalizarNcm,
  normalizarNbs,
  normalizarNomenclatura,
  normalizarReferencia,
} from '@/infrastructure/base/normalizacao'
import { db } from '@/infrastructure/db/schema'

/* ------------------------------------------------------------ fixtures --- */

const BASE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
  'base',
)

const ler = (nome: string): Record<string, any> =>
  JSON.parse(readFileSync(path.join(BASE_DIR, nome), 'utf8')) as Record<string, any>

const manifest = ler('MANIFEST.json')
const arquivoRef = ler('classificacao-tributaria.json')
const arquivoReforma = ler('reforma.json')
const arquivoNomen = ler('nomenclatura.json')

const referencia = normalizarReferencia(arquivoRef.itens)
const cst = normalizarCst(arquivoReforma.cst)
const cstct = normalizarCstClassTrib(arquivoReforma.cstClassTrib)
const ncm = normalizarNcm(arquivoReforma.ncm)
const nbs = normalizarNbs(arquivoReforma.nbs)
const nomenclatura = normalizarNomenclatura(arquivoNomen)

/* ------------------------------------------------------------ describe --- */

describe('normalização da base embutida', () => {
  it('reproduz as contagens oficiais do MANIFEST', () => {
    const stats = manifest.estatisticas as Record<string, number>
    expect(referencia).toHaveLength(stats.referencia)
    expect(cst).toHaveLength(stats.cst)
    expect(cstct).toHaveLength(stats.cstClassTrib)
    expect(ncm).toHaveLength(stats.ncm)
    expect(nomenclatura).toHaveLength(stats.nomenclatura)
    expect(nbs).toHaveLength(arquivoReforma.meta.totalNbs)

    // Espelha `MANIFEST.json` — atualize junto com a base se ela for recompilada.
    // NBS vem do arquivo vivo dedupicado (137 linhas → 112 vínculos únicos).
    expect([referencia.length, cst.length, cstct.length, ncm.length, nbs.length, nomenclatura.length])
      .toEqual([164, 17, 132, 2335, 112, 15156])
  })

  it('preserva descrições, documentos, alíquotas e atos', () => {
    expect(ncm.every((n) => n.descricao !== '')).toBe(true)
    expect(ncm.every((n) => n.documentos !== '')).toBe(true)
    expect(nbs.every((n) => n.descricao !== '')).toBe(true)
    expect(referencia.every((r) => r.descricao !== '' && r.cstDescricao !== '')).toBe(true)
    expect(cst.every((c) => c.descricao !== '')).toBe(true)
    expect(cstct.every((c) => c.descricao !== '' && c.nome !== '')).toBe(true)
    expect(nomenclatura.every((n) => n.descricao !== '' && n.ato !== null)).toBe(true)

    const amostra = ncm.find((n) => n.codigo === '02011000')
    expect(amostra).toMatchObject({
      id: '02011000|200003|0',
      codigoFormatado: '0201.10.00',
      cst: '200',
      cClassTrib: '200003',
      reducao: 1,
      documentos: 'NFCE, NFE',
    })
    expect(amostra?.descricao).toContain('Lei Complementar nº 214')

    const reg = referencia.find((r) => r.id === '000|000001')
    expect(reg).toMatchObject({ cst: '000', cClassTrib: '000001', exigeTributacao: true })
    expect(reg?.docs.NFe).toBe(true)
    expect(reg?.anexo).toBeNull()

    const vigente = nomenclatura.find((n) => n.dataFim)
    expect(vigente).toMatchObject({ codigo: '39139050', dataFim: '30/09/2026' })
  })

  it('é idempotente: reaplicar sobre os artefatos não perde campos', () => {
    expect(normalizarReferencia(arquivoRef)).toEqual(referencia)
    expect(normalizarReferencia(referencia)).toEqual(referencia)
    expect(normalizarCst(cst)).toEqual(cst)
    expect(normalizarCstClassTrib(cstct)).toEqual(cstct)
    expect(normalizarNcm(ncm)).toEqual(ncm)
    expect(normalizarNbs(nbs)).toEqual(nbs)
    expect(normalizarNomenclatura({ itens: nomenclatura })).toEqual(nomenclatura)
  })
})

describe('importação em tempo de execução (JSON oficiais brutos)', () => {
  it('normaliza a tabela CST a partir das chaves de origem', () => {
    expect(
      normalizarCst([
        {
          'CST-IBS/CBS': '1',
          'Descrição CST-IBS/CBS': 'Regime monofásico',
          ind_gIBSCBS: 'Sim',
          ind_gIBSCBSMono: '1',
          ind_gRed: 'Não',
          ind_gDif: '0',
          ind_gTransfCred: 'true',
          indNFe: '1',
          indNFCe: 'Sim',
          indCTe: '0',
          indCteOS: '1',
          indBPe: '0',
          indBPeTM: '0',
          indNF3e: '1',
          indNFCom: '0',
          indNFSe: '1',
        },
      ]),
    ).toEqual([
      {
        codigo: '001',
        descricao: 'Regime monofásico',
        indIBSCBS: true,
        indIBSCBSMono: true,
        indReducao: false,
        indDiferimento: false,
        indTransferenciaCredito: true,
        docs: {
          NFe: true,
          NFCe: true,
          CTe: false,
          CTeOS: true,
          BPe: false,
          BPeTM: false,
          NF3e: true,
          NFCom: false,
          NFSe: true,
        },
      },
    ])
  })

  it('normaliza a referência CST × cClassTrib a partir das chaves de origem', () => {
    expect(
      normalizarReferencia([
        {
          'Código da Situação Tributária': '1',
          'Descrição da Situação Tributária': 'Regime monofásico',
          'Código da Classificação Tributária': '1',
          'Descrição do Código da Classificação Tributária': 'Monofásico normal',
          'Percentual Redução IBS': '17,7',
          'Percentual Redução CBS': '',
          'Exige Tributação': 'Sim',
          Diferimento: 'Não',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: '001|000001',
        cst: '001',
        cstDescricao: 'Regime monofásico',
        cClassTrib: '000001',
        descricao: 'Monofásico normal',
        pRedIBS: 17.7,
        pRedCBS: 0,
        exigeTributacao: true,
        diferimento: false,
        docs: expect.objectContaining({ NFe: false, NFSe: false }),
      }),
    ])
  })

  it('normaliza NCM, NBS e nomenclatura a partir das chaves de origem', () => {
    expect(
      normalizarNcm([
        {
          codigo: '20019000',
          cst: '1',
          cClassTrib: '1',
          baseLegal: 'Ato do Comitê',
          reducao: '12,5',
          aliquotaIBS: '17,7',
          aliquotaCBS: '8,8',
          documentosFiscaisRelacionados: 'NFE, NFCE',
          descricaoCompleta: 'Produtos químicos',
        },
      ]),
    ).toEqual([
      {
        id: '20019000|000001|0',
        codigo: '20019000',
        codigoFormatado: '2001.90.00',
        cst: '001',
        cClassTrib: '000001',
        baseLegal: 'Ato do Comitê',
        reducao: 12.5,
        aliquotaIBS: 17.7,
        aliquotaCBS: 8.8,
        documentos: 'NFE, NFCE',
        descricao: 'Produtos químicos',
      },
    ])

    expect(
      normalizarNomenclatura({
        Nomenclaturas: [
          {
            Codigo: '01',
            Descricao: 'Animais vivos.',
            Data_Inicio: '01/04/2022',
            Data_Fim: '31/12/9999',
            Tipo_Ato_Ini: 'Res Gecex',
            Numero_Ato_Ini: '272',
            Ano_Ato_Ini: '2021',
          },
        ],
      }),
    ).toEqual([
      {
        codigo: '01',
        codigoOriginal: '01',
        descricao: 'Animais vivos.',
        dataInicio: '01/04/2022',
        dataFim: null,
        ato: 'Res Gecex 272/2021',
        atoFim: null,
      },
    ])
  })

  it('descarta códigos fora do formato esperado', () => {
    expect(normalizarNcm([{ codigo: '1234', descricaoCompleta: 'curto' }])).toEqual([])
    expect(normalizarNbs([{ codigo: '12345678', descricaoCompleta: '8 dígitos' }])).toEqual([])
    expect(normalizarCst([{}, { 'CST-IBS/CBS': '' }])).toEqual([])
  })
})

describe('detecção de formato', () => {
  it('reconhece os JSON brutos e os artefatos da base embutida', () => {
    expect(detectarFormato({ Nomenclaturas: [] })).toBe('nomenclatura')
    expect(detectarFormato(arquivoNomen)).toBe('nomenclatura')
    expect(detectarFormato(arquivoReforma)).toBe('reforma')
    expect(detectarFormato(arquivoRef)).toBe('referencia')
    expect(detectarFormato(arquivoRef.itens)).toBe('referencia')
    expect(detectarFormato({})).toBe('desconhecido')
    expect(detectarFormato(null)).toBe('desconhecido')
  })
})

describe('semeação da base embutida', () => {
  it('preenche todas as stores do IndexedDB', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (entrada: unknown) => {
      const nome = String(entrada).replace(/^base\//, '')
      const conteudo = readFileSync(path.join(BASE_DIR, nome), 'utf8')
      return { ok: true, status: 200, text: async () => conteudo }
    }) as unknown as typeof fetch

    try {
      const status = await semearBaseEmbutida()

      expect(status).toMatchObject({
        ncm: 2335,
        cst: 17,
        cstClassTrib: 132,
        referencia: 164,
        nomenclatura: 15156,
        nbs: 112,
        cnae: 1090,
        embutida: true,
      })
      expect(status.ultimaImportacao?.arquivo).toBe(arquivoReforma.meta.arquivoOrigem)
      expect(status.ultimaImportacao?.total).toBe(2335)
      expect(status.ultimaNomenclatura?.arquivo).toBe(arquivoNomen.meta.arquivoOrigem)
      expect(status.ultimaNomenclatura?.total).toBe(15156)

      const amostra = await db.ncm.get('02011000|200003|0')
      expect(amostra?.descricao).not.toBe('')
      expect(amostra?.documentos).not.toBe('')

      const reg = await db.referencia.get('000|000001')
      expect(reg?.docs.NFe).toBe(true)

      expect((await db.cst.get('200'))?.descricao).not.toBe('')
      expect((await db.cstClassTrib.get('200|200003'))?.descricao).not.toBe('')
      expect((await db.ncmNomenclatura.get('01'))?.ato).not.toBeNull()

      const gravadas = await statusBase()
      expect(gravadas).toEqual(status)
    } finally {
      globalThis.fetch = originalFetch
    }
  }, 60_000)
})
