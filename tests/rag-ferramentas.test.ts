import { describe, expect, it } from 'vitest'
import {
  listarFerramentasParaModelo,
  ferramentasParaIntencao,
  executarFerramenta,
  REGISTRO_FERRAMENTAS,
} from '@/application/aurum-ai-registro-ferramentas'
import { montarPacoteContextoRag, pacoteParaTexto } from '@/application/aurum-ai-contexto-rag'

describe('registro executável de ferramentas (RAG agêntico)', () => {
  it('expõe specs function-calling para qualquer modelo', () => {
    const specs = listarFerramentasParaModelo()
    expect(specs.length).toBeGreaterThanOrEqual(20)
    for (const s of specs) {
      expect(s.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
      expect(s.description.length).toBeGreaterThan(10)
      expect(s.parameters.type).toBe('object')
    }
    const nomes = specs.map((s) => s.name)
    for (const esperado of ['consultarNCM', 'consultarNBS', 'calcularIBSCBS', 'calcularSimples', 'consultarDadosXml', 'explicarArtigoLC214']) {
      expect(nomes).toContain(esperado)
    }
  })

  it('filtra por domínio', () => {
    const fiscal = listarFerramentasParaModelo(['fiscal'])
    expect(fiscal.length).toBeGreaterThan(0)
    expect(fiscal.every((s) => REGISTRO_FERRAMENTAS.find((r) => r.nome === s.name)?.dominio === 'fiscal')).toBe(true)
  })

  it('roteia intenção → ferramentas candidatas', () => {
    expect(ferramentasParaIntencao('ncm')).toContain('consultarNCM')
    expect(ferramentasParaIntencao('simples')).toContain('calcularSimples')
    expect(ferramentasParaIntencao('dados')).toContain('consultarDadosXml')
    expect(ferramentasParaIntencao('legislacao')).toContain('explicarArtigoLC214')
  })

  it('rejeita ferramenta desconhecida sem lançar', async () => {
    const r = await executarFerramenta('ferramentaInexistente' as never, {})
    expect(r.ok).toBe(false)
    expect(r.erro).toMatch(/desconhecida/)
  })

  it('conta básica executa pelo motor (determinístico)', async () => {
    const r = await executarFerramenta('calcularContaBasica', { expressao: '10% de 500' })
    expect(r.ok).toBe(true)
    expect(String(r.texto)).toContain('50')
  })

  it('tempo responde sem rede', async () => {
    const r = await executarFerramenta('responderTempo', { tipo: 'hora' })
    expect(r.ok).toBe(true)
    expect(String(r.texto)).toMatch(/Agora são/)
  })
})

describe('pacote de contexto RAG', () => {
  it('monta pacote com orçamento do perfil', () => {
    const pacote = montarPacoteContextoRag({
      analise: { intencao: 'ncm', termoBusca: 'banana' } as never,
      fichas: [
        { codigo: '08031000', nome: 'Bananas frescas', capitulo: '08', vinculo: 'tributação integral', score: 9.5 },
        { codigo: '08030000', nome: 'Bananas', capitulo: '08', score: 4.1 },
      ],
      historico: [{ papel: 'user', texto: 'ncm de banana?' }],
      perfil: { familia: 'generico', templateChat: 'generico', contextSize: 4096 } as never,
    })
    expect(pacote.versao).toBe('rag-v1')
    expect(pacote.ferramentas).toContain('consultarNCM')
    expect(pacote.fichas.length).toBe(2)
    expect(JSON.stringify(pacote).length).toBeLessThan(4096 * 4)
    const texto = pacoteParaTexto(pacote)
    expect(texto).toContain('08031000')
  })

  it('trunca com perfil pequeno sem estourar orçamento', () => {
    const fichas = Array.from({ length: 10 }, (_, i) => ({
      codigo: `0000000${i}`,
      nome: 'x'.repeat(200),
      vinculo: 'y'.repeat(200),
    }))
    const pacote = montarPacoteContextoRag({
      analise: { intencao: 'ncm', termoBusca: 'x' } as never,
      fichas,
      perfil: { familia: 'generico', templateChat: 'generico', contextSize: 1024 } as never,
    })
    expect(JSON.stringify(pacote).length).toBeLessThanOrEqual(1024 * 4 * 0.7 + 500)
  })
})
