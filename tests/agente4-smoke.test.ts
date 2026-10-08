import { describe, expect, it } from 'vitest'
import { calcularTributos, ehCestaBasica, observacaoCestaBasica, observacaoIS, observacoesFiscais } from '@/domain/services/calculo'
import { PARAMETROS_REF, validarParametrosRef } from '@/domain/constants/parametros'
import { BANNER_REF_FALLBACK, obterAliquotasRefSync } from '@/domain/services/referencia-service'
import { contarMascaras, removerPII } from '@/ai/guards'
import type { Classificacao } from '@/domain/entities'

const clBase = {
  id: 'x', codigo: '22030000', codigoFormatado: '2203.00.00', cst: '200', cClassTrib: '200003',
  baseLegal: '', descricao: 'Cerveja', vinculo: null, cstDetalhes: null, cstClassTribDetalhes: null,
  referencia: null, regraGeral: false,
  resumo: { descricaoCClassTrib: 'Cesta', percentualReducaoIBS: 100, percentualReducaoCBS: 100, anexo: '1', urlLegislacao: null, documentosHabilitados: null },
} as unknown as Classificacao

describe('agente4 smoke', () => {
  it('parametros.json valido (soma 19+9=28)', () => {
    expect(validarParametrosRef(PARAMETROS_REF)?.soma).toBe(28)
    expect(validarParametrosRef({ refIBS: 19, refCBS: 9, soma: 27 })).toBeNull()
  })
  it('sync expoe banner + fallback honesto', () => {
    expect(obterAliquotasRefSync().fonte).toBe('fallback')
    expect(BANNER_REF_FALLBACK).toMatch(/ESTIMATIVA/)
  })
  it('totalIBS_CBS acompanha total (compat)', () => {
    const r = calcularTributos(100, 60, 60, 19, 9)
    expect(r.totalIBS_CBS).toBe(r.total)
    expect(r.total).toBe(11.2)
  })
  it('IS: capitulo candidato avisa, demais silenciam', () => {
    expect(observacaoIS('22030000')?.titulo).toMatch(/IS não calculado/)
    expect(observacaoIS('22030000')?.texto).toMatch(/conferir LC214/)
    expect(observacaoIS('02011000')).toBeNull()
    expect(observacaoIS('curto')).toBeNull()
  })
  it('cesta 200/200003 emite selo art.125', () => {
    expect(ehCestaBasica(clBase)).toBe(true)
    expect(observacaoCestaBasica(clBase)?.titulo).toBe('Cesta básica nacional — Anexo I / art. 125 (alíquota zero)')
    expect(ehCestaBasica({ ...clBase, cClassTrib: '200038' } as Classificacao)).toBe(false)
    const obs = observacoesFiscais('22030000', clBase)
    expect(obs.some((o) => o.titulo.includes('Cesta básica nacional'))).toBe(true)
    expect(obs.some((o) => o.titulo.includes('IS não calculado'))).toBe(true)
  })
  it('CPF: pontuado mascara, 11 digitos avulsos nao viram [CPF]', () => {
    expect(removerPII('CPF 123.456.789-09')).toContain('[CPF]')
    // 11 dígitos sem contexto/pontuação NÃO geram [CPF] (podem casar [FONE] — comportamento prévio, fora do escopo)
    expect(removerPII('protocolo 12345678909')).not.toContain('[CPF]')
    expect(removerPII('CPF 12345678909')).toContain('[CPF]')
    expect(contarMascaras('a@b.com (11) 9999-8888')).toEqual({ cnpj: 0, cpf: 0, email: 1, fone: 1 })
  })
})
