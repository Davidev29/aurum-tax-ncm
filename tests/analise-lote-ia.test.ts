/**
 * Aurum AI assistida do lote — nome + NCM = comparativo, decisão do usuário.
 *
 * Garantias:
 * - 1 opção → confirma e fixa (situação `unica`);
 * - N opções (incluindo diferimento) → NUNCA fixa benefício: sugere a
 *   integral de segurança e explica o porquê SÓ com dados oficiais;
 * - nenhum comentário inventa CST, redução, anexo ou artigo.
 */
import { describe, expect, it } from 'vitest'
import { analisarItemLoteIA } from '@/domain/services/analise-lote-ia'
import type { Classificacao } from '@/domain/entities'

function opcao(parcial: Partial<Classificacao> & { cst: string; cClassTrib: string }): Classificacao {
  const redIBS = parcial.resumo?.percentualReducaoIBS ?? 0
  const redCBS = parcial.resumo?.percentualReducaoCBS ?? 0
  return {
    id: `${parcial.cst}|${parcial.cClassTrib}`,
    codigo: '02011000',
    codigoFormatado: '0201.10.00',
    cst: parcial.cst,
    cClassTrib: parcial.cClassTrib,
    baseLegal: parcial.baseLegal ?? 'LC 214/2025 — base oficial',
    descricao: parcial.descricao ?? '',
    vinculo: (parcial.vinculo ?? null) as Classificacao['vinculo'],
    cstDetalhes: (parcial.cstDetalhes ?? null) as Classificacao['cstDetalhes'],
    cstClassTribDetalhes: (parcial.cstClassTribDetalhes ?? null) as Classificacao['cstClassTribDetalhes'],
    referencia: (parcial.referencia ?? null) as Classificacao['referencia'],
    resumo: {
      descricaoCClassTrib: parcial.resumo?.descricaoCClassTrib ?? parcial.descricao ?? '',
      percentualReducaoIBS: redIBS,
      percentualReducaoCBS: redCBS,
      anexo: parcial.resumo?.anexo ?? null,
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: false,
  }
}

describe('analisarItemLoteIA', () => {
  it('NCM inválido não sugere tributação', () => {
    const a = analisarItemLoteIA({
      nome: 'Queijo Minas', ncm: '123', classificacoes: [],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: null,
    })
    expect(a.situacao).toBe('invalida')
    expect(a.opcoes).toHaveLength(0)
    expect(a.orientacaoEscolha).toMatch(/reimporte/i)
  })

  it('tributação única é confirmada com confiança alta', () => {
    const c = opcao({
      cst: '000', cClassTrib: '000002',
      descricao: 'Carne bovina fresca',
      baseLegal: 'LC 214/2025 — art. 11',
      resumo: { descricaoCClassTrib: 'Alíquota zero — carne bovina', percentualReducaoIBS: 100, percentualReducaoCBS: 100, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    })
    const a = analisarItemLoteIA({
      nome: 'Carne bovina fresca', ncm: '02011000', classificacoes: [c],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: 'Carne bovina fresca',
    })
    expect(a.situacao).toBe('unica')
    expect(a.maisProvavelIndice).toBe(0)
    expect(a.confianca).toBeGreaterThanOrEqual(0.85)
    expect(a.opcoes[0].comentario).toContain('000')
    expect(a.opcoes[0].comentario).toContain('000002')
    expect(a.opcoes[0].comentario).toContain('art. 11')
  })

  it('múltiplas: nunca fixa benefício — sugere a integral e cita o comparativo do nome', () => {
    const a1 = opcao({
      cst: '000', cClassTrib: '000002',
      descricao: 'Alíquota zero — carne bovina in natura',
      baseLegal: 'LC 214/2025 — Anexo II',
      resumo: { descricaoCClassTrib: 'Alíquota zero — carne bovina', percentualReducaoIBS: 100, percentualReducaoCBS: 100, anexo: '2', urlLegislacao: null, documentosHabilitados: null },
    })
    const b1 = opcao({
      cst: '200', cClassTrib: '200038',
      descricao: 'Insumo agropecuário com redução de 60%',
      baseLegal: 'LC 214/2025 — Anexo IX',
      resumo: { descricaoCClassTrib: 'Redução de 60% — insumo agropecuário', percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: '9', urlLegislacao: null, documentosHabilitados: null },
    })
    const integral = opcao({
      cst: '000', cClassTrib: '000001',
      descricao: 'Tributação integral',
      baseLegal: 'LC 214/2025 — Regra geral',
      resumo: { descricaoCClassTrib: 'Tributação integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    })
    integral.integralFallback = true
    const a = analisarItemLoteIA({
      nome: 'Insumo agropecuário para plantio', ncm: '02011000',
      classificacoes: [a1, b1, integral],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: 'Carne bovina',
    })
    expect(a.situacao).toBe('multipla')
    // Segurança: mesmo com o nome aderente ao benefício, a sugestão é a integral.
    expect(a.maisProvavelIndice).toBe(2)
    expect(a.confianca).toBeLessThan(0.5)
    // Porquê grounded: cita os dois CSTs e as duas reduções reais.
    expect(a.porqueMultiplas).toContain('000')
    expect(a.porqueMultiplas).toContain('200')
    expect(a.porqueMultiplas).toContain('100')
    expect(a.porqueMultiplas).toContain('60')
    // Anti-alucinação: nenhum artigo inventado fora das bases informadas.
    expect(a.porqueMultiplas).not.toMatch(/art\. 137/i)
    expect(a.porqueMultiplas).not.toMatch(/art\. 135/i)
    for (const op of a.opcoes) {
      expect(op.comentario).not.toMatch(/art\. 137/i)
      expect(op.comentario).not.toMatch(/art\. 135/i)
    }
    expect(a.orientacaoEscolha).toMatch(/Opção 3/)
    expect(a.alertas.join(' ')).toMatch(/não fixou benefício|integral/i)
  })

  it('empate no nome sugere a integral com confiança baixa', () => {
    const a1 = opcao({ cst: '000', cClassTrib: '000001', descricao: 'Tributação integral', baseLegal: 'LC 214/2025' })
    const b1 = opcao({ cst: '000', cClassTrib: '000002', descricao: 'Alíquota zero', baseLegal: 'LC 214/2025' })
    const a = analisarItemLoteIA({
      nome: 'Xyzq inexistente', ncm: '02011000', classificacoes: [a1, b1],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: 'Outra coisa',
    })
    expect(a.situacao).toBe('multipla')
    expect(a.maisProvavelIndice).toBe(0)
    expect(a.confianca).toBeLessThan(0.5)
    expect(a.resumo).toMatch(/integral|escolha/i)
  })

  it('nome comercial diferente do texto oficial não gera alerta — o NCM manda', () => {
    const c = opcao({
      cst: '000', cClassTrib: '000002', descricao: 'Carne bovina fresca', baseLegal: 'LC 214/2025',
      resumo: { descricaoCClassTrib: 'Carne bovina', percentualReducaoIBS: 100, percentualReducaoCBS: 100, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    })
    const a = analisarItemLoteIA({
      nome: 'Notebook gamer 15 polegadas', ncm: '02011000', classificacoes: [c],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: 'Carne bovina fresca',
    })
    expect(a.divergenciaNome).toBe(false)
    // Sem integral anexada, sem o que alertar além da confirmação.
    expect(a.alertas).toHaveLength(0)
    expect(a.maisProvavelIndice).toBe(0)
  })

  it('única com integral trocável: fixa o oficial e alerta sem aderência do nome', () => {
    const oficial = opcao({
      cst: '200', cClassTrib: '200007',
      descricao: 'Fornecimento dos dispositivos de acessibilidade próprios para pessoas com deficiência',
      baseLegal: 'LC 214/2025 — Anexo XIII',
      resumo: { descricaoCClassTrib: 'Dispositivos de acessibilidade', percentualReducaoIBS: 60, percentualReducaoCBS: 60, anexo: '13', urlLegislacao: null, documentosHabilitados: null },
    })
    const integral = opcao({
      cst: '000', cClassTrib: '000001', descricao: 'Tributação integral', baseLegal: 'LC 214/2025 — Regra geral',
      resumo: { descricaoCClassTrib: 'Tributação integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    })
    integral.integralFallback = true
    const a = analisarItemLoteIA({
      nome: 'ARMADOR GROSSO COM 12 PARES', ncm: '83024100',
      classificacoes: [oficial, integral],
      regraGeral: false, manual: false, extinto: false, nomenclaturaDescricao: 'Guarnições para móveis',
    })
    expect(a.situacao).toBe('unica')
    // Fixa o oficial (índice 0), nunca a integral.
    expect(a.maisProvavelIndice).toBe(0)
    expect(a.totalOpcoes).toBe(2)
    // Sem aderência do nome ao benefício → alerta + orientação de troca.
    expect(a.alertas.join(' ')).toMatch(/finalidade|integral/i)
    expect(a.orientacaoEscolha).toMatch(/Opção 2/)
  })

  it('regra geral e manual têm situações próprias', () => {
    const rg = opcao({ cst: '000', cClassTrib: '000001', descricao: 'Tributação integral', baseLegal: 'LC 214/2025 — Regra geral' })
    const aRg = analisarItemLoteIA({
      nome: 'Produto qualquer', ncm: '84713012', classificacoes: [rg],
      regraGeral: true, manual: false, extinto: false, nomenclaturaDescricao: 'Máquinas',
    })
    expect(aRg.situacao).toBe('regra-geral')
    expect(aRg.resumo).toMatch(/regra geral/i)

    const man = opcao({ cst: '200', cClassTrib: '200038', descricao: 'Minha regra', baseLegal: 'Minha fonte' })
    const aMan = analisarItemLoteIA({
      nome: 'Produto', ncm: '02011000', classificacoes: [{ ...man, manual: { ncm: '02011000', cst: '200', cClassTrib: '200038', descricao: 'x', fonteDescricao: 'lei', fonteUrl: '', criadoEm: '', atualizadoEm: '' } }],
      regraGeral: false, manual: true, extinto: false, nomenclaturaDescricao: null,
    })
    expect(aMan.situacao).toBe('manual')
  })
})
