/**
 * Exportadores: CSV, JSON e PDF (relatórios).
 *
 * ## Paridade com a v1
 * Tanto o CSV quanto o JSON dos produtos reproduzem *exatamente* as colunas,
 * o escape de célula e o nome de arquivo do `index.html` original:
 *
 * - produtos → célula só é entreaspada se contiver `"`, `;`, `\n` ou `\r`;
 * - SPED     → **toda** célula é entreaspada;
 * - ambos    → separador `;`, quebras `\r\n` e BOM `﻿` para o Excel.
 *
 * ## Melhoria: pdfMake no lugar do jsPDF
 * O relatório era desenhado à mão com `jsPDF` + `jspdf-autotable`, o que exigia
 * coordenadas em milímetros, reposicionamento do timbrado a cada página e
 * contagem manual de páginas. Aqui o documento é declarativo:
 *
 * - quebra de página e repetição de cabeçalho automáticas;
 * - timbrado do emitente no `header` de todas as páginas;
 * - rodapé com "Página X de Y" resolvido pelo motor;
 * - colunas de identificador (NCM, CST, CFOP) em fonte monoespaçada.
 */
import { calcularTributos } from '../../domain/services/calculo'
import { REF_DEFAULT } from '../../domain/constants'
import { fmtCarga, fmtCnpj, fmtMoeda, fmtNcm, fmtNum, fmtPct, hexToRgb } from '../../domain/services/format'
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces'
import { ehResumo } from '../sped/tipos'
import type { ResultadoItem, ResultadoResumo, ResultadoSped } from '../sped/tipos'
import { creditoDaNota, creditoIbsCbsDaNota } from '../nfe/credito'
import { apurarIbsCbs } from '../nfe/apuracao'
import { REGIME_LABELS, regimeDoEmitente } from '../nfe/regime'
import type { CreditoFornecedor, NotaXml } from '../nfe/tipos'
import type { Emitente, Empresa, Produto } from '../../domain/entities'

/* --------------------------------------------------------------- helpers -- */

const BOM = '﻿'
const hojeISO = (): string => new Date().toISOString().slice(0, 10)

/** Sufixo de arquivo usado pela v1: razão social sem não-alfanuméricos. */
function sufixo(emp: Empresa | null, fallback: string): string {
  const base = emp ? emp.razaoSocial : fallback
  return base.replace(/\W+/g, '_') || 'todas'
}

/**
 * Gera o PDF sob demanda. O motor pdfMake (~1,9 MB) só é carregado quando o
 * usuário pede um relatório — o boot da aplicação fica bem mais leve.
 */
async function gerarPdf(doc: TDocumentDefinitions, nomeArquivo: string): Promise<void> {
  const { baixarPdf } = await import('../pdf/setup')
  await baixarPdf(doc, nomeArquivo)
}

/**
 * Monta o CSV. `sempreAspas` reproduz o SPED (tudo entreaspado); caso contrário
 * aplica a regra da v1 nos produtos.
 */
export function montarCSV(linhas: unknown[][], sempreAspas = false): string {
  const corpo = linhas
    .map((l) =>
      l
        .map((v) => {
          const s = String(v ?? '')
          return sempreAspas || /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(';'),
    )
    .join('\r\n')
  return BOM + corpo
}

/** Baixa um arquivo gerado em memória ( Blob + link temporário). */
export function baixar(nome: string, conteudo: string | Blob, mime = 'application/octet-stream'): void {
  const blob = typeof conteudo === 'string' ? new Blob([conteudo], { type: mime }) : conteudo
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ----------------------------------------------------------- CSV / JSON -- */

export const CABECALHO_PRODUTOS = [
  'SKU', 'Nome', 'NCM', 'CFOP', 'CST ICMS', 'PIS', 'COFINS', 'Qtd',
  'Valor Unitário', 'Total', 'CST Reforma', 'cClassTrib',
  'Classificação Reforma', 'Red. IBS (%)', 'Red. CBS (%)', 'Anexo',
] as const

/** Linha de produto idêntica a `produtoParaLinha` da v1. */
export function produtoParaLinha(p: Produto): unknown[] {
  const c = p.classificacaoSnapshot ?? ({} as Produto['classificacaoSnapshot'])
  return [
    p.codigo,
    p.nome,
    fmtNcm(p.ncm),
    p.cfop ?? '',
    p.cstIcms ?? '',
    p.pis ?? '',
    p.cofins ?? '',
    p.quantidade ?? 0,
    Number(p.valorUnitario ?? 0).toFixed(2),
    (Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0)).toFixed(2),
    p.cstReforma,
    p.cClassTrib,
    c.classificacao ?? '',
    c.pRedIBS ?? '',
    c.pRedCBS ?? '',
    c.anexo ?? '',
  ]
}

export function csvProdutos(produtos: Produto[]): string {
  return montarCSV([CABECALHO_PRODUTOS as unknown as unknown[], ...produtos.map(produtoParaLinha)])
}

export function jsonProdutos(produtos: Produto[], empresa: Empresa | null): string {
  const payload = { empresa, exportadoEm: new Date().toISOString(), produtos }
  return JSON.stringify(payload, null, 2)
}

export function exportarProdutosCSV(produtos: Produto[], empresa: Empresa | null): void {
  baixar(
    `produtos_${sufixo(empresa, 'todas')}_${hojeISO()}.csv`,
    csvProdutos(produtos),
    'text/csv;charset=utf-8',
  )
}

export function exportarProdutosJSON(produtos: Produto[], empresa: Empresa | null): void {
  baixar(`produtos_${sufixo(empresa, 'todas')}.json`, jsonProdutos(produtos, empresa), 'application/json')
}

/** Modelo de planilha para classificação em lote (paridade com a v1). */
export function baixarModeloLote(): void {
  const modelo = [
    ['COD/SKU', 'NOME DO PRODUTO', 'NCM', 'CFOP', 'CST', 'PIS', 'COFINS'],
    ['SKU-0001', 'Queijo Minas Frescal 500g', '02011000', '5102', '000', '01', '01'],
    ['SKU-0002', 'Eletrocardiógrafo portátil', '90181100', '5102', '000', '01', '01'],
    ['SKU-0003', 'Medicamento de referência', '30049099', '5102', '000', '01', '01'],
  ]
  baixar('modelo_classificacao_lote.csv', BOM + modelo.map((l) => l.join(';')).join('\r\n'), 'text/csv;charset=utf-8')
}

/** Modelo de importação de empresas (paridade com a v1). */
export function baixarModeloEmpresas(): void {
  const modelo = [
    ['Razão Social', 'CNPJ', 'Nome Fantasia'],
    ['Empresa Exemplo Ltda', '12345678000190', 'Exemplo'],
  ]
  baixar('modelo_empresas.csv', BOM + modelo.map((l) => l.join(';')).join('\r\n'), 'text/csv;charset=utf-8')
}

/* -------------------------------------------------------- SPED (dados) --- */

/** Monta as duas variantes de CSV do SPED (itens × resumo), como na v1. */
export function csvSped(resultados: ResultadoSped): string {
  if (ehResumo(resultados)) {
    const head = ['CST ICMS', 'CFOP', 'Notas', 'Valor Operação', 'BC ICMS', 'ICMS', 'IBS', 'CBS', 'Total Tributos']
    const linhas = (resultados as ResultadoResumo[]).map((r) => [
      r.cstIcms, r.cfop, r.qtdNotas,
      r.totalOperacao.toFixed(2), r.totalBcIcms.toFixed(2), r.totalIcms.toFixed(2),
      r.ibs.toFixed(2), r.cbs.toFixed(2), r.totalTributos.toFixed(2),
    ])
    return montarCSV([head, ...linhas], true)
  }

  const head = [
    'Código', 'Produto', 'NCM', 'CST', 'CFOP', 'Qtd', 'Valor',
    'CST Reforma', 'cClassTrib', 'Red. IBS (%)', 'Red. CBS (%)',
    'IBS', 'CBS', 'Total Tributos', 'Anexo',
  ]
  const linhas = (resultados as ResultadoItem[]).map((r) => [
    r.codItem, r.descricaoProduto, fmtNcm(r.ncm), r.cstIcms, r.cfop, r.qtd,
    Number(r.vlItem).toFixed(2), r.classificacao.cst, r.classificacao.cClassTrib,
    r.redIBS, r.redCBS, r.ibs.toFixed(2), r.cbs.toFixed(2),
    r.totalTributos.toFixed(2), r.anexo,
  ])
  return montarCSV([head, ...linhas], true)
}

export function exportarSpedCSV(resultados: ResultadoSped): void {
  baixar(`SPED_Tributacao_${hojeISO()}.csv`, csvSped(resultados), 'text/csv;charset=utf-8')
}

/** Totais agregados usados pela faixa de resumo (SPEC R4.15). */
export function totaisSped(resultados: ResultadoSped) {
  let base = 0
  let ibs = 0
  let cbs = 0
  for (const r of resultados) {
    base += Number('_isResumo' in r ? r.totalOperacao : r.vlItem) || 0
    ibs += r.ibs
    cbs += r.cbs
  }
  const trib = ibs + cbs
  return { base, ibs, cbs, trib, carga: base > 0 ? (trib / base) * 100 : 0 }
}

/* ----------------------------------------------------------------- PDF --- */

type Cell = string | number | null | undefined

interface ColunaRel {
  titulo: string
  /** Peso relativo (a largura final é proporcional à soma). */
  larg: number
  alin?: 'left' | 'right' | 'center'
  /** Fonte monoespaçada — usada em NCM/CST/CFOP para alinhar colunas. */
  mono?: boolean
  forte?: boolean
  cinza?: boolean
  min?: number
}

const PT_MM = 2.834645669
void PT_MM

function celula(txt: Cell, col: ColunaRel, forte?: boolean): {
  text: string
  fontSize: number
  bold: boolean
  color: string
  font?: 'Courier'
  alignment: 'left' | 'right' | 'center'
  margin: [number, number, number, number]
  fillColor?: string
} {
  const s = txt === null || txt === undefined || txt === '' ? '—' : String(txt)
  return {
    text: s,
    fontSize: 6.6,
    bold: forte ?? col.forte ?? false,
    color: col.cinza ? '#5a6478' : '#1e293b',
    ...(col.mono ? { font: 'Courier' as const } : {}),
    alignment: col.alin ?? 'left',
    margin: [2.5, 2.2, 2.5, 2.2] as [number, number, number, number],
  }
}

/** Tabela densa com cabeçalho repetido e faixa zebrada (recursos nativos do pdfMake). */
function tabelaRelatorio(opts: {
  cols: ColunaRel[]
  rows: Cell[][]
  total?: Cell[]
  corCabecalho: string
  corpoFonte?: number
}) {
  const peso = opts.cols.reduce((s, c) => s + c.larg, 0)
  const widths = opts.cols.map((c) => `${((c.larg / peso) * 100).toFixed(3)}%`)

  const cabecalho = opts.cols.map((c) => ({
    text: c.titulo,
    fillColor: opts.corCabecalho,
    color: '#ffffff',
    bold: true,
    fontSize: 6.8,
    alignment: 'left' as const,
    margin: [2.5, 3, 2.5, 3] as [number, number, number, number],
  }))

  const corpo = opts.rows.map((linha, i) =>
    linha.map((v, j) => {
      const cel = celula(v, opts.cols[j])
      if (i % 2 === 1) cel.fillColor = '#f7faf9'
      return cel
    }),
  )

  const corpoTotal = opts.total
    ? opts.total.map((v, j) => ({
        ...celula(v, opts.cols[j], true),
        fillColor: '#e8eeed',
        border: [false, true, false, false] as [boolean, boolean, boolean, boolean],
      }))
    : undefined

  return {
    table: {
      headerRows: 1,
      widths,
      body: [cabecalho, ...corpo, ...(corpoTotal ? [corpoTotal] : [])] as never[][],
    },
    layout: {
      hLineColor: () => '#dfe4e8',
      vLineWidth: () => 0,
      hLineWidth: (i: number) => (i === 0 ? 0.8 : 0.3),
      paddingLeft: () => 0,
      paddingRight: () => 0,
      fillBottomLeftCorner: false,
      fillBottomRightCorner: false,
      fillTopLeftCorner: false,
      fillTopRightCorner: false,
    },
    margin: [0, 4, 0, 8] as [number, number, number, number],
  }
}

function rgbHex(h: string | null | undefined): string {
  const [r, g, b] = hexToRgb(h)
  const p = (n: number) => n.toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`
}

/**
 * Timbre: caixa larga para acomodar marcas horizontais sem achatar.
 * O `fit` preserva a proporção original: uma logo quadrada preenche 64pt de
 * altura, uma horizontal ocupa até 132pt de largura com a mesma altura —
 * por isso marcas retangulares pareciam "pequenas" na caixa quadrada de 57pt.
 */
const LOGO_IMG_FIT: [number, number] = [132, 64]
const LOGO_FALLBACK_LADO = 64

function logoDoEmitente(emitente: Emitente, cor: string) {
  if (emitente.logo && /^data:image\/(png|jpe?g|webp);base64,/i.test(emitente.logo)) {
    return {
      image: emitente.logo,
      fit: LOGO_IMG_FIT,
      margin: [0, 0, 0, 0] as [number, number, number, number],
    }
  }
  // Fallback "Au / NCM", espelhando o `drawDefaultLogo` da v1.
  const lado = LOGO_FALLBACK_LADO
  return {
    width: lado,
    height: lado,
    stack: [
      {
        canvas: [{ type: 'rect' as const, x: 0, y: 0, w: lado, h: lado, r: 8, color: cor }],
        margin: [0, 0, 0, -lado] as [number, number, number, number],
      },
      { text: 'Au', alignment: 'center' as const, fontSize: 24, bold: true, color: '#ffffff', margin: [0, 17, 0, 0] as [number, number, number, number] },
      { text: 'NCM', alignment: 'center' as const, fontSize: 9, color: '#ffffff' },
    ],
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }
}

function linhasEmitente(e: Emitente): string[][] {
  return [
    [[e.cnpj ? `CNPJ ${e.cnpj}` : '', e.ie ? `IE ${e.ie}` : ''].filter(Boolean).join('  ·  ')],
    [[e.endereco, e.cidade, e.cep].filter(Boolean).join('  ·  ')],
    [[e.telefone, e.email, e.site].filter(Boolean).join('  ·  ')],
  ].filter((l) => l[0])
}

/** Timbrado repetido no topo de todas as páginas (equivalente ao `drawLetterhead`). */
function timbrado(emitente: Emitente, cor: string, titulo: string, subtitulo: string) {
  const info = linhasEmitente(emitente)
  return {
    margin: [34, 8, 34, 0] as [number, number, number, number],
    stack: [
      {
        canvas: [{ type: 'rect' as const, x: 0, y: 0, w: 527, h: 11.3, color: cor }],
        margin: [0, 0, 0, 6] as [number, number, number, number],
      },
      {
        columnGap: 14,
        columns: [
          { width: 'auto', stack: [logoDoEmitente(emitente, cor) as never] },
          {
            width: '*',
            stack: [
              { text: emitente.razaoSocial || 'Aurum Bit Labs & Studios LTDA', fontSize: 11.5, bold: true, color: cor },
              ...info.map((linha) => ({ text: linha[0], fontSize: 7.4, color: '#64748b', margin: [0, 1, 0, 0] as [number, number, number, number] })),
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: titulo, fontSize: 8.4, bold: true, color: '#334155' },
              { text: subtitulo, fontSize: 7.2, color: '#94a3b8', margin: [0, 2, 0, 0] as [number, number, number, number] },
            ],
          },
        ],
      },
      {
        canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 527, y2: 0, lineWidth: 0.7, lineColor: '#dfe4e8' }],
        margin: [0, 5, 0, 0] as [number, number, number, number],
      },
    ],
  }
}

function rodape(emitente: Emitente) {
  return (pagina: number, total: number) => ({
    margin: [34, 0, 34, 24] as [number, number, number, number],
    stack: [
      { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 527, y2: 0, lineWidth: 0.5, lineColor: '#e6eaee' }] },
      {
        margin: [0, 4, 0, 0] as [number, number, number, number],
        columns: [
          { text: emitente.rodape || emitente.razaoSocial || 'Aurum Tax NCM', fontSize: 6.8, color: '#8c96a5' },
          { text: `Aurum Bit Labs & Studios LTDA · Página ${pagina} de ${total}`, fontSize: 6.8, color: '#8c96a5', alignment: 'right' },
        ],
      },
    ],
  })
}

/** Faixa de totais com fundo na cor de destaque (como a v1 fazia com `roundedRect`). */
function faixaTotais(rotulos: [string, string][], cor: string) {
  return {
    table: {
      widths: rotulos.map(() => 'auto' as const),
      body: [
        rotulos.map(([rot, val]) => ({
          text: `${rot}: ${val}`,
          fillColor: cor,
          color: '#ffffff',
          bold: true,
          fontSize: 7.6,
          margin: [8, 5, 8, 5] as [number, number, number, number],
          border: [false, false, false, false] as [boolean, boolean, boolean, boolean],
        })),
      ],
    },
    layout: 'noBorders' as const,
    margin: [0, 0, 0, 6] as [number, number, number, number],
  }
}

function avisoSaida(): TDocumentDefinitions['content'] {
  return {
    table: {
      widths: ['100%'],
      body: [
        [
          {
            text:
              '⚠ Esta análise considera apenas as operações de SAÍDA do SPED. As entradas foram descartadas automaticamente.',
            fillColor: '#fffbeb',
            color: '#92400e',
            fontSize: 7,
            bold: true,
            margin: [8, 5, 8, 5] as [number, number, number, number],
            border: [false, false, false, false] as [boolean, boolean, boolean, boolean],
          },
        ],
      ],
    },
    margin: [0, 0, 0, 6] as [number, number, number, number],
  }
}

function secao(titulo: string, sub?: string): NonNullable<Content>[] {
  return [
    { text: titulo, fontSize: 10.5, bold: true, color: '#1f3d37', margin: [0, 8, 0, 1] as [number, number, number, number] },
    ...(sub ? [{ text: sub, fontSize: 7, color: '#7a8896', margin: [0, 0, 0, 2] as [number, number, number, number] }] : []),
  ]
}

/* --------------------------------------------------- Relatório: produtos -- */

export interface RelatorioProdutosParams {
  produtos: Produto[]
  empresa: Empresa | null
  emitente: Emitente
}

/**
 * Relatório de classificação dos produtos cadastrados (recria o `exportarPDF`
 * da v1 em pdfMake, com a mesma estrutura de colunas).
 */
export async function exportarProdutosPDF({ produtos, empresa, emitente }: RelatorioProdutosParams): Promise<void> {
  const cor = rgbHex(emitente.cor || '#0f215c')
  const data = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  const empresaLabel = empresa ? empresa.razaoSocial : emitente.razaoSocial || 'Todas as empresas'
  const cnpjLabel =
    empresa && empresa.cnpj ? `CNPJ ${empresa.cnpj}` : emitente.cnpj ? `CNPJ ${emitente.cnpj}` : ''

  // Recalcula IBS/CBS com as reduções congeladas no snapshot de cada produto.
  let ibsTotal = 0
  let cbsTotal = 0
  let valorTotal = 0
  for (const p of produtos) {
    const c = p.classificacaoSnapshot ?? ({} as Produto['classificacaoSnapshot'])
    const base = Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0)
    valorTotal += base
    const r = calcularTributos(base, Number(c.pRedIBS ?? 0), Number(c.pRedCBS ?? 0), REF_DEFAULT.IBS, REF_DEFAULT.CBS)
    ibsTotal += r.vIBS
    cbsTotal += r.vCBS
  }
  const tribTotal = ibsTotal + cbsTotal
  const carga = valorTotal > 0 ? (tribTotal / valorTotal) * 100 : 0

  const cols: ColunaRel[] = [
    { titulo: 'SKU', larg: 15, forte: true },
    { titulo: 'Produto', larg: 35 },
    { titulo: 'NCM', larg: 16, alin: 'center', forte: true, mono: true },
    { titulo: 'Trib. anterior', larg: 20, cinza: true },
    { titulo: 'CST', larg: 8, alin: 'center', forte: true, mono: true },
    { titulo: 'cClassTrib', larg: 13, alin: 'center', forte: true, mono: true },
    { titulo: 'Classificação', larg: 37 },
    { titulo: 'Qtd', larg: 10, alin: 'right' },
    { titulo: 'Vlr. un.', larg: 16, alin: 'right' },
    { titulo: 'Total', larg: 16, alin: 'right', forte: true },
  ]

  const rows = produtos.map((p) => {
    const c = p.classificacaoSnapshot ?? ({} as Produto['classificacaoSnapshot'])
    const antiga = [
      p.cfop ? `CFOP ${p.cfop}` : null,
      p.cstIcms ? `CST ${p.cstIcms}` : null,
      p.pis ? `PIS ${p.pis}` : null,
      p.cofins ? `COFINS ${p.cofins}` : null,
    ]
      .filter(Boolean)
      .join('\n')
    return [
      p.codigo,
      p.nome || '',
      fmtNcm(p.ncm),
      antiga || '—',
      p.cstReforma || '—',
      p.cClassTrib || '—',
      (c.classificacao || p.baseLegal || '').slice(0, 140),
      fmtNum(p.quantidade),
      fmtMoeda(p.valorUnitario),
      fmtMoeda(Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0)),
    ]
  })

  const totalGeral = produtos.reduce(
    (a, p) => a + Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0),
    0,
  )

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#1e293b' },
    info: {
      title: 'Relatório de Classificação Tributária',
      author: 'Aurum Tax NCM',
      creator: 'Aurum Tax NCM',
    },
    header: (() =>
      timbrado(
        emitente,
        cor,
        'Relatório de Classificação Tributária',
        `LC 214/2025 · ${[empresaLabel, cnpjLabel].filter(Boolean).join(' · ')} · Gerado em ${data}`,
      )) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content: [
      {
        text: 'Relatório de Classificação Tributária',
        fontSize: 14,
        bold: true,
        color: cor,
        margin: [0, 2, 0, 1] as [number, number, number, number],
      },
      {
        text: [empresaLabel, cnpjLabel, `Gerado em ${data}`].filter(Boolean).join(' · '),
        fontSize: 7.6,
        color: '#7a8896',
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },
      faixaTotais(
        [
          ['Itens', String(produtos.length)],
          ['Base', fmtMoeda(valorTotal)],
          ['IBS', fmtMoeda(ibsTotal)],
          ['CBS', fmtMoeda(cbsTotal)],
          ['Tributos', fmtMoeda(tribTotal)],
          ['Carga', fmtCarga(carga)],
        ],
        cor,
      ),
      tabelaRelatorio({
        cols,
        rows,
        corCabecalho: cor,
        total: [
          'TOTAL',
          `${produtos.length} produtos`,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          fmtMoeda(totalGeral),
        ],
      }),
      {
        columns: [
          {
            stack: [
              { text: 'CST 000 · Regra geral', fontSize: 7, bold: true, color: '#b45309' },
              {
                text: 'Produtos sem CST informado ou classificados pela regra geral recebem alíquota cheia, sem redução de IBS/CBS.',
                fontSize: 6.6,
                color: '#92400e',
                margin: [0, 1, 0, 0] as [number, number, number, number],
              },
            ],
            width: '*',
          },
          {
            stack: [
              { text: 'Aurum Tax NCM', fontSize: 7.5, bold: true, color: cor, alignment: 'right' as const },
              { text: 'Aurum Bit Labs & Studios LTDA · Todos os direitos reservados.', fontSize: 6.4, color: '#94a3b8', alignment: 'right' as const },
            ],
            width: 'auto',
          },
        ],
        margin: [0, 6, 0, 0] as [number, number, number, number],
      },
    ],
  }

  const suf = sufixo(empresa, emitente.razaoSocial || 'todas')
  await gerarPdf(doc, `classificacao_${suf}_${hojeISO()}.pdf`)
}

/* -------------------------------------------------------- Relatório: SPED -- */

export interface RelatorioSpedParams {
  resultados: ResultadoSped
  emitente: Emitente
  tipo: 'icmsipi' | 'contribuicoes'
  arquivo?: string
}

const CORES_GRAFICO_PDF: Record<string, string> = {
  '0': '#10b981',
  '80': '#ea580c',
  '70': '#f97316',
  '60': '#f59e0b',
  '50': '#0ea5e9',
  '40': '#3b82f6',
  '30': '#6366f1',
  misto: '#8b5cf6',
  isento: '#94a3b8',
}

const ROTULOS_GRAFICO_PDF: Record<string, string> = {
  '0': 'Alíquota Zero',
  '80': 'Redução 80%',
  '70': 'Redução 70%',
  '60': 'Redução 60%',
  '50': 'Redução 50%',
  '40': 'Redução 40%',
  '30': 'Redução 30%',
  misto: 'Redução IBS ≠ CBS',
  isento: 'Sem redução',
}

/** Barra horizontal proporcional (0–230pt) desenhada em canvas nativo. */
export function barraPdf(valor: number, max: number, cor: string, larguraMax = 230) {
  const w = max > 0 ? Math.max(3, Math.round((valor / max) * larguraMax)) : 3
  return {
    canvas: [{ type: 'rect' as const, x: 0, y: 0, w, h: 9, r: 3, color: cor }],
    margin: [0, 2, 0, 2] as [number, number, number, number],
  }
}

/**
 * Visuais do relatório SPED: distribuição por anexo (modo itens) ou por grupo
 * CST/CFOP (modo resumo) + ranking dos maiores, como barras proporcionais.
 * O pdfMake não incorpora Chart.js — o desenho em canvas nativo mantém o
 * relatório elegante sem dependência pesada no momento da exportação.
 */
function graficosSpedPdf(resultados: ResultadoSped): NonNullable<Content>[] {
  if (!resultados.length) return []
  if (ehResumo(resultados)) {
    const grupos = [...(resultados as ResultadoResumo[])]
      .sort((a, b) => b.totalOperacao - a.totalOperacao)
      .slice(0, 8)
    const max = grupos.reduce((m, g) => Math.max(m, g.totalOperacao), 0)
    return [
      {
        text: 'Distribuição por grupo (top 8 · base de operação)',
        fontSize: 8.5,
        bold: true,
        color: '#1f3d37',
        margin: [0, 8, 0, 4] as [number, number, number, number],
      },
      {
        table: {
          widths: ['32%', '46%', '22%'],
          body: grupos.map((g) => [
            { text: `CST ${g.cstIcms} · CFOP ${g.cfop}`, fontSize: 7, color: '#334155' },
            barraPdf(g.totalOperacao, max, '#3a5dff'),
            { text: fmtMoeda(g.totalOperacao), fontSize: 7, bold: true, alignment: 'right' as const },
          ]),
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 6] as [number, number, number, number],
      },
    ]
  }

  const itens = resultados as ResultadoItem[]
  const chaves = ['0', '80', '70', '60', '50', '40', '30', 'misto', 'isento']
  const porAnexo = chaves.map((a) => ({
    anexo: a,
    valor: itens.filter((r) => r.anexo === a).reduce((s, r) => s + (Number(r.vlItem) || 0), 0),
  }))
  const maxAnexo = porAnexo.reduce((m, g) => Math.max(m, g.valor), 0)
  const top = [...itens]
    .sort((a, b) => b.totalTributos - a.totalTributos)
    .slice(0, 8)
  const maxTop = top.reduce((m, r) => Math.max(m, r.totalTributos), 0)

  return [
    {
      text: 'Distribuição por anexo (base de cálculo)',
      fontSize: 8.5,
      bold: true,
      color: '#1f3d37',
      margin: [0, 8, 0, 4] as [number, number, number, number],
    },
    {
      table: {
        widths: ['26%', '52%', '22%'],
        body: porAnexo.map((g) => [
          { text: ROTULOS_GRAFICO_PDF[g.anexo] ?? g.anexo, fontSize: 7, color: '#334155' },
          barraPdf(g.valor, maxAnexo, CORES_GRAFICO_PDF[g.anexo] ?? '#94a3b8'),
          { text: fmtMoeda(g.valor), fontSize: 7, bold: true, alignment: 'right' as const },
        ]),
      },
      layout: 'noBorders' as const,
      margin: [0, 0, 0, 6] as [number, number, number, number],
    },
    {
      text: 'Maiores tributos por produto (top 8 · IBS + CBS)',
      fontSize: 8.5,
      bold: true,
      color: '#1f3d37',
      margin: [0, 4, 0, 4] as [number, number, number, number],
    },
    {
      table: {
        widths: ['38%', '40%', '22%'],
        body: top.map((r) => [
          { text: (r.descricaoProduto || r.codItem).slice(0, 44), fontSize: 7, color: '#334155' },
          barraPdf(r.totalTributos, maxTop, '#3a5dff', 190),
          { text: fmtMoeda(r.totalTributos), fontSize: 7, bold: true, alignment: 'right' as const },
        ]),
      },
      layout: 'noBorders' as const,
      margin: [0, 0, 0, 6] as [number, number, number, number],
    },
  ]
}

/**
 * Relatório tributário do SPED em **paisagem** (como a v1), com a mesma
 * estrutura de colunas das duas variantes (itens × resumo C190).
 */
export async function exportarSpedPDF(params: RelatorioSpedParams): Promise<void> {
  const { resultados, emitente, tipo } = params
  const cor = rgbHex(emitente.cor || '#0f215c')
  const resumo = ehResumo(resultados)
  const tot = totaisSped(resultados)
  const tipoNome = tipo === 'contribuicoes' ? 'EFD Contribuições (PIS/COFINS)' : 'EFD ICMS/IPI'
  const data = new Date().toLocaleString('pt-BR')

  const cols: ColunaRel[] = resumo
    ? [
        { titulo: 'CST ICMS', larg: 9, mono: true, forte: true },
        { titulo: 'CFOP', larg: 7, mono: true },
        { titulo: 'Notas', larg: 7, alin: 'right' },
        { titulo: 'Valor Operação', larg: 16, alin: 'right' },
        { titulo: 'BC ICMS', larg: 14, alin: 'right' },
        { titulo: 'ICMS', larg: 13, alin: 'right' },
        { titulo: 'IBS', larg: 13, alin: 'right' },
        { titulo: 'CBS', larg: 13, alin: 'right' },
        { titulo: 'Total', larg: 15, alin: 'right', forte: true },
      ]
    : [
        { titulo: 'Código', larg: 9, forte: true },
        { titulo: 'Produto', larg: 24 },
        { titulo: 'NCM', larg: 8, mono: true, alin: 'center' },
        { titulo: 'CST', larg: 5, mono: true, alin: 'center' },
        { titulo: 'CFOP', larg: 5, mono: true, alin: 'center' },
        { titulo: 'Qtd', larg: 7, alin: 'right' },
        { titulo: 'Valor', larg: 11, alin: 'right' },
        { titulo: 'CST Reforma', larg: 7, mono: true, alin: 'center' },
        { titulo: 'cClassTrib', larg: 9, mono: true, alin: 'center' },
        { titulo: 'Red. IBS', larg: 7, alin: 'right' },
        { titulo: 'Red. CBS', larg: 7, alin: 'right' },
        { titulo: 'IBS', larg: 10, alin: 'right' },
        { titulo: 'CBS', larg: 10, alin: 'right' },
        { titulo: 'Total', larg: 11, alin: 'right', forte: true },
      ]

  const rows: Cell[][] = resumo
    ? (resultados as ResultadoResumo[]).map((r) => [
        r.cstIcms, r.cfop, String(r.qtdNotas),
        fmtMoeda(r.totalOperacao), fmtMoeda(r.totalBcIcms), fmtMoeda(r.totalIcms),
        fmtMoeda(r.ibs), fmtMoeda(r.cbs), fmtMoeda(r.totalTributos),
      ])
    : (resultados as ResultadoItem[]).map((r) => [
        r.codItem,
        (r.descricaoProduto || '').slice(0, 40),
        fmtNcm(r.ncm),
        r.cstIcms,
        r.cfop,
        fmtNum(r.qtd),
        fmtMoeda(r.vlItem),
        r.classificacao.cst || '—',
        r.classificacao.cClassTrib || '—',
        fmtPct(r.redIBS),
        fmtPct(r.redCBS),
        fmtMoeda(r.ibs),
        fmtMoeda(r.cbs),
        fmtMoeda(r.totalTributos),
      ])

  const totalRow: Cell[] | undefined = resumo
    ? ['TOTAL', '', String((resultados as ResultadoResumo[]).reduce((a, r) => a + r.qtdNotas, 0)),
       fmtMoeda(tot.base), '', '', fmtMoeda(tot.ibs), fmtMoeda(tot.cbs), fmtMoeda(tot.trib)]
    : ['TOTAL', `${resultados.length} itens`, '', '', '', '', fmtMoeda(tot.base), '', '', '', '',
       fmtMoeda(tot.ibs), fmtMoeda(tot.cbs), fmtMoeda(tot.trib)]

  const doc: TDocumentDefinitions = {
    pageSize: { width: 841.89, height: 595.28 }, // A4 paisagem
    pageMargins: [28, 102, 28, 44],
    defaultStyle: { font: 'Roboto', fontSize: 6.4, color: '#1e293b' },
    info: { title: `${tipoNome} — Relatório Tributário`, author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: () => ({
      margin: [28, 8, 28, 0] as [number, number, number, number],
      stack: [
        {
          canvas: [{ type: 'rect', x: 0, y: 0, w: 785, h: 11.3, color: cor }],
          margin: [0, 0, 0, 7] as [number, number, number, number],
        },
        {
          columnGap: 12,
          columns: [
            { width: 'auto', stack: [logoDoEmitente(emitente, cor) as never] },
            {
              stack: [
                { text: `${tipoNome} — Relatório Tributário (LC 214/2025)`, fontSize: 13, bold: true, color: cor },
                {
                  text: `Emitente: ${emitente.razaoSocial || '—'}${emitente.cnpj ? ` · CNPJ ${emitente.cnpj}` : ''} · Gerado em ${data}`,
                  fontSize: 7.4,
                  color: '#7a8896',
                  margin: [0, 2, 0, 0] as [number, number, number, number],
                },
              ],
              width: '*',
            },
            ...(params.arquivo
              ? [{
                  stack: [{ text: `Fonte: ${params.arquivo}`, fontSize: 6.8, color: '#94a3b8', alignment: 'right' as const }],
                  width: 'auto',
                }]
              : []),
          ],
        },
        {
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 785, y2: 0, lineWidth: 0.7, lineColor: '#dfe4e8' }],
          margin: [0, 5, 0, 0] as [number, number, number, number],
        },
      ],
    }),
    footer: (pagina: number, total: number) => ({
      margin: [28, 0, 28, 22] as [number, number, number, number],
      columns: [
        { text: emitente.rodape || 'Aurum Tax NCM · Aurum Bit Labs & Studios LTDA', fontSize: 6.6, color: '#8c96a5' },
        { text: `Página ${pagina} de ${total}`, fontSize: 6.6, color: '#8c96a5', alignment: 'right' },
      ],
    }),
    content: [
      faixaTotais(
        [
          ['Itens', String(resultados.length)],
          ['Base', fmtMoeda(tot.base)],
          ['IBS', fmtMoeda(tot.ibs)],
          ['CBS', fmtMoeda(tot.cbs)],
          ['Total', fmtMoeda(tot.trib)],
          ['Carga', fmtCarga(tot.carga)],
        ],
        cor,
      ),
      avisoSaida(),
      ...graficosSpedPdf(resultados),
      ...secao(
        resumo ? 'Resumo por CST ICMS / CFOP' : 'Detalhamento por item',
        resumo
          ? 'Registros C190 agrupados; a classificação da Reforma é estimada pela regra geral.'
          : 'Classificação resolvida pela base oficial LC 214/2025 para cada NCM do item.',
      ),
      tabelaRelatorio({ cols, rows, total: totalRow, corCabecalho: cor }),
    ],
  }

  await gerarPdf(doc, `SPED_Tributacao_${hojeISO()}.pdf`)
}

/* --------------------------------------------------------- Relatório: lote -- */

export interface LinhaLote {
  linha: number
  sku?: string
  produto?: string
  ncmOriginal?: string
  ncmSugerido?: string
  cfop?: string
  cst?: string
  cClassTrib?: string
  situacao?: string
  regraGeral?: boolean
  manual?: boolean
  [chave: string]: unknown
}

/**
 * Relatório da classificação em lote. Não existia na v1 (só havia CSV) —
 * agora os resultados podem sair em PDF com a mesma identidade visual.
 */
export async function exportarLotePDF(
  linhas: LinhaLote[],
  emitente: Emitente,
  nomeArquivo: string,
): Promise<void> {
  const cor = rgbHex(emitente.cor || '#0f215c')
  const divergentes = linhas.filter(
    (l) => l.ncmSugerido && l.ncmOriginal && l.ncmOriginal.replace(/\D/g, '') !== l.ncmSugerido.replace(/\D/g, ''),
  ).length

  const cols: ColunaRel[] = [
    { titulo: '#', larg: 5, alin: 'right', cinza: true },
    { titulo: 'SKU', larg: 11, forte: true },
    { titulo: 'Produto', larg: 30 },
    { titulo: 'NCM atual', larg: 11, mono: true, alin: 'center' },
    { titulo: 'NCM sugerido', larg: 11, mono: true, alin: 'center', forte: true },
    { titulo: 'CFOP', larg: 6, mono: true, alin: 'center' },
    { titulo: 'CST', larg: 6, mono: true, alin: 'center' },
    { titulo: 'cClassTrib', larg: 9, mono: true, alin: 'center' },
    { titulo: 'Situação', larg: 22 },
  ]

  const rows: Cell[][] = linhas.map((l, i) => [
    i + 1,
    l.sku ?? '',
    String(l.produto ?? '').slice(0, 60),
    l.ncmOriginal ? fmtNcm(l.ncmOriginal) : '—',
    l.ncmSugerido ? fmtNcm(l.ncmSugerido) : '—',
    l.cfop ?? '',
    l.cst ?? '',
    l.cClassTrib ?? '',
    l.situacao ?? (l.regraGeral ? 'regra geral' : 'ok'),
  ])

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#1e293b' },
    info: { title: 'Classificação em lote', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: (() => timbrado(emitente, cor, 'Classificação em lote', `LC 214/2025 · ${nomeArquivo}`)) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content: [
      { text: 'Classificação em lote', fontSize: 14, bold: true, color: cor, margin: [0, 2, 0, 1] as [number, number, number, number] },
      {
        text: `${nomeArquivo} · ${linhas.length} itens processados`,
        fontSize: 7.6,
        color: '#7a8896',
        margin: [0, 0, 0, 8] as [number, number, number, number],
      },
      faixaTotais(
        [
          ['Itens', String(linhas.length)],
          ['NCM divergentes', String(divergentes)],
          ['Sem NCM', String(linhas.filter((l) => !l.ncmSugerido).length)],
          ['Regra geral', String(linhas.filter((l) => l.regraGeral).length)],
        ],
        cor,
      ),
      tabelaRelatorio({ cols, rows, corCabecalho: cor }),
    ],
  }

  await gerarPdf(doc, `classificacao_lote_${hojeISO()}.pdf`)
}

/* ---------------------------------------------------------- Relatório: NFe -- */

const ROTULO_DIRECAO: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', quarentena: 'Quarentena' }

const fmtDataBr = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso

/** CSV das notas (tudo entreaspado, padrão SPED da v1). */
export function csvNfe(notas: NotaXml[]): string {
  const head = [
    'Chave', 'Número', 'Série', 'Modelo', 'Emissão', 'Direção',
    'Emitente', 'CNPJ Emitente', 'Regime Emitente', 'Destinatário', 'Itens', 'Valor Total',
    'ICMS Destacado', 'Itens c/ Crédito', 'Fontes Crédito',
    'IBS Destacado XML', 'CBS Destacada XML', 'Crédito IBS/CBS XML',
    'IBS', 'CBS', 'Total Tributos',
  ]
  const linhas = notas.map((n) => {
    const cred = creditoDaNota(n.itensAnalisados)
    const credReforma = creditoIbsCbsDaNota(n.itensAnalisados, n)
    const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
    return [
      n.chave, n.numero, n.serie, n.modelo, fmtDataBr(n.dataEmissao),
      ROTULO_DIRECAO[n.direcao] ?? n.direcao,
      n.emitNome, n.emitCnpj,
      regime === 'desconhecido' ? '—' : REGIME_LABELS[regime],
      n.destNome || '—', n.itensAnalisados.length,
      Number(n.valorTotal).toFixed(2),
      cred.icmsDestacado.toFixed(2), `${cred.itensComCredito}/${cred.totalItens}`, cred.fontes.join('+'),
      credReforma.ibsDestacado.toFixed(2), credReforma.cbsDestacado.toFixed(2), credReforma.totalDestacado.toFixed(2),
      Number(n.totalIBS).toFixed(2),
      Number(n.totalCBS).toFixed(2), Number(n.totalTributos).toFixed(2),
    ]
  })
  // Bloco de apuração ao final — mesmo cálculo do painel em tela.
  const ap = apurarIbsCbs(notas)
  const vereditoCsv =
    ap.resultado === 'a-pagar'
      ? `IMPOSTO A PAGAR ${ap.valorAPagar.toFixed(2)}`
      : ap.resultado === 'saldo-credor'
        ? `SALDO CREDOR ${ap.saldoCredor.toFixed(2)}`
        : ap.resultado.toUpperCase().replace('-', ' ')
  const blocoApuracao: unknown[][] = [
    [],
    ['APURACAO IBS/CBS (estimativa LC 214/2025)', 'IBS', 'CBS', 'Total'],
    [`Débitos — Saídas (${ap.qtdSaidas} notas)`, ap.debitoIBS.toFixed(2), ap.debitoCBS.toFixed(2), ap.debitoTotal.toFixed(2)],
    [`Créditos apropriáveis — Entradas (${ap.qtdEntradasApropriaveis} notas)`, ap.creditoIBS.toFixed(2), ap.creditoCBS.toFixed(2), ap.creditoTotal.toFixed(2)],
    ['Saldo apurado', ap.saldoIBS.toFixed(2), ap.saldoCBS.toFixed(2), ap.saldoTotal.toFixed(2)],
    [vereditoCsv],
    [`Bloqueados Simples/MEI (${ap.qtdEntradasBloqueadas} notas)`, ap.bloqueadoIBS.toFixed(2), ap.bloqueadoCBS.toFixed(2), ap.bloqueadoTotal.toFixed(2)],
  ]
  return montarCSV([head, ...linhas, ...blocoApuracao], true)
}

export function exportarNfeCSV(notas: NotaXml[]): void {
  baixar(`NFe_Notas_${hojeISO()}.csv`, csvNfe(notas), 'text/csv;charset=utf-8')
}

export interface RelatorioNfeParams {
  notas: NotaXml[]
  ranking: CreditoFornecedor[]
  emitente: Emitente
  empresaNome: string
  periodo: string
}

/**
 * Relatório das notas de XML em **retrato A4, nível editorial**: timbre só na
 * primeira folha, sumário executivo, apuração com quantidades avaliadas,
 * ranking de fornecedores e produtos analisados (entradas × saídas lado a
 * lado). Paleta fixa slate + esmeralda; textos padronizados.
 */
export async function exportarNfePDF(params: RelatorioNfeParams): Promise<void> {
  const { notas, ranking, emitente, empresaNome, periodo } = params
  const cor = rgbHex(emitente.cor || '#0f215c')
  const data = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const ap = apurarIbsCbs(notas)

  const qtdEntradas = ap.qtdEntradasApropriaveis + ap.qtdEntradasBloqueadas + ap.qtdEntradasNaoConfirmadas
  const baseTotal = ap.baseEntradas + ap.baseSaidas
  const tribEstimado = notas.reduce((s, n) => s + (Number(n.totalTributos) || 0), 0)
  const destTotal = notas.reduce((s, n) => s + creditoIbsCbsDaNota(n.itensAnalisados, n).totalDestacado, 0)
  const carga = baseTotal > 0 ? (tribEstimado / baseTotal) * 100 : 0
  const maxBar = Math.max(ap.creditoTotal, ap.debitoTotal, 1)
  const maxForn = ranking.slice(0, 8).reduce((m, r) => Math.max(m, r.creditoTotal), 1)
  const totalCredRank = ranking.reduce((s, r) => s + r.creditoTotal, 0)

  const vereditoTexto =
    ap.resultado === 'a-pagar'
      ? `Imposto a pagar: ${fmtMoeda(ap.valorAPagar)}`
      : ap.resultado === 'saldo-credor'
        ? `Saldo credor: ${fmtMoeda(ap.saldoCredor)} — disponível para restituição ou compensação`
        : ap.resultado === 'zerado'
          ? 'Débitos e créditos equivalentes — sem saldo a pagar ou restituir'
          : 'Sem movimento no período avaliado'
  const vereditoCor = ap.resultado === 'a-pagar' ? '#dc2626' : ap.resultado === 'saldo-credor' ? '#047857' : '#475569'
  const vereditoFundo = ap.resultado === 'a-pagar' ? '#fef2f2' : ap.resultado === 'saldo-credor' ? '#ecfdf5' : '#f8fafc'

  // Paleta editorial fixa — slate + esmeralda. A cor do emissor aparece só no
  // selo do timbre; divisões e tabelas usam sempre os mesmos tons.
  const TINTA = '#0f172a'
  const SUAVE = '#64748b'
  const LINHA = '#e2e8f0'
  const FUNDO = '#f8fafc'
  const ESMERALDA = '#047857'
  const AZUL = '#1d4ed8'

  // Referências de alíquota usadas nas notas (nota metodológica).
  const refs = [...new Set(notas.map((n) => `${n.refIBS}% / ${n.refCBS}%`))].slice(0, 4)

  // Produtos analisados — agregados por código a partir dos itens das notas,
  // separados por fluxo. Top por valor para caber em quadros lado a lado.
  interface ProdutoAgregado { codigo: string; nome: string; qtd: number; base: number; trib: number }
  const agregar = (fluxo: 'entrada' | 'saida'): { top: ProdutoAgregado[]; qtdItens: number; base: number; trib: number } => {
    const mapa = new Map<string, ProdutoAgregado>()
    for (const n of notas) {
      if (n.direcao !== fluxo) continue
      for (const it of n.itensAnalisados) {
        const chave = `${it.codProd}‖${it.ncm}`
        const atual = mapa.get(chave) ?? { codigo: it.codProd, nome: it.descricao || it.codProd, qtd: 0, base: 0, trib: 0 }
        atual.qtd += Number(it.qtd) || 0
        atual.base += Number(it.vlTotal) || 0
        atual.trib += Number(it.totalTributos) || 0
        mapa.set(chave, atual)
      }
    }
    const todos = [...mapa.values()].sort((a, b) => b.base - a.base)
    return {
      top: todos.slice(0, 7),
      qtdItens: todos.length,
      base: todos.reduce((s, p) => s + p.base, 0),
      trib: todos.reduce((s, p) => s + p.trib, 0),
    }
  }
  const prodEntradas = agregar('entrada')
  const prodSaidas = agregar('saida')

  /** Cartão de KPI do sumário executivo. */
  const cartaoKpi = (rotulo: string, valor: string, detalhe: string) => ({
    stack: [
      { text: rotulo.toUpperCase(), fontSize: 6.5, bold: true, color: '#64748b', margin: [0, 0, 0, 2] as [number, number, number, number] },
      { text: valor, fontSize: 12, bold: true, color: '#0f172a' },
      { text: detalhe, fontSize: 6.8, color: '#64748b', margin: [0, 2, 0, 0] as [number, number, number, number] },
    ],
    fillColor: '#f8fafc',
    margin: [7, 7, 7, 7] as [number, number, number, number],
  })

  const tituloSecao = (num: string, titulo: string, sub?: string): NonNullable<Content>[] => [
    {
      stack: [
        { text: `SEÇÃO ${num}`, fontSize: 7, bold: true, color: ESMERALDA, margin: [0, 0, 0, 1] as [number, number, number, number] },
        { text: titulo, fontSize: 12, bold: true, color: TINTA },
        ...(sub ? [{ text: sub, fontSize: 7.5, color: SUAVE, margin: [0, 1, 0, 0] as [number, number, number, number] }] : []),
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: ESMERALDA }], margin: [0, 5, 0, 0] as [number, number, number, number] },
      ],
      margin: [0, 14, 0, 6] as [number, number, number, number],
    },
  ]

  // -- tabelas ---------------------------------------------------------------
  const colsFluxo: ColunaRel[] = [
    { titulo: 'Fluxo', larg: 34 },
    { titulo: 'Notas avaliadas', larg: 16, alin: 'right', forte: true },
    { titulo: 'Base (R$)', larg: 17, alin: 'right' },
    { titulo: 'IBS (R$)', larg: 16, alin: 'right' },
    { titulo: 'CBS (R$)', larg: 16, alin: 'right' },
    { titulo: 'Total (R$)', larg: 17, alin: 'right', forte: true },
  ]
  const rowsFluxo: Cell[][] = [
    ['Crédito — Entradas avaliadas', qtdEntradas, fmtMoeda(ap.baseEntradas), fmtMoeda(ap.creditoIBS + ap.bloqueadoIBS + ap.naoConfirmadoIBS), fmtMoeda(ap.creditoCBS + ap.bloqueadoCBS + ap.naoConfirmadoCBS), fmtMoeda(ap.creditoTotal + ap.bloqueadoTotal + ap.naoConfirmadoTotal)],
    ['Débito — Saídas avaliadas', ap.qtdSaidas, fmtMoeda(ap.baseSaidas), fmtMoeda(ap.debitoIBS), fmtMoeda(ap.debitoCBS), fmtMoeda(ap.debitoTotal)],
  ]

  const colsApuracao: ColunaRel[] = [
    { titulo: 'Apuração IBS/CBS (estimativa LC 214/2025)', larg: 42 },
    { titulo: 'Base', larg: 17, alin: 'right' },
    { titulo: 'IBS', larg: 17, alin: 'right' },
    { titulo: 'CBS', larg: 17, alin: 'right' },
    { titulo: 'Total', larg: 17, alin: 'right', forte: true },
  ]
  const rowsApuracao: Cell[][] = [
    [`Débitos — Saídas (${ap.qtdSaidas} nota(s) avaliada(s))`, fmtMoeda(ap.baseSaidas), fmtMoeda(ap.debitoIBS), fmtMoeda(ap.debitoCBS), fmtMoeda(ap.debitoTotal)],
    [`(−) Créditos apropriáveis — Entradas regime normal (${ap.qtdEntradasApropriaveis} nota(s))`, fmtMoeda(ap.baseEntradas), fmtMoeda(ap.creditoIBS), fmtMoeda(ap.creditoCBS), fmtMoeda(ap.creditoTotal)],
    ['(=) Saldo apurado', '—', fmtMoeda(ap.saldoIBS), fmtMoeda(ap.saldoCBS), fmtMoeda(ap.saldoTotal)],
  ]
  const rowsForaSaldo: Cell[][] = [
    ...(ap.qtdEntradasBloqueadas > 0
      ? [[`Bloqueados — Simples/MEI (${ap.qtdEntradasBloqueadas} nota(s), fora do saldo)`, '—', fmtMoeda(ap.bloqueadoIBS), fmtMoeda(ap.bloqueadoCBS), fmtMoeda(ap.bloqueadoTotal)] as Cell[]]
      : []),
    ...(ap.qtdEntradasNaoConfirmadas > 0
      ? [[`Não confirmados — regime desconhecido (${ap.qtdEntradasNaoConfirmadas} nota(s), fora do saldo)`, '—', fmtMoeda(ap.naoConfirmadoIBS), fmtMoeda(ap.naoConfirmadoCBS), fmtMoeda(ap.naoConfirmadoTotal)] as Cell[]]
      : []),
    ...(ap.qtdQuarentena > 0 ? [[`Quarentena — direção indefinida (${ap.qtdQuarentena} nota(s), excluída)`, '—', '—', '—', '—'] as Cell[]] : []),
  ]

  const topForn = ranking.slice(0, 8)
  const colsRank: ColunaRel[] = [
    { titulo: 'Fornecedor (maior crédito)', larg: 38 },
    { titulo: 'Notas', larg: 10, alin: 'right' },
    { titulo: 'Base entradas', larg: 17, alin: 'right' },
    { titulo: 'Crédito total', larg: 17, alin: 'right', forte: true },
    { titulo: '% do crédito', larg: 11, alin: 'right' },
  ]
  const rowsRank: Cell[][] = topForn.map((r) => [
    `${r.nome}${r.simples ? ' (Simples · sem crédito)' : ''} · ${fmtCnpj(r.cnpj)}`.slice(0, 58),
    r.qtdNotas,
    fmtMoeda(r.totalEntradas),
    fmtMoeda(r.creditoTotal),
    totalCredRank > 0 ? `${((r.creditoTotal / totalCredRank) * 100).toFixed(1).replace('.', ',')}%` : '—',
  ])

  const colsProduto: ColunaRel[] = [
    { titulo: 'Produto', larg: 44 },
    { titulo: 'Qtd', larg: 14, alin: 'right' },
    { titulo: 'Base', larg: 21, alin: 'right' },
    { titulo: 'IBS+CBS', larg: 21, alin: 'right', forte: true },
  ]
  const linhasProduto = (lista: ProdutoAgregado[]): Cell[][] =>
    lista.map((p) => [
      `${p.nome.slice(0, 30)} · ${p.codigo}`.slice(0, 42),
      fmtNum(p.qtd),
      fmtMoeda(p.base),
      fmtMoeda(p.trib),
    ])
  /** Quadro lateral de produtos (entradas em esmeralda, saídas em azul). */
  const quadroProdutos = (
    rotulo: string,
    resumo: string,
    dados: { top: ProdutoAgregado[]; qtdItens: number; base: number; trib: number },
    destaque: string,
  ): NonNullable<Content> => ({
    stack: [
      {
        table: {
          widths: ['100%'],
          body: [
            [
              {
                stack: [
                  { text: rotulo, fontSize: 8, bold: true, color: '#ffffff', alignment: 'center' as const },
                  { text: resumo, fontSize: 6.5, color: '#ffffff', alignment: 'center' as const, margin: [0, 1, 0, 0] as [number, number, number, number] },
                ],
                fillColor: destaque,
                margin: [6, 6, 6, 6] as [number, number, number, number],
              },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 3] as [number, number, number, number],
      },
      ...(dados.top.length
        ? [tabelaRelatorio({ cols: colsProduto, rows: linhasProduto(dados.top), total: ['TOTAL DO FLUXO', `${dados.qtdItens} item(ns)`, fmtMoeda(dados.base), fmtMoeda(dados.trib)], corCabecalho: TINTA })]
        : [{ text: 'Sem produtos neste fluxo no filtro aplicado.', fontSize: 7.5, italics: true, color: SUAVE, margin: [0, 4, 0, 4] as [number, number, number, number] }]),
    ],
  })

  const infoTimbre = linhasEmitente(emitente).map((l) => l[0]).filter(Boolean)
  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 55, 40, 55],
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: '#1e293b', lineHeight: 1.35 },
    info: {
      title: `Apuração IBS/CBS — Notas Fiscais (XML) · ${empresaNome} · ${periodo}`,
      author: emitente.razaoSocial || 'Aurum Tax NCM',
      creator: 'Aurum Tax NCM',
    },
    // Timbre só na primeira folha (bloco de capa no conteúdo); nas demais,
    // um cabeçalho de condução discreto com título + empresa/período.
    header: ((pagina: number) => {
      if (pagina === 1) return null
      return {
        margin: [40, 18, 40, 0] as [number, number, number, number],
        stack: [
          {
            columns: [
              { text: 'APURAÇÃO IBS/CBS · NOTAS FISCAIS (XML)', fontSize: 7, bold: true, color: SUAVE },
              { text: `${empresaNome} · ${periodo}`, fontSize: 7, color: SUAVE, alignment: 'right' as const },
            ],
          },
          { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: LINHA }], margin: [0, 5, 0, 0] as [number, number, number, number] },
        ],
      }
    }) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content: [
      // -- timbre da primeira folha -------------------------------------------
      { canvas: [{ type: 'rect' as const, x: 0, y: 0, w: 515, h: 5, color: ESMERALDA }], margin: [0, 0, 0, 10] as [number, number, number, number] },
      {
        columnGap: 12,
        columns: [
          { width: 'auto', stack: [logoDoEmitente(emitente, cor) as never] },
          {
            width: '*',
            stack: [
              { text: emitente.razaoSocial || empresaNome, fontSize: 13, bold: true, color: TINTA },
              ...(emitente.cnpj ? [{ text: `CNPJ ${emitente.cnpj}${emitente.ie ? `  ·  IE ${emitente.ie}` : ''}`, fontSize: 7.5, color: SUAVE, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
              ...infoTimbre.slice(1).map((linha) => ({ text: linha, fontSize: 7.2, color: SUAVE, margin: [0, 1, 0, 0] as [number, number, number, number] })),
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: 'DOCUMENTO TRIBUTÁRIO', fontSize: 7, bold: true, color: ESMERALDA },
              { text: 'Apuração IBS/CBS', fontSize: 9, bold: true, color: TINTA, margin: [0, 1, 0, 0] as [number, number, number, number] },
              { text: `Período ${periodo}`, fontSize: 7.2, color: SUAVE, margin: [0, 1, 0, 0] as [number, number, number, number] },
              { text: `Gerado em ${data}`, fontSize: 7.2, color: SUAVE },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.7, lineColor: LINHA }], margin: [0, 10, 0, 10] as [number, number, number, number] },
      // -- capa ---------------------------------------------------------------
      { text: 'REFORMA TRIBUTÁRIA · LC 214/2025 · NT 2025.002', fontSize: 7.5, bold: true, color: ESMERALDA, margin: [0, 2, 0, 2] as [number, number, number, number] },
      { text: 'Apuração IBS / CBS', fontSize: 24, bold: true, color: TINTA, margin: [0, 0, 0, 1] as [number, number, number, number] },
      { text: 'Notas fiscais eletrônicas (XML) — créditos das entradas × débitos das saídas', fontSize: 9.5, color: '#475569' },
      {
        text: `${empresaNome} · Período ${periodo} · Gerado em ${data} · ${notas.length} nota(s) no filtro`,
        fontSize: 7.5, color: SUAVE, margin: [0, 4, 0, 8] as [number, number, number, number],
      },
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              cartaoKpi('Entradas avaliadas', String(qtdEntradas), `Base ${fmtMoeda(ap.baseEntradas)}`),
              cartaoKpi('Saídas avaliadas', String(ap.qtdSaidas), `Base ${fmtMoeda(ap.baseSaidas)}`),
              cartaoKpi('Crédito apropriável', fmtMoeda(ap.creditoTotal), `IBS ${fmtMoeda(ap.creditoIBS)} + CBS ${fmtMoeda(ap.creditoCBS)}`),
              cartaoKpi('Débito das saídas', fmtMoeda(ap.debitoTotal), `IBS ${fmtMoeda(ap.debitoIBS)} + CBS ${fmtMoeda(ap.debitoCBS)}`),
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 4] as [number, number, number, number],
      },
      // -- veredito em destaque -------------------------------------------------
      {
        table: {
          widths: [5, '*'],
          body: [
            [
              { text: '', fillColor: vereditoCor, margin: [0, 0, 0, 0] as [number, number, number, number] },
              {
                stack: [
                  { text: vereditoTexto, fontSize: 10.5, bold: true, color: vereditoCor },
                  {
                    text: `Carga estimada ${fmtCarga(carga)} sobre base total de ${fmtMoeda(baseTotal)} · IBS/CBS destacados no XML: ${fmtMoeda(destTotal)} · Quarentena excluída: ${ap.qtdQuarentena} nota(s)`,
                    fontSize: 7.2, color: '#475569', margin: [0, 2, 0, 0] as [number, number, number, number],
                  },
                ],
                fillColor: vereditoFundo,
                margin: [10, 8, 10, 8] as [number, number, number, number],
              },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 2, 0, 2] as [number, number, number, number],
      },
      // -- 1. direção ------------------------------------------------------------
      ...tituloSecao('01', 'Crédito por entrada × débito por saída', 'Quantidades avaliadas e valores estimados — a base da apuração.'),
      tabelaRelatorio({ cols: colsFluxo, rows: rowsFluxo, corCabecalho: TINTA }),
      {
        table: {
          widths: ['26%', '56%', '18%'],
          body: [
            [
              { text: 'Crédito apropriável', fontSize: 7.5, color: '#334155' },
              barraPdf(ap.creditoTotal, maxBar, '#047857', 200),
              { text: fmtMoeda(ap.creditoTotal), fontSize: 7.5, bold: true, alignment: 'right' as const },
            ],
            [
              { text: 'Débito das saídas', fontSize: 7.5, color: '#334155' },
              barraPdf(ap.debitoTotal, maxBar, '#1d4ed8', 200),
              { text: fmtMoeda(ap.debitoTotal), fontSize: 7.5, bold: true, alignment: 'right' as const },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 2] as [number, number, number, number],
      },
      // -- 2. apuração ------------------------------------------------------------
      ...tituloSecao('02', 'Apuração IBS/CBS — débitos menos créditos', 'Entradas de regime normal abatem; Simples/MEI bloqueados e regime desconhecido ficam fora do saldo.'),
      tabelaRelatorio({
        cols: colsApuracao,
        rows: [...rowsApuracao, ...rowsForaSaldo],
        corCabecalho: TINTA,
      }),
      // -- 3. fornecedores ---------------------------------------------------------
      ...(topForn.length
        ? [
            ...tituloSecao('03', 'Fornecedores que mais geraram crédito', 'IBS + CBS estimados das entradas por emitente — ver as notas na tela do sistema.'),
            tabelaRelatorio({ cols: colsRank, rows: rowsRank, corCabecalho: TINTA }),
            {
              table: {
                widths: ['34%', '48%', '18%'],
                body: topForn.slice(0, 5).map((r) => [
                  { text: r.nome.slice(0, 30), fontSize: 7.2, color: '#334155' },
                  barraPdf(r.creditoTotal, maxForn, r.simples ? '#94a3b8' : '#047857', 170),
                  { text: fmtMoeda(r.creditoTotal), fontSize: 7.2, bold: true, alignment: 'right' as const },
                ]),
              },
              layout: 'noBorders' as const,
              margin: [0, 0, 0, 2] as [number, number, number, number],
            },
          ]
        : []),
      // -- 4. produtos analisados (quadros lado a lado) -------------------------------
      ...tituloSecao('04', 'Produtos analisados — entradas × saídas', 'Itens dos XMLs agregados por produto (código), top 7 por valor em cada fluxo.'),
      {
        columnGap: 10,
        columns: [
          quadroProdutos(
            'ENTRADAS · CRÉDITO',
            `${prodEntradas.qtdItens} produto(s) · base ${fmtMoeda(prodEntradas.base)}`,
            prodEntradas,
            ESMERALDA,
          ),
          quadroProdutos(
            'SAÍDAS · DÉBITO',
            `${prodSaidas.qtdItens} produto(s) · base ${fmtMoeda(prodSaidas.base)}`,
            prodSaidas,
            AZUL,
          ),
        ],
      },
      {
        table: {
          widths: [5, '*'],
          body: [
            [
              { text: '', fillColor: ESMERALDA, margin: [0, 0, 0, 0] as [number, number, number, number] },
              {
                stack: [
                  { text: 'Nota metodológica', fontSize: 8.5, bold: true, color: TINTA },
                  {
                    text: [
                      'Estimativa por item: base × alíquotas de referência com reduções de CST/cClassTrib (LC 214/2025). ',
                      refs.length ? `Referências nas notas: ${refs.join(' · ')}. ` : '',
                      'Saída gera débito integral; entrada de regime normal gera crédito apropriável integral. ',
                      'Simples/MEI é bloqueado (não transfere crédito); regime desconhecido fica como não confirmado; ',
                      'quarentena é excluída.',
                    ].join(''),
                    fontSize: 7.2, color: '#475569', margin: [0, 2, 0, 0] as [number, number, number, number],
                  },
                ],
                fillColor: FUNDO,
                margin: [10, 8, 10, 8] as [number, number, number, number],
              },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 6, 0, 4] as [number, number, number, number],
      },
      {
        text: 'Documento gerado automaticamente a partir dos XMLs importados — confira na EFD. O documento fiscal válido é o XML com sua chave de acesso. Estimativas calculadas sobre o filtro aplicado em tela.',
        fontSize: 7, italics: true, color: '#94a3b8', margin: [0, 6, 0, 0] as [number, number, number, number],
      },
    ],
  }

  await gerarPdf(doc, `NFe_Apuracao_${hojeISO()}.pdf`)
}
