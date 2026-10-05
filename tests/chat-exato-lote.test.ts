import { beforeEach, describe, expect, it } from 'vitest'
import { responderChat } from '@/application/aurum-ai-chat'
import { detectarIntencaoChat, extrairCnae } from '@/domain/services/detector-chat'
import { importarBase } from '@/infrastructure/base/base-service'
import { invalidarCacheBuscaTexto, invalidarCacheBuscaTextoNbs } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

const noop = () => undefined

const NBS_VIVO = [
  { NBS: '122011100', CST: '200', CclassTrib: '200028', 'Base Legal': 'Fornecimento dos serviços de educação (Anexo II)', Redução: 0.6, 'Aliq. IBS': 0.0004, 'Aliq. CBS': 0.0036, 'DFes Relac.': 'NFSE', 'Descrição completa': 'Serviços de educação do Anexo II.' },
]

const CNAE_VIVO = [
  { CNAE: '6201-5/01', 'Descrição oficial': 'Desenvolvimento de programas de computador sob encomenda', Situação: 'Permitido com ressalvas', Anexos: 'III / V', 'Fator R': 'Sim' },
]

beforeEach(async () => {
  invalidarCacheBuscaTexto()
  invalidarCacheBuscaTextoNbs()
  await Promise.all([
    db.ncm.clear().catch(() => undefined),
    db.ncmNomenclatura.clear().catch(() => undefined),
    db.nbs.clear().catch(() => undefined),
    db.cnae.clear().catch(() => undefined),
    db.referencia.clear().catch(() => undefined),
    db.cst.clear().catch(() => undefined),
    db.cstClassTrib.clear().catch(() => undefined),
  ])
  await db.ncmNomenclatura.put({
    codigo: '08031000',
    codigoOriginal: '0803.10.00',
    descricao: 'Bananas-da-terra (Bananas-pão*) (Plátanos*)',
    dataInicio: null,
    dataFim: null,
    ato: null,
  } as never)
  await importarBase(NBS_VIVO, 'NBS SERVIÇOS.json', noop)
  await importarBase(CNAE_VIVO, 'CNAE X ANEXO.json', noop)
})

describe('chat exato — sem nível de confiança quando 100% match', () => {
  it('NCM exato não mostra confiança', async () => {
    const r = await responderChat('08031000')
    expect(r.tipoCodigo).toBe('ncm')
    expect(r.exato).toBe(true)
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toContain('0803.10.00')
  }, 15000)

  it('NBS exato não mostra confiança', async () => {
    const r = await responderChat('122011100')
    expect(r.tipoCodigo).toBe('nbs')
    expect(r.exato).toBe(true)
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toContain('122.011.100')
  }, 15000)

  it('CNAE exato mostra Anexo do Simples sem confiança', async () => {
    const r = await responderChat('CNAE 6201-5/01 qual anexo?')
    expect(r.tipoCodigo).toBe('cnae')
    expect(r.exato).toBe(true)
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toMatch(/Anexo Simples/)
  }, 15000)

  it('NCM inexistente vira funil (do que se trata), sem confiança', async () => {
    const r = await responderChat('99999999')
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toMatch(/Do que se trata/i)
  }, 15000)

  it('NBS inexistente vira funil (do que se trata), sem confiança', async () => {
    const r = await responderChat('999999999')
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toMatch(/Do que se trata/i)
  }, 15000)

  it('CNAE inexistente vira funil (do que se trata), sem confiança', async () => {
    const r = await responderChat('CNAE 9999-9/99 qual anexo?')
    expect(r.texto).not.toMatch(/confian[aç]a/i)
    expect(r.texto).toMatch(/Do que se trata/i)
  }, 15000)
})

describe('detector CNAE', () => {
  it('extrai CNAE formatado', () => {
    expect(extrairCnae('CNAE 6201-5/01 qual anexo?')).toBe('6201501')
    expect(extrairCnae('6201-5/01')).toBe('6201501')
  })

  it('intenção cnae para pergunta de anexo', () => {
    const a = detectarIntencaoChat('CNAE 6201-5/01 qual anexo?')
    expect(a.intencao).toBe('cnae')
    expect(a.cnae).toBe('6201501')
  })
})

describe('fila de lote — responde em ordem indicando a origem', () => {
  it('envios em sequência viram respostas próprias com emRespostaA', async () => {
    const { useChat } = await import('@/store/chat')
    useChat.setState({
      mensagens: [{ id: 0, papel: 'assistant', texto: 'boot', quando: new Date().toISOString() }],
      conversaId: 'conv-lote',
      arquivadas: [],
      fila: [],
      enviando: false,
    })
    // Dispara 2 sem aguardar (lote): nenhuma pode ser descartada.
    const p1 = useChat.getState().enviar('oi')
    const p2 = useChat.getState().enviar('obrigado!')
    await Promise.all([p1, p2])
    const s = useChat.getState()
    const users = s.mensagens.filter((m) => m.papel === 'user')
    const assistants = s.mensagens.filter((m) => m.papel === 'assistant' && m.emRespostaA)
    expect(users).toHaveLength(2)
    expect(assistants).toHaveLength(2)
    expect(assistants[0].emRespostaA?.texto).toContain('oi')
    expect(assistants[1].emRespostaA?.texto).toContain('obrigado')
    expect(s.fila).toHaveLength(0)
    expect(s.enviando).toBe(false)
  }, 20000)

  it('enviarLote processa todas em ordem', async () => {
    const { useChat } = await import('@/store/chat')
    useChat.setState({
      mensagens: [{ id: 0, papel: 'assistant', texto: 'boot', quando: new Date().toISOString() }],
      conversaId: 'conv-lote-2',
      arquivadas: [],
      fila: [],
      enviando: false,
    })
    await useChat.getState().enviarLote(['oi', 'tchau'])
    const s = useChat.getState()
    expect(s.mensagens.filter((m) => m.papel === 'user')).toHaveLength(2)
    expect(s.mensagens.filter((m) => m.papel === 'assistant' && m.emRespostaA)).toHaveLength(2)
  }, 20000)
})
