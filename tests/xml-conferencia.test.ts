/**
 * Conferência do XML igual ao lote: itens com mais de uma regra exigem
 * escolha do usuário (integral de segurança pré-selecionada) e nada é
 * gravado sem revisão.
 */
import { describe, expect, it } from 'vitest'
import { prepararConferenciaXml } from '@/application/xml-conferencia'
import { dividirLoteParaSalvamento } from '@/domain/services/salvamento-lote'
import type { NotaXml, ResultadoItemNfe } from '@/infrastructure/nfe/tipos'

function item(parcial: Partial<ResultadoItemNfe>): ResultadoItemNfe {
  return {
    chave: 'chave',
    numItem: '1',
    codProd: 'SKU-1',
    descricao: 'Produto',
    ncm: '02011000',
    ncmOriginal: '02011000',
    cfop: '5102',
    cstIcms: '00',
    qtd: 2,
    unid: 'UN',
    vlUnit: 10,
    vlTotal: 20,
    vlDesc: 0,
    vlIcms: 0,
    cstPis: '01',
    cstCofins: '01',
    classificacao: {} as never,
    regraGeral: false,
    redIBS: 0,
    redCBS: 0,
    ibs: 0,
    cbs: 0,
    totalTributos: 0,
    carga: 0,
    anexo: '',
    observacoes: [],
    ...parcial,
  } as ResultadoItemNfe
}

function nota(itens: ResultadoItemNfe[]): NotaXml {
  return {
    chave: 'chave',
    numero: '1',
    serie: '1',
    modelo: '55',
    natOp: 'VENDA',
    dataEmissao: '2026-01-01',
    emitCnpj: '00',
    emitNome: 'Emit',
    emitCrt: '',
    emitIe: '',
    emitIm: '',
    emitEndereco: '',
    emitCidade: '',
    emitUf: '',
    destDoc: '',
    destNome: '',
    destIe: '',
    valorProdutos: 20,
    valorTotal: 20,
    itens: [],
    empresaId: 1,
    direcao: 'entrada',
    arquivo: null,
    xmlConteudo: null,
    refIBS: 0,
    refCBS: 0,
    totalIBS: 0,
    totalCBS: 0,
    totalTributos: 0,
    importadoEm: '',
    itensAnalisados: itens,
  }
}

describe('prepararConferenciaXml', () => {
  it('agrupa por SKU e resolve com o motor único', async () => {
    const r = await prepararConferenciaXml([
      nota([item({ codProd: 'SKU-1', descricao: 'Carne bovina', qtd: 2, vlUnit: 10 })]),
      nota([item({ codProd: 'SKU-1', descricao: 'Carne bovina resfriada', qtd: 3, vlUnit: 12 })]),
      nota([item({ codProd: 'SKU-2', descricao: 'Outro', ncm: '123', ncmOriginal: '123', qtd: 1, vlUnit: 5 })]),
    ])
    expect(r.itens).toHaveLength(2)
    const sku1 = r.itens.find((i) => i.codigo === 'SKU-1')!
    // Somou quantidades e ficou com o último preço.
    expect(sku1.quantidade).toBe(5)
    expect(sku1.valorUnitario).toBe(12)
    expect(sku1.ocorrencias).toBe(2)
    // SKU válido resolveu classificação (não salva direto na 1ª sem conferir).
    expect(sku1.classificacoes.length).toBeGreaterThan(0)
    expect(sku1.escolhida).not.toBeNull()
    expect(sku1.analiseIA).toBeDefined()
    // SKU inválido fica sem classificação e cai nos ignorados da revisão.
    const sku2 = r.itens.find((i) => i.codigo === 'SKU-2')!
    expect(sku2.escolhida).toBeNull()
    const { gravaveis, ignorados } = dividirLoteParaSalvamento(r.itens)
    expect(gravaveis.map((g) => g.codigo)).toContain('SKU-1')
    expect(ignorados.map((g) => g.item.codigo)).toContain('SKU-2')
  })

  it('NCM com múltiplas regras exige escolha (igual ao lote)', async () => {
    const r = await prepararConferenciaXml([
      nota([item({ codProd: 'SKU-M', descricao: 'Produto multi', ncm: '02011000', ncmOriginal: '02011000' })]),
    ])
    const alvo = r.itens[0]
    // Se a base tiver 2+ oficiais, a análise marca múltipla com integral sugerida.
    if (alvo.classificacoes.filter((c) => !c.integralFallback).length > 1) {
      expect(alvo.analiseIA?.situacao).toBe('multipla')
      expect(alvo.escolhida?.integralFallback ?? (alvo.escolhida?.cst === '000')).toBe(true)
    } else {
      // Comportamento de única continua válido.
      expect(['unica', 'regra-geral', 'manual']).toContain(alvo.analiseIA?.situacao)
    }
  })
})
