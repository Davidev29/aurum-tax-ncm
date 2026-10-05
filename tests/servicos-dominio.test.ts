/**
 * Phase 7 — domínio puro: CNPJ, NBS, CNAE, detector, classificador de serviços.
 */
import { describe, expect, it } from 'vitest'
import { ehCnpjValido, validarCnpj } from '@/domain/services/cnpj'
import { interpretarEntradaNbs } from '@/domain/services/classificacao-nbs'
import {
  corSituacaoCnae,
  exigePerguntaFatorR,
  rotuloAnexoSimples,
  tetoConfiancaCnae,
  textoBuscavelCnae,
} from '@/domain/services/cnae'
import { detectarIntencaoConsulta } from '@/domain/services/detector-consulta'
import {
  analisarDescricaoServico,
  calcularConfiancaServicos,
  perguntasComplementaresServicos,
} from '@/domain/services/classificador-descricao-servicos'
import { hipoteseNbsParcial } from '@/application/classificacao-inteligente-servicos'

describe('CNPJ (dígito verificador)', () => {
  it('aceita CNPJ válido conhecido', () => {
    expect(ehCnpjValido('11.222.333/0001-81')).toBe(true)
    expect(ehCnpjValido('53.795.990/0001-68')).toBe(true)
    expect(validarCnpj('11222333000181')).toEqual({ ok: true, cnpj: '11222333000181' })
  })

  it('recusa tamanho, sequência e DV errado com motivo próprio', () => {
    expect(validarCnpj('123').motivo).toBe('cnpj-tamanho')
    expect(validarCnpj('11111111111111').motivo).toBe('cnpj-sequencia')
    expect(validarCnpj('11222333000182').motivo).toBe('cnpj-digito')
    expect(validarCnpj('').motivo).toBe('cnpj-vazio')
  })
})

describe('interpretarEntradaNbs', () => {
  it('9 dígitos = ok; 8 dígitos = inválido (NCM não é NBS)', () => {
    expect(interpretarEntradaNbs('122.011.100')).toEqual({ kind: 'ok', codigo: '122011100', digitos: 9 })
    expect(interpretarEntradaNbs('02011000').kind).toBe('invalido')
    expect(interpretarEntradaNbs('12201110').kind).toBe('invalido')
  })
})

describe('hipoteseNbsParcial', () => {
  it('2–8 dígitos sem letras = parcial; 9 = null; com letras = null', () => {
    expect(hipoteseNbsParcial('122011')).toBe('122011')
    expect(hipoteseNbsParcial('122011100')).toBeNull()
    expect(hipoteseNbsParcial('aula de inglês')).toBeNull()
  })
})

describe('detector com 9 dígitos', () => {
  it('9 dígitos numéricos = NBS exato', () => {
    const i = detectarIntencaoConsulta('122011100')
    expect(i.tipo).toBe('numerica')
    expect(i.deveClassificarExato).toBe(true)
    expect(i.rotulo).toBe('🔢 NBS exato')
  })

  it('8 dígitos continua NCM exato (sem regressão no domínio padrão)', () => {
    const i = detectarIntencaoConsulta('02011000')
    expect(i.rotulo).toBe('🔢 NCM exato')
    expect(i.deveClassificarExato).toBe(true)
  })

  it('domínio nbs: 8 dígitos NÃO é exato nem ganha selo de NCM', () => {
    const i = detectarIntencaoConsulta('01053000', 'nbs')
    expect(i.tipo).toBe('numerica')
    expect(i.deveBuscarExato).toBe(true)
    expect(i.deveClassificarExato).toBe(false)
    expect(i.rotulo).toBe('⌨️ NBS tem 9 dígitos')
    expect(i.rotulo).not.toContain('NCM')
  })

  it('domínio nbs: 9 dígitos continua NBS exato e classifica', () => {
    const i = detectarIntencaoConsulta('122011100', 'nbs')
    expect(i.deveClassificarExato).toBe(true)
    expect(i.rotulo).toBe('🔢 NBS exato')
  })

  it('domínio nbs: texto misto com 8 dígitos não classifica exato', () => {
    const i = detectarIntencaoConsulta('aula 01053000', 'nbs')
    expect(i.deveClassificarExato).toBe(false)
  })
})

describe('matriz CNAE (teto por Situação)', () => {
  it('Permitido não veta; ressalva veta em 0.6; depende veta tudo', () => {
    expect(tetoConfiancaCnae('Permitido')).toBe(1)
    expect(tetoConfiancaCnae('Permitido com ressalvas')).toBe(0.6)
    expect(tetoConfiancaCnae('Depende da atividade')).toBe(0)
  })

  it('rótulo sempre com prefixo "Anexo Simples"', () => {
    expect(rotuloAnexoSimples(['III', 'V'])).toBe('Anexo Simples III / V')
    expect(rotuloAnexoSimples([])).toBe('Anexo Simples —')
  })

  it('cores por situação', () => {
    expect(corSituacaoCnae('Permitido')).toBe('emerald')
    expect(corSituacaoCnae('Permitido com ressalvas')).toBe('amber')
    expect(corSituacaoCnae('Depende da atividade')).toBe('slate')
  })

  it('Fator R exige pergunta', () => {
    expect(exigePerguntaFatorR({ fatorR: true, anexos: ['III'] })).toBe(true)
    expect(exigePerguntaFatorR({ fatorR: false, anexos: ['V'] })).toBe(true)
    expect(exigePerguntaFatorR({ fatorR: false, anexos: ['II'] })).toBe(false)
  })

  it('texto buscável junta código + descrição', () => {
    expect(textoBuscavelCnae({ codigoFormatado: '8599-6/01', descricao: 'Formação de condutores' })).toContain('8599-6/01')
  })
})

describe('classificador de serviços (etapa 1)', () => {
  it('detecta ENSINO + REMOTO em "aula de inglês online"', () => {
    const a = analisarDescricaoServico({ descricao: 'aula de inglês online' })
    expect(a.sinais).toContain('ENSINO')
    expect(a.sinais).toContain('REMOTO')
    expect(a.insuficiente).toBe(false)
  })

  it('entrada pobre é insuficiente e pede contexto', () => {
    const a = analisarDescricaoServico({ descricao: 'serviço' })
    expect(a.insuficiente).toBe(true)
    expect(perguntasComplementaresServicos(a).length).toBeGreaterThan(0)
  })

  it('cultura sem produção nacional = risco + pergunta de destinação', () => {
    const a = analisarDescricaoServico({ descricao: 'show musical' })
    expect(a.ambiguidades.length).toBeGreaterThan(0)
    expect(perguntasComplementaresServicos(a).join(' ')).toContain('nacional')
  })

  it('confiança: sem candidato = baixa; risco = no máximo média', () => {
    expect(calcularConfiancaServicos({ totalCandidatos: 0, margemTopo: 0, tokensUteis: 3, temCondicaoRisco: false })).toBe('baixa')
    expect(calcularConfiancaServicos({ totalCandidatos: 3, margemTopo: 999, tokensUteis: 3, temCondicaoRisco: true })).toBe('media')
    expect(calcularConfiancaServicos({ totalCandidatos: 1, margemTopo: 999, tokensUteis: 3, temCondicaoRisco: false })).toBe('alta')
  })
})
