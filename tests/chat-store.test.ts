import { beforeEach, describe, expect, it } from 'vitest'
import { useChat } from '@/store/chat'

const BOOT = {
  id: 0,
  papel: 'assistant' as const,
  texto: 'boot',
  quando: new Date().toISOString(),
}

beforeEach(() => {
  useChat.setState({ mensagens: [BOOT], conversaId: 'conv-1', arquivadas: [], enviando: false })
})

describe('chat store — espelho desde a 1ª mensagem', () => {
  it('primeira troca já aparece nas arquivadas', async () => {
    await useChat.getState().enviar('oi')
    const s = useChat.getState()
    expect(s.mensagens.length).toBe(3)
    expect(s.arquivadas.length).toBe(1)
    expect(s.arquivadas[0].id).toBe('conv-1')
    expect(s.arquivadas[0].titulo).toBe('oi')
  }, 15000)

  it('novas mensagens atualizam o espelho sem duplicar', async () => {
    await useChat.getState().enviar('oi')
    await useChat.getState().enviar('obrigado!')
    const s = useChat.getState()
    expect(s.mensagens.length).toBe(5)
    expect(s.arquivadas.length).toBe(1)
    expect(s.arquivadas[0].mensagens.length).toBe(5)
  }, 15000)

  it('nova() abre telinha limpa sem perder o arquivo', async () => {
    await useChat.getState().enviar('oi')
    useChat.getState().nova()
    const s = useChat.getState()
    expect(s.mensagens.length).toBe(1)
    expect(s.mensagens.every((m) => m.papel === 'assistant')).toBe(true)
    expect(s.arquivadas.length).toBe(1)
    expect(s.conversaId).not.toBe('conv-1')
  }, 15000)

  it('restaurar troca sem duplicar nem sumir da lista', async () => {
    await useChat.getState().enviar('oi')
    useChat.getState().nova()
    await useChat.getState().enviar('tchau')
    const meio = useChat.getState()
    expect(meio.arquivadas.length).toBe(2)
    const idPrimeira = meio.arquivadas.find((a) => a.titulo === 'oi')!.id
    useChat.getState().restaurar(idPrimeira)
    const s = useChat.getState()
    expect(s.conversaId).toBe(idPrimeira)
    expect(s.mensagens.some((m) => m.texto === 'oi')).toBe(true)
    expect(s.arquivadas.length).toBe(2)
    expect(new Set(s.arquivadas.map((a) => a.id)).size).toBe(2)
  }, 15000)

  it('resposta simples não cita origem; lote cita', async () => {
    await useChat.getState().enviar('oi')
    const s1 = useChat.getState()
    const resp1 = s1.mensagens[s1.mensagens.length - 1]
    expect(resp1.papel).toBe('assistant')
    expect(resp1.emRespostaA ?? null).toBeNull()
    useChat.getState().nova()
    await useChat.getState().enviarLote(['primeira pergunta', 'segunda pergunta'])
    const s2 = useChat.getState()
    const resps = s2.mensagens.filter((m) => m.papel === 'assistant' && m.emRespostaA)
    expect(resps.length).toBe(2)
  }, 30000)
})
