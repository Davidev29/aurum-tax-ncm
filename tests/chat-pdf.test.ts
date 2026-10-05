/**
 * PDF do chat (Aurum AI) — documento timbrado de conversa e cálculo.
 */
import { describe, expect, it } from 'vitest'
import { EMITENTE_PADRAO } from '@/domain/entities'
import { limparMarkdownChat, montarDocumentoChatPDF } from '@/application/aurum-ai-chat-pdf'
import { montarRelatorioCalculo, montarRelatorioConversa } from '@/application/aurum-ai-chat'

describe('chat-pdf', () => {
  it('limpa marcadores markdown para o PDF', () => {
    expect(limparMarkdownChat('**CNPJ 11.222.333/0001-81** — `6201`')).toBe('CNPJ 11.222.333/0001-81 — 6201')
  })
  it('stub pdf nos builders em memória', () => {
    const conv = montarRelatorioConversa(
      { historico: [{ papel: 'user', texto: 'oi' }], pergunta: 'relatorio', geradoEm: 'agora' },
      'pdf',
    )
    expect(conv.nome).toMatch(/\.pdf$/)
    expect(conv.mime).toBe('application/pdf')
    const calc = montarRelatorioCalculo({ codigo: '08031000', base: 1000, ibs: 10, cbs: 5, total: 15 }, 'pdf')
    expect(calc.nome).toMatch(/\.pdf$/)
    expect(calc.mime).toBe('application/pdf')
  })
  it('documento de cálculo tem timbrado + tabela NCM', () => {
    const doc = montarDocumentoChatPDF(
      'calculo',
      { codigo: '08031000', base: 1000, ibs: 10, cbs: 5, total: 15 },
      EMITENTE_PADRAO,
    )
    expect(doc.header).toBeDefined()
    expect(doc.footer).toBeDefined()
    expect(JSON.stringify(doc.content)).toContain('0803.10.00')
  })
  it('documento de conversa lista as mensagens sem markdown', () => {
    const doc = montarDocumentoChatPDF(
      'conversa',
      {
        historico: [
          { papel: 'user', texto: 'Quais atividades o CNPJ tem?' },
          { papel: 'assistant', texto: '**CNPJ 11.222.333/0001-81** — Escola' },
        ],
        pergunta: 'gera pdf',
        geradoEm: 'agora',
      },
      EMITENTE_PADRAO,
    )
    const cru = JSON.stringify(doc.content)
    expect(cru).toContain('Aurum AI')
    expect(cru).not.toContain('**CNPJ')
    expect(cru).toContain('CNPJ 11.222.333/0001-81')
  })
})
