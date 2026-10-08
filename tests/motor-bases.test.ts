/**
 * Motor de bases — garantia fim a fim.
 *
 * Prova que os arquivos reais dos portais (formato CFF) alimentam a
 * classificação: importa referência CFF + vínculos + nomenclatura e resolve
 * um NCM pelo motor único, com os mesmos joins da produção.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { importarBase } from '@/infrastructure/base/base-service'
import { anexosDoNcm, anexosNegadosPara, anexosParaNcms, locaisOperacao, regrasCreditoPresumido } from '@/infrastructure/base/info-adicional'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

const noop = () => undefined

const CLASSTRIB_CFF = [
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
        IndCTe: true,
        IndCTeOS: true,
        IndBPe: true,
        IndBPeTM: false,
        IndNF3e: true,
        IndNFCom: true,
        IndNFSE: true,
      },
    ],
  },
  {
    CST: '200',
    DescricaoCST: 'Alíquota zero',
    IndIBSCBS: true,
    IndRedBC: false,
    IndRedAliq: true,
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
        cClassTrib: '200003',
        DescricaoClassTrib: 'Cesta básica',
        pRedIBS: 100,
        pRedCBS: 100,
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
        TipoAliquota: '1 - Alíquota zero',
        TipoReceitaBrutaSN: '1 - Receita Bruta Interna',
        Anexo: 1,
        Link: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art125',
        IndNFe: true,
        IndNFCe: true,
        IndCTe: false,
        IndCTeOS: false,
        IndBPe: false,
        IndBPeTM: false,
        IndNF3e: false,
        IndNFCom: false,
        IndNFSE: false,
      },
    ],
  },
]

const REFORMA = {
  NCM: [
    {
      codigo: '02011000',
      cst: '200',
      cClassTrib: '200003',
      baseLegal: 'Art. 125',
      descricaoCompleta: 'Carne bovina fresca',
      documentosFiscaisRelacionados: 'NFe',
    },
  ],
  NBS: [],
  tabelasAuxiliares: { cst: [], cstClassTrib: [] },
}

const NOMENCLATURA = {
  Nomenclaturas: [
    {
      Codigo: '02011000',
      Descricao: 'Carne bovina fresca',
      Data_Inicio: '01/04/2022',
      Data_Fim: '31/12/9999',
      Tipo_Ato_Ini: 'Res Gecex',
      Numero_Ato_Ini: '272',
      Ano_Ato_Ini: '2021',
    },
  ],
}

const ANEXOS = [
  { nroAnexo: 1, codNcmNbs: '02011000', TipoNomenclatura: 'NCM', TipoPermissao: 'Permitido', descrAnexo: 'Cesta básica' },
]

const CLASSPROD = [{ codClassProd: '0100101', descrClassProd: 'Telefonia', codGrupoClass: '010' }]

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
})

describe('motor de bases (CFF real → classificação)', () => {
  it('importa referência CFF + vínculos + nomenclatura e resolve o NCM', async () => {
    const r1 = await importarBase(CLASSTRIB_CFF, 'classTrib.json', noop)
    expect(r1.formato).toBe('classtrib-cff')
    expect(r1.total).toBe(2)

    const r2 = await importarBase(REFORMA, 'reforma.json', noop)
    expect(r2.formato).toBe('reforma')

    const r3 = await importarBase(NOMENCLATURA, 'vigente.json', noop)
    expect(r3.formato).toBe('nomenclatura')

    const res = await resolverClassificacoes('02011000')
    expect(res.regraGeral).toBe(false)
    expect(res.manual).toBe(false)
    expect(res.lista).toHaveLength(1)
    expect(res.lista[0].cst).toBe('200')
    expect(res.lista[0].cClassTrib).toBe('200003')
    expect(res.lista[0].resumo?.percentualReducaoIBS).toBe(100)
    expect(res.lista[0].resumo?.percentualReducaoCBS).toBe(100)
  })

  it('importa anexos e produtos por DFe (com sistema) sem tocar na classificação', async () => {
    const a = await importarBase(ANEXOS, 'anexos.json', noop)
    expect(a.formato).toBe('anexos-cff')
    expect(await db.anexos.count()).toBe(1)

    await expect(importarBase(CLASSPROD, 'prod.json', noop)).rejects.toThrow(/sistema/i)
    const p = await importarBase(CLASSPROD, 'prod.json', noop, { sistema: 'NFCom' })
    expect(p.formato).toBe('classprod-cff')
    expect(await db.produtosDfe.count()).toBe(1)

    // Reimportação é idempotente: mesmos ids, mesmas contagens.
    await importarBase(ANEXOS, 'anexos.json', noop)
    await importarBase(CLASSPROD, 'prod.json', noop, { sistema: 'NFCom' })
    expect(await db.anexos.count()).toBe(1)
    expect(await db.produtosDfe.count()).toBe(1)
  })

  it('rejeita formato desconhecido com mensagem acionável', async () => {
    await expect(importarBase({ foo: 1 }, 'x.json', noop)).rejects.toThrow(/não reconhecido/i)
  })

  it('converte de verdade e casa por match: anexos do NCM + tabelas de referência', async () => {
    await importarBase(
      [
        { nroAnexo: 1, codNcmNbs: '02011000', TipoNomenclatura: 'NCM', TipoPermissao: 'Permitido', descrAnexo: 'Cesta básica', descrCondicao: 'Alimentação humana' },
        { nroAnexo: 4, codNcmNbs: '02011000', TipoNomenclatura: 'NCM', TipoPermissao: 'Não Permitido', descrAnexo: 'Outro', descrExcecao: 'Exceto X' },
      ],
      'anexos.json',
      noop,
    )
    const match = await anexosDoNcm('02011000')
    expect(match).toHaveLength(2)
    expect(match.map((a) => a.permissao).sort()).toEqual(['negado', 'permitido'])
    // NCM sem linha não casa com nada.
    expect(await anexosDoNcm('99999999')).toHaveLength(0)
    // Lote: uma consulta para vários NCMs; só negados para o alerta do PDF.
    const mapa = await anexosParaNcms(['02011000', '99999999', 'invalido'])
    expect(Object.keys(mapa)).toEqual(['02011000'])
    expect(mapa['02011000']).toHaveLength(2)
    const negados = await anexosNegadosPara(['02011000'])
    expect(negados).toHaveLength(1)
    expect(negados[0].nroAnexo).toBe(4)

    const c = await importarBase(
      [{ codCredPres: 1, descrCredPres: 'Produtor rural', indIbs: true, indCbs: true }],
      'cred.json',
      noop,
    )
    expect(c.formato).toBe('credito-presumido-cff')
    const regras = await regrasCreditoPresumido()
    expect(regras).toHaveLength(1)
    expect(regras[0]).toMatchObject({ cod: 1, indIbs: true })

    const l = await importarBase(
      [{ codOperacao: '010101', nomeOperacao: 'Bem Móvel' }],
      'ind.json',
      noop,
    )
    expect(l.formato).toBe('indoper-cff')
    const locais = await locaisOperacao()
    expect(locais).toHaveLength(1)
    expect(locais[0].cod).toBe('010101')
  })
})
