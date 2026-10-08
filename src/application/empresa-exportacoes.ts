/**
 * Exportações a partir da tela da empresa — paridade com a interface nativa
 * de Produtos (`ModalExportacaoGeral`, escopo `produto`).
 *
 * Reusa os mesmos motores (`exportarTabelasCSV/XLSX/PDF` + colunas
 * discriminadas entrada × saída): o que sai daqui é byte a byte idêntico
 * ao que sairia da tela de Produtos com a mesma empresa ativa.
 */
import { EMITENTE_PADRAO, type Empresa, type Emitente, type Produto } from '@/domain/entities'
import { REF_DEFAULT } from '@/domain/constants'

export type FormatoEmpresa = 'csv' | 'xlsx' | 'pdf'

/** Produtos da empresa (ordenados por SKU, como no resumo do detalhe). */
export async function produtosDaEmpresa(empresaId: number): Promise<Produto[]> {
  const { db } = await import('@/infrastructure/db/schema')
  try {
    const lista = await db.produtos.where('empresaId').equals(empresaId).toArray()
    return lista.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR'))
  } catch {
    return []
  }
}

/**
 * Exporta os produtos da empresa no formato pedido — mesmos motores da
 * tela de Produtos (CSV `;` + BOM, XLSX com colunas entrada × saída, PDF
 * de conferência com timbrado). Lança quando não há nada para exportar.
 */
export async function exportarProdutosDaEmpresa(
  empresa: Empresa,
  formato: FormatoEmpresa,
  opts?: { emitente?: Emitente | null; colunasProdutos?: string[] },
): Promise<void> {
  if (empresa.id == null) throw new Error('Empresa sem id — salve o cadastro antes de exportar.')
  const filtro = { texto: '', empresaId: empresa.id }
  const colunas = opts?.colunasProdutos?.length ? { produtos: opts.colunasProdutos } : undefined
  if (formato === 'csv') {
    const { exportarTabelasCSV } = await import('./exportacao-geral')
    const n = await exportarTabelasCSV(['produtos'], filtro, colunas)
    void n
    return
  }
  if (formato === 'xlsx') {
    const { exportarTabelasXLSX } = await import('./exportacao-geral')
    await exportarTabelasXLSX(['produtos'], filtro, colunas)
    return
  }
  const { exportarTabelasPDF } = await import('./exportacao-geral')
  await exportarTabelasPDF(['produtos'], filtro, {
    empresa,
    emitente: opts?.emitente ?? EMITENTE_PADRAO,
  }, colunas)
}

/**
 * Relatório rico de produtos da empresa (mesmo `exportarProdutosPDF` dos
 * relatórios — faixa de totais IBS/CBS + tabela densa). Usado como
 * alternativa "PDF completo" ao PDF de conferência da exportação geral.
 */
export async function exportarProdutosRicoDaEmpresa(
  empresa: Empresa,
  emitente?: Emitente | null,
): Promise<void> {
  if (empresa.id == null) throw new Error('Empresa sem id — salve o cadastro antes de exportar.')
  const produtos = await produtosDaEmpresa(empresa.id)
  if (!produtos.length) throw new Error('Nenhum produto cadastrado para esta empresa.')
  const { exportarProdutosPDF } = await import('@/infrastructure/exporters/relatorios')
  await exportarProdutosPDF({
    produtos,
    empresa,
    emitente: emitente ?? EMITENTE_PADRAO,
    refIBS: REF_DEFAULT.IBS,
    refCBS: REF_DEFAULT.CBS,
  })
}
