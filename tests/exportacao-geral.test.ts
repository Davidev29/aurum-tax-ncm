/** Exportação geral: coleta com filtro + CSV/XLSX/PDF. */
import { beforeEach, describe, expect, it } from 'vitest'
import { salvarProduto } from '@/application/produtos'
import { coletarTabela, colunasDe, contarTabelas, tabelaParaCSV, TABELAS_EXPORTAVEIS, tabelasDoEscopo, linhaProdutoParaExportacao, rotulosProdutos, amostraParaPreview, CHAVES_PRODUTOS_PADRAO } from '@/application/exportacao-geral'
import { db } from '@/infrastructure/db/schema'
import type { Classificacao } from '@/domain/entities'

function classificacao(): Classificacao {
  return {
    id: 'X|02011000', codigo: '02011000', codigoFormatado: '0201.10.00',
    cst: '000', cClassTrib: '000001', baseLegal: 'LC', descricao: 'x',
    vinculo: null, cstDetalhes: null, cstClassTribDetalhes: null, referencia: null,
    resumo: { descricaoCClassTrib: 'Integral', percentualReducaoIBS: 0, percentualReducaoCBS: 0, anexo: null, urlLegislacao: null, documentosHabilitados: null },
    regraGeral: true,
  }
}

beforeEach(async () => {
  await db.produtos.clear()
  await salvarProduto({
    empresaId: null, codigo: 'SKU-X1', nome: 'Queijo Minas', ncm: '02011000',
    cfopEntrada: '1102', cfopSaida: '5102', cstIcmsEntrada: '000', cstIcmsSaida: '010',
    quantidade: 1, valorUnitario: 10, classificacao: classificacao(),
  })
  await salvarProduto({
    empresaId: null, codigo: 'SKU-X2', nome: 'Notebook', ncm: '84713012',
    cfopEntrada: '1102', cfopSaida: '5102',
    quantidade: 1, valorUnitario: 20, classificacao: classificacao(),
  })
})

describe('exportacao-geral', () => {
  it('expõe todas as tabelas principais', () => {
    const stores = TABELAS_EXPORTAVEIS.map((t) => t.store)
    for (const s of ['produtos', 'empresas', 'nfeNotas', 'cfop', 'cstIcms', 'cstPisCofins', 'audit_log']) {
      expect(stores).toContain(s)
    }
  })
  it('conta e filtra por texto (o que se vê é o que sai)', async () => {
    const todas = await contarTabelas({ texto: '', empresaId: null })
    expect(todas.produtos).toBe(2)
    const filtro = await coletarTabela('produtos', { texto: 'queijo', empresaId: null })
    expect(filtro.length).toBe(1)
    expect(String((filtro[0] as Record<string, unknown>).codigo)).toBe('SKU-X1')
  })
  it('respeita escopo de empresa', async () => {
    const fora = await coletarTabela('produtos', { texto: '', empresaId: 999 })
    expect(fora.length).toBe(0)
  })
  it('CSV contém colunas entrada × saída', async () => {
    const linhas = await coletarTabela('produtos', { texto: '', empresaId: null })
    const cols = colunasDe(linhas, 40)
    expect(cols).toContain('cfopEntrada')
    expect(cols).toContain('cfopSaida')
    const csv = tabelaParaCSV(linhas)
    expect(csv).toContain('CFOP entrada')
    expect(csv).toContain('CFOP saída')
    expect(csv).toContain('SKU-X1')
  })
  it('escopo produto: só tabelas de produto (sem NBS, sem CNAE, sem empresas/notas)', () => {
    const geral = tabelasDoEscopo('geral').map((t) => t.store)
    const produto = tabelasDoEscopo('produto').map((t) => t.store)
    expect(geral).toContain('nbs')
    expect(geral).toContain('cnae')
    for (const fora of ['nbs', 'cnae', 'empresas', 'nfeNotas', 'audit_log', 'anexos']) {
      expect(produto).not.toContain(fora)
    }
    for (const dentro of ['produtos', 'cfop', 'cstIcms', 'cstPisCofins', 'cest', 'ncm', 'referencia']) {
      expect(produto).toContain(dentro)
    }
  })
  it('CFOP entrada × saída discriminados: o usuário escolhe as colunas', async () => {
    const linhas = await coletarTabela('produtos', { texto: '', empresaId: null })
    expect(linhas.length).toBe(2)
    // Só saída: entrada não aparece no cabeçalho nem nos valores.
    const csvSaida = tabelaParaCSV(linhas, 'produtos', ['codigo', 'cfopSaida'])
    const [cabSaida, ...corpoSaida] = csvSaida.replace('﻿', '').split('\r\n')
    expect(cabSaida).toBe('SKU;CFOP saída')
    expect(corpoSaida.join('\n')).toContain('5102')
    expect(corpoSaida.join('\n')).not.toContain('1102')
    // Só entrada: o inverso.
    const csvEntrada = tabelaParaCSV(linhas, 'produtos', ['codigo', 'cfopEntrada'])
    const [cabEntrada, ...corpoEntrada] = csvEntrada.replace('﻿', '').split('\r\n')
    expect(cabEntrada).toBe('SKU;CFOP entrada')
    expect(corpoEntrada.join('\n')).toContain('1102')
    // Linha direta respeita a ordem das colunas pedidas.
    const linha = linhaProdutoParaExportacao(linhas[0] as Record<string, unknown>, ['cfopSaida', 'cfopEntrada', 'codigo'])
    expect(linha).toEqual(['5102', '1102', 'SKU-X1'])
    expect(rotulosProdutos(['cfopSaida', 'cfopEntrada'])).toEqual(['CFOP saída', 'CFOP entrada'])
  })
  it('amostraParaPreview reflete as colunas escolhidas', async () => {
    const linhas = await coletarTabela('produtos', { texto: '', empresaId: null })
    const amostra = amostraParaPreview('produtos', linhas as Record<string, unknown>[], ['codigo', 'cfopSaida'])
    expect(amostra.cols).toEqual(['SKU', 'CFOP saída'])
    expect(amostra.rows[0]).toEqual(['SKU-X1', '5102'])
    const padrao = amostraParaPreview('produtos', linhas as Record<string, unknown>[], CHAVES_PRODUTOS_PADRAO)
    expect(padrao.cols).toContain('CFOP entrada')
    expect(padrao.cols).toContain('CFOP saída')
  })
})
