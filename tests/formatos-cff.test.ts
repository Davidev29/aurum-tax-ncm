/**
 * Motor de bases CFF — fingerprint + normalizadores dos formatos reais da API.
 *
 * Garante que cada arquivo baixado dos portais (classTrib, anexos,
 * credPresumido, indOper, ConsultaClassificacaoProduto, Siscomex, DFe) seja
 * reconhecido pelo conteúdo e normalizado de forma idempotente.
 */
import { describe, expect, it } from 'vitest'
import { fingerprintBase } from '@/infrastructure/base/formatos'
import {
  normalizarAnexosCff,
  normalizarClassTribCff,
  normalizarCreditoPresumido,
  normalizarLocaisOperacao,
  normalizarProdutoDfe,
} from '@/infrastructure/base/normalizacao'

const CST_CFF = [
  {
    CST: '000',
    DescricaoCST: 'Tributação integral',
    IndIBSCBS: true,
    IndRedBC: false,
    IndRedAliq: false,
    IndTransfCred: false,
    IndDif: false,
    IndAjusteCompet: false,
    IndIBSCBSMono: false,
    IndCredPresIBSZFM: false,
    Publicacao: '2025-05-12T00:00:00',
    InicioVigencia: '2025-05-01T00:00:00',
    FimVigencia: null,
    classificacoesTributarias: [
      {
        cClassTrib: '000001',
        DescricaoClassTrib: 'Integral',
        pRedIBS: 0,
        pRedCBS: 0,
        IndTribRegular: false,
        IndCredPresOper: false,
        IndEstornoCred: false,
        MonofasiaSujeitaRetencao: false,
        MonofasiaRetidaAnt: false,
        MonofasiaDiferimento: false,
        MonofasiaPadrao: false,
        Publicacao: '2026-06-22T00:00:00',
        InicioVigencia: '2025-05-05T00:00:00',
        FimVigencia: null,
        TipoAliquota: '2 - Padrão',
        TipoReceitaBrutaSN: '1 - Receita Bruta Interna',
        Anexo: null,
        Link: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art4',
        IndNFe: true,
        IndNFCe: true,
        IndCTe: false,
        IndCTeOS: false,
        IndBPe: true,
        IndBPeTM: false,
        IndNF3e: true,
        IndNFCom: true,
        IndNFSE: true,
      },
    ],
  },
]

describe('fingerprintBase', () => {
  it('reconhece classtrib-cff pelo conteúdo (não pelo nome)', () => {
    expect(fingerprintBase(CST_CFF)).toBe('classtrib-cff')
  })

  it('reconhece anexos, credito, indoper e classprod', () => {
    expect(fingerprintBase([{ nroAnexo: 1, codNcmNbs: '10062010' }])).toBe('anexos-cff')
    expect(fingerprintBase([{ codCredPres: 1 }])).toBe('credito-presumido-cff')
    expect(fingerprintBase([{ codOperacao: '010101' }])).toBe('indoper-cff')
    expect(fingerprintBase([{ codClassProd: '0100101' }])).toBe('classprod-cff')
  })

  it('mantém os formatos legados (reforma, nomenclatura, referencia-dfe)', () => {
    expect(fingerprintBase({ NCM: [], tabelasAuxiliares: {} })).toBe('reforma')
    expect(fingerprintBase({ Nomenclaturas: [] })).toBe('nomenclatura')
    expect(fingerprintBase([{ 'Código da Situação Tributária': '000' }])).toBe('referencia-dfe')
    expect(fingerprintBase({ tipo: 'reforma' })).toBe('reforma')
  })

  it('não confunde referencia flat com classtrib aninhado', () => {
    // classtrib tem `codigo`? não — tem CST + classificacoesTributarias.
    expect(fingerprintBase([{ CST: '000', classificacoesTributarias: [] }])).toBe('classtrib-cff')
    // referencia normalizada tem cst + cClassTrib sem `codigo`.
    expect(fingerprintBase([{ cst: '000', cClassTrib: '000001' }])).toBe('referencia-dfe')
  })

  it('desconhecido para resto', () => {
    expect(fingerprintBase(null)).toBe('desconhecido')
    expect(fingerprintBase([])).toBe('desconhecido')
    expect(fingerprintBase([{ aleatorio: 1 }])).toBe('desconhecido')
    expect(fingerprintBase({ foo: 'bar' })).toBe('desconhecido')
  })
})

describe('normalizarClassTribCff', () => {
  it('achata CST aninhado nos 3 registros canônicos', () => {
    const r = normalizarClassTribCff(CST_CFF)
    expect(r.referencia).toHaveLength(1)
    expect(r.cst).toHaveLength(1)
    expect(r.cstClassTrib).toHaveLength(1)
    const ref = r.referencia[0]
    expect(ref.id).toBe('000|000001')
    expect(ref.cst).toBe('000')
    expect(ref.cClassTrib).toBe('000001')
    expect(ref.urlLegislacao).toContain('#art4')
    expect(ref.docs.NFe).toBe(true)
    expect(ref.docs.CTe).toBe(false)
    expect(r.cst[0].codigo).toBe('000')
    expect(r.cstClassTrib[0].id).toBe('000|000001')
  })

  it('ignora linhas sem CST ou sem classificacoes', () => {
    const r = normalizarClassTribCff([{ foo: 1 }, { CST: '000' }, null])
    expect(r.referencia).toHaveLength(0)
  })
})

describe('normalizarAnexosCff', () => {
  it('normaliza NCM/NBS e permissão', () => {
    const r = normalizarAnexosCff([
      { nroAnexo: 1, codNcmNbs: '10062010', TipoNomenclatura: 'NCM', TipoPermissao: 'Permitido', descrAnexo: 'A' },
      { nroAnexo: 1, codNcmNbs: '03021900', TipoNomenclatura: 'NCM', TipoPermissao: 'Não Permitido', descrAnexo: 'A' },
    ])
    expect(r).toHaveLength(2)
    expect(r[0].codigo).toBe('10062010')
    expect(r[0].tipo).toBe('NCM')
    expect(r[0].permissao).toBe('permitido')
    expect(r[1].permissao).toBe('negado')
  })

  it('preserva "Sem código" como catálogo do anexo (sem vínculo)', () => {
    const r = normalizarAnexosCff([
      { nroAnexo: 92371, codNcmNbs: 'Sem código', TipoNomenclatura: 'NBS', TipoPermissao: null, descrAnexo: 'Planos' },
    ])
    expect(r).toHaveLength(1)
    expect(r[0].codigo).toBeNull()
    expect(r[0].tipo).toBeNull()
    expect(r[0].permissao).toBeNull()
  })
})

describe('normalizarProdutoDfe', () => {  it('exige o sistema e chaveia por sistema|cod', () => {
    expect(() => normalizarProdutoDfe([{ codClassProd: '0100101' }], '')).toThrow(/sistema/i)
    const r = normalizarProdutoDfe(
      [{ codClassProd: '0100101', descrClassProd: 'Telefonia', codGrupoClass: '010', indPrePago: false }],
      'NFCom',
    )
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('NFCom|0100101')
    expect(r[0].sistema).toBe('NFCom')
    expect(r[0].flags).toEqual({ indPrePago: false })
  })

  it('mesmo código em sistemas diferentes gera registros distintos', () => {
    const a = normalizarProdutoDfe([{ codClassProd: '0100101', descrClassProd: 'Telefonia' }], 'NFCom')
    const b = normalizarProdutoDfe([{ codClassProd: '0100101', descrClassProd: 'Gás' }], 'NFGas')
    expect(a[0].id).not.toBe(b[0].id)
    expect(a[0].descricao).not.toBe(b[0].descricao)
  })
})

describe('conversão tipada (credito + locais)', () => {
  it('normalizarCreditoPresumido converte de verdade (não guarda raw)', () => {
    const r = normalizarCreditoPresumido([
      { codCredPres: 1, descrCredPres: 'Produtor rural', indIbs: true, indCbs: true, indApropriaDfe: true, indApropriaEvento: true, indCondSuspensiva: false, dthIniVigIbs: '2027-01-01T00:00:00', dthFimVigIbs: null, dthIniVigCbs: '2027-01-01T00:00:00', dthFimVigCbs: null, indDeduzCredPres: false },
      { semCodigo: true },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cod: 1, indIbs: true, indCbs: true, apropriaDfe: true })
    expect(r[0].descricao).toContain('rural')
  })

  it('normalizarLocaisOperacao converte de verdade', () => {
    const r = normalizarLocaisOperacao([
      { codOperacao: '010101', nomeOperacao: 'Bem Móvel', texDispLegal: 'Inc. I', texLocalOperacao: 'Local da entrega', texLocalFornec: 'Estab.', texCaractFornec: 'Presencial', dthPublicacao: '2025-11-17T00:00:00', dthIniVig: '2025-11-17T00:00:00', dthFimVig: null },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ cod: '010101', nome: 'Bem Móvel' })
  })
})
