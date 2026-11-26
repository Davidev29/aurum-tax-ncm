/**
 * Vocabulário determinístico NBS/Serviços — cobertura de setores e sinais.
 *
 * Cobre:
 * - vocabulário expandido (dia a dia → juridiquês NBS);
 * - sinais por setor + perguntas de refino + ambiguidades.
 */
import { describe, expect, it } from 'vitest'
import { SINONIMOS_SERVICOS, expandirSinonimoServico } from '@/domain/services/vocabulario-servicos'
import {
  analisarDescricaoServico,
  extrairSinaisServicos,
  perguntasComplementaresServicos,
} from '@/domain/services/classificador-descricao-servicos'

describe('vocabulario-servicos (calibragem v2+v3)', () => {
  it('cobre os setores novos (TI, transporte, beleza, financeiro...)', () => {
    expect(expandirSinonimoServico('frete')).toBe('transporte')
    expect(expandirSinonimoServico('advogado')).toBe('advogados')
    expect(expandirSinonimoServico('cabeleireiro')).toBe('beleza')
    expect(expandirSinonimoServico('restaurante')).toBe('alimentacao')
    expect(expandirSinonimoServico('eletricista')).toBe('manutencao')
    // v3 honesto: TI genérico NÃO mapeia p/ Anexo XI (evita falso benefício)
    expect(expandirSinonimoServico('app')).toBe('servico')
    expect(expandirSinonimoServico('firewall')).toBe('cibernetica')
    expect(expandirSinonimoServico('circo')).toBe('circenses')
    expect(expandirSinonimoServico('formacao')).toBe('educacao')
  })

  it('tem cobertura mínima (≥500 termos) para preditividade real', () => {
    expect(Object.keys(SINONIMOS_SERVICOS).length).toBeGreaterThanOrEqual(500)
  })
})

describe('sinais por setor (raciocínio)', () => {
  it('frete com destino exterior acende TRANSPORTE + TOMADOR_EXTERIOR + risco', () => {
    const a = analisarDescricaoServico({ descricao: 'frete com destino ao exterior' })
    expect(a.sinais).toContain('TRANSPORTE_LOGISTICA')
    expect(a.sinais).toContain('TOMADOR_EXTERIOR')
    expect(a.ambiguidades.join(' ')).toMatch(/exterior|exportação/i)
  })

  it('consulta médica domiciliar acende SAUDE + DOMICILIAR', () => {
    const a = analisarDescricaoServico({ descricao: 'consulta médica domiciliar' })
    expect(a.sinais).toContain('SAUDE')
    expect(a.sinais).toContain('DOMICILIAR')
  })

  it('desenvolvimento de app acende TI_SOFTWARE com pergunta de refino', () => {
    const a = analisarDescricaoServico({ descricao: 'desenvolvimento de aplicativo para empresa' })
    expect(a.sinais).toContain('TI_SOFTWARE')
    const ps = perguntasComplementaresServicos(a)
    expect(ps.join(' ')).toMatch(/desenvolvimento|licenciamento|suporte|hospedagem/i)
  })

  it('extrairSinaisServicos é estável (ids usados em testes)', () => {
    expect(extrairSinaisServicos(['frete', 'exterior'])).toContain('TRANSPORTE_LOGISTICA')
    expect(extrairSinaisServicos(['cabeleireiro'])).toContain('BELEZA_BEMESTAR')
    expect(extrairSinaisServicos(['restaurante'])).toContain('ALIMENTACAO_HOSPEDAGEM')
  })
})


