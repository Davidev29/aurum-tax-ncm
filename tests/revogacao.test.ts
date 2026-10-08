/**
 * Revogações de anexos/ccts + rebaixamento no resolvedor.
 *
 * Trava a regra: item revogado ou NCM extinto com vínculo NUNCA apresenta
 * redução como vigente — cai para regra geral com aviso vermelho.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import {
  extrairRevogacoesAnexos,
  normAnexo,
  observacaoRevogacao,
  revogacaoDe,
  revogacaoDoAnexo,
  revogacaoDoCct,
  REVOGACOES_ANEXO,
} from '@/domain/services/revogacao'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'

const NCM_EXTINTO = '11111111'
const NCM_REVOGADO = '22222222'
const NCM_NORMAL = '33333333'

async function semearBase() {
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
  const ref = (cst: string, cct: string, anexo: string | null) => ({
    id: `${cst}|${cct}`, cst, cstDescricao: 'x', cClassTrib: cct, descricao: 'x',
    pRedIBS: 60, pRedCBS: 60, tipoAliquota: '2 - Padrão', anexo,
    urlLegislacao: null, exigeTributacao: true, reducaoBC: false, reducaoAliquota: true,
    transferenciaCredito: false, diferimento: false, monofasica: false,
    creditoPresumidoZFM: false, ajusteCompetencia: false, tributacaoRegular: false,
    creditoPresumido: false, estornoCredito: false, monoNormal: false, monoRetencao: false,
    monoRetida: false, monoDiferimentoCombustivel: false, simplesReceitaBruta: null,
    regimeContribuicaoSocial: null, impostoBensServicos: null, docs: {} as never,
  })
  await db.referencia.put({ ...ref('200', '200001', null) } as never)
  await db.referencia.put({ ...ref('200', '200002', '19'), pRedIBS: 60, pRedCBS: 60 } as never)
  await db.ncm.put({
    id: `${NCM_EXTINTO}|200001|0`, codigo: NCM_EXTINTO, codigoFormatado: '1111.11.11',
    cst: '200', cClassTrib: '200001', baseLegal: '', reducao: null,
    aliquotaIBS: null, aliquotaCBS: null, descricao: 'Extinto com vínculo', documentos: '',
  })
  await db.ncm.put({
    id: `${NCM_REVOGADO}|200002|0`, codigo: NCM_REVOGADO, codigoFormatado: '2222.22.22',
    cst: '200', cClassTrib: '200002', baseLegal: '', reducao: null,
    aliquotaIBS: null, aliquotaCBS: null, descricao: 'Anexo revogado', documentos: '',
  })
  await db.ncm.put({
    id: `${NCM_NORMAL}|200001|0`, codigo: NCM_NORMAL, codigoFormatado: '3333.33.33',
    cst: '200', cClassTrib: '200001', baseLegal: '', reducao: null,
    aliquotaIBS: null, aliquotaCBS: null, descricao: 'Normal', documentos: '',
  })
  await db.ncmNomenclatura.put({
    codigo: NCM_EXTINTO, codigoOriginal: '1111.11.11', descricao: 'Extinto',
    dataInicio: '01/04/2022', dataFim: '30/09/2026', ato: 'Res Gecex 272/2021', atoFim: 'Res Gecex 926/2026',
  })
  await db.ncmNomenclatura.put({
    codigo: NCM_REVOGADO, codigoOriginal: '2222.22.22', descricao: 'Revogado',
    dataInicio: '01/04/2022', dataFim: null, ato: 'Res Gecex 272/2021', atoFim: null,
  })
  await db.ncmNomenclatura.put({
    codigo: NCM_NORMAL, codigoOriginal: '3333.33.33', descricao: 'Normal',
    dataInicio: '01/04/2022', dataFim: null, ato: 'Res Gecex 272/2021', atoFim: null,
  })
}

beforeEach(async () => {
  await db.delete().catch(() => undefined)
  await db.open()
  await semearBase()
})

describe('registro de revogações', () => {
  it('anexo 19 consta como integralmente revogado', () => {
    expect(REVOGACOES_ANEXO['19']).toBeDefined()
    expect(revogacaoDoAnexo('19')?.tipo).toBe('anexo')
    expect(revogacaoDoAnexo('9')).toBeNull()
  })

  it('normAnexo aceita 9/09/IX/Anexo IX e rejeita 9xxxx', () => {
    expect(normAnexo('9')).toBe('9')
    expect(normAnexo('09')).toBe('9')
    expect(normAnexo('IX')).toBe('9')
    expect(normAnexo('Anexo IX')).toBe('9')
    expect(normAnexo('90111')).toBeNull()
    expect(normAnexo(null)).toBeNull()
  })

  it('revogacaoDe prefere cct ao anexo', () => {
    expect(revogacaoDe('200001', '19')?.alvo).toBe('19')
    expect(revogacaoDe('200001', '9')).toBeNull()
    expect(revogacaoDe('200001', null)).toBeNull()
  })

  it('revogacaoDoCct vazio por padrão', () => {
    expect(revogacaoDoCct('200001')).toBeNull()
  })

  it('observação vermelha cita alvo e ato', () => {
    const o = observacaoRevogacao(revogacaoDoAnexo('19'))
    expect(o?.cor).toBe('red')
    expect(o?.titulo).toContain('19')
    expect(observacaoRevogacao(null)).toBeNull()
  })
})

describe('extrairRevogacoesAnexos (CFF)', () => {
  it('detecta linhas marcadas e ignora o resto', () => {
    const out = extrairRevogacoesAnexos({
      itens: [
        { cClassTrib: '200038', descricao: 'Anexo IX', status: 'Vigente' },
        { cClassTrib: '200099', descricao: 'Revogado', situacao: 'Revogado pela Res. X' },
        { anexo: '19', descricao: 'Anexo 19', status: 'INATIVO' },
        { cClassTrib: '200001', descricao: 'Normal' },
      ],
    })
    expect(out).toHaveLength(2)
    expect(out.find((r) => r.alvo === '200099')?.tipo).toBe('cClassTrib')
    expect(out.find((r) => r.alvo === '19')?.tipo).toBe('anexo')
  })

  it('sem marcador explícito nunca revoga', () => {
    expect(extrairRevogacoesAnexos([{ cClassTrib: '200001' }])).toEqual([])
    expect(extrairRevogacoesAnexos(null)).toEqual([])
  })
})

describe('resolvedor com extinto/revogado', () => {
  it('NCM extinto com vínculo cai para regra geral sem redução', async () => {
    const r = await resolverClassificacoes(NCM_EXTINTO)
    expect(r.extinto).toBe(true)
    expect(r.regraGeral).toBe(true)
    expect(r.lista).toHaveLength(1)
    expect(r.lista[0].cst).toBe('000')
    expect(Number(r.lista[0].resumo.percentualReducaoIBS) || 0).toBe(0)
    expect(Number(r.lista[0].resumo.percentualReducaoCBS) || 0).toBe(0)
    // Vínculo histórico preservado para referência.
    expect(r.vinculos).toHaveLength(1)
  })

  it('vínculo de anexo revogado cai para regra geral com revogado anexado', async () => {
    const r = await resolverClassificacoes(NCM_REVOGADO)
    expect(r.regraGeral).toBe(true)
    expect(r.revogado?.alvo).toBe('19')
    expect(r.lista[0].revogado?.alvo).toBe('19')
    expect(Number(r.lista[0].resumo.percentualReducaoIBS) || 0).toBe(0)
  })

  it('vínculo normal e vigente mantém a redução', async () => {
    const r = await resolverClassificacoes(NCM_NORMAL)
    expect(r.regraGeral).toBe(false)
    expect(r.extinto).toBe(false)
    expect(r.revogado).toBeNull()
    expect(r.lista[0].cClassTrib).toBe('200001')
    expect(Number(r.lista[0].resumo.percentualReducaoIBS)).toBe(60)
  })
})
