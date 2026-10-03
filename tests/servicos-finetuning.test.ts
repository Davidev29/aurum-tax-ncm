/**
 * Fine-tuning NBS/Serviços v2 — a IA entende mais setores e raciocina melhor.
 *
 * Cobre:
 * - vocabulário expandido (dia a dia → juridiquês NBS);
 * - sinais por setor + perguntas de refino + ambiguidades (raciocínio);
 * - pack de conhecimento (servicos-nbs.json + frases-modelo-servicos.json).
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { SINONIMOS_SERVICOS, expandirSinonimoServico } from '@/domain/services/vocabulario-servicos'
import {
  analisarDescricaoServico,
  extrairSinaisServicos,
  perguntasComplementaresServicos,
} from '@/domain/services/classificador-descricao-servicos'
import fs from 'node:fs'
import path from 'node:path'

describe('vocabulario-servicos (fine-tuning v2+v3)', () => {
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

describe('pack fine-tuning (conhecimento)', () => {
  it('servicos-nbs.json existe e tem raciocínio em 7 etapas', () => {
    const p = path.resolve(__dirname, '..', 'recursos-ia', 'conhecimento', 'servicos-nbs.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    expect(j.versao).toMatch(/finetuning-servicos/)
    expect(j.raciocinio.etapas).toHaveLength(7)
    expect(j.principio).toMatch(/resolvedor/i)
  })

  it('frases-modelo-servicos.json existe com casos preditivos e negativos', () => {
    const p = path.resolve(__dirname, '..', 'recursos-ia', 'conhecimento', 'frases-modelo-servicos.json')
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    expect(j.frases.length).toBeGreaterThanOrEqual(8)
    expect(j.frases.some((f: { tipo?: string }) => f.tipo === 'preditiva')).toBe(true)
    expect(j.frases.some((f: { tipo?: string }) => f.tipo === 'sem-lastro')).toBe(true)
  })
})
