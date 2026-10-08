/**
 * CFOP × crédito/débito + naturezas da operação (bloco acima dos gráficos).
 * Testes puros da curadoria sobre `bases-fonte/cfop.json`.
 */
import { describe, expect, it } from 'vitest'
import {
  CFOP_SEM_EFEITO,
  classificarCfop,
  classificarNatOp,
  efeitoDoItem,
  IMUNIDADES_LC214,
  normalizarCfop,
  resumirNaturezas,
  sinalImunidadeLC,
} from '@/infrastructure/nfe/cfop'

describe('normalizarCfop', () => {
  it('reduz para 4 dígitos', () => {
    expect(normalizarCfop('5.102')).toBe('5102')
    expect(normalizarCfop('1102')).toBe('1102')
    expect(normalizarCfop('')).toBe('')
  })
})

describe('classificarCfop', () => {
  it('compra p/ comercialização gera crédito', () => {
    const c = classificarCfop('1102', 'COMPRA', 'entrada')
    expect(c.efeito).toBe('compra-gera')
    expect(c.geraCredito).toBe(true)
  })

  it('venda gera débito na saída', () => {
    const c = classificarCfop('5102', 'VENDA', 'saida')
    expect(c.efeito).toBe('venda')
    expect(c.geraDebito).toBe(true)
    expect(c.geraCredito).toBe(false)
  })

  it('compra p/ imobilizado não gera crédito', () => {
    for (const cfop of ['1551', '2551', '3551']) {
      const c = classificarCfop(cfop, 'COMPRA DE BEM PARA O ATIVO IMOBILIZADO', 'entrada')
      expect(c.efeito).toBe('imobilizado')
      expect(c.geraCredito).toBe(false)
    }
  })

  it('uso e consumo não gera crédito', () => {
    const c = classificarCfop('1556', 'COMPRA DE MATERIAL PARA USO OU CONSUMO', 'entrada')
    expect(c.efeito).toBe('imobilizado')
    expect(c.geraCredito).toBe(false)
  })

  it('diferente de venda não gera nada', () => {
    for (const cfop of ['5910', '5949', '1949', '5201', '5152']) {
      const c = classificarCfop(cfop, 'REMESSA', cfop.startsWith('1') ? 'entrada' : 'saida')
      expect(c.efeito).toBe('sem-efeito')
      expect(c.geraCredito).toBe(false)
      expect(c.geraDebito).toBe(false)
    }
  })

  it('exportação sinaliza imunidade da LC', () => {
    const c = classificarCfop('7102', 'EXPORTACAO', 'saida')
    expect(c.imunidadeLC).toContain('Exportação')
    expect(sinalImunidadeLC('7102', 'VENDA')).toContain('Exportação')
    expect(sinalImunidadeLC('5102', 'VENDA')).toBeNull()
  })

  it('natureza desempatata quando o CFOP não está nas listas', () => {
    expect(efeitoDoItem('9999', 'REMESSA EM BONIFICACAO', 'saida')).toBe('sem-efeito')
    expect(efeitoDoItem('9999', 'VENDA DE MERCADORIA', 'saida')).toBe('venda')
    expect(efeitoDoItem('', 'VENDA', 'entrada')).toBe('compra-gera')
  })

  it('tabela de sem-efeito cobre os núcleos pedidos', () => {
    for (const cfop of ['1910', '5910', '1949', '5949', '1551', '5201', '6201', '5152', '6152']) {
      if (cfop === '1551') continue // imobilizado tem conjunto próprio
      expect(CFOP_SEM_EFEITO.has(cfop)).toBe(true)
    }
  })
})

describe('classificarNatOp', () => {
  it('venda, não-venda, imobilizado e indefinida', () => {
    expect(classificarNatOp('VENDA DE MERCADORIA ADQUIRIDA')).toBe('venda')
    expect(classificarNatOp('REMESSA EM BONIFICACAO')).toBe('nao-venda')
    expect(classificarNatOp('COMPRA DE BEM PARA O ATIVO IMOBILIZADO')).toBe('imobilizado')
    expect(classificarNatOp('')).toBe('indefinida')
    expect(classificarNatOp('EXPORTACAO DE MERCADORIAS')).toBe('nao-venda')
  })

  it('venda sob ST por contribuinte substituído é venda (ST é outro assunto)', () => {
    expect(classificarNatOp('VENDA MERCADORIA SOB O REG DE ST POR CONTR SUBSTITUIDO')).toBe('venda')
    expect(classificarNatOp('VENDA PROD ESTAB - CONT SUBSTITUID')).toBe('venda')
    // Sem VENDA explícita, substituição de mercadoria segue não-venda.
    expect(classificarNatOp('REMESSA PARA SUBSTITUICAO DE PECA')).toBe('nao-venda')
    expect(classificarNatOp('SUBSTITUICAO DE MERCADORIA')).toBe('nao-venda')
    // Guardas: devolução/retorno com a palavra VENDA continuam não-venda.
    expect(classificarNatOp('DEVOLUCAO DE VENDA')).toBe('nao-venda')
    expect(classificarNatOp('RETORNO DE MERCADORIA PARA VENDA')).toBe('nao-venda')
  })
})

describe('resumirNaturezas', () => {
  const notaBase = {
    chave: 'x', numero: '1', emitCnpj: '111', emitNome: 'F1',
    direcao: 'entrada' as const, valorTotal: 100, itensAnalisados: [{ cfop: '1102' }],
  }

  it('ignora notas de venda pura', () => {
    const r = resumirNaturezas([{ ...notaBase, natOp: 'VENDA' }])
    expect(r.qtdNaoVenda).toBe(0)
    expect(r.grupos).toHaveLength(0)
  })

  it('separa natureza diferente de venda por fornecedor/nota', () => {
    const r = resumirNaturezas([
      { ...notaBase, chave: 'a', numero: '10', emitNome: 'Fornecedor A', natOp: 'REMESSA EM BONIFICACAO', valorTotal: 50, itensAnalisados: [{ cfop: '5910' }] },
      { ...notaBase, chave: 'b', numero: '11', emitNome: 'Fornecedor B', natOp: 'COMPRA PARA ATIVO IMOBILIZADO', valorTotal: 5000, itensAnalisados: [{ cfop: '1551' }] },
      { ...notaBase, chave: 'c', numero: '12', natOp: 'VENDA' },
    ])
    expect(r.totalNotas).toBe(3)
    expect(r.qtdNaoVenda).toBe(2)
    expect(r.qtdImobilizado).toBe(1)
    expect(r.valorImobilizado).toBe(5000)
    expect(r.qtdSemEfeito).toBe(1)
    expect(r.grupos).toHaveLength(2)
    expect(r.grupos[0].notas[0].emitNome).toBe('Fornecedor B')
  })

  it('CFOP restritivo entra mesmo com capa de venda', () => {
    const r = resumirNaturezas([
      { ...notaBase, chave: 'a', natOp: 'VENDA', itensAnalisados: [{ cfop: '5910' }] },
    ])
    expect(r.qtdNaoVenda).toBe(1)
    expect(r.qtdSemEfeito).toBe(1)
  })

  it('venda sob ST por substituído não cai no bloco de não-venda', () => {
    const r = resumirNaturezas([
      {
        ...notaBase,
        chave: 'st1',
        natOp: 'VENDA MERCADORIA SOB O REG DE ST POR CONTR SUBSTITUIDO',
        itensAnalisados: [{ cfop: '5405' }],
      },
    ])
    expect(r.qtdNaoVenda).toBe(0)
    expect(r.grupos).toHaveLength(0)
  })

  it('expõe a seção de imunidades da LC para comparação', () => {
    expect(IMUNIDADES_LC214.length).toBeGreaterThanOrEqual(4)
    expect(IMUNIDADES_LC214.some((i) => /export/i.test(i.titulo))).toBe(true)
  })
})
