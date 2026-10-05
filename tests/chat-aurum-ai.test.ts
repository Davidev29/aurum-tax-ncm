import { describe, expect, it } from 'vitest'
import {
  responderChat,
  montarRelatorioConversa,
  montarRelatorioCalculo,
} from '@/application/aurum-ai-chat'

describe('aurum-ai-chat (orquestrador)', () => {
  it('fora de escopo responde amigável + profissional da área', async () => {
    const r = await responderChat('me conta uma piada')
    expect(r.texto).toContain('Aurum AI')
    expect(r.texto.toLowerCase()).toContain('profissional')
    expect(r.codigo ?? null).toBeNull()
  }, 15000)

  it('saudação identifica a IA', async () => {
    const r = await responderChat('oi')
    expect(r.texto).toContain('Aurum AI')
  })

  it('"o que você pode fazer?" lista recursos com botões (não é sem-lastro)', async () => {
    const r = await responderChat('o que você pode fazer?')
    expect(r.texto).toContain('Aurum AI')
    expect(r.texto).not.toContain('não encontrei nenhuma referência')
    expect(r.texto).toContain('Consulta NCM')
    expect(r.botoes?.length).toBeGreaterThan(0)
  }, 15000)

  it('vago sem lastro pede esclarecimento (sem eco de sem-lastro)', async () => {
    const r = await responderChat('xyzblt')
    expect(r.texto).toContain('Aurum AI')
    expect(r.texto).not.toContain('não encontrei nenhuma referência')
  }, 15000)

  it('navegar sugere botão de ir à tela, sem "Sou a" redundante', async () => {
    const r = await responderChat('me leva para a calculadora')
    expect(r.texto).not.toContain('Sou a')
    expect(r.botoes?.some((b) => b.acao === 'navegar' && b.alvo === 'calculadora')).toBe(true)
  }, 15000)

  it('cálculo sem valor assume R$ 1.000 com aviso explícito, sem eco da pergunta', async () => {
    const r = await responderChat('quanto fica no NCM 08031000?')
    expect(r.texto).not.toContain('Sou a')
    expect(r.texto).not.toContain('Para "')
    expect(r.texto).toContain('Faltou o valor base')
  }, 15000)

  it('simples sem dados PERGUNTA os valores (nunca projeta exemplo)', async () => {
    const r = await responderChat('meu DAS?')
    expect(r.texto).not.toContain('Sou a')
    expect(r.texto).toContain('preciso de')
    expect(r.texto).toContain('RBT12')
    expect(r.pensamento?.etapas.length).toBeGreaterThan(0)
  }, 15000)

  it('relatório pergunta o formato (CSV/JSON/TXT), sem payload ainda', async () => {
    const r = await responderChat('gera um relatório dessa conversa', [
      { papel: 'user', texto: 'tem algum ncm de banana?' },
    ])
    expect(r.texto).not.toContain('Sou a')
    expect(r.relatorio ?? null).toBeNull()
    expect(r.relatorioOpcoes?.base).toBe('conversa')
    expect(r.botoes?.filter((b) => b.acao === 'formato').map((b) => b.alvo).sort()).toEqual(['csv', 'json', 'pdf', 'txt'])
  }, 15000)

  it('builders de relatório geram CSV/JSON/TXT com mime certo', () => {
    const d = { historico: [{ papel: 'user' as const, texto: 'oi' }], pergunta: 'relatorio', geradoEm: 'agora' }
    const csv = montarRelatorioConversa(d, 'csv')
    expect(csv.nome).toMatch(/\.csv$/)
    expect(csv.mime).toContain('text/csv')
    expect(csv.conteudo).toContain(';')
    const json = montarRelatorioConversa(d, 'json')
    expect(json.nome).toMatch(/\.json$/)
    expect(() => JSON.parse(json.conteudo)).not.toThrow()
    const txt = montarRelatorioConversa(d, 'txt')
    expect(txt.nome).toMatch(/\.txt$/)
    expect(txt.mime).toContain('text/plain')
    const calc = montarRelatorioCalculo({ codigo: '08031000', base: 1000, ibs: 190, cbs: 90, total: 280 }, 'json')
    expect(JSON.parse(calc.conteudo).tipo).toBe('calculo')
  })

  it('relatório de produtos orienta ao módulo (não inventa dados)', async () => {
    const r = await responderChat('gere um relatório dos meus produtos')
    expect(r.relatorio ?? null).toBeNull()
    expect(r.botoes?.some((b) => b.acao === 'navegar' && b.alvo === 'produtos')).toBe(true)
  }, 15000)

  it('cálculo simples responde com valores e thinking, sem "Sou a"', async () => {
    const r = await responderChat('meu DAS no Anexo III com RBT12 500 mil e receita 40 mil')
    expect(r.texto).not.toContain('Sou a')
    expect(r.texto).toContain('DAS')
    expect(r.pensamento?.etapas.length).toBeGreaterThan(0)
  }, 15000)

  it('NCM não ecoa a pergunta', async () => {
    const r = await responderChat('08031000')
    expect(r.texto).not.toContain('Para "')
  }, 15000)
})
