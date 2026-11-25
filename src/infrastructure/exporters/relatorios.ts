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
import { calcularTributos, round2 } from '../../domain/services/calculo'
import { fmtCarga, fmtMoeda, fmtNcm, fmtNum, hexToRgb } from '../../domain/services/format'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import type { AnexoNcm, Emitente, Empresa, Produto } from '../../domain/entities'
import { anexosNegadosPara } from '../base/info-adicional'
import { OURO_AURUM, fundoMarcaDagua } from '../pdf/marca-dagua'

/* --------------------------------------------------------------- helpers -- */

const BOM = '﻿'
const hojeISO = (): string => new Date().toISOString().slice(0, 10)

/**
 * Restrições oficiais "Não Permitido" para os NCMs do relatório (best-effort:
 * sem tabela de anexos, devolve vazio e o relatório sai como antes).
 */
async function anexosNegadosRelatorio(ncms: unknown[]): Promise<AnexoNcm[]> {
  try {
    return await anexosNegadosPara(ncms)
  } catch {
    return []
  }
}

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
  'SKU', 'Nome', 'NCM', 'CFOP entrada', 'CFOP saída', 'CST ICMS entrada', 'CST ICMS saída',
  'PIS entrada', 'PIS saída', 'COFINS entrada', 'COFINS saída', 'Qtd',
  'Valor Unitário', 'Total', 'CST Reforma', 'cClassTrib',
  'Classificação Reforma', 'Red. IBS (%)', 'Red. CBS (%)', 'Anexo',
] as const

/** Linha de produto idêntica a `produtoParaLinha` da v1 + colunas entrada×saída. */
export function produtoParaLinha(p: Produto): unknown[] {
  const c = p.classificacaoSnapshot ?? ({} as Produto['classificacaoSnapshot'])
  const r = p as unknown as Record<string, string | undefined>
  const cfopE = r.cfopEntrada || p.cfop || ''
  const cfopS = r.cfopSaida || ''
  const icmsE = r.cstIcmsEntrada || p.cstIcms || ''
  const icmsS = r.cstIcmsSaida || ''
  const pisE = r.pisEntrada || p.pis || ''
  const pisS = r.pisSaida || ''
  const cofE = r.cofinsEntrada || p.cofins || ''
  const cofS = r.cofinsSaida || ''
  return [
    p.codigo,
    p.nome,
    fmtNcm(p.ncm),
    cfopE,
    cfopS,
    icmsE,
    icmsS,
    pisE,
    pisS,
    cofE,
    cofS,
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

/* ----------------------------------------------------------------- PDF --- */

export interface LinhaLote {
  linha: number
  sku: string
  produto: string
  ncmOriginal: string
  ncmSugerido: string
  cfop: string
  cst: string
  cClassTrib: string
  situacao: string
  regraGeral: boolean
  manual?: boolean
}

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
export function tabelaRelatorio(opts: {
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

/** Timbrado premium repetido no topo de todas as páginas (equivalente ao `drawLetterhead`). */
export function timbrado(emitente: Emitente, cor: string, titulo: string, subtitulo: string) {
  const info = linhasEmitente(emitente)
  return {
    margin: [34, 8, 34, 0] as [number, number, number, number],
    stack: [
      // Abertura em filete duplo: ouro Aurum + barra na cor do emitente.
      {
        canvas: [
          { type: 'rect' as const, x: 0, y: 0, w: 527, h: 2.2, color: OURO_AURUM },
          { type: 'rect' as const, x: 0, y: 3.4, w: 527, h: 7.5, color: cor },
        ],
        margin: [0, 0, 0, 7] as [number, number, number, number],
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
              {
                text: 'AURUM TAX NCM · REFORMA TRIBUTÁRIA — LC 214/2025',
                fontSize: 6.4,
                bold: true,
                color: OURO_AURUM,
                margin: [0, 3, 0, 0] as [number, number, number, number],
              },
            ],
          },
          {
            width: 'auto',
            columns: [
              {
                width: 2.4,
                canvas: [{ type: 'rect' as const, x: 0, y: 0, w: 2.4, h: 30, color: OURO_AURUM }],
                margin: [0, 1, 0, 0] as [number, number, number, number],
              },
              {
                width: 'auto',
                alignment: 'right',
                stack: [
                  { text: titulo, fontSize: 8.4, bold: true, color: '#334155' },
                  { text: subtitulo, fontSize: 7.2, color: '#94a3b8', margin: [0, 2, 0, 0] as [number, number, number, number] },
                ],
                margin: [7, 0, 0, 0] as [number, number, number, number],
              },
            ],
          },
        ],
      },
      // Fechamento em filete duplo: cinza + ouro fino.
      {
        canvas: [
          { type: 'line' as const, x1: 0, y1: 0, x2: 527, y2: 0, lineWidth: 0.7, lineColor: '#dfe4e8' },
          { type: 'line' as const, x1: 0, y1: 1.8, x2: 527, y2: 1.8, lineWidth: 0.5, lineColor: OURO_AURUM },
        ],
        margin: [0, 5, 0, 0] as [number, number, number, number],
      },
    ],
  }
}

export function rodape(emitente: Emitente) {
  return (pagina: number, total: number) => ({
    margin: [34, 0, 34, 24] as [number, number, number, number],
    stack: [
      {
        canvas: [
          { type: 'line' as const, x1: 0, y1: 0, x2: 527, y2: 0, lineWidth: 0.5, lineColor: '#e6eaee' },
          { type: 'rect' as const, x: 0, y: 1.4, w: 44, h: 1.6, color: OURO_AURUM },
        ],
      },
      {
        margin: [0, 4, 0, 0] as [number, number, number, number],
        columns: [
          { text: emitente.rodape || emitente.razaoSocial || 'Aurum Tax NCM', fontSize: 6.8, color: '#8c96a5' },
          {
            text: [
              { text: `Página ${pagina} de ${total}`, bold: true, color: '#334155' },
              { text: '  ·  Aurum Tax NCM — Aurum Bit Labs & Studios LTDA', color: '#8c96a5' },
            ],
            fontSize: 6.8,
            alignment: 'right',
          },
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

/* --------------------------------------------------- Relatório: produtos -- */

export interface RelatorioProdutosParams {
  produtos: Produto[]
  empresa: Empresa | null
  emitente: Emitente
  /** Alíquotas de referência dinâmicas (reativas a mudanças de regras vigentes). */
  refIBS: number
  refCBS: number
}

/**
 * Relatório de classificação dos produtos cadastrados (recria o `exportarPDF`
 * da v1 em pdfMake, com a mesma estrutura de colunas).
 */
export async function exportarProdutosPDF({ produtos, empresa, emitente, refIBS, refCBS }: RelatorioProdutosParams): Promise<void> {
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
    const base = round2(Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0))
    valorTotal = round2(valorTotal + base)
    const r = calcularTributos(base, Number(c.pRedIBS ?? 0), Number(c.pRedCBS ?? 0), refIBS, refCBS)
    ibsTotal = round2(ibsTotal + r.vIBS)
    cbsTotal = round2(cbsTotal + r.vCBS)
  }
  const tribTotal = round2(ibsTotal + cbsTotal)
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
    const r = p as unknown as Record<string, string | undefined>
    const cfopE = r.cfopEntrada || p.cfop || ''
    const cfopS = r.cfopSaida || ''
    const icmsE = r.cstIcmsEntrada || p.cstIcms || ''
    const icmsS = r.cstIcmsSaida || ''
    const antiga = [
      cfopE ? `CFOP E ${cfopE}` : null,
      cfopS ? `CFOP S ${cfopS}` : null,
      icmsE ? `CST E ${icmsE}` : null,
      icmsS ? `CST S ${icmsS}` : null,
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
    background: fundoMarcaDagua(300, 0.07),
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


/** Barra horizontal proporcional (0–230pt) desenhada em canvas nativo. */
export function barraPdf(valor: number, max: number, cor: string, larguraMax = 230) {
  const w = max > 0 ? Math.max(3, Math.round((valor / max) * larguraMax)) : 3
  return {
    canvas: [{ type: 'rect' as const, x: 0, y: 0, w, h: 9, r: 3, color: cor }],
    margin: [0, 2, 0, 2] as [number, number, number, number],
  }
}

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

  const negadosLote = await anexosNegadosRelatorio(linhas.map((l) => l.ncmSugerido ?? l.ncmOriginal))
  const rowsNegadosLote: Cell[][] = negadosLote.slice(0, 20).map((a) => [
    a.codigo ? fmtNcm(a.codigo) : '—',
    `Anexo ${a.nroAnexo}`,
    ['Não permitido na tabela oficial', a.descrExcecao ? `Exceto: ${String(a.descrExcecao).slice(0, 90)}` : null].filter(Boolean).join(' · '),
  ])

  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 7, color: '#1e293b' },
    background: fundoMarcaDagua(300, 0.07),
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
      ...(negadosLote.length
        ? [
            {
              text: 'Anexos — NCMs com restrição oficial ("Não Permitido" na tabela de anexos)',
              fontSize: 9,
              bold: true,
              color: cor,
              margin: [0, 10, 0, 4] as [number, number, number, number],
            },
            tabelaRelatorio({
              cols: [
                { titulo: 'NCM', larg: 12, mono: true, alin: 'center' },
                { titulo: 'Anexo', larg: 18 },
                { titulo: 'Restrição', larg: 70 },
              ],
              rows: rowsNegadosLote,
              corCabecalho: cor,
            }),
          ]
        : []),
    ],
  }

  await gerarPdf(doc, `classificacao_lote_${hojeISO()}.pdf`)
}


/** CSV das notas (tudo entreaspado, padrão SPED da v1). */
