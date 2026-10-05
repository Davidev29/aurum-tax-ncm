import { describe, expect, it } from 'vitest'
import { inferirAnexoPorAtividade, ANEXO_POR_ATIVIDADE_EXEMPLOS } from '@/domain/services/anexo-inferencia'
import { responderChat } from '@/application/aurum-ai-chat'

describe('08-01 inferencia de anexo por atividade', () => {
  it('36 exemplos inferem o anexo esperado', () => {
    let ok = 0
    for (const ex of ANEXO_POR_ATIVIDADE_EXEMPLOS) {
      const r = inferirAnexoPorAtividade(ex.texto)
      if (r.anexo === ex.anexo) ok++
      else console.log('MISS', ex.texto, '->', r.anexo, 'esperado', ex.anexo)
    }
    const taxa = ok / ANEXO_POR_ATIVIDADE_EXEMPLOS.length
    console.log(`inferencia ${ok}/${ANEXO_POR_ATIVIDADE_EXEMPLOS.length} = ${(taxa * 100).toFixed(1)}%`)
    expect(taxa).toBeGreaterThanOrEqual(0.85)
  })
  it('explicito vence inferencia', () => {
    expect(inferirAnexoPorAtividade('sou medico, Anexo I').anexo).toBe('I')
    expect(inferirAnexoPorAtividade('Anexo IV, sou medico').anexo).toBe('IV')
  })
  it('V pede confirmacao, I/II/IV nao', () => {
    expect(inferirAnexoPorAtividade('sou medico').precisaConfirmar).toBe(true)
    expect(inferirAnexoPorAtividade('sou comercio').precisaConfirmar).toBe(false)
    expect(inferirAnexoPorAtividade('sou da construcao civil').precisaConfirmar).toBe(false)
  })
})

describe('08-00/08-01 guard Fator R', () => {
  it('Anexo I nao menciona Fator R', async () => {
    const r = await responderChat('Quanto vou pagar de imposto no Anexo I do simples nacional? RBT12 12 mil e receita do mes 36 mil?', [])
    expect(r.texto).toContain('R$')
    expect(r.texto).not.toMatch(/Fator R/i)
    expect(r.texto).not.toMatch(/III.*V|V.*III/)
    expect(r.fontes.join(' ')).not.toMatch(/Fator R/)
  })
  it('Anexo II e IV tambem suprimem Fator R', async () => {
    for (const a of ['II', 'IV'] as const) {
      const r = await responderChat(`Anexo ${a}, RBT12 500 mil, receita 40 mil`, [])
      expect(r.texto).not.toMatch(/Fator R/i)
    }
  })
  it('Anexo III mantem Fator R', async () => {
    const r = await responderChat('Anexo III, RBT12 500 mil, receita 40 mil', [])
    expect(r.texto).toMatch(/Fator R/i)
  })
  it('sou comercio com valores calcula Anexo I sem Fator R', async () => {
    const r = await responderChat('sou comercio, RBT12 12 mil e receita 36 mil', [])
    expect(r.texto).toMatch(/Anexo I/)
    expect(r.texto).not.toMatch(/Fator R/i)
  })
  it('sou medico sem folha sugere V + pede folha', async () => {
    const r = await responderChat('sou medico, RBT12 500 mil, receita 40 mil', [])
    expect(r.texto).toMatch(/Anexo V/)
    expect(r.texto).toMatch(/folha/i)
  })
  it('MEI orienta sem calcular', async () => {
    const r = await responderChat('sou MEI, quanto pago? RBT12 50 mil receita 5 mil', [])
    expect(r.texto).toMatch(/MEI/i)
    expect(r.texto).not.toMatch(/Alíquota efetiva/)
  })
})

describe('08-02 comparativos com valores da conversa', () => {
  it('matriz I-V com payload', async () => {
    const r = await responderChat('__COMPARAR_ANEXOS__ RBT12=12000 RECEITA=36000 FOLHA=0 ANEXO_ATUAL=I', [])
    expect(r.texto).toMatch(/Anexo I/)
    expect(r.texto).toMatch(/Anexo V/)
    expect(r.texto).toMatch(/Menor carga/)
  })
  it('hibrido com payload avisa sem despesas', async () => {
    const r = await responderChat('__COMPARAR_HIBRIDO__ RBT12=12000 RECEITA=36000 FOLHA=0 ANEXO=I DESPESA=0', [])
    expect(r.texto).toMatch(/Híbrido|Convencional|Empate/)
    expect(r.texto).toMatch(/despesas/i)
  })
  it('payload adulterado pergunta em vez de chutar', async () => {
    const r = await responderChat('__COMPARAR_ANEXOS__ RBT12=abc RECEITA=xyz', [])
    expect(r.texto).toMatch(/preciso de RBT12/i)
  })
})
