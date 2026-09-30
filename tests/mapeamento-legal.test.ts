/**
 * Mapeamento legal — travas das correções da auditoria paralela:
 * anexo oficial × derivado, blindagem de citações (com enquadramento
 * específico, nenhum artigo inferido por faixa — nem Prouni/art. 308),
 * alíquotas uniformes (CST 010/011 não citam art. 128/127), união de
 * documentos (referência ∪ CST) e extinção em primeiro lugar nas observações.
 */
import { describe, expect, it } from 'vitest'
import { OBS_ARTIGOS, rotuloAnexoOficial } from '@/domain/constants/tributarios'
import {
  observacaoTipoAliquota,
  observacoesFiscais,
  observacoesLegais,
} from '@/domain/services/calculo'
import { montarClassificacao } from '@/domain/services/classificacao'
import type {
  Classificacao,
  DocumentosHabilitados,
  ReferenciaCClassTrib,
  TabelaCst,
  TabelaCstClassTrib,
  VinculoNcm,
} from '@/domain/entities'

const DOCS_FALSO = {
  NFe: false, NFCe: false, CTe: false, CTeOS: false, BPe: false,
  BPeTM: false, NF3e: false, NFCom: false, NFSe: false,
} as DocumentosHabilitados

const DOCS_NFE = { ...DOCS_FALSO, NFe: true }

const cct = (over: Partial<TabelaCstClassTrib> = {}): TabelaCstClassTrib => ({
  id: '011|011001',
  cst: '011',
  cClassTrib: '011001',
  nome: 'Planos de assistência funerária',
  descricao: 'Planos de assistência funerária, observado o art. 236',
  lcRedacao: null,
  lcRef: null,
  tipoAliquota: '4 - Uniforme Nacional',
  pRedIBS: 60,
  pRedCBS: 60,
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
  ...over,
})

const cl = (over: Partial<Classificacao> = {}): Classificacao => ({
  id: '011|011001|0',
  codigo: '04011000',
  codigoFormatado: '0401.10.00',
  cst: '011',
  cClassTrib: '011001',
  baseLegal: '',
  descricao: 'Leite',
  vinculo: null,
  cstDetalhes: null,
  cstClassTribDetalhes: cct(),
  referencia: null,
  resumo: {
    descricaoCClassTrib: 'Planos de assistência funerária',
    percentualReducaoIBS: 60,
    percentualReducaoCBS: 60,
    anexo: null,
    urlLegislacao: null,
    documentosHabilitados: null,
  },
  regraGeral: false,
  ...over,
})

describe('rotuloAnexoOficial', () => {
  it('numera anexos I–XV em romano e não cai em "Sem redução"', () => {
    expect(rotuloAnexoOficial('9')).toBe('Anexo IX — LC 214/2025')
    expect(rotuloAnexoOficial('1')).toBe('Anexo I — LC 214/2025')
    expect(rotuloAnexoOficial('15')).toBe('Anexo XV — LC 214/2025')
  })

  it('códigos 9xxxx ganham rótulo neutro, sem inferir dispositivo', () => {
    expect(rotuloAnexoOficial('90111')).toBe('Ref. oficial 90111')
    expect(rotuloAnexoOficial('93081')).toBe('Ref. oficial 93081')
  })

  it('vazio/nulo vira isento', () => {
    expect(rotuloAnexoOficial('')).toContain('Sem redução')
    expect(rotuloAnexoOficial(null)).toContain('Sem redução')
  })
})

describe('observacaoTipoAliquota', () => {
  it('uniforme nacional cita arts. 236 a 246, não o art. 128', () => {
    const o = observacaoTipoAliquota('4 - Uniforme Nacional')
    expect(o?.texto).toContain('236')
    expect(o?.texto).not.toContain('art. 128')
  })

  it('uniforme setorial e fixa têm observação própria', () => {
    expect(observacaoTipoAliquota('5 - Uniforme Setorial')?.titulo).toContain('setorial')
    expect(observacaoTipoAliquota('1 - Fixa')?.titulo).toContain('fixa')
  })

  it('padrão/sem-alíquota/nulo retornam null', () => {
    expect(observacaoTipoAliquota('2 - Padrão')).toBeNull()
    expect(observacaoTipoAliquota('3 - Sem aliquota')).toBeNull()
    expect(observacaoTipoAliquota(null)).toBeNull()
  })
})

describe('observacoesFiscais', () => {
  it('uniforme substitui a fundamentação por faixa (sem art. 128 para 011)', () => {
    const obs = observacoesFiscais('04011000', cl())
    expect(obs.some((o) => o.titulo.includes('uniforme'))).toBe(true)
    expect(obs.some((o) => o.texto.includes('art. 128'))).toBe(false)
  })

  it('blindagem: enquadramento específico não recebe artigo inferido por faixa (nem art. 308)', () => {
    const padrao = cl({
      cst: '200',
      cClassTrib: '200025',
      resumo: {
        descricaoCClassTrib: 'Prouni',
        percentualReducaoIBS: 60,
        percentualReducaoCBS: 100,
        anexo: '93081',
        urlLegislacao: null,
        documentosHabilitados: null,
      },
      cstClassTribDetalhes: cct({ tipoAliquota: '2 - Padrão', pRedIBS: 60, pRedCBS: 100 }),
    })
    const obs = observacoesFiscais('04011000', padrao)
    // A função pura ainda infere por % (uso restrito ao fallback de regra
    // geral), mas o caminho produtivo blinda: com enquadramento específico,
    // o sistema NÃO afirma art. 308 sozinho — o fundamento é o da base
    // oficial (cabeçalho da classificação + base legal).
    expect(observacoesLegais('04011000', 60, 100).some((o) => o.texto.includes('art. 308'))).toBe(true)
    expect(obs.some((o) => o.texto.includes('art. 308'))).toBe(false)
  })

  it('extinção do NCM vem primeiro', () => {
    const obs = observacoesFiscais('39139050', cl(), {
      codigo: '39139050',
      codigoOriginal: '3913.90.50',
      descricao: 'Quitosan',
      dataInicio: '01/04/2022',
      dataFim: '30/09/2026',
      ato: 'Res Gecex 272/2021',
      atoFim: 'Res Gecex 926/2026',
    })
    expect(obs[0]?.titulo).toContain('extinto')
  })

  it('enquadramento específico 200/200038: só o aviso oficial condicional (art. 138), zero inferência', () => {
    // Cenário da tela de Consulta: 1 opção oficial (Anexo IX, redução 60%).
    // Blindagem: nenhum artigo inferido por faixa/capítulo (137/135/128) —
    // a única citação é o aviso condicional do art. 138, que existe na base
    // oficial. O resto do fundamento está no cabeçalho + base legal.
    const anexoIX = cl({
      codigo: '01022110',
      codigoFormatado: '0102.21.10',
      cst: '200',
      cClassTrib: '200038',
      descricao: 'Bovino reprodutor',
      cstClassTribDetalhes: cct({
        id: '200|200038',
        cst: '200',
        cClassTrib: '200038',
        nome: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
        tipoAliquota: '2 - Padrão',
        pRedIBS: 60,
        pRedCBS: 60,
      }),
      referencia: {
        lcRef: 'Art. 138',
        reducaoAliquota: true,
        reducaoBcCst: false,
        monofasica: false,
        creditoPresumido: false,
        diferimento: false,
        anexo: '9',
        urlLegislacao: null,
        documentos: {},
      },
      resumo: {
        descricaoCClassTrib: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
        percentualReducaoIBS: 60,
        percentualReducaoCBS: 60,
        anexo: '9',
        urlLegislacao: null,
        documentosHabilitados: null,
      },
    })
    const obs = observacoesFiscais('01022110', anexoIX)
    const titulos = obs.map((o) => o.titulo)
    expect(titulos.some((t) => t.includes('condicional'))).toBe(true)
    expect(titulos).not.toContain(OBS_ARTIGOS.art128.titulo)
    expect(titulos).not.toContain(OBS_ARTIGOS.art137.titulo)
    expect(titulos).not.toContain(OBS_ARTIGOS.art135.titulo)
    expect(obs).toHaveLength(1)
  })
})

describe('união de documentos (referência ∪ CST)', () => {
  const vinculo: VinculoNcm = {
    id: '41001199|410011|0',
    codigo: '41001199',
    codigoFormatado: '4100.11.99',
    cst: '410',
    cClassTrib: '410011',
    baseLegal: '',
    reducao: null,
    aliquotaIBS: null,
    aliquotaCBS: null,
    descricao: 'Item imune',
    documentos: '',
  }
  const cst: TabelaCst = {
    codigo: '410',
    descricao: 'Imune',
    indIBSCBS: true,
    indIBSCBSMono: false,
    indReducao: false,
    indDiferimento: false,
    indTransferenciaCredito: false,
    docs: DOCS_NFE,
  }
  const ref = {
    id: '410|410011',
    cst: '410',
    cClassTrib: '410011',
    docs: DOCS_FALSO,
    anexo: null,
    urlLegislacao: null,
    descricao: 'Imune',
    pRedIBS: 100,
    pRedCBS: 100,
  } as unknown as ReferenciaCClassTrib

  it('tudo-falso na referência não apaga os docs da CST', () => {
    const c = montarClassificacao(vinculo, { cstDetalhes: cst, cstClassTribDetalhes: null, referencia: ref })
    expect(c.resumo.documentosHabilitados?.NFe).toBe(true)
    expect(c.referencia?.documentos.NFe).toBe(true)
  })

  it('sem referência e sem CST, documentos ficam nulos (UI omite a linha)', () => {
    const c = montarClassificacao(vinculo, { cstDetalhes: null, cstClassTribDetalhes: null, referencia: null })
    // montarReferencia retorna null sem ref — resumo herda null.
    expect(c.resumo.documentosHabilitados).toBeNull()
    expect(c.referencia).toBeNull()
  })
})
