/**
 * Classificação inteligente por descrição — testes de ancoragem oficial.
 *
 * Invariantes:
 * - o NCM sugerido SEMPRE existe na nomenclatura semeada (nunca inventado);
 * - exceção só com vínculo real na base (CST/cClassTrib com benefício);
 * - os 3 exemplos do prompt com expectativas CORRIGIDAS pela base vigente:
 *   "0102.10.00" do prompt é NCM extinto (a TEC vigente desmembrou o 01.02);
 *   suspensão de PIS/COFINS (Lei 12.350/10) não existe na LC 214/2025.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  analisarDescricao,
  calcularConfianca,
  consultasEfetivas,
  extrairSinais,
  perguntasComplementares,
} from '@/domain/services/classificador-descricao'
import { classificarPorDescricao } from '@/application/classificacao-inteligente'
import { invalidarCacheBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

const NOMEN = [
  { codigo: '01', codigoOriginal: '01', descricao: 'Animais vivos.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '0102', codigoOriginal: '01.02', descricao: 'Animais vivos da espécie bovina.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '010229', codigoOriginal: '0102.29', descricao: '-- Outros (bovinos domésticos)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '01022919', codigoOriginal: '0102.29.19', descricao: 'Outros, para reprodução', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10', codigoOriginal: '10', descricao: 'Cereais', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '1005', codigoOriginal: '10.05', descricao: 'Milho.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10051000', codigoOriginal: '1005.10.00', descricao: 'Para semeadura (sementeira)', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '10059010', codigoOriginal: '1005.90.10', descricao: 'Em grão', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23', codigoOriginal: '23', descricao: 'Resíduos das indústrias alimentares; alimentos para animais', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '2309', codigoOriginal: '23.09', descricao: 'Preparações do tipo utilizado na alimentação de animais.', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23091000', codigoOriginal: '2309.10.00', descricao: 'Alimentos para cães ou gatos, acondicionados para venda a retalho', dataInicio: null, dataFim: null, ato: 'Ato' },
  { codigo: '23099090', codigoOriginal: '2309.90.90', descricao: 'Outras', dataInicio: null, dataFim: null, ato: 'Ato' },
]

const vinculo = (codigo: string, cst: string, cClassTrib: string, descricao: string) => ({
  id: `${codigo}|${cst}|${cClassTrib}`,
  codigo,
  codigoFormatado: codigo,
  cst,
  cClassTrib,
  baseLegal: descricao,
  reducao: 60,
  aliquotaIBS: null,
  aliquotaCBS: null,
  descricao,
  documentos: 'NFE',
})

async function semear() {
  await db.ncmNomenclatura.clear()
  await db.ncm.clear()
  await db.cst.clear()
  await db.cstClassTrib.clear()
  await db.referencia.clear()
  invalidarCacheBuscaTexto()
  await db.ncmNomenclatura.bulkPut(NOMEN)
  await db.cst.put({
    codigo: '200',
    descricao: 'Alíquota reduzida',
    indIBSCBS: true,
    indIBSCBSMono: false,
    indReducao: true,
    indDiferimento: false,
    indTransferenciaCredito: false,
    docs: { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false },
  })
  await db.cstClassTrib.bulkPut([
    {
      id: '200|200034', cst: '200', cClassTrib: '200034',
      nome: 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)',
      descricao: 'Fornecimento dos alimentos destinados ao consumo humano relacionados no Anexo VII',
      lcRedacao: 'Art. 135. Ficam reduzidas em 60% as alíquotas do IBS e da CBS',
      lcRef: 'Art. 135', tipoAliquota: 'Padrão', pRedIBS: 60, pRedCBS: 60,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0,
      indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null,
      inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
    {
      id: '200|200038', cst: '200', cClassTrib: '200038',
      nome: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
      descricao: 'Fornecimento dos insumos agropecuários e aquícolas relacionados no Anexo IX',
      lcRedacao: 'Art. 138. Ficam reduzidas em 60% as alíquotas do IBS e da CBS',
      lcRef: 'Art. 138', tipoAliquota: 'Padrão', pRedIBS: 60, pRedCBS: 60,
      indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0,
      indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null,
      inicioVigencia: null, fimVigencia: null, atualizadoEm: null,
    },
  ])
  // Milho-semente com DUPLO vínculo (Anexo VII + Anexo IX), como na base real.
  await db.ncm.bulkPut([
    vinculo('10051000', '200', '200034', 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)'),
    vinculo('10051000', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
    vinculo('23091000', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
    vinculo('23099090', '200', '200038', 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)'),
  ])
  const docs = { NFe: true, NFCe: true, CTe: false, CTeOS: false, BPe: false, BPeTM: false, NF3e: false, NFCom: false, NFSe: false }
  await db.referencia.bulkPut([
    {
      id: '200|200034', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200034',
      descricao: 'Fornecimento dos alimentos destinados ao consumo humano (Anexo VII)',
      pRedIBS: 60, pRedCBS: 60, tipoAliquota: 'Padrão', anexo: '7',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art135',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs,
    },
    {
      id: '200|200038', cst: '200', cstDescricao: 'Alíquota reduzida', cClassTrib: '200038',
      descricao: 'Fornecimento dos insumos agropecuários e aquícolas (Anexo IX)',
      pRedIBS: 60, pRedCBS: 60, tipoAliquota: 'Padrão', anexo: '9',
      urlLegislacao: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art138',
      exigeTributacao: true, reducaoBC: false, reducaoAliquota: true, transferenciaCredito: false,
      diferimento: false, monofasica: false, creditoPresumidoZFM: false, ajusteCompetencia: false,
      tributacaoRegular: false, creditoPresumido: false, estornoCredito: false,
      monoNormal: false, monoRetencao: false, monoRetida: false, monoDiferimentoCombustivel: false,
      simplesReceitaBruta: null, regimeContribuicaoSocial: null, impostoBensServicos: null, docs,
    },
  ])
}

describe('analisarDescricao (pura)', () => {
  it('infere vivo + capítulo 01 a partir de "reprodutor" mesmo sem "vivo"', () => {
    const a = analisarDescricao({ descricao: 'Boi da raça Nelore para reprodução' })
    expect(a.sinais).toContain('VIVO')
    expect(a.sinais).toContain('REPRODUTOR')
    expect(a.capitulosPrioritarios).toContain('01')
    expect(a.insuficiente).toBe(false)
  })

  it('detecta condição de risco do sal em ração', () => {
    const a = analisarDescricao({ descricao: 'Ração para cães com adição de sal' })
    expect(a.sinais).toContain('RACAO_ANIMAL')
    expect(a.sinais).toContain('SAL_ADICIONADO')
    expect(a.ambiguidades.length).toBeGreaterThan(0)
    // A consulta-núcleo remove o sal para achar o produto-base.
    const efetivas = consultasEfetivas(a)
    expect(efetivas.some((c) => !c.includes('sal'))).toBe(true)
  })

  it('extrai sinais de semente/plantio e prioriza capítulo 10', () => {
    expect(extrairSinais(['semente', 'milho', 'plantio'])).toContain('SEMENTE_PLANTIO')
    const a = analisarDescricao({ descricao: 'Semente de milho híbrido para plantio' })
    expect(a.capitulosPrioritarios).toContain('10')
  })

  it('marca entrada insuficiente e pede composição/destinação', () => {
    const a = analisarDescricao({ descricao: 'sal' })
    expect(a.insuficiente).toBe(true)
    expect(perguntasComplementares(a).join(' ')).toMatch(/composi/i)
  })

  it('confiança: sem candidato é baixa; risco trava no máximo média', () => {
    expect(calcularConfianca({ totalCandidatos: 0, margemTopo: 0, tokensUteis: 3, temCondicaoRisco: false })).toBe('baixa')
    expect(calcularConfianca({ totalCandidatos: 1, margemTopo: 999, tokensUteis: 4, temCondicaoRisco: true })).toBe('media')
    expect(calcularConfianca({ totalCandidatos: 1, margemTopo: 999, tokensUteis: 4, temCondicaoRisco: false })).toBe('alta')
  })
})

describe('classificarPorDescricao (ancorada na base)', () => {
  beforeEach(semear)

  it('semente de milho → 1005.10.00 com exceção (Anexo VII e/ou IX), confiança alta', async () => {
    const r = await classificarPorDescricao({ descricao: 'Semente de milho híbrido para plantio' })
    expect(r.ncm_provavel).toBe('1005.10.00')
    expect(r.excecao_enquadravel).toBe(true)
    expect(r.tipo_excecao).toMatch(/Anexo (VII|IX)/)
    expect(r.justificativa).toMatch(/Art\. 13[58]/)
    expect(r.confianca).toBe('alta')
    expect(r.cst).toBe('200')
  })

  it('ração com sal → 2309 com vínculo, mas confiança média + alerta de composição', async () => {
    const r = await classificarPorDescricao({ descricao: 'Ração para cães com adição de sal' })
    expect(r.ncm_provavel).toMatch(/^2309\./)
    // Vínculo oficial existe (Anexo IX) — o sal vira ALERTA, não negação da base.
    expect(r.excecao_enquadravel).toBe(true)
    expect(r.confianca).toBe('media')
    expect(r.justificativa).toMatch(/sal/i)
    expect(r.perguntasComplementares.join(' ')).toMatch(/sal/i)
  })

  it('boi vivo reprodutor → capítulo 01 SEM inventar exceção (0102.10.00 do prompt é extinto)', async () => {
    const r = await classificarPorDescricao({ descricao: 'Boi vivo da raça Nelore para reprodução' })
    expect(r.ncm_provavel?.replace(/\D+/g, '').slice(0, 2)).toBe('01')
    // Sem vínculo na base semeada: resposta honesta é regra geral, sem exceção.
    expect(r.excecao_enquadravel).toBe(false)
    expect(r.tipo_excecao).toBeNull()
    expect(r.ncm_provavel).not.toBe('0102.10.00')
    expect(r.justificativa).toMatch(/Sem vínculo específico|tributação integral/)
  })

  it('descrição insuficiente → null + baixa + pergunta', async () => {
    const r = await classificarPorDescricao({ descricao: 'coisa' })
    expect(r.ncm_provavel).toBeNull()
    expect(r.confianca).toBe('baixa')
    expect(r.perguntasComplementares.length).toBeGreaterThan(0)
  })

  it('sem match na nomenclatura → null + baixa (nunca inventa NCM)', async () => {
    const r = await classificarPorDescricao({ descricao: 'nave espacial alienígena interestelar' })
    expect(r.ncm_provavel).toBeNull()
    expect(r.excecao_enquadravel).toBe(false)
    expect(r.confianca).toBe('baixa')
  })

  it('todo NCM sugerido existe na nomenclatura (alternativas incluídas)', async () => {
    const r = await classificarPorDescricao({ descricao: 'milho para semeadura' })
    const todos = [r.ncm_provavel, ...r.alternativas].filter(Boolean) as string[]
    expect(todos.length).toBeGreaterThan(0)
    for (const cod of todos) {
      const digitos = cod.replace(/\D+/g, '')
      expect(await db.ncmNomenclatura.get(digitos)).not.toBeUndefined()
    }
  })
})
