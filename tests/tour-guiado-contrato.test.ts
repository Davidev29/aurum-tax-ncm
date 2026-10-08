/**
 * Tour guiado + contrato v1.1 — garantias do onboarding e do reaceite.
 */
import { describe, expect, it } from 'vitest'
import { PASSOS_TOUR } from '@/domain/tutorial'
import { CONTRATO_VERSAO, TERMO_RESUMO, lerAceite } from '@/domain/contrato'
import { deveAbrirAposInstalacao } from '@/store/tutorial'

describe('tour guiado — cobertura menu a menu', () => {
  it('cobre os 10 menus do sistema, sem repetir', () => {
    expect(PASSOS_TOUR).toHaveLength(10)
    const ids = PASSOS_TOUR.map((p) => p.id)
    expect(new Set(ids).size).toBe(10)
    for (const esperada of [
      'calculadora',
      'simples',
      'consulta',
      'servicos',
      'cnaes',
      'lote',
      'nfe',
      'produtos',
      'auxiliares',
      'legislacao',
    ]) {
      expect(ids).toContain(esperada)
    }
  })

  it('cada passo explica o que faz, como usar e dica', () => {
    for (const p of PASSOS_TOUR) {
      expect(p.menu.trim().length).toBeGreaterThan(0)
      expect(p.oQueFaz.trim().length).toBeGreaterThan(20)
      expect(p.comoUsar.length).toBeGreaterThanOrEqual(3)
      expect(p.dica.trim().length).toBeGreaterThan(10)
      expect(p.acao.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('contrato v1.1 — reflete o software atual', () => {
  it('versão bumpada força reaceite da v1.0', () => {
    expect(CONTRATO_VERSAO).toBe('1.1 — Out/2026')
  })

  it('resumo menciona os 10 módulos e corrige SPED/IA', () => {
    const texto = TERMO_RESUMO.join(' ')
    expect(texto).toMatch(/10 módulos|10 módulos/)
    expect(texto).toMatch(/SPED/)
    expect(texto).toMatch(/determinística/)
    expect(texto).toMatch(/v1\.1/)
  })

  it('aceite antigo (v1.0) é invalidado', () => {
    const bruto = JSON.stringify({
      versao: '1.0 — Set/2026',
      dataHora: new Date().toISOString(),
      agente: 'teste',
    })
    const getItem = localStorage.getItem.bind(localStorage)
    localStorage.setItem('aurum_tax_ncm_aceite_v1', bruto)
    try {
      expect(lerAceite()).toBeNull()
    } finally {
      // restaura: remove o aceite fake para não vazar entre testes
      try {
        localStorage.removeItem('aurum_tax_ncm_aceite_v1')
        void getItem
      } catch {
        /* ignora */
      }
    }
  })

  it('tour abre quando nunca visto', () => {
    try {
      localStorage.removeItem('aurum:tour-guiado-visto')
    } catch {
      /* ignora */
    }
    expect(deveAbrirAposInstalacao()).toBe(true)
  })
})
