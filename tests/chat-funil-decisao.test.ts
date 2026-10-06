/**
 * Funil desambiguador + subagente de decisão (curadoria multiagente).
 * - 20 consultas curtas DEVEM virar funil (marcador de funil no texto, nunca
 *   "Classificação sugerida"). O funil responde antes do RAG: sem Dexie.
 * - 10 consultas com detalhe DEVEM pular o funil (sem marcador de funil).
 * - 10 pares pergunta→tool do decisor (puro, via detector + sinal do grafo).
 */
import { describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { decidirToolComGrafo, filtrarToolsPossiveis } from '@/application/aurum-ai-decisao'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'

/** Cabeçalho exclusivo do funil (sem-lastro e classificação não têm). */
const MARCA_FUNIL = /Para classificar|O que é exatamente|Entendi que é|Ferro\/aço/i

describe('funil: 20 curtas viram pergunta, nunca chute', () => {
  it.each([
    'frango vivo',
    'boi vivo',
    'porco vivo',
    'cavalo vivo',
    'ovelha viva',
    'carne bovina',
    'coxa de frango',
    'peito de frango',
    'costela bovina',
    'lombo suíno',
    'banana prata',
    'maçã gala',
    'laranja pera',
    'uva verde',
    'manga tommy',
    'chapa aço',
    'barra ferro',
    'tubo aço',
    'aço inox',
    'arame ferro',
  ])('%s → funil', async (q) => {
    const r = await responderChat(`Qual é o NCM de ${q}?`, [])
    expect(r.texto).toMatch(MARCA_FUNIL)
    expect(r.texto).not.toMatch(/Classificação sugerida/)
    expect(r.texto).not.toMatch(/3002\.42\.70/)
  }, 30000)
})

describe('pula-funil: 10 com detalhe não perguntam de novo', () => {
  it.each([
    'Qual é o NCM do boi vivo para reprodução?',
    'coxa de frango congelada',
    'carne bovina resfriada',
    'banana fresca para consumo',
    'uva seca para consumo',
    'vergalhão de aço',
    'tubo de ferro fundido',
    'camiseta 100% algodão para revenda',
    'frango inteiro abatido resfriado',
    'arroz branco polido',
  ])('%s → sem funil', async (q) => {
    const r = await responderChat(`Qual é o NCM de ${q}?`, [])
    expect(r.texto).not.toMatch(MARCA_FUNIL)
  }, 30000)
})

describe('decisor: 10 pares pergunta→tool', () => {
  type Sinal = {
    dominio: 'ncm' | 'nbs' | 'cnae' | null
    candidatosNcm: number
    candidatosNbs: number
    candidatosCnae: number
    temProveniencia: boolean
  }
  const casos: Array<[string, Sinal | null, string, boolean]> = [
    ['tem algum ncm de banana?', null, 'consultarNCM', false],
    [
      'Qual é o NCM do frango vivo para abate?',
      { dominio: 'ncm', candidatosNcm: 3, candidatosNbs: 0, candidatosCnae: 0, temProveniencia: true },
      'consultarNCM',
      true,
    ],
    [
      'qual o NBS para aula de inglês?',
      { dominio: 'nbs', candidatosNcm: 0, candidatosNbs: 2, candidatosCnae: 0, temProveniencia: true },
      'consultarNBS',
      true,
    ],
    ['NBS para programação de computadores?', null, 'consultarNBS', false],
    ['qual anexo do CNAE 6201-5/01?', null, 'consultarCnaeNbs', false],
    [
      'CNAE 0161-0/01 quais NBS e benefícios?',
      { dominio: 'cnae', candidatosNcm: 0, candidatosNbs: 1, candidatosCnae: 2, temProveniencia: true },
      'consultarCnaeNbs',
      true,
    ],
    ['quanto fica R$ 2.500 no NCM 0803.10.00?', null, 'calcularIBSCBS', false],
    [
      'quanto fica R$ 1.000 no NCM 0105.94.00?',
      { dominio: null, candidatosNcm: 0, candidatosNbs: 0, candidatosCnae: 0, temProveniencia: true },
      'calcularIBSCBS',
      true,
    ],
    ['DAS Anexo III, RBT12 500 mil, receita 40 mil', null, 'calcularSimples', false],
    [
      'DAS Anexo III, RBT12 500 mil, receita 40 mil',
      { dominio: null, candidatosNcm: 0, candidatosNbs: 0, candidatosCnae: 0, temProveniencia: true },
      'calcularSimples',
      true,
    ],
  ]
  it.each(casos)('%s → %s (viaGrafo=%s)', (pergunta, sinal, tool, viaGrafo) => {
    const analise = detectarIntencaoChat(pergunta)
    const d = decidirToolComGrafo(analise, pergunta, sinal)
    expect(d.tool).toBe(tool)
    expect(d.viaGrafo).toBe(viaGrafo)
    const { eliminadas } = filtrarToolsPossiveis(analise, pergunta)
    expect(Array.isArray(eliminadas)).toBe(true)
  })
})
