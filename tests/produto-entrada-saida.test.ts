/** Validação multiagente + entrada×saída (tributação antiga; Reforma imutável). */
import { beforeEach, describe, expect, it } from 'vitest'
import { salvarProduto, normalizarFluxo, distribuirCfopUnico, rotuloTributacaoAnterior } from '@/application/produtos'
import { validarProdutoMultiagente } from '@/domain/services/validacao-produto'
import { db } from '@/infrastructure/db/schema'
import type { Classificacao } from '@/domain/entities'
import type { EntradaProduto } from '@/application/produtos'

function classificacao(): Classificacao {
  return {
    id: 'X|02011000', codigo: '02011000', codigoFormatado: '0201.10.00',
    cst: '000', cClassTrib: '000001', baseLegal: 'LC 214/2025', descricao: 'x',
    vinculo: null, cstDetalhes: null, cstClassTribDetalhes: null, referencia: null,
    resumo: { descricaoCClassTrib: 'Integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    regraGeral: true,
  }
}

function entrada(alt: Partial<EntradaProduto> = {}): EntradaProduto {
  return {
    empresaId: null, codigo: 'SKU-E1', nome: 'Prod E/S', ncm: '02011000',
    cfopEntrada: '1102', cfopSaida: '5102',
    cstIcmsEntrada: '000', cstIcmsSaida: '010',
    pisEntrada: '01', pisSaida: '01', cofinsEntrada: '01', cofinsSaida: '01',
    quantidade: 1, valorUnitario: 10, classificacao: classificacao(), ...alt,
  }
}

beforeEach(async () => {
  await db.produtos.clear()
  await db.cfop.clear().catch(() => undefined)
  await db.table('cfop').bulkPut([
    { codigo: '1102', descricao: 'Compra para comercialização', tipo: 'Entrada' },
    { codigo: '5102', descricao: 'Venda de mercadoria', tipo: 'Saída' },
  ] as never[]).catch(() => undefined)
})

describe('normalizarFluxo / distribuirCfopUnico', () => {
  it('legado preenche ambos os fluxos', () => {
    expect(normalizarFluxo({ cfop: '5102' } as EntradaProduto).cfopEntrada).toBe('5102')
    expect(normalizarFluxo({ cfop: '5102' } as EntradaProduto).cfopSaida).toBe('5102')
  })
  it('distribui CFOP único pelo 1º dígito', () => {
    expect(distribuirCfopUnico('1102')).toEqual({ cfopEntrada: '1102', cfopSaida: '' })
    expect(distribuirCfopUnico('5102')).toEqual({ cfopEntrada: '', cfopSaida: '5102' })
  })
  it('rótulo resume entrada × saída', () => {
    expect(rotuloTributacaoAnterior({ cfopEntrada: '1102', cfopSaida: '5102' } as never)).toContain('E:')
  })
})

describe('validarProdutoMultiagente', () => {
  it('aprova entrada/saída válidos (avisos não bloqueiam)', async () => {
    const v = await validarProdutoMultiagente(entrada())
    expect(v.ok).toBe(true)
    expect(v.porAgente.map((a) => a.agente)).toEqual(['sintaxe', 'auxiliar', 'coerencia', 'reforma-imutavel', 'sku'])
  })
  it('bloqueia CFOP com formato inválido', async () => {
    const v = await validarProdutoMultiagente(entrada({ cfopEntrada: 'AB' }))
    expect(v.ok).toBe(false)
    expect(v.bloqueios.join(' ')).toMatch(/CFOP entrada/)
  })
  it('avisa CFOP de entrada com dígito de saída', async () => {
    const v = await validarProdutoMultiagente(entrada({ cfopEntrada: '5102', cfopSaida: '5102' }))
    expect(v.ok).toBe(true)
    expect(v.avisos.join(' ')).toMatch(/entrada.*Saída|iguais/)
  })
  it('bloqueia campo da Reforma via formulário antigo', async () => {
    const v = await validarProdutoMultiagente({ ...entrada(), cstReforma: '000' } as unknown as EntradaProduto)
    expect(v.ok).toBe(false)
    expect(v.bloqueios.join(' ')).toMatch(/Reforma/)
  })
  it('bloqueia SKU/NCM inválidos antes do banco', async () => {
    const v = await validarProdutoMultiagente(entrada({ codigo: '  ', ncm: '123' }))
    expect(v.ok).toBe(false)
  })
  it('bloqueia NBS (9 dígitos) no CFOP com mensagem dedicada', async () => {
    const v = await validarProdutoMultiagente(entrada({ cfopEntrada: '123456789' }))
    expect(v.ok).toBe(false)
    expect(v.bloqueios.join(' ')).toMatch(/NBS/)
  })
  it('bloqueia NBS (9 dígitos) no NCM com mensagem dedicada', async () => {
    const v = await validarProdutoMultiagente(entrada({ ncm: '123456789' }))
    expect(v.ok).toBe(false)
    expect(v.bloqueios.join(' ')).toMatch(/NBS/)
  })
})

describe('salvarProduto com fluxos', () => {
  it('grava entrada × saída e mantém legado como fallback', async () => {
    const r = await salvarProduto(entrada())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.produto.cfopEntrada).toBe('1102')
    expect(r.produto.cfopSaida).toBe('5102')
    expect(r.produto.cfop).toBe('1102')
    expect(r.produto.cstIcmsEntrada).toBe('000')
    expect(r.produto.pisSaida).toBe('01')
  })
  it('rejeita formato inválido sem escrever', async () => {
    const r = await salvarProduto(entrada({ cfopSaida: 'ZZ' }))
    expect(r.ok).toBe(false)
    expect(await db.produtos.count()).toBe(0)
  })
  it('migra legado antigo para ambos os fluxos', async () => {
    const r = await salvarProduto(entrada({ cfopEntrada: '', cfopSaida: '', cfop: '5102', cstIcms: '000', pis: '01', cofins: '01' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.produto.cfopEntrada).toBe('5102')
    expect(r.produto.cfopSaida).toBe('5102')
  })
  it('rejeita NBS no CFOP e no NCM sem escrever', async () => {
    const r1 = await salvarProduto(entrada({ codigo: 'SKU-NBS1', cfopEntrada: '123456789' }))
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.motivo).toMatch(/NBS/)
    const r2 = await salvarProduto(entrada({ codigo: 'SKU-NBS2', ncm: '123456789' }))
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.motivo).toMatch(/NBS/)
    expect(await db.produtos.count()).toBe(0)
  })
})
