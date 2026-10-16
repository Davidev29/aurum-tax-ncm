import { describe, expect, it } from 'vitest'
import { avaliarGate, diasParaVencer, estadoDeActivation, paraMs } from '@/aurum/gate'
import { REGEX_CHAVE, mascararChave } from '@/aurum/api'
import type { LicencaEstado } from '@/aurum/types'

// Cobertura do critério de pronto da camada Aurumbit (gate offline-first).
const DIA = 24 * 60 * 60 * 1000
const AGORA = Date.parse('2026-10-16T12:00:00Z')

function estado(parcial: Partial<LicencaEstado> = {}): LicencaEstado {
  return {
    licenseId: 'lic-1',
    productId: 'aurum-tax-ncm',
    app_instance_id: 'inst-1',
    device_hash: 'a'.repeat(64),
    offlineToken: 'jwt',
    lic_exp: AGORA + 10 * DIA,
    grace_until: AGORA + 20 * DIA,
    off_exp: AGORA + 30 * DIA,
    token_version: 3,
    updatedAt: AGORA,
    ...parcial,
  }
}

describe('aurum gate canRun', () => {
  it('vigente (now<=lic_exp && now<=off_exp) → ALLOW pleno', () => {
    const g = avaliarGate(estado(), AGORA)
    expect(g.decisao).toBe('ALLOW')
    expect(g.motivo).toBe('OK')
    expect(g.bloquearSensiveis).toBe(false)
  })

  it('fecha/reabre offline funciona até off_exp', () => {
    const g = avaliarGate(estado({ lic_exp: AGORA - DIA, grace_until: AGORA + 20 * DIA }), AGORA)
    expect(g.motivo).toBe('GRACE')
    expect(g.bloquearSensiveis).toBe(true)
  })

  it('graça mostra banner: lic_exp<now<=grace+3d → ALLOW degradado', () => {
    const grace = AGORA - DIA
    const g = avaliarGate(estado({ lic_exp: AGORA - 2 * DIA, grace_until: grace }), AGORA)
    expect(g.decisao).toBe('ALLOW')
    expect(g.motivo).toBe('GRACE')
    expect(g.bloquearSensiveis).toBe(true)
    // limite exato da tolerância ainda passa
    const limite = avaliarGate(estado({ lic_exp: AGORA - 2 * DIA, grace_until: grace }), grace + 3 * DIA)
    expect(limite.motivo).toBe('GRACE')
  })

  it('expirado bloqueia: now>grace+3d → DENY EXPIRED', () => {
    const g = avaliarGate(
      estado({ lic_exp: AGORA - 30 * DIA, grace_until: AGORA - 10 * DIA }),
      AGORA,
    )
    expect(g.decisao).toBe('DENY')
    expect(g.motivo).toBe('EXPIRED')
  })

  it('off_exp vencido trava mesmo na graça → DENY OFFLINE_EXPIRED', () => {
    const g = avaliarGate(
      estado({ lic_exp: AGORA - DIA, grace_until: AGORA + 20 * DIA, off_exp: AGORA - 1 }),
      AGORA,
    )
    expect(g.decisao).toBe('DENY')
    expect(g.motivo).toBe('OFFLINE_EXPIRED')
  })

  it('sem estado → DENY NO_LICENSE', () => {
    const g = avaliarGate(null, AGORA)
    expect(g).toMatchObject({ decisao: 'DENY', motivo: 'NO_LICENSE', limparSessao: false })
  })

  it('REVOKED/SUSPENDED → DENY + limpa sessão', () => {
    for (const status of ['REVOKED', 'revoked', 'SUSPENDED']) {
      const g = avaliarGate(estado({ status }), AGORA)
      expect(g.decisao).toBe('DENY')
      expect(g.limparSessao).toBe(true)
    }
    expect(avaliarGate(estado({ status: 'REVOKED' }), AGORA).motivo).toBe('REVOKED')
    expect(avaliarGate(estado({ status: 'SUSPENDED' }), AGORA).motivo).toBe('SUSPENDED')
  })

  it('tv divergente → DENY TOKEN_MISMATCH + limpa sessão', () => {
    const g = avaliarGate(estado({ token_version: 3 }), AGORA, 4)
    expect(g).toMatchObject({ decisao: 'DENY', motivo: 'TOKEN_MISMATCH', limparSessao: true })
    expect(avaliarGate(estado({ token_version: 4 }), AGORA, 4).decisao).toBe('ALLOW')
  })

  it('tempos ilegíveis → DENY NO_LICENSE (fail-closed)', () => {
    const g = avaliarGate(estado({ lic_exp: NaN }), AGORA)
    expect(g).toMatchObject({ decisao: 'DENY', motivo: 'NO_LICENSE' })
  })
})

describe('aurum ativação', () => {
  it('regex da chave aceita blocos válidos e rejeita I/O/0/1', () => {
    expect(REGEX_CHAVE.test('AURUM-AB2C-DE34-FG56')).toBe(true)
    expect(REGEX_CHAVE.test('aurum-ab2c-de34-fg56')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-AB2C-DE34-FG5')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-IB2C-DE34-FG56')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-OB2C-DE34-FG56')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-0B2C-DE34-FG56')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-1B2C-DE34-FG56')).toBe(false)
    expect(REGEX_CHAVE.test('AURUM-AB2C-DE34-FG56-EXTRA')).toBe(false)
  })

  it('máscara exibe só ••••-WXYZ', () => {
    expect(mascararChave('AURUM-AB2C-DE34-FG56')).toBe('••••-FG56')
    expect(mascararChave('••••-EF56')).toBe('••••-EF56')
    expect(mascararChave('')).toBe('••••-????')
  })

  it('estadoDeActivation normaliza ISO→ms sem guardar a chave', () => {
    const e = estadoDeActivation(
      {
        licenseId: 'lic-9',
        productId: 'aurum-tax-ncm',
        expiresAt: '2026-12-01T00:00:00Z',
        graceUntil: '2026-12-15T00:00:00Z',
        device_hash: 'b'.repeat(64),
        offlineToken: 'jwt.a.b',
        off_exp: '2027-01-01T00:00:00Z',
        token_version: 1,
        keyMasked: '••••-WXYZ',
      },
      'inst-9',
    )
    expect(e.lic_exp).toBe(Date.parse('2026-12-01T00:00:00Z'))
    expect(e.off_exp).toBe(Date.parse('2027-01-01T00:00:00Z'))
    expect(JSON.stringify(e)).not.toMatch(/AURUM-/)
    expect(e.keyMasked).toBe('••••-WXYZ')
  })

  it('paraMs aceita ISO, número e rejeita lixo', () => {
    expect(paraMs('2026-10-16T00:00:00Z')).toBe(Date.parse('2026-10-16T00:00:00Z'))
    expect(paraMs(123)).toBe(123)
    expect(paraMs('')).toBeNaN()
    expect(paraMs(null)).toBeNaN()
  })

  it('diasParaVencer conta regressiva', () => {
    expect(diasParaVencer(estado(), AGORA)).toBe(10)
    expect(diasParaVencer(null)).toBeNull()
  })
})
