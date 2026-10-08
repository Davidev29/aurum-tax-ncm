/**
 * Entrada robusta — o chat entende qualquer formulação:
 * typos/abreviações, molduras genéricas ("você sabe me dizer..."),
 * follow-ups de contexto ("e para revenda?") e multi-intenção
 * ("ncm de banana e quanto fica 2 mil").
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  detectarIntencaoChat,
  despirAndaime,
  extrairNucleoBusca,
  normalizarEntrada,
} from '@/domain/services/detector-chat'
import {
  extrairContextoConversa,
  refinarIntencaoComContexto,
} from '@/application/aurum-ai-tools'
import { responderChat } from '@/application/aurum-ai-chat'
import { db } from '@/infrastructure/db/schema'

beforeEach(async () => {
  await Promise.all([
    db.ncm.clear().catch(() => undefined),
    db.ncmNomenclatura.clear().catch(() => undefined),
  ])
})

describe('normalização de entrada (typos + abreviações)', () => {
  it('"vc sabe?" → "voce sabe?"', () => {
    expect(normalizarEntrada('vc sabe o ncm de banana?')).toContain('voce')
  })
  it('"cunsulta" → "consulta"', () => {
    expect(normalizarEntrada('cunsulta ncm banana')).toContain('consulta')
  })
  it('"tributasao" → "tributacao"', () => {
    expect(normalizarEntrada('qual a tributasao de banana?')).toContain('tributacao')
  })
  it('"obg" → "obrigado" (conversa leve com typo)', () => {
    expect(detectarIntencaoChat('obg!').intencao).toBe('conversa_leve')
  })
  it('"cunsulta ncm banana" roteia para ncm', () => {
    expect(detectarIntencaoChat('cunsulta ncm banana').intencao).toBe('ncm')
  })
})

describe('andaime genérico (molduras não previstas)', () => {
  it('"preciso do ncm para parafuso" → "parafuso"', () => {
    expect(despirAndaime('preciso do ncm para parafuso')).toBe('parafuso')
  })
  it('"você sabe me dizer ... queijo minas" → "queijo minas"', () => {
    expect(despirAndaime('você sabe me dizer qual é a tributação de queijo minas')).toBe('queijo minas')
  })
  it('produto puro não é tocado', () => {
    expect(despirAndaime('camiseta de algodão')).toBe('camiseta de algodão')
  })
  it('núcleo: "você sabe me dizer qual é a tributação de queijo minas?"', () => {
    expect(extrairNucleoBusca('você sabe me dizer qual é a tributação de queijo minas?')).toBe('queijo minas')
  })
  it('núcleo: "preciso do ncm para parafuso sextavado"', () => {
    expect(extrairNucleoBusca('preciso do ncm para parafuso sextavado')).toBe('parafuso sextavado')
  })
  it('núcleo: "gostaria de saber o nbs de aula de yoga"', () => {
    expect(extrairNucleoBusca('gostaria de saber o nbs de aula de yoga')).toBe('aula de yoga')
  })
  it('núcleo corta a cauda de cálculo ("...e quanto fica 2 mil")', () => {
    expect(extrairNucleoBusca('quero o ncm de banana e quanto fica 2 mil')).toBe('banana')
  })
  it('"gostaria de saber o nbs de aula de yoga" → nbs', () => {
    expect(detectarIntencaoChat('gostaria de saber o nbs de aula de yoga').intencao).toBe('nbs')
  })
})

describe('contexto: assunto + refino', () => {
  const hist = [
    { papel: 'user' as const, texto: 'qual o ncm de tangerina?' },
    { papel: 'assistant' as const, texto: 'NCM 0805.21.00 ...' },
  ]
  it('contexto guarda assunto e domínio', () => {
    const ctx = extrairContextoConversa(hist)
    expect(ctx.ultimoAssunto).toBe('tangerina')
    expect(ctx.ultimoDominio).toBe('ncm')
  })
  it('"e para revenda?" herda o assunto (vira ncm de tangerina)', () => {
    const det = detectarIntencaoChat('e para revenda?')
    expect(det.intencao).toBe('generico')
    const ref = refinarIntencaoComContexto(det, 'e para revenda?', hist)
    expect(ref.intencao).toBe('ncm')
    expect(ref.termoBusca).toBe('tangerina')
  })
})

describe('multi-intenção (classifica + calcula)', () => {
  it('"ncm de banana e quanto fica 2 mil" é cálculo com valor', () => {
    const a = detectarIntencaoChat('quero o ncm de banana e quanto fica 2 mil')
    expect(a.intencao).toBe('calculo')
    expect(a.valorBase).toBe(2000)
  })
  it('classifica e calcula na mesma resposta', async () => {
    await db.ncmNomenclatura.put({
      codigo: '08031000',
      codigoOriginal: '0803.10.00',
      descricao: 'Bananas frescas',
      dataInicio: null,
      dataFim: null,
      ato: null,
    } as never)
    await db.ncm.put({
      id: '08031000-000-000001',
      codigo: '08031000',
      codigoFormatado: '0803.10.00',
      cst: '000',
      cClassTrib: '000001',
      baseLegal: 'LC 214/2025',
      reducao: 0,
      aliquotaIBS: null,
      aliquotaCBS: null,
      descricao: '',
      documentos: '',
    } as never)
    const r = await responderChat('quero o ncm de banana e quanto fica 2 mil')
    expect(r.texto).toContain('0803.10.00')
    expect(r.texto).toContain('2.000')
  }, 20000)
})
