/**
 * Phase 7 — consulta por CNPJ (BrasilAPI mockada + cache + matriz CNAE).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/infrastructure/db/schema'
import { importarBase } from '@/infrastructure/base/base-service'
import { limparCacheBrasilApi } from '@/infrastructure/receita/brasilapi'
import { consultarPorCnpj } from '@/application/consultar-por-cnpj'
import { useServicos } from '@/store/consulta-servicos'

const noop = () => undefined

const REFERENCIA = [
  {
    'Código da Situação Tributária': '200',
    'Descrição da Situação Tributária': 'Alíquota reduzida',
    'Código da Classificação Tributária': '200028',
    'Descrição do Código da Classificação Tributária': 'Fornecimento dos serviços de educação (Anexo II)',
    'Percentual Redução IBS': 60,
    'Percentual Redução CBS': 60,
    'Tipo de Alíquota': '2 - Padrão',
    'Número do Anexo': '2',
    'Url da Legislação': 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art129',
    'Exige Tributação': 'Sim',
    'Redução BC CST': 'Não',
    'Redução de Alíquota': 'Sim',
    'Transferência de Crédito': 'Não',
    Diferimento: 'Não',
    Monofásica: 'Não',
    'Crédito Presumido IBS Zona Franca de Manaus': 'Não',
    'Ajuste de Competência': 'Não',
    'Tributação Regular': 'Não',
    'Crédito Presumido': 'Não',
    'Estorno de Crédito': 'Não',
    'Tributação Monofásica Normal': 'Não',
    'Tributação Monofásica sujeita a retenção': 'Não',
    'Tributação Monofásica retida anteriormente': 'Não',
    'Tributação Monofásica de Combustível com diferimento': 'Não',
    NFSe: 'Sim',
  },
]

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '8599-6/01', 'Descrição oficial': 'Formação de condutores', Situação: 'Permitido', Anexos: 'III / V', 'Fator R': 'Sim' },
  { CNAE: '9001-9/01', 'Descrição oficial': 'Produção teatral', Situação: 'Depende da atividade', Anexos: 'III', 'Fator R': 'Não' },
]

function respostaBrasilApi() {
  return {
    cnpj: '11222333000181',
    razao_social: 'ESCOLA EXEMPLO LTDA',
    nome_fantasia: 'ESCOLA EXEMPLO',
    municipio: 'FORTALEZA',
    uf: 'ce',
    cep: '60000000',
    ddd_telefone_1: '8530000000',
    email: 'a@a.com',
    cnae_fiscal: 8599601,
    cnae_fiscal_descricao: 'Formação de condutores',
    cnaes_secundarios: [
      { codigo: 9001901, descricao: 'Produção teatral' },
      { codigo: 9999999, descricao: 'Inexistente na tabela' },
    ],
    porte: 'MICRO EMPRESA',
    descricao_situacao_cadastral: 'ATIVA',
    opcao_pelo_simples: true,
  }
}

function fetchOk(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

beforeEach(async () => {
  limparCacheBrasilApi()
  await Promise.all([
    db.nbs.clear().catch(() => undefined),
    db.cnae.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
    db.consultasCnpj.clear().catch(() => undefined),
    db.table('ia_feedback').clear().catch(() => undefined),
  ])
  await importarBase(REFERENCIA, 'classificacao_tributaria.json', noop)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
})

describe('consultarPorCnpj', () => {
  it('estado nunca guarda além de 14 dígitos (display mascara, estado não diverge)', () => {
    useServicos.getState().setCnpjEntrada('53.795.990/0001-689 extra')
    expect(useServicos.getState().cnpjEntrada).toBe('53795990000168')
    useServicos.getState().limpar()
    expect(useServicos.getState().cnpjEntrada).toBe('')
  })

  it('DV inválido lança antes da rede', async () => {
    const fetch = fetchOk(respostaBrasilApi())
    await expect(consultarPorCnpj('11222333000182', { fetchFn: fetch as typeof fetch })).rejects.toThrow('dígito verificador')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('classifica o principal, força manual no "depende" e marca desconhecido', async () => {
    const fetch = fetchOk(respostaBrasilApi())
    const v = await consultarPorCnpj('11222333000181', { fetchFn: fetch as typeof fetch })
    expect(v.razaoSocial).toBe('ESCOLA EXEMPLO LTDA')
    expect(v.opcaoSimples).toBe(true)
    expect(v.atividades).toHaveLength(3)

    const principal = v.atividades.find((a) => a.principal)!
    expect(principal.cnae7).toBe('8599601')
    expect(principal.estado).toBe('classificado')
    expect(principal.resultado?.codigoEscolhido).toBe('122011100')
    expect(principal.cnaeTabela?.anexos).toEqual(['III', 'V'])

    const depende = v.atividades.find((a) => a.cnae7 === '9001901')!
    expect(depende.estado).toBe('manual-obrigatorio')
    expect(depende.resultado).toBeNull()

    const desconhecida = v.atividades.find((a) => a.cnae7 === '9999999')!
    expect(desconhecida.estado).toBe('cnae-desconhecido')

    expect(v.resumo.classificadas).toBe(1)
    expect(v.resumo.manualObrigatorio).toBe(1)
    expect(v.resumo.desconhecidas).toBe(1)
  })

  it('segunda consulta usa o cache (sem nova rede)', async () => {
    const fetch = fetchOk(respostaBrasilApi())
    await consultarPorCnpj('11222333000181', { fetchFn: fetch as typeof fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    const v2 = await consultarPorCnpj('11.222.333/0001-81', { fetchFn: fetch as typeof fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(v2.doCache).toBe(true)
  })

  it('CNAE de serviço sem benefício vira tributação integral (sem chute)', async () => {
    await db.cnae.put({
      codigo7: '6201501',
      codigoFormatado: '6201-5/01',
      descricao: 'Desenvolvimento de programas de computador sob encomenda',
      situacao: 'Permitido',
      anexos: ['III'],
      fatorR: false,
    })
    const body = { ...respostaBrasilApi(), cnae_fiscal: 6201501, cnae_fiscal_descricao: 'Software', cnaes_secundarios: [] }
    const v = await consultarPorCnpj('11222333000181', { fetchFn: fetchOk(body) as unknown as typeof fetch })
    const atv = v.atividades.find((a) => a.cnae7 === '6201501')!
    expect(atv.estado).toBe('tributacao-integral')
    expect(v.resumo.tributacaoIntegral).toBe(1)
  })
})
