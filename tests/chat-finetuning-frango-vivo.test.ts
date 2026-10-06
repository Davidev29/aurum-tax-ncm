import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { responderChat } from '@/application/aurum-ai-chat'
import { decidirToolComGrafo, filtrarToolsPossiveis } from '@/application/aurum-ai-decisao'
import { detectarIntencaoChat } from '@/domain/services/detector-chat'
import { sanitizarLivre, sanitizarAbertura } from '@/application/aurum-ai-livre'
import { db } from '@/infrastructure/db/schema'

const RAIZ = process.cwd()

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear().catch(() => null),
    db.ncmNomenclatura.clear().catch(() => null),
    db.cst.clear().catch(() => null),
    db.cstClassTrib.clear().catch(() => null),
  ])
  try {
    const { invalidarCacheBuscaTexto } = await import('@/infrastructure/base/classificacao-repo')
    invalidarCacheBuscaTexto()
    const { invalidarCacheFichaAbsoluta } = await import('@/application/aurum-ai-contexto')
    invalidarCacheFichaAbsoluta()
  } catch { /* best-effort */ }
  // Hierarquia mínima para "frango vivo": 01 (vivos) → 0105 (aves vivas) →
  // 0105.94.00 (Gallus) + rival 3002.42.70 (vacina com "vírus vivo").
  await db.ncmNomenclatura.bulkPut([
    { codigo: '01', codigoOriginal: '01', descricao: 'Animais vivos', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '0105', codigoOriginal: '01.05', descricao: 'Aves da especie Gallus domesticus, vivas', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '010594', codigoOriginal: '0105.94', descricao: 'Aves da especie Gallus domesticus, vivas', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '01059400', codigoOriginal: '0105.94.00', descricao: 'Aves da especie Gallus domesticus', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '30', codigoOriginal: '30', descricao: 'Produtos farmaceuticos', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '3002', codigoOriginal: '30.02', descricao: 'Vacinas para medicina veterinaria', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '300242', codigoOriginal: '3002.42', descricao: 'Vacinas contra enfermidades de aves', dataInicio: null, dataFim: null, ato: 'TEC' },
    { codigo: '30024270', codigoOriginal: '3002.42.70', descricao: 'Contra as seguintes enfermidades: de Newcastle, a virus vivo ou virus inativo', dataInicio: null, dataFim: null, ato: 'TEC' },
  ]).catch(() => null)
  await db.cstClassTrib.bulkPut([
    { id: '200|200038', cst: '200', cClassTrib: '200038', nome: 'Insumos agropecuarios', descricao: 'Fornecimento de insumos agropecuarios', lcRedacao: null, lcRef: 'Art. 136', tipoAliquota: 'Reduzida', pRedIBS: 60, pRedCBS: 60, indRedutorBC: 0, indTribRegular: 0, indCredPres: 0, indMono: 0, indMonoReten: 0, indMonoRet: 0, indMonoDif: 0, creditoPara: null, inicioVigencia: null, fimVigencia: null, atualizadoEm: null },
  ]).catch(() => null)
  await db.ncm.bulkPut([
    { id: '01059400|200|200038', codigo: '01059400', codigoFormatado: '0105.94.00', cst: '200', cClassTrib: '200038', baseLegal: 'LC 214/2025', reducao: null, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '' },
    { id: '30024270|200|200038', codigo: '30024270', codigoFormatado: '3002.42.70', cst: '200', cClassTrib: '200038', baseLegal: 'LC 214/2025', reducao: null, aliquotaIBS: null, aliquotaCBS: null, descricao: '', documentos: '' },
  ]).catch(() => null)
})

describe('regressão Frango Vivo + decisão multiagente', () => {
  it('finetuning-6000 existe com 6000 consultas válidas (60 âncoras × 100)', () => {
    const p = join(RAIZ, 'recursos-ia', 'conhecimento', 'finetuning-6000.json')
    expect(existsSync(p)).toBe(true)
    const arr = JSON.parse(readFileSync(p, 'utf8'))
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBeGreaterThanOrEqual(6000)
    // Âncoras obrigatórias + expansão multiagente presentes
    const textos: string[] = arr.map((r: { consulta: string }) => String(r.consulta).toLowerCase())
    expect(textos.some((t: string) => t.includes('frango vivo para abate'))).toBe(true)
    expect(textos.some((t: string) => t.includes('banana fresca'))).toBe(true)
    expect(textos.some((t: string) => t.includes('pintinho de um dia'))).toBe(true)
    expect(textos.some((t: string) => t.includes('parafuso sextavado'))).toBe(true)
    expect(textos.some((t: string) => t.includes('roteador wifi'))).toBe(true)
    // 60 NCMs distintos
    const ncms = new Set(arr.map((r: { ncm: string }) => String(r.ncm).replace(/\D+/g, '')))
    expect(ncms.size).toBeGreaterThanOrEqual(60)
    for (const r of arr.slice(0, 50)) {
      expect(String(r.ncm).replace(/\D+/g, '')).toMatch(/^\d{8}$/)
    }
  })

  it('"Qual é o NCM do Frango Vivo?" vira funil (pergunta o que é), nunca 3002', async () => {
    const r = await responderChat('Qual é o NCM do Frango Vivo?', [])
    expect(r.texto).toMatch(/animal vivo|o que é/i)
    expect(r.texto).toMatch(/destina/i)
    expect(r.texto).not.toMatch(/3002\.42\.70|30024270/)
    expect(r.texto).not.toMatch(/Classificação sugerida/)
    expect(r.texto).not.toMatch(/Thinking Process:/i)
    expect(r.texto).not.toMatch(/<think>/i)
  }, 30000)

  it('"frango vivo para abate" classifica no cap. 01, nunca vacina 3002', async () => {
    const r = await responderChat('Qual é o NCM do frango vivo para abate?', [])
    // Com destinação, o funil é pulado e a classificação acontece.
    expect(r.texto).toMatch(/Classificação sugerida: NCM 01/)
    expect(r.texto).not.toMatch(/3002\.42\.70|30024270/)
    // Header e justificativa falam do MESMO NCM (anti-contradição).
    const header = r.texto.match(/Classificação sugerida: NCM (\d{4}\.\d{2}\.\d{2})/)
    expect(header).not.toBeNull()
    const codHeader = header![1]
    expect(r.texto).toContain(`Posição ${codHeader}`)
  }, 60000)

  it('resposta fiscal é direta: sem saudação e sem thinking', async () => {
    const r = await responderChat('Qual é o NCM do frango vivo para abate?', [])
    expect(r.texto).not.toMatch(/^(bom dia|boa tarde|boa noite|olá|oi)[,! ]/i)
    expect(r.texto).not.toMatch(/Thinking Process:/i)
    expect(r.texto).not.toMatch(/<think>/i)
    expect(r.texto).not.toMatch(/why i (chose|choose)/i)
    expect(r.viaModelo).toBe(false)
  }, 60000)

  it('sanitização remove Thinking Process do modelo', () => {
    const sujo = 'Thinking Process:\n1. blah\nOlá, tudo bem por aqui'
    const limpoLivre = sanitizarLivre(sujo, { codigos: [], valores: [] })
    expect(limpoLivre).not.toBeNull()
    expect(String(limpoLivre)).not.toMatch(/thinking process/i)
    // Abertura fiscal nunca carrega número: com thinking + texto simples, o
    // thinking some e sobra a frase.
    const abertura = sanitizarAbertura('Thinking Process: rascunho interno\nTudo bem por aqui')
    expect(abertura).not.toBeNull()
    expect(String(abertura)).not.toMatch(/thinking process/i)
  })

  it('subagente de decisão: grafo resolve o tool calling (NCM × NBS)', () => {
    const analise = detectarIntencaoChat('Qual é o NCM do frango vivo para abate?')
    const decisao = decidirToolComGrafo(analise, 'Qual é o NCM do frango vivo para abate?', {
      dominio: 'ncm',
      candidatosNcm: 3,
      candidatosNbs: 0,
      candidatosCnae: 0,
      temProveniencia: true,
    })
    expect(decisao.tool).toBe('consultarNCM')
    expect(decisao.viaGrafo).toBe(true)
    expect(decisao.motivo).toMatch(/grafo/i)

    const { eliminadas } = filtrarToolsPossiveis(analise, 'Qual é o NCM do frango vivo para abate?')
    expect(Array.isArray(eliminadas)).toBe(true)
  })
})
