/**
 * Exportação geral — **todas as tabelas de dados do sistema**.
 *
 * O botão Exportar abre um modal (filtro + escolha de tabelas + formato):
 * - CSV (um arquivo por tabela, padrão `;` + BOM, Excel-pt-BR);
 * - XLSX (uma pasta de trabalho, uma aba por tabela);
 * - PDF (conferência visual: tabelas resumidas com timbrado).
 *
 * Proteção:
 * - `meta` sensível (`aurum_kek_*`, `aurum_artefato_*`) nunca sai;
 * - filtro de texto aplicado antes de gerar (o que se vê é o que sai);
 * - escopo de empresa aplicado a `produtos`/`nfeNotas` quando houver ativa;
 * - tudo validado/limitado (máx. 5.000 linhas por tabela no PDF/XLSX-preview).
 */
import { db } from '@/infrastructure/db/schema'
import { META_SENSIVEL_PREFIXOS } from '@/application/backup'
import { montarCSV, baixar, tabelaRelatorio } from '@/infrastructure/exporters/relatorios'
import type { Empresa, Emitente } from '@/domain/entities'

export type FormatoExportacao = 'csv' | 'xlsx' | 'pdf'

/** Onde a tabela aparece: `produto` (tela Produtos) × `geral` (só geral) × `servico` (só geral, serviços). */
export type EscopoTabela = 'produto' | 'geral' | 'servico'

export interface TabelaExportavel {
  store: string
  titulo: string
  icone: string
  descricao: string
  escopo: EscopoTabela
}

export const TABELAS_EXPORTAVEIS: TabelaExportavel[] = [
  { store: 'produtos', titulo: 'Produtos', icone: '📦', descricao: 'Cadastro com entrada × saída + Reforma', escopo: 'produto' },
  { store: 'cfop', titulo: 'CFOP', icone: '📋', descricao: 'Código Fiscal de Operações', escopo: 'produto' },
  { store: 'cstIcms', titulo: 'CST ICMS', icone: '🏷', descricao: 'Tributação do ICMS', escopo: 'produto' },
  { store: 'cstPisCofins', titulo: 'CST PIS/COFINS', icone: '💰', descricao: 'Tributação PIS/COFINS', escopo: 'produto' },
  { store: 'cest', titulo: 'CEST', icone: '🏷', descricao: 'Código Especificador', escopo: 'produto' },
  { store: 'cst', titulo: 'CST IBS/CBS', icone: '🏷', descricao: 'Situação Tributária Reforma', escopo: 'produto' },
  { store: 'cstClassTrib', titulo: 'cClassTrib', icone: '🎯', descricao: 'Classificação Tributária', escopo: 'produto' },
  { store: 'ncm', titulo: 'NCM × Classificação', icone: '🔗', descricao: 'Vínculos NCM', escopo: 'produto' },
  { store: 'ncmNomenclatura', titulo: 'Nomenclatura NCM', icone: '📖', descricao: 'Descrições oficiais', escopo: 'produto' },
  { store: 'referencia', titulo: 'Referência oficial', icone: '📚', descricao: 'CST × cClassTrib oficial', escopo: 'produto' },
  { store: 'reclassificacoesManuais', titulo: 'Reclassificações manuais', icone: '✋', descricao: 'Ajustes do usuário por NCM', escopo: 'produto' },
  // Fora do contexto produto: empresas, notas, CNAE, anexos (NCM+NBS), auditoria e NBS (serviços).
  { store: 'empresas', titulo: 'Empresas', icone: '🏢', descricao: 'Empresas do usuário', escopo: 'geral' },
  { store: 'nfeNotas', titulo: 'Notas Fiscais (XML)', icone: '🧾', descricao: 'Notas importadas + análise', escopo: 'geral' },
  { store: 'cnae', titulo: 'CNAE', icone: '🏭', descricao: 'CNAE × Anexo Simples', escopo: 'geral' },
  { store: 'anexos', titulo: 'Anexos', icone: '📎', descricao: 'Restrições oficiais por NCM/NBS', escopo: 'geral' },
  { store: 'audit_log', titulo: 'Auditoria', icone: '🧾', descricao: 'Log imutável (últimos 2.000)', escopo: 'geral' },
  { store: 'nbs', titulo: 'NBS', icone: '🧮', descricao: 'Vínculos de serviços (NBS 9 dígitos)', escopo: 'servico' },
]

/**
 * Tabelas visíveis num contexto. `produto` = só o que faz sentido na tela de
 * Produtos (NCM + tributos de produto): sem NBS, sem CNAE, sem empresas/notas.
 */
export function tabelasDoEscopo(escopo: 'produto' | 'geral'): TabelaExportavel[] {
  if (escopo === 'produto') return TABELAS_EXPORTAVEIS.filter((t) => t.escopo === 'produto')
  return TABELAS_EXPORTAVEIS
}

export const MAX_LINHAS_PDF = 300
export const MAX_LINHAS_XLSX = 5000

/* ------------------------------------------------ colunas (discriminadas) -- */

/**
 * Colunas exportáveis de **produtos**, discriminadas por fluxo: CFOP entrada
 * × CFOP saída (campos diferentes — o usuário escolhe o que sai).
 */
export interface ColunaProduto {
  chave: string
  rotulo: string
  fluxo: 'ident' | 'entrada' | 'saida' | 'valores' | 'reforma'
}

export const COLUNAS_PRODUTOS: ColunaProduto[] = [
  { chave: 'codigo', rotulo: 'SKU', fluxo: 'ident' },
  { chave: 'nome', rotulo: 'Nome', fluxo: 'ident' },
  { chave: 'ncm', rotulo: 'NCM', fluxo: 'ident' },
  { chave: 'cfopEntrada', rotulo: 'CFOP entrada', fluxo: 'entrada' },
  { chave: 'cfopSaida', rotulo: 'CFOP saída', fluxo: 'saida' },
  { chave: 'cstIcmsEntrada', rotulo: 'CST ICMS entrada', fluxo: 'entrada' },
  { chave: 'cstIcmsSaida', rotulo: 'CST ICMS saída', fluxo: 'saida' },
  { chave: 'pisEntrada', rotulo: 'PIS entrada', fluxo: 'entrada' },
  { chave: 'pisSaida', rotulo: 'PIS saída', fluxo: 'saida' },
  { chave: 'cofinsEntrada', rotulo: 'COFINS entrada', fluxo: 'entrada' },
  { chave: 'cofinsSaida', rotulo: 'COFINS saída', fluxo: 'saida' },
  { chave: 'quantidade', rotulo: 'Qtd', fluxo: 'valores' },
  { chave: 'valorUnitario', rotulo: 'Valor Unitário', fluxo: 'valores' },
  { chave: 'total', rotulo: 'Total', fluxo: 'valores' },
  { chave: 'cstReforma', rotulo: 'CST Reforma', fluxo: 'reforma' },
  { chave: 'cClassTrib', rotulo: 'cClassTrib', fluxo: 'reforma' },
  { chave: 'descClass', rotulo: 'Classificação Reforma', fluxo: 'reforma' },
  { chave: 'redIBS', rotulo: 'Red. IBS (%)', fluxo: 'reforma' },
  { chave: 'redCBS', rotulo: 'Red. CBS (%)', fluxo: 'reforma' },
  { chave: 'anexo', rotulo: 'Anexo', fluxo: 'reforma' },
]

export const CHAVES_PRODUTOS_PADRAO: string[] = COLUNAS_PRODUTOS.map((c) => c.chave)

function fmtNcmLocal(ncm: unknown): string {
  const d = String(ncm ?? '').replace(/\D/g, '')
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : String(ncm ?? '')
}

/** Valor de uma célula de produto (legado `cfop`/`cstIcms`/`pis`/`cofins` como fallback da entrada). */
export function extrairValorProduto(p: Record<string, unknown>, chave: string): string {
  const snap = (p.classificacaoSnapshot ?? {}) as Record<string, unknown>
  switch (chave) {
    case 'ncm': return fmtNcmLocal(p.ncm)
    case 'cfopEntrada': return celulaParaTexto(p.cfopEntrada ?? p.cfop ?? '')
    case 'cstIcmsEntrada': return celulaParaTexto(p.cstIcmsEntrada ?? p.cstIcms ?? '')
    case 'pisEntrada': return celulaParaTexto(p.pisEntrada ?? p.pis ?? '')
    case 'cofinsEntrada': return celulaParaTexto(p.cofinsEntrada ?? p.cofins ?? '')
    case 'quantidade': return celulaParaTexto(p.quantidade ?? 0)
    case 'valorUnitario': return Number(p.valorUnitario ?? 0).toFixed(2)
    case 'total': return (Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0)).toFixed(2)
    case 'descClass': return celulaParaTexto((snap.classificacao as string) ?? (p.baseLegal as string) ?? '')
    case 'redIBS': return celulaParaTexto(snap.pRedIBS ?? '')
    case 'redCBS': return celulaParaTexto(snap.pRedCBS ?? '')
    case 'anexo': return celulaParaTexto(snap.anexo ?? '')
    default: return celulaParaTexto(p[chave])
  }
}

/** Linha de produto nas colunas escolhidas (ordem de `COLUNAS_PRODUTOS`). */
export function linhaProdutoParaExportacao(p: Record<string, unknown>, chaves: string[]): string[] {
  return chaves.map((c) => extrairValorProduto(p, c))
}

/** Rótulos das chaves escolhidas (ordem de `COLUNAS_PRODUTOS`). */
export function rotulosProdutos(chaves: string[]): string[] {
  const mapa = new Map(COLUNAS_PRODUTOS.map((c) => [c.chave, c.rotulo]))
  return chaves.map((c) => mapa.get(c) ?? c)
}

/** Linha parece de produto (tem os fluxos entrada×saída)? */
function ehLinhaProduto(r: Record<string, unknown>): boolean {
  return 'cfopEntrada' in r || 'cfopSaida' in r || 'cstIcmsEntrada' in r
}

/**
 * Amostra para a conferência visual do modal: colunas + 5 primeiras linhas
 * já em texto. Produtos respeitam as colunas escolhidas (discriminadas).
 */
export function amostraParaPreview(
  store: string,
  linhas: Record<string, unknown>[],
  colunasProdutos?: string[],
): { cols: string[]; rows: string[][] } {
  if (store === 'produtos' && linhas.length && (ehLinhaProduto(linhas[0]) || colunasProdutos)) {
    const chaves = (colunasProdutos ?? CHAVES_PRODUTOS_PADRAO).filter((c) =>
      COLUNAS_PRODUTOS.some((col) => col.chave === c),
    )
    const finais = chaves.length ? chaves : CHAVES_PRODUTOS_PADRAO
    return {
      cols: rotulosProdutos(finais),
      rows: linhas.slice(0, 5).map((r) => linhaProdutoParaExportacao(r, finais)),
    }
  }
  if (!linhas.length) return { cols: [], rows: [] }
  const cols = colunasDe(linhas, 6)
  return {
    cols,
    rows: linhas.slice(0, 5).map((r) => cols.map((c) => celulaParaTexto(r[c]).slice(0, 60))),
  }
}

export interface FiltroExportacao {
  texto: string
  empresaId: number | null
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Lê uma tabela com filtro de texto + escopo de empresa (quando aplicável). */
export async function coletarTabela(store: string, filtro: FiltroExportacao): Promise<Record<string, unknown>[]> {
  let linhas: Record<string, unknown>[] = []
  try {
    if (store === 'audit_log') {
      linhas = ((await db.table(store).toArray().catch(() => [])) as Record<string, unknown>[]).slice(-2000)
    } else {
      linhas = (await db.table(store).toArray().catch(() => [])) as Record<string, unknown>[]
    }
  } catch {
    return []
  }
  if (store === 'meta') return []
  if (store === 'produtos' || store === 'nfeNotas') {
    if (filtro.empresaId != null) {
      linhas = linhas.filter((r) => (r as Record<string, unknown>).empresaId === filtro.empresaId)
    }
  }
  if (store === 'meta') {
    linhas = linhas.filter((r) => {
      const chave = (r as Record<string, unknown>).chave
      return typeof chave !== 'string' || !META_SENSIVEL_PREFIXOS.some((p) => chave.startsWith(p))
    })
  }
  const t = filtro.texto.trim().toLowerCase()
  if (t) {
    linhas = linhas.filter((r) => {
      try {
        return JSON.stringify(r).toLowerCase().includes(t)
      } catch {
        return false
      }
    })
  }
  return linhas
}

export async function contarTabelas(filtro: FiltroExportacao): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  await Promise.all(
    TABELAS_EXPORTAVEIS.map(async (t) => {
      out[t.store] = (await coletarTabela(t.store, filtro)).length
    }),
  )
  return out
}

/** Colunas = união das chaves (ordem estável, máx. 12 para caber no PDF). */
export function colunasDe(linhas: Record<string, unknown>[], max = 12): string[] {
  const ordem: string[] = []
  const vistas = new Set<string>()
  for (const r of linhas.slice(0, 50)) {
    for (const k of Object.keys(r ?? {})) {
      if (!vistas.has(k)) {
        vistas.add(k)
        ordem.push(k)
      }
      if (ordem.length >= max) break
    }
    if (ordem.length >= max) break
  }
  return ordem.length ? ordem : ['(vazio)']
}

function celulaParaTexto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v)
      return s.length > 120 ? `${s.slice(0, 120)}…` : s
    } catch {
      return ''
    }
  }
  const s = String(v)
  return s.length > 160 ? `${s.slice(0, 160)}…` : s
}

/** Mapa `store → chaves` escolhidas pelo usuário (só produtos usa por ora). */
export type ColunasPorTabela = Record<string, string[]>

export function tabelaParaCSV(
  linhas: Record<string, unknown>[],
  store?: string,
  colunas?: string[],
): string {
  if (!linhas.length) return montarCSV([['(sem dados)']])
  if ((store === 'produtos' || (store === undefined && ehLinhaProduto(linhas[0]))) && linhas.length) {
    const chaves = (colunas ?? CHAVES_PRODUTOS_PADRAO).filter((c) =>
      COLUNAS_PRODUTOS.some((col) => col.chave === c),
    )
    const finais = chaves.length ? chaves : CHAVES_PRODUTOS_PADRAO
    const corpo: unknown[][] = [rotulosProdutos(finais)]
    for (const r of linhas.slice(0, MAX_LINHAS_XLSX)) {
      corpo.push(linhaProdutoParaExportacao(r, finais))
    }
    return montarCSV(corpo)
  }
  const cols = colunas?.length ? colunas : colunasDe(linhas, 40)
  const corpo: unknown[][] = [cols]
  for (const r of linhas.slice(0, MAX_LINHAS_XLSX)) {
    corpo.push(cols.map((c) => celulaParaTexto(r[c])))
  }
  return montarCSV(corpo)
}

export async function exportarTabelasCSV(
  stores: string[],
  filtro: FiltroExportacao,
  colunasPorTabela?: ColunasPorTabela,
): Promise<number> {
  let arquivos = 0
  for (const s of stores) {
    const linhas = await coletarTabela(s, filtro)
    baixar(`export_${s}_${hoje()}.csv`, tabelaParaCSV(linhas, s, colunasPorTabela?.[s]), 'text/csv;charset=utf-8')
    arquivos++
  }
  return arquivos
}

export async function exportarTabelasXLSX(
  stores: string[],
  filtro: FiltroExportacao,
  colunasPorTabela?: ColunasPorTabela,
): Promise<number> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of stores) {
    const linhas = (await coletarTabela(s, filtro)).slice(0, MAX_LINHAS_XLSX)
    if (s === 'produtos') {
      const chaves = (colunasPorTabela?.[s] ?? CHAVES_PRODUTOS_PADRAO).filter((c) =>
        COLUNAS_PRODUTOS.some((col) => col.chave === c),
      )
      const finais = chaves.length ? chaves : CHAVES_PRODUTOS_PADRAO
      const rotulos = rotulosProdutos(finais)
      const dados = linhas.length
        ? linhas.map((r) => Object.fromEntries(rotulos.map((rot, i) => [rot, linhaProdutoParaExportacao(r, finais)[i]])))
        : [{ '(sem dados)': '' }]
      const ws = XLSX.utils.json_to_sheet(dados)
      ws['!cols'] = rotulos.map(() => ({ wch: 22 }))
      XLSX.utils.book_append_sheet(wb, ws, 'produtos')
      continue
    }
    const cols = colunasPorTabela?.[s]?.length ? (colunasPorTabela[s] as string[]) : linhas.length ? colunasDe(linhas, 40) : ['(sem dados)']
    const dados = linhas.length
      ? linhas.map((r) => Object.fromEntries(cols.map((c) => [c, celulaParaTexto(r[c])])))
      : [{ '(sem dados)': '' }]
    const ws = XLSX.utils.json_to_sheet(dados)
    ws['!cols'] = cols.map(() => ({ wch: 22 }))
    const nomeAba = s.slice(0, 31) || 'dados'
    XLSX.utils.book_append_sheet(wb, ws, nomeAba)
  }
  const buf: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  baixar(`export_geral_${hoje()}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return stores.length
}

export async function exportarTabelasPDF(
  stores: string[],
  filtro: FiltroExportacao,
  opts: { empresa: Empresa | null; emitente: Emitente },
  colunasPorTabela?: ColunasPorTabela,
): Promise<void> {
  const { timbrado, rodape } = await import('@/infrastructure/exporters/relatorios')
  const { fundoMarcaDagua, OURO_AURUM } = await import('@/infrastructure/pdf/marca-dagua')
  void OURO_AURUM
  const cor = '#0f215c'
  const data = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const { baixarPdf } = await import('@/infrastructure/pdf/setup')
  const content: never[] = []
  for (const s of stores) {
    const meta = TABELAS_EXPORTAVEIS.find((t) => t.store === s)
    const linhas = (await coletarTabela(s, filtro)).slice(0, MAX_LINHAS_PDF)
    // Produtos: colunas escolhidas pelo usuário (CFOP entrada × saída
    // discriminados); demais: união das chaves (máx. 6 p/ caber no PDF).
    let cols: string[]
    let rows: string[][]
    if (s === 'produtos' && linhas.length) {
      const chaves = (colunasPorTabela?.[s] ?? CHAVES_PRODUTOS_PADRAO).filter((c) =>
        COLUNAS_PRODUTOS.some((col) => col.chave === c),
      )
      const finais = (chaves.length ? chaves : CHAVES_PRODUTOS_PADRAO).slice(0, 10)
      cols = rotulosProdutos(finais)
      rows = linhas.map((r) => linhaProdutoParaExportacao(r, finais))
    } else {
      cols = linhas.length ? colunasDe(linhas, 6) : []
      rows = linhas.map((r) => cols.map((c) => celulaParaTexto(r[c]).slice(0, 60)))
    }
    const titulo = `${meta?.icone ?? '📄'} ${meta?.titulo ?? s} — ${linhas.length} registro(s)`
    ;(content as unknown as unknown[]).push({
      text: titulo,
      fontSize: 10,
      bold: true,
      color: cor,
      margin: [0, 10, 0, 2],
    })
    if (!linhas.length) {
      ;(content as unknown as unknown[]).push({ text: 'Sem dados para o filtro atual.', fontSize: 7, color: '#64748b' })
      continue
    }
    ;(content as unknown as unknown[]).push(
      tabelaRelatorio({
        cols: cols.map((c) => ({ titulo: c.slice(0, 18), larg: 1 })),
        rows,
        corCabecalho: cor,
      }) as never,
    )
  }
  const doc = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [28, 102, 28, 44],
    defaultStyle: { font: 'Roboto', fontSize: 6.4, color: '#1e293b' },
    background: fundoMarcaDagua(360, 0.06),
    info: { title: 'Exportação geral', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: (() =>
      timbrado(opts.emitente, cor, 'Exportação geral', `Todas as tabelas · filtro "${filtro.texto || '—'}" · ${data}`)) as never,
    footer: rodape(opts.emitente) as never,
    content,
  }
  await baixarPdf(doc as never, `export_geral_${hoje()}.pdf`)
}
