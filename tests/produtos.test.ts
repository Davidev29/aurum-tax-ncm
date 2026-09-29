/**
 * Casos de uso de produtos (SPEC §8) — sobretudo o **upsert por SKU**, que a v1
 * não tinha (`[BUG] L1237/L1684/L1810/L1026`): reexecutar "salvar todos" não
 * pode duplicar o cadastro.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  atualizarValoresProduto,
  classificacaoDeItemManual,
  entradaProdutoDeFormulario,
  excluirProduto,
  listarProdutos,
  produtoLinha,
  produtoPorSku,
  salvarProduto,
  salvarProdutosEmLote,
  snapshotDe,
} from '@/application/produtos'
import { db } from '@/infrastructure/db/schema'
import type { Classificacao } from '@/domain/entities'
import type { EntradaProduto } from '@/application/produtos'

/* --------------------------------------------------------------- fixtures -- */

function classificacao(alt: Partial<Classificacao> = {}): Classificacao {
  return {
    id: 'X|02011000',
    codigo: '02011000',
    codigoFormatado: '0201.10.00',
    cst: '000',
    cClassTrib: '000001',
    baseLegal: 'LC 214/2025',
    descricao: 'Carne bovina',
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: {
      descricaoCClassTrib: 'Tributação integral',
      percentualReducaoIBS: 0,
      percentualReducaoCBS: 0,
      anexo: null,
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: true,
    ...alt,
  }
}

function entrada(alt: Partial<EntradaProduto> = {}): EntradaProduto {
  return {
    empresaId: null,
    codigo: 'SKU-0001',
    nome: 'Queijo Minas',
    ncm: '0201.10.00',
    cfop: '5102',
    cstIcms: '000',
    pis: '01',
    cofins: '01',
    quantidade: 2,
    valorUnitario: 19.9,
    classificacao: classificacao(),
    ...alt,
  }
}

beforeEach(async () => {
  await db.produtos.clear()
})

/* ------------------------------------------------------------- snapshot -- */

describe('snapshotDe', () => {
  it('congela reduções, anexo e descrição a partir do resumo', () => {
    const s = snapshotDe(
      classificacao({
        resumo: {
          descricaoCClassTrib: 'Alíquota zero',
          percentualReducaoIBS: 100,
          percentualReducaoCBS: 60,
          anexo: '60',
          urlLegislacao: null,
          documentosHabilitados: null,
        },
      }),
    )
    expect(s).toMatchObject({
      codigo: '02011000',
      codigoFormatado: '0201.10.00',
      pRedIBS: 100,
      pRedCBS: 60,
      anexo: '60',
      classificacao: 'Alíquota zero',
    })
  })
})

/* -------------------------------------------------------------- escrita -- */

describe('salvarProduto', () => {
  it('cria um produto novo', async () => {
    const r = await salvarProduto(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('criado')
    expect(r.produto.id).toBeDefined()
    expect(r.produto.ncm).toBe('02011000') // normalizado
    expect(r.produto.codigo).toBe('SKU-0001')
    expect(await db.produtos.count()).toBe(1)
  })

  it('SKU repetido na mesma empresa é bloqueado (sem `forcar`)', async () => {
    await salvarProduto(entrada())
    const r = await salvarProduto(entrada({ nome: 'Outro nome' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toContain('Já existe o SKU "SKU-0001"')
    expect(r.existente?.nome).toBe('Queijo Minas')
    expect(await db.produtos.count()).toBe(1)
  })

  it('com `forcar` atualiza em vez de duplicar', async () => {
    const primeiro = await salvarProduto(entrada())
    if (!primeiro.ok) throw new Error('falha ao criar')

    const r = await salvarProduto(entrada({ nome: 'Nome novo', valorUnitario: 25 }), { forcar: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('atualizado')
    expect(r.produto.id).toBe(primeiro.produto.id)
    expect(r.produto.criadoEm).toBe(primeiro.produto.criadoEm)
    expect(r.produto.nome).toBe('Nome novo')
    expect(r.produto.valorUnitario).toBe(25)
    expect(await db.produtos.count()).toBe(1)
  })

  it('modo edição atualiza o registro indicado', async () => {
    const primeiro = await salvarProduto(entrada())
    if (!primeiro.ok) throw new Error('falha ao criar')
    await salvarProduto(entrada({ codigo: 'SKU-0002' }))

    const r = await salvarProduto(entrada({ nome: 'Editado' }), { editarId: primeiro.produto.id! })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.status).toBe('atualizado')
    expect(r.produto.id).toBe(primeiro.produto.id)
    expect(r.produto.criadoEm).toBe(primeiro.produto.criadoEm)
    expect(r.produto.nome).toBe('Editado')
    expect(await db.produtos.count()).toBe(2)
  })

  it('edição de registro inexistente falha sem tocar no banco', async () => {
    const r = await salvarProduto(entrada(), { editarId: 999 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('Produto não encontrado para edição.')
    expect(await db.produtos.count()).toBe(0)
  })

  it('valida antes de escrever', async () => {
    const casos: [EntradaProduto, string][] = [
      [entrada({ codigo: '   ' }), 'Informe o SKU.'],
      [entrada({ nome: '' }), 'Informe o nome do produto.'],
      [entrada({ ncm: '0201100' }), 'NCM deve ter 8 dígitos.'],
      [entrada({ classificacao: null as never }), 'Escolha uma classificação na lateral.'],
    ]
    for (const [e, motivo] of casos) {
      const r = await salvarProduto(e)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toBe(motivo)
    }
    expect(await db.produtos.count()).toBe(0)
  })

  it('o SKU é comparado dentro da empresa ativa', async () => {
    expect((await salvarProduto(entrada())).ok).toBe(true)
    expect((await salvarProduto(entrada())).ok).toBe(false) // mesma empresa (null)

    const outra = await salvarProduto(entrada({ empresaId: 7 }))
    expect(outra.ok).toBe(true)

    expect(await db.produtos.count()).toBe(2)
    expect((await produtoPorSku(null, 'SKU-0001'))?.empresaId).toBeNull()
    expect((await produtoPorSku(7, 'SKU-0001'))?.empresaId).toBe(7)
    expect(await produtoPorSku(8, 'SKU-0001')).toBeUndefined()
  })

  it('sem empresa ativa não reaproveita SKU de outra empresa (escopo exato)', async () => {
    await salvarProduto(entrada({ empresaId: 7 }))
    // Mesmo SKU, agora no escopo "sem empresa": deve criar uma linha nova.
    const r = await salvarProduto(entrada())
    expect(r.ok).toBe(true)
    expect(await db.produtos.count()).toBe(2)
    expect((await produtoPorSku(null, 'SKU-0001'))?.empresaId).toBeNull()
    expect((await produtoPorSku(7, 'SKU-0001'))?.empresaId).toBe(7)
  })

  it('listarProdutos separa por empresa e ordena por SKU', async () => {
    await salvarProduto(entrada({ codigo: 'B' }))
    await salvarProduto(entrada({ codigo: 'A' }))
    await salvarProduto(entrada({ codigo: 'C', empresaId: 3 }))

    expect((await listarProdutos(null)).map((p) => p.codigo)).toEqual(['A', 'B', 'C'])
    expect((await listarProdutos(3)).map((p) => p.codigo)).toEqual(['C'])
    expect(await listarProdutos(9)).toEqual([])
  })
})

/* -------------------------------------------------------- gravação lote -- */

describe('salvarProdutosEmLote', () => {
  const itens = () => [
    { codigo: 'L1', nome: 'Um', ncm: '02011000', classificacao: classificacao() },
    { codigo: 'L2', nome: 'Dois', ncm: '84713012', classificacao: classificacao() },
    { codigo: '   ', nome: 'Sem SKU', ncm: '02011000', classificacao: classificacao() },
  ]

  it('cria novos e ignora linhas sem SKU', async () => {
    const c = await salvarProdutosEmLote(itens(), null)
    expect(c).toEqual({ salvos: 2, atualizados: 0, ignorados: 1 })
    expect(await db.produtos.count()).toBe(2)
  })

  it('reexecutar atualiza em vez de duplicar (bug da v1)', async () => {
    await salvarProdutosEmLote(itens(), null)
    const segunda = await salvarProdutosEmLote(
      itens().map((i) => ({ ...i, nome: 'Atualizado' })),
      null,
    )
    expect(segunda).toEqual({ salvos: 0, atualizados: 2, ignorados: 1 })
    expect(await db.produtos.count()).toBe(2)
    expect((await produtoPorSku(null, 'L1'))?.nome).toBe('Atualizado')
  })

  it('reporta progresso', async () => {
    const chamadas: [number, number][] = []
    await salvarProdutosEmLote(itens(), null, (f, t) => chamadas.push([f, t]))
    // Feito = linhas na fila; total = linhas do arquivo (a sem SKU não entra).
    expect(chamadas.at(-1)).toEqual([2, 3])
    expect(chamadas.every(([, t]) => t === 3)).toBe(true)
  })
})

/* ---------------------------------------------------------- update/delete -- */

describe('atualizarValoresProduto / excluirProduto', () => {
  it('atualiza apenas quantidade e valor', async () => {
    const r = await salvarProduto(entrada())
    if (!r.ok) throw new Error('falha')
    await atualizarValoresProduto(r.produto.id!, 10, 99.5)
    const atual = await db.produtos.get(r.produto.id!)
    expect(atual?.quantidade).toBe(10)
    expect(atual?.valorUnitario).toBe(99.5)
    expect(atual?.nome).toBe('Queijo Minas')
  })

  it('ignora id inexistente', async () => {
    await expect(atualizarValoresProduto(42, 1, 1)).resolves.toBeUndefined()
  })

  it('exclui por id', async () => {
    const r = await salvarProduto(entrada())
    if (!r.ok) throw new Error('falha')
    await excluirProduto(r.produto.id!)
    expect(await db.produtos.count()).toBe(0)
  })
})

/* --------------------------------------------------------- apresentação -- */

describe('apresentação', () => {
  it('produtoLinha deriva totais e reduções do snapshot', async () => {
    const r = await salvarProduto(
      entrada({
        classificacao: classificacao({
          resumo: {
            descricaoCClassTrib: 'Redução 60%',
            percentualReducaoIBS: 60,
            percentualReducaoCBS: 60,
            anexo: null,
            urlLegislacao: null,
            documentosHabilitados: null,
          },
        }),
      }),
    )
    if (!r.ok) throw new Error('falha')
    const linha = produtoLinha(r.produto, new Map())
    expect(linha.redIBS).toBe(60)
    expect(linha.redCBS).toBe(60)
    expect(linha.descClass).toBe('Redução 60%')
    expect(linha.total).toBeCloseTo(39.8, 9)
    expect(linha.empresaNome).toBeNull()
  })

  it('produtoLinha resolve o nome da empresa', async () => {
    const r = await salvarProduto(entrada({ empresaId: 4 }))
    if (!r.ok) throw new Error('falha')
    const linha = produtoLinha(r.produto, new Map([[4, 'Empresa X']]))
    expect(linha.empresaNome).toBe('Empresa X')
    expect(produtoLinha({ ...r.produto, empresaId: 5 }, new Map()).empresaNome).toBe('Empresa #5')
  })

  it('entradaProdutoDeFormulario aplica as máscaras da v1', () => {
    const e = entradaProdutoDeFormulario(
      { codigo: ' A ', nome: ' B ', ncm: '02.01.10.00', qtd: '1.234,5', valor: 'R$ 19,90' },
      classificacao(),
      2,
    )
    expect(e).toMatchObject({
      empresaId: 2,
      codigo: 'A',
      nome: 'B',
      ncm: '02011000',
      quantidade: 1234.5,
      valorUnitario: 19.9,
    })
  })

  it('classificacaoDeItemManual preenche o fallback da regra geral', () => {
    const cl = classificacaoDeItemManual({
      ncm: '84713012',
      nome: 'Notebook',
      cst: '',
      cClassTrib: '',
      descClass: 'Regra geral',
      redIBS: 0,
      redCBS: 0,
      regraGeral: true,
      baseLegal: 'LC 214/2025',
      quantidade: 1,
      valorUnitario: 100,
    })
    expect(cl).toMatchObject({
      id: 'MANUAL|84713012',
      codigo: '84713012',
      cst: '000',
      cClassTrib: '000001',
      regraGeral: true,
    })
    expect(cl.resumo.percentualReducaoIBS).toBe(0)
  })
})
