import { describe, expect, it } from 'vitest'
import { ErroAurum } from '@/aurum/api'
import { mapearErro, notificarPosAtivacao, textoGate } from '@/aurum/erros'

// Mapa central de erros → toast: nenhum código pode ficar sem mensagem.
describe('aurum erros → toast', () => {
  it('mapeia todos os CodigoErroAurum com tipo e mensagem PT-BR', () => {
    const codigos = [
      'AUTH',
      'ACCOUNT_NO_LICENSE',
      'DEVICE_LIMIT',
      'DEVICE_CONFLICT',
      'KEY_INVALID',
      'LICENSE_INACTIVE',
      'DEVICE_BLOCKED',
      'REDE',
      'SERVIDOR',
      'RESPOSTA_INVALIDA',
    ] as const
    for (const code of codigos) {
      const m = mapearErro(new ErroAurum(code, 'detalhe do servidor'))
      expect(m.codigo).toBe(code)
      expect(m.mensagem.length).toBeGreaterThan(10)
      expect(['err', 'warn']).toContain(m.tipo)
      // A única menção a "AURUM-…" permitida é o placeholder de formato
      // (documentação); chave real nunca chega até aqui como input.
      expect(m.mensagem).not.toMatch(/AURUM-AB2C/)
    }
  })

  it('REDE é sempre warn (modo offline permitido, sem pânico)', () => {
    expect(mapearErro(new ErroAurum('REDE', 'x')).tipo).toBe('warn')
  })

  it('login com AUTH orienta conferir e-mail/senha', () => {
    const m = mapearErro(new ErroAurum('AUTH', 'Sessão expirada'), 'login')
    expect(m.mensagem).toMatch(/e-mail|senha/i)
  })

  it('erro desconhecido tem fallback comportado e higieniza chave', () => {
    const m = mapearErro(new Error(''))
    expect(m.mensagem.length).toBeGreaterThan(5)
    expect(m.tipo).toBe('err')
    const vazado = mapearErro(new ErroAurum('SERVIDOR', 'falhou AURUM-AB2C-DE34-FG56 feio'))
    expect(vazado.mensagem).not.toContain('AURUM-AB2C')
    expect(vazado.mensagem).toContain('••••-XXXX')
  })

  it('gate DENY pós-ativação explica o motivo (não diz "ativada")', () => {
    for (const motivo of ['EXPIRED', 'OFFLINE_EXPIRED', 'REVOKED', 'SUSPENDED', 'TOKEN_MISMATCH', 'NO_LICENSE'] as const) {
      const t = textoGate({ decisao: 'DENY', motivo, bloquearSensiveis: true, limparSessao: false })
      expect(t.tipo).toBe('err')
      expect(t.mensagem).not.toMatch(/Bom trabalho/)
    }
  })

  it('gate ALLOW comemora; GRACE avisa sem bloquear a verdade', () => {
    expect(textoGate({ decisao: 'ALLOW', motivo: 'OK', bloquearSensiveis: false, limparSessao: false }).tipo).toBe('ok')
    const g = textoGate({ decisao: 'ALLOW', motivo: 'GRACE', bloquearSensiveis: true, limparSessao: false })
    expect(g.tipo).toBe('warn')
    expect(g.mensagem).toMatch(/graça/i)
  })

  it('notificarPosAtivacao retorna liberado=true só em ALLOW', () => {
    expect(
      notificarPosAtivacao({ decisao: 'ALLOW', motivo: 'OK', bloquearSensiveis: false, limparSessao: false }, '••••-WXYZ'),
    ).toBe(true)
    expect(
      notificarPosAtivacao({ decisao: 'DENY', motivo: 'EXPIRED', bloquearSensiveis: true, limparSessao: false }),
    ).toBe(false)
  })
})
