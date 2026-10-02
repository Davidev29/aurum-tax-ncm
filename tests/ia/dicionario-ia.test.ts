/**
 * QA do dicionário comercial no pipeline (determinístico + fallback IA).
 *
 * Cenário do print: "parmesão" caía em NÃO SEI (`similaridade-insuficiente`)
 * porque a palavra não existe na TEC. Com o pin curado + sinônimo de pool:
 * - "queijo parmesao" (2 termos) → determinístico `alta` em 0406.90.10;
 * - "parmesao" (1 termo) → fallback IA decide 04069010 com
 *   `motivo: 'dicionario-comercial'`, carimbo do resolvedor e veredito de
 *   benefício (CST 200/cClassTrib 200003, redução 100%);
 * - dois pins distintos ("provolone parmesao") continuam NÃO SEI (empate);
 * - ambíguo sem pin ("prato de vidro") continua NÃO SEI.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { classificarPorDescricao } from '@/application/classificacao-inteligente'
import { classificarComIA } from '@/infrastructure/ia/classificacao-ia-repo'
import { invalidarCacheBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'
import { semearBaseIa, soDigitos } from './ajuda-ia'

const NOMEN_QUEIJOS = [
  { codigo: '04', codigoOriginal: '04', descricao: 'Leite e lacticínios; ovos de aves; mel natural.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '0406', codigoOriginal: '04.06', descricao: 'Queijos e requeijão.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04061010', codigoOriginal: '0406.10.10', descricao: 'Mozarela', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04062000', codigoOriginal: '0406.20.00', descricao: 'Queijos ralados ou em pó, de qualquer tipo', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04063000', codigoOriginal: '0406.30.00', descricao: 'Queijos fundidos, exceto ralados ou em pó', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04064000', codigoOriginal: '0406.40.00', descricao: 'Queijos de pasta mofada (azul)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04069010', codigoOriginal: '0406.90.10', descricao: 'Com um teor de umidade inferior a 36,0%, em peso (massa dura)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '04069020', codigoOriginal: '0406.90.20', descricao: 'Com um teor de umidade igual ou superior a 36,0% e inferior a 46,0%, em peso (massa semidura)', dataInicio: null, dataFim: null, ato: 'Ato' },
]

async function semearQueijos(): Promise<void> {
  await semearBaseIa()
  await db.ncmNomenclatura.bulkPut(NOMEN_QUEIJOS as never)
  await db.cstClassTrib.put({
    id: '200|200003', cst: '200', cClassTrib: '200003',
    nome: 'Vendas de produtos destinados à alimentação humana (Anexo I)',
    descricao: 'Vendas de produtos destinados à alimentação humana relacionados no Anexo I',
    lcRedacao: 'Art. 134. Fica zerada a alíquota',
    lcRef: 'Art. 134', tipoAliquota: 'Padrão', pRedIBS: 100, pRedCBS: 100,
    indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0,
    indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null,
    inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
  } as never)
  await db.referencia.put({
    id: '200|200003', cst: '200', cstDescricao: 'Alíquota zerada', cClassTrib: '200003',
    descricao: 'Vendas de produtos destinados à alimentação humana (Anexo I)',
    pRedIBS: 100, pRedCBS: 100, tipoAliquota: 'Padrão', anexo: '1',
    urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art134',
    exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
    diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
    tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
    monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
    simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs: { NFe: true },
  } as never)
  await db.ncm.put({
    id: '04069010|200|200003', codigo: '04069010', codigoFormatado: '0406.90.10',
    cst: '200', cClassTrib: '200003', baseLegal: 'Art. 134',
    reducao: 100, aliquotaIBS: null, aliquotaCBS: null,
    descricao: 'Vendas de produtos destinados à alimentação humana (Anexo I)',
    documentos: 'NFE',
  } as never)
  invalidarCacheBuscaTexto()
}

beforeAll(() => {
  const g = globalThis as unknown as { window?: { aurum?: unknown } }
  if (typeof g.window === 'undefined') g.window = {}
  if (g.window.aurum !== undefined) delete g.window.aurum
})

describe('dicionario no pipeline', () => {
  beforeEach(semearQueijos)

  it('"queijo parmesao" ancora 0406.90.10 no determinístico', async () => {
    const s = await classificarPorDescricao({ descricao: 'queijo parmesao' })
    expect(s.ncm_provavel).toBe('0406.90.10')
    expect(s.confianca).toBe('alta')
    expect(s.trilha.some((t) => t.etapa === 'Dicionário comercial')).toBe(true)
  })

  it('"parmesao" decide 04069010 no fallback com motivo do dicionário', async () => {
    const r = await classificarComIA('parmesao')
    expect(soDigitos(r.codigoEscolhido)).toBe('04069010')
    expect(r.via).toBe('ia')
    expect(r.motivo).toBe('dicionario-comercial')
    expect(r.mock).toBe(true)
    expect(r.decisao).not.toBeNull()
    expect(r.nomenclatura?.codigo).toBe('04069010')
    expect(r.calculo).not.toBeNull()
    expect(r.veredito?.situacao).toBe('beneficio-confirmado')
    expect(r.fontes).toContain('Dicionário comercial (nomes populares → NCM)')
  })

  it('dois pins distintos empatam: "provolone parmesao" é NÃO SEI', async () => {
    const r = await classificarComIA('provolone parmesao')
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
  })

  it('sem pin continua NÃO SEI: "prato de vidro"', async () => {
    const r = await classificarComIA('prato de vidro')
    expect(r.codigoEscolhido).toBeNull()
    expect(r.decisao).toBeNull()
  })
})
