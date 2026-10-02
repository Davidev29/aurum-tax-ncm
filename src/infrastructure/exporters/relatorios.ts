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
import { anexoOficial, calcularTributos, round2 } from '../../domain/services/calculo'
import { rotuloAnexoOficial } from '../../domain/constants/tributarios'
import { fmtCarga, fmtMoeda, fmtNcm, fmtNum, fmtPct, hexToRgb } from '../../domain/services/format'
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces'
import { ehResumo } from '../sped/tipos'
import type { ResultadoItem, ResultadoResumo, ResultadoSped } from '../sped/tipos'
import { creditoDaNota, creditoIbsCbsDaNota } from '../nfe/credito'
import { apurarIbsCbs } from '../nfe/apuracao'
import { REGIME_LABELS, regimeDoEmitente } from '../nfe/regime'
import type { CreditoFornecedor, CreditoLoja, DisponibilidadeCredito, InsightNfe, NotaXml, OpcoesRelatorioNfe, VerificacaoRagNfe } from '../nfe/tipos'
import { OPCOES_RELATORIO_CHEIO } from '../nfe/tipos'
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
    // BLINDAGEM: coluna "Anexo" só com o oficial (`Número do Anexo` da base);
    // sem cobertura oficial, vazio — nunca faixa derivada (`60`, `isento`).
    r.totalTributos.toFixed(2), anexoOficial(r.classificacao) ?? '',
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
    base = round2(base + (Number('_isResumo' in r ? r.totalOperacao : r.vlItem) || 0))
    ibs = round2(ibs + r.ibs)
    cbs = round2(cbs + r.cbs)
  }
  const trib = round2(ibs + cbs)
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

/** Timbrado premium repetido no topo de todas as páginas (equivalente ao `drawLetterhead`). */
function timbrado(emitente: Emitente, cor: string, titulo: string, subtitulo: string) {
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

function rodape(emitente: Emitente) {
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
  // BLINDAGEM: agrupa por anexo OFICIAL quando houver (`Anexo IX`, …); itens
  // sem cobertura oficial caem na faixa de redução derivada, rotulada como
  // tal — anexos oficiais nunca somem nem viram faixa, e faixas nunca se
  // passam por anexo oficial.
  const grupos = new Map<string, { chave: string; rotulo: string; valor: number; cor: string }>()
  for (const r of itens) {
    const of = anexoOficial(r.classificacao)
    const chave = of != null ? `oficial:${of}` : `faixa:${r.anexo}`
    let g = grupos.get(chave)
    if (!g) {
      g = {
        chave,
        rotulo: of != null ? rotuloAnexoOficial(of) : `${ROTULOS_GRAFICO_PDF[r.anexo] ?? r.anexo} (faixa)`,
        valor: 0,
        cor: CORES_GRAFICO_PDF[r.anexo] ?? '#64748b',
      }
      grupos.set(chave, g)
    }
    g.valor += Number(r.vlItem) || 0
  }
  const porAnexo = [...grupos.values()]
  const maxAnexo = porAnexo.reduce((m, g) => Math.max(m, g.valor), 0)
  const top = [...itens]
    .sort((a, b) => b.totalTributos - a.totalTributos)
    .slice(0, 8)
  const maxTop = top.reduce((m, r) => Math.max(m, r.totalTributos), 0)

  return [
    {
      text: 'Distribuição por anexo oficial e faixa de redução (base de cálculo)',
      fontSize: 8.5,
      bold: true,
      color: '#1f3d37',
      margin: [0, 8, 0, 4] as [number, number, number, number],
    },
    {
      table: {
        widths: ['26%', '52%', '22%'],
        body: porAnexo.map((g) => [
          { text: g.rotulo, fontSize: 7, color: '#334155' },
          barraPdf(g.valor, maxAnexo, g.cor),
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

  const negadosSped = resumo
    ? []
    : await anexosNegadosRelatorio((resultados as ResultadoItem[]).map((r) => r.ncm))

  const doc: TDocumentDefinitions = {
    pageSize: { width: 841.89, height: 595.28 }, // A4 paisagem
    pageMargins: [28, 102, 28, 44],
    defaultStyle: { font: 'Roboto', fontSize: 6.4, color: '#1e293b' },
    background: fundoMarcaDagua(360, 0.06),
    info: { title: `${tipoNome} — Relatório Tributário`, author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: () => ({
      margin: [28, 8, 28, 0] as [number, number, number, number],
      stack: [
        {
          canvas: [
            { type: 'rect', x: 0, y: 0, w: 785, h: 2.2, color: OURO_AURUM },
            { type: 'rect', x: 0, y: 3.4, w: 785, h: 7.5, color: cor },
          ],
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
                {
                  text: 'AURUM TAX NCM · REFORMA TRIBUTÁRIA — LC 214/2025',
                  fontSize: 6.4,
                  bold: true,
                  color: OURO_AURUM,
                  margin: [0, 3, 0, 0] as [number, number, number, number],
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
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 785, y2: 0, lineWidth: 0.7, lineColor: '#dfe4e8' },
            { type: 'line', x1: 0, y1: 1.8, x2: 785, y2: 1.8, lineWidth: 0.5, lineColor: OURO_AURUM },
          ],
          margin: [0, 5, 0, 0] as [number, number, number, number],
        },
      ],
    }),
    footer: (pagina: number, total: number) => ({
      margin: [28, 0, 28, 22] as [number, number, number, number],
      stack: [
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 785, y2: 0, lineWidth: 0.5, lineColor: '#e6eaee' },
            { type: 'rect', x: 0, y: 1.4, w: 44, h: 1.6, color: OURO_AURUM },
          ],
        },
        {
          margin: [0, 4, 0, 0] as [number, number, number, number],
          columns: [
            { text: emitente.rodape || 'Aurum Tax NCM · Aurum Bit Labs & Studios LTDA', fontSize: 6.6, color: '#8c96a5' },
            {
              text: [
                { text: `Página ${pagina} de ${total}`, bold: true, color: '#334155' },
                { text: '  ·  Aurum Tax NCM', color: '#8c96a5' },
              ],
              fontSize: 6.6,
              alignment: 'right',
            },
          ],
        },
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
      ...(negadosSped.length
        ? [
            ...secao(
              'Anexos — NCMs com restrição oficial',
              'Linhas "Não Permitido" da tabela oficial de anexos para NCMs deste SPED.',
            ),
            tabelaRelatorio({
              cols: [
                { titulo: 'NCM', larg: 12, mono: true, alin: 'center' },
                { titulo: 'Anexo', larg: 20 },
                { titulo: 'Restrição', larg: 68 },
              ],
              rows: negadosSped.slice(0, 20).map((a) => [
                a.codigo ? fmtNcm(a.codigo) : '—',
                `Anexo ${a.nroAnexo}`,
                ['Não permitido na tabela oficial', a.descrExcecao ? `Exceto: ${String(a.descrExcecao).slice(0, 90)}` : null]
                  .filter(Boolean)
                  .join(' · '),
              ]),
              corCabecalho: cor,
            }),
          ]
        : []),
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
  /**
   * Pacote preparado por `prepararRelatorioNfeComIA` (v5).
   * Opcionais para compatibilidade: sem eles, o relatório sai sem o quadro
   * da Aurum AI e sem os recados — só com os números das notas.
   */
  verificacao?: VerificacaoRagNfe | null
  insights?: InsightNfe[]
  confronto?: unknown
  duplicadasIgnoradas?: number
  /**
   * O que entra no relatório (modal "Gerar PDF", v6).
   * Ausente = relatório cheio (comportamento anterior).
   */
  opcoes?: OpcoesRelatorioNfe
}

/* ------------------------------------------- novas seções (reforma v2) --- */

/** Agrega itens por produto (código) separado por fluxo, marcando ajuste do usuário. */
function produtosPorFluxo(notas: NotaXml[], fluxo: 'entrada' | 'saida'): {
  codigo: string
  nome: string
  ncm: string
  qtd: number
  base: number
  ibs: number
  cbs: number
  trib: number
  /** `true` quando você ajustou o imposto de ao menos um item (só etiqueta). */
  ajustado: boolean
  /** Imposto da Reforma do grupo (primeiro item — mesmo produto costuma repetir). */
  redIBS: number
  redCBS: number
  cst: string
  cct: string
}[] {
  const mapa = new Map<string, { codigo: string; nome: string; ncm: string; qtd: number; base: number; ibs: number; cbs: number; trib: number; ajustado: boolean; redIBS: number; redCBS: number; cst: string; cct: string }>()
  for (const n of notas) {
    if (n.direcao !== fluxo) continue
    for (const it of n.itensAnalisados) {
      const chave = `${it.codProd}‖${it.ncm}`
      const atual = mapa.get(chave) ?? {
        codigo: it.codProd, nome: it.descricao || it.codProd, ncm: it.ncm, qtd: 0, base: 0, ibs: 0, cbs: 0, trib: 0,
        ajustado: false, redIBS: Number(it.redIBS) || 0, redCBS: Number(it.redCBS) || 0,
        cst: it.classificacao?.cst || '—', cct: it.classificacao?.cClassTrib || '—',
      }
      atual.qtd += Number(it.qtd) || 0
      atual.base += Number(it.vlTotal) || 0
      atual.ibs += Number(it.ibs) || 0
      atual.cbs += Number(it.cbs) || 0
      atual.trib += Number(it.totalTributos) || 0
      if (it.manual) atual.ajustado = true
      mapa.set(chave, atual)
    }
  }
  return [...mapa.values()].sort((a, b) => b.base - a.base)
}

/**
 * Verificação de crédito por loja de entrada: Simples/MEI nunca transfere
 * crédito desse imposto; regime desconhecido fica "a confirmar".
 */
function disponibilidadeCredito(notas: NotaXml[]): CreditoLoja[] {
  const mapa = new Map<string, CreditoLoja & { simples: boolean; desconhecido: boolean }>()
  for (const n of notas) {
    if (n.direcao !== 'entrada') continue
    const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
    const chave = n.emitCnpj || n.emitNome
    let loja = mapa.get(chave)
    if (!loja) {
      loja = { nome: n.emitNome || n.emitCnpj, cnpj: n.emitCnpj, qtdNotas: 0, total: 0, disponibilidade: 'com-credito', simples: false, desconhecido: false }
      mapa.set(chave, loja)
    }
    if (regime === 'simples' || regime === 'mei') loja.simples = true
    else if (regime === 'desconhecido') loja.desconhecido = true
    loja.qtdNotas++
    loja.total += Number(n.valorTotal) || 0
  }
  const out: CreditoLoja[] = []
  for (const l of mapa.values()) {
    let disponibilidade: DisponibilidadeCredito = 'com-credito'
    if (l.simples) disponibilidade = 'sem-credito'
    else if (l.desconhecido) disponibilidade = 'a-confirmar'
    if (disponibilidade === 'com-credito') continue
    out.push({ nome: l.nome, cnpj: l.cnpj, qtdNotas: l.qtdNotas, total: l.total, disponibilidade })
  }
  return out.sort((a, b) => b.total - a.total)
}

/**
 * Para cada loja de fora do Simples: o produto que mais gerou crédito para
 * você + se o imposto dele bate com a lei atual (`bate com a lei`) ou foi
 * ajustado por você (`você ajustou` — só etiqueta, sem aviso).
 */
function destaquesPorFornecedor(notas: NotaXml[]): {
  nome: string
  qtdNotas: number
  credito: number
  produto: string
  creditoProduto: number
  ajustado: boolean
}[] {
  const lojas = new Map<string, {
    nome: string
    qtdNotas: number
    credito: number
    simples: boolean
    produtos: Map<string, { nome: string; credito: number; ajustado: boolean }>
  }>()
  for (const n of notas) {
    if (n.direcao !== 'entrada') continue
    const regime = regimeDoEmitente(n.emitCrt, n.itensAnalisados)
    const chave = n.emitCnpj || n.emitNome
    let loja = lojas.get(chave)
    if (!loja) {
      loja = { nome: n.emitNome || n.emitCnpj, qtdNotas: 0, credito: 0, simples: false, produtos: new Map() }
      lojas.set(chave, loja)
    }
    if (regime === 'simples' || regime === 'mei') loja.simples = true
    loja.qtdNotas++
    loja.credito += Number(n.totalTributos) || 0
    for (const it of n.itensAnalisados) {
      const cp = `${it.codProd}‖${it.ncm}`
      const p = loja.produtos.get(cp) ?? { nome: it.descricao || it.codProd, credito: 0, ajustado: false }
      p.credito += Number(it.totalTributos) || 0
      if (it.manual) p.ajustado = true
      loja.produtos.set(cp, p)
    }
  }
  return [...lojas.values()]
    .filter((l) => !l.simples)
    .map((l) => {
      const top = [...l.produtos.values()].sort((a, b) => b.credito - a.credito)[0]
      return {
        nome: l.nome,
        qtdNotas: l.qtdNotas,
        credito: l.credito,
        produto: top?.nome ?? '—',
        creditoProduto: top?.credito ?? 0,
        ajustado: top?.ajustado ?? false,
      }
    })
    .sort((a, b) => b.credito - a.credito)
    .slice(0, 3)
}

/* ------------------------------------- tabela editorial (só NFe) --- */

interface ColunaEditorial {
  titulo: string
  larg: number
  alin?: 'left' | 'right' | 'center'
  mono?: boolean
  forte?: boolean
}

/**
 * Tabela leve, de respiro editorial: cabeçalho em versalete cinza sem
 * preenchimento, só filetes horizontais, sem zebra, células com folga.
 * Usada só no relatório de XML para não passar sensação de densidade.
 */
function tabelaEditorial(opts: { cols: ColunaEditorial[]; rows: Cell[][] }) {
  const peso = opts.cols.reduce((s, c) => s + c.larg, 0)
  const widths = opts.cols.map((c) => `${((c.larg / peso) * 100).toFixed(3)}%`)

  const cabecalho = opts.cols.map((c) => ({
    text: c.titulo.toUpperCase(),
    color: '#8a94a6',
    bold: true,
    fontSize: 6.5,
    alignment: (c.alin ?? 'left') as 'left' | 'right' | 'center',
    margin: [5, 0, 5, 6] as [number, number, number, number],
  }))

  const corpo = opts.rows.map((linha) =>
    linha.map((v, j) => {
      const col = opts.cols[j]
      const s = v === null || v === undefined || v === '' ? '—' : String(v)
      return {
        text: s,
        fontSize: 8,
        bold: col.forte ?? false,
        color: '#1e293b',
        ...(col.mono ? { font: 'Courier' as const } : {}),
        alignment: (col.alin ?? 'left') as 'left' | 'right' | 'center',
        margin: [5, 4, 5, 4] as [number, number, number, number],
        border: [false, false, false, false] as [boolean, boolean, boolean, boolean],
      }
    }),
  )

  return {
    table: { headerRows: 1, widths, body: [cabecalho, ...corpo] as never[][], dontBreakRows: true },
    layout: {
      hLineColor: () => '#e6eaee',
      vLineWidth: () => 0,
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3,
      paddingLeft: () => 0,
      paddingRight: () => 0,
    },
    margin: [0, 2, 0, 10] as [number, number, number, number],
  }
}

/**
 * Relatório das notas em **retrato A4, linguagem simples**: só o essencial,
 * sem termo técnico, uma ideia por quadro.
 *
 * ## v5 — simples de verdade
 * - Sem duplicidade (chave única) e sem repetir a mesma informação;
 * - "A Aurum AI encontrou…" no lugar de qualquer nome técnico;
 * - Itens que você ajustou ganham só uma etiqueta ("você ajustou"), sem aviso;
 * - Só o essencial: o que mais comprou/vendeu, quem mais gerou crédito (e com
 *   qual produto, e se bate com a lei atual) + conta final do imposto.
 */
export async function exportarNfePDF(params: RelatorioNfeParams): Promise<void> {
  // Dedup defensivo: a importação já barra repetidas no banco, mas o filtro
  // pode reunir a mesma chave duas vezes — o relatório nunca soma em dobro.
  const vistas = new Set<string>()
  const notas: NotaXml[] = []
  let dupFiltro = 0
  for (const n of params.notas ?? []) {
    const chave = String(n?.chave ?? '').trim()
    if (chave && vistas.has(chave)) {
      dupFiltro++
      continue
    }
    if (chave) vistas.add(chave)
    notas.push(n)
  }
  const { emitente, empresaNome, periodo } = params
  const duplicadasIgnoradas = (params.duplicadasIgnoradas ?? 0) + dupFiltro
  const verificacao: VerificacaoRagNfe | null = params.verificacao ?? null
  const insights: InsightNfe[] = (params.insights ?? []).slice(0, 3)
  /** O que entra no relatório (v6) — ausente = relatório cheio. */
  const op = { ...OPCOES_RELATORIO_CHEIO, ...(params.opcoes ?? {}) }
  const cor = rgbHex(emitente.cor || '#0f215c')
  const data = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const ap = apurarIbsCbs(notas)

  const vereditoTexto =
    op.resumo === 'credito'
      ? ap.creditoTotal > 0
        ? `Você tem ${fmtMoeda(ap.creditoTotal)} de crédito para usar`
        : 'Nenhum crédito no período'
      : op.resumo === 'debito'
        ? ap.debitoTotal > 0
          ? `Suas vendas deram ${fmtMoeda(ap.debitoTotal)} de imposto`
          : 'Nenhuma venda no período'
        : ap.resultado === 'a-pagar'
          ? `Você vai pagar ${fmtMoeda(ap.valorAPagar)}`
          : ap.resultado === 'saldo-credor'
            ? `Sobrou ${fmtMoeda(ap.saldoCredor)} para você usar depois`
            : ap.resultado === 'zerado'
              ? 'Empatou — nada a pagar nem a receber'
              : 'Sem movimento no período'
  const vereditoCor = ap.resultado === 'a-pagar' ? '#dc2626' : ap.resultado === 'saldo-credor' ? '#047857' : '#475569'
  const vereditoFundo = ap.resultado === 'a-pagar' ? '#fef2f2' : ap.resultado === 'saldo-credor' ? '#ecfdf5' : '#f8fafc'

  // Paleta fixa — slate + esmeralda.
  const TINTA = '#0f172a'
  const SUAVE = '#64748b'
  const LINHA = '#e2e8f0'
  const ESMERALDA = '#047857'

  // -- só o essencial (o modal escolhe o que entra) --------------------------------
  const creditoLojas = disponibilidadeCredito(notas)
  const totalSemCredito = creditoLojas
    .filter((l) => l.disponibilidade === 'sem-credito')
    .reduce((s, l) => s + l.total, 0)
  const qtdSemCredito = creditoLojas
    .filter((l) => l.disponibilidade === 'sem-credito')
    .reduce((s, l) => s + l.qtdNotas, 0)

  const listaCompras = produtosPorFluxo(notas, 'entrada')
  const listaVendas = produtosPorFluxo(notas, 'saida')
  const maisComprados = listaCompras.slice(0, 5)
  const maisVendidos = listaVendas.slice(0, 5)
  const qtdProdutosDistintos = new Set(
    [...listaCompras, ...listaVendas].map((p) => `${p.codigo}‖${p.ncm}`),
  ).size

  const lojasDestaque = destaquesPorFornecedor(notas)

  /** O recorte de notas vale para as seções de movimento (só o escolhido). */
  const mostraCompras = op.direcao !== 'saida'
  const mostraVendas = op.direcao !== 'entrada'
  /** Lojas e Simples só existem em compras — somem no recorte só-vendas. */
  const mostraLojas = op.lojas && mostraCompras
  const mostraSimples = op.simples && mostraCompras

  /** Etiqueta discreta: o que você ajustou só se diferencia, sem aviso. */
  const etiqueta = (ajustado: boolean): string => (ajustado ? 'você ajustou' : 'bate com a lei')

  /** Situação do produto em palavras simples, com a particularidade (desconto). */
  const detalheSituacao = (p: { ajustado: boolean; redIBS: number; redCBS: number }): string => {
    if (p.ajustado) return 'você ajustou'
    const a = Number(p.redIBS) || 0
    const b = Number(p.redCBS) || 0
    if (a > 0 && a === b) return `bate com a lei · desconto de ${a}%`
    if (a > 0 || b > 0) return `bate com a lei · desconto IBS ${a}% · CBS ${b}%`
    return 'bate com a lei'
  }

  /** Frase simples da conferência na lei atual (nunca mostra termo técnico). */
  const fraseAurumAI = (): string => {
    if (!verificacao) return 'A Aurum AI ainda não conferiu estas notas na lei de hoje.'
    const erros = verificacao.alertas.filter((a) => a.tipo === 'erro').length
    let frase = `A Aurum AI olhou ${notas.length === 1 ? 'sua 1 nota' : `suas ${notas.length} notas`} e ${qtdProdutosDistintos === 1 ? '1 produto' : `${qtdProdutosDistintos} produtos`} na lei de hoje.`
    if (verificacao.itensManuais > 0) {
      frase += verificacao.itensManuais === 1
        ? ' 1 item foi ajustado por você e aparece marcado como "você ajustou".'
        : ` ${verificacao.itensManuais} itens foram ajustados por você e aparecem marcados como "você ajustou".`
    }
    if (erros > 0) {
      frase += erros === 1
        ? ' Encontrou 1 ponto que merece sua atenção antes de usar.'
        : ` Encontrou ${erros} pontos que merecem sua atenção antes de usar.`
    } else if (verificacao.itensManuais === 0) {
      frase += ' Está tudo batendo com a lei atual.'
    }
    return frase
  }

  /** Cartão de KPI do sumário executivo — fundo branco, filete superior. */
  const cartaoKpi = (rotulo: string, valor: string, detalhe: string) => ({
    stack: [
      { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 2, lineColor: ESMERALDA }], margin: [0, 0, 0, 8] as [number, number, number, number] },
      { text: rotulo.toUpperCase(), fontSize: 7, bold: true, color: '#8a94a6', margin: [0, 0, 0, 4] as [number, number, number, number] },
      { text: valor, fontSize: 15, bold: true, color: '#0f172a' },
      { text: detalhe, fontSize: 7.5, color: '#64748b', margin: [0, 4, 0, 0] as [number, number, number, number] },
    ],
    margin: [10, 6, 10, 6] as [number, number, number, number],
  })

  const titulo = (texto: string, sub?: string): NonNullable<Content>[] => [
    {
      stack: [
        { text: texto, fontSize: 13, bold: true, color: TINTA, margin: [0, 0, 0, 2] as [number, number, number, number] },
        ...(sub ? [{ text: sub, fontSize: 8, color: SUAVE, margin: [0, 0, 0, 0] as [number, number, number, number] }] : []),
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: LINHA }], margin: [0, 8, 0, 0] as [number, number, number, number] },
      ],
      margin: [0, 14, 0, 8] as [number, number, number, number],
    },
  ]

  // -- tabelas simples (poucas colunas, palavras do dia a dia) ----------------------
  interface LinhaProduto {
    nome: string
    ncm: string
    base: number
    trib: number
    ajustado: boolean
    redIBS: number
    redCBS: number
  }
  const colsProduto: ColunaEditorial[] = [
    { titulo: 'Produto', larg: 34 },
    { titulo: 'NCM', larg: 15, mono: true, alin: 'center' },
    { titulo: 'Valor', larg: 14, alin: 'right' },
    { titulo: 'Imposto', larg: 15, alin: 'right', forte: true },
    { titulo: 'Situação', larg: 22 },
  ]
  const colsProdutoUni: ColunaEditorial[] = [
    { titulo: 'Produto', larg: 28 },
    { titulo: 'NCM', larg: 14, mono: true, alin: 'center' },
    { titulo: 'Movimento', larg: 11, alin: 'center' },
    { titulo: 'Valor', larg: 13, alin: 'right' },
    { titulo: 'Imposto', larg: 13, alin: 'right', forte: true },
    { titulo: 'Situação', larg: 21 },
  ]
  const linhaProduto = (p: LinhaProduto): Cell[] => [
    p.nome.slice(0, 38),
    fmtNcm(p.ncm),
    fmtMoeda(p.base),
    fmtMoeda(p.trib),
    detalheSituacao(p),
  ]
  /** Unificado (sem separar compras e vendas): top 10 com a coluna Movimento. */
  const produtosUnificados = [...listaCompras.map((p) => ({ ...p, mov: 'Compra' })), ...listaVendas.map((p) => ({ ...p, mov: 'Venda' }))]
    .filter((p) => (p.mov === 'Compra' ? mostraCompras : mostraVendas))
    .sort((a, b) => b.base - a.base)
    .slice(0, 10)
  const rowsProdutoUni: Cell[][] = produtosUnificados.map((p) => [
    p.nome.slice(0, 32),
    fmtNcm(p.ncm),
    p.mov,
    fmtMoeda(p.base),
    fmtMoeda(p.trib),
    detalheSituacao(p),
  ])

  const colsLojas: ColunaEditorial[] = [
    { titulo: 'Loja', larg: 26 },
    { titulo: 'Produto que mais ajudou', larg: 36 },
    { titulo: 'Crédito p/ você', larg: 20, alin: 'right', forte: true },
    { titulo: 'Como está', larg: 18, alin: 'center' },
  ]
  const rowsLojas: Cell[][] = lojasDestaque.map((d) => [
    d.nome.slice(0, 32),
    `${d.produto.slice(0, 30)} (${fmtMoeda(d.creditoProduto)})`,
    fmtMoeda(d.credito),
    etiqueta(d.ajustado),
  ])

  const resultadoValor =
    ap.resultado === 'a-pagar'
      ? fmtMoeda(ap.valorAPagar)
      : ap.resultado === 'saldo-credor'
        ? fmtMoeda(ap.saldoCredor)
        : '—'
  const colsResumo: ColunaEditorial[] = [
    { titulo: '', larg: 55 },
    { titulo: 'Valor', larg: 45, alin: 'right', forte: true },
  ]
  /** A conta final obedece ao modal: completa, só crédito ou só débito. */
  const rowsResumo: Cell[][] =
    op.resumo === 'credito'
      ? [[`Crédito das compras · ${ap.qtdEntradasApropriaveis} compra(s)`, fmtMoeda(ap.creditoTotal)]]
      : op.resumo === 'debito'
        ? [[`Imposto das vendas · ${ap.qtdSaidas} venda(s)`, fmtMoeda(ap.debitoTotal)]]
        : [
            [`Imposto das vendas · ${ap.qtdSaidas} venda(s)`, fmtMoeda(ap.debitoTotal)],
            [`Menos: crédito das compras · ${ap.qtdEntradasApropriaveis} compra(s)`, `− ${fmtMoeda(ap.creditoTotal)}`],
            ['Resultado para você', resultadoValor],
          ]
  const tituloResumo = op.resumo === 'credito'
    ? 'Crédito apurado'
    : op.resumo === 'debito'
      ? 'Débito apurado'
      : 'Resumo do imposto'
  const subResumo = op.resumo === 'completo'
    ? 'A conta é simples: imposto das vendas menos o crédito das compras.'
    : undefined

  const infoTimbre = linhasEmitente(emitente).map((l) => l[0]).filter(Boolean)
  const doc: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [42, 48, 42, 50],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#1e293b', lineHeight: 1.35 },
    background: fundoMarcaDagua(300, 0.07),
    info: {
      title: `Seu imposto novo — Notas fiscais · ${empresaNome} · ${periodo}`,
      author: emitente.razaoSocial || 'Aurum Tax NCM',
      creator: 'Aurum Tax NCM',
    },
    // Timbre só na primeira folha (bloco de capa no conteúdo); nas demais,
    // um cabeçalho de condução discreto com título + empresa/período.
    header: ((pagina: number) => {
      if (pagina === 1) return null
      return {
        margin: [42, 16, 42, 0] as [number, number, number, number],
        stack: [
          {
            columns: [
              { text: 'Aurum Tax NCM · Seu imposto das notas', fontSize: 7, color: '#8a94a6' },
              { text: `${empresaNome} · ${periodo}`, fontSize: 7, color: '#8a94a6', alignment: 'right' as const },
            ],
          },
          {
            canvas: [
              { type: 'line' as const, x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: LINHA },
              { type: 'rect' as const, x: 0, y: 1.4, w: 30, h: 1.6, color: OURO_AURUM },
            ],
            margin: [0, 6, 0, 0] as [number, number, number, number],
          },
        ],
      }
    }) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content: [
      // -- timbre da primeira folha (filete duplo ouro + cor, sem barra chapada) ---
      {
        canvas: [
          { type: 'rect' as const, x: 0, y: 0, w: 499, h: 2.2, color: OURO_AURUM },
          { type: 'rect' as const, x: 0, y: 3.4, w: 499, h: 7, color: cor },
        ],
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },
      {
        columnGap: 14,
        columns: [
          { width: 'auto', stack: [logoDoEmitente(emitente, cor) as never] },
          {
            width: '*',
            stack: [
              { text: emitente.razaoSocial || empresaNome, fontSize: 12, bold: true, color: TINTA },
              ...(emitente.cnpj ? [{ text: `CNPJ ${emitente.cnpj}`, fontSize: 7.5, color: SUAVE, margin: [0, 3, 0, 0] as [number, number, number, number] }] : []),
              ...infoTimbre.slice(1, 2).map((linha) => ({ text: linha, fontSize: 7.5, color: SUAVE, margin: [0, 1, 0, 0] as [number, number, number, number] })),
            ],
          },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: `Período ${periodo}`, fontSize: 7.5, color: SUAVE, margin: [0, 12, 0, 0] as [number, number, number, number] },
              { text: `Gerado em ${data}`, fontSize: 7.5, color: SUAVE },
            ],
          },
        ],
        margin: [0, 0, 0, 4] as [number, number, number, number],
      },
      {
        canvas: [
          { type: 'line' as const, x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: LINHA },
          { type: 'line' as const, x1: 0, y1: 1.8, x2: 499, y2: 1.8, lineWidth: 0.5, lineColor: OURO_AURUM },
        ],
        margin: [0, 8, 0, 18] as [number, number, number, number],
      },
      // -- capa (adapta-se ao que foi escolhido no modal) ---------------------------
      { text: 'Imposto novo (IBS + CBS) · somados para facilitar', fontSize: 8, bold: true, color: ESMERALDA, margin: [0, 0, 0, 6] as [number, number, number, number] },
      { text: 'Seu imposto das notas', fontSize: 28, bold: true, color: TINTA, margin: [0, 0, 0, 4] as [number, number, number, number] },
      {
        text: op.resumo === 'credito'
          ? 'O crédito das suas compras'
          : op.resumo === 'debito'
            ? 'O imposto das suas vendas'
            : 'O que você comprou, vendeu e pode abater',
        fontSize: 10.5, color: '#475569', margin: [0, 0, 0, 4] as [number, number, number, number],
      },
      {
        text: `${empresaNome} · ${notas.length === 1 ? '1 nota' : `${notas.length} notas`} no período${duplicadasIgnoradas > 0 ? ` · ${duplicadasIgnoradas} repetida(s) contada(s) uma vez só` : ''}`,
        fontSize: 8, color: SUAVE, margin: [0, 0, 0, 14] as [number, number, number, number],
      },
      {
        table: {
          widths: op.resumo === 'completo' ? ['*', '*'] : ['*'],
          body: [
            op.resumo === 'debito'
              ? [cartaoKpi('Imposto das suas vendas', fmtMoeda(ap.debitoTotal), `${ap.qtdSaidas} venda(s) no período`)]
              : op.resumo === 'credito'
                ? [cartaoKpi('Crédito que você pode usar', fmtMoeda(ap.creditoTotal), `${ap.qtdEntradasApropriaveis} compra(s) de loja comum`)]
                : [
                    cartaoKpi('Crédito que você pode usar', fmtMoeda(ap.creditoTotal), `${ap.qtdEntradasApropriaveis} compra(s) de loja comum`),
                    cartaoKpi('Imposto das suas vendas', fmtMoeda(ap.debitoTotal), `${ap.qtdSaidas} venda(s) no período`),
                  ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 0, 0, 10] as [number, number, number, number],
      },
      // -- veredito em destaque -------------------------------------------------
      {
        table: {
          widths: [3, '*'],
          body: [
            [
              { text: '', fillColor: vereditoCor, margin: [0, 0, 0, 0] as [number, number, number, number] },
              {
                stack: [
                  { text: vereditoTexto, fontSize: 11, bold: true, color: vereditoCor },
                  {
                    text: ap.qtdQuarentena > 0 ? `${ap.qtdQuarentena} nota(s) ficaram de fora da conta por falta de informação.` : 'Todas as notas entraram na conta.',
                    fontSize: 7.5, color: '#475569', margin: [0, 3, 0, 0] as [number, number, number, number],
                  },
                ],
                fillColor: vereditoFundo,
                margin: [14, 12, 14, 12] as [number, number, number, number],
              },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 4, 0, 6] as [number, number, number, number],
      },
      // -- o que a Aurum AI encontrou (conferência na lei atual, sem tecnicês) ----
      {
        table: {
          widths: [3, '*'],
          body: [
            [
              { text: '', fillColor: '#047857', margin: [0, 0, 0, 0] as [number, number, number, number] },
              {
                stack: [
                  { text: 'O que a Aurum AI encontrou', fontSize: 9, bold: true, color: '#047857' },
                  { text: fraseAurumAI(), fontSize: 8, color: '#334155', margin: [0, 3, 0, 0] as [number, number, number, number] },
                ],
                fillColor: '#ecfdf5',
                margin: [14, 10, 14, 10] as [number, number, number, number],
              },
            ],
          ],
        },
        layout: 'noBorders' as const,
        margin: [0, 2, 0, 6] as [number, number, number, number],
      },
      // -- produtos (só se marcado no modal; separado ou junto) ------------------------
      ...(op.produtos && op.itensFluxo && mostraCompras && maisComprados.length
        ? [
            ...titulo('O que você mais comprou', 'Os 5 maiores valores que entraram, com o imposto de cada um.'),
            tabelaEditorial({ cols: colsProduto, rows: maisComprados.map(linhaProduto) }),
          ]
        : []),
      ...(op.produtos && op.itensFluxo && mostraVendas && maisVendidos.length
        ? [
            ...titulo('O que você mais vendeu', 'Os 5 maiores valores que saíram, com o imposto de cada um.'),
            tabelaEditorial({ cols: colsProduto, rows: maisVendidos.map(linhaProduto) }),
          ]
        : []),
      // -- relação completa de vendidos (além do top 5, com NCM e regras) ---------
      // Só quando há mais do que o top 5 já mostrou (ou no modo junto, onde o
      // top 10 mistura compras e vendas) — nunca repete a mesma lista.
      ...(op.produtos && mostraVendas && listaVendas.length > (op.itensFluxo ? 5 : 0)
        ? [
            ...titulo(
              `Todos os produtos vendidos (${listaVendas.length})`,
              'Relação completa, com o NCM e o imposto de cada um.',
            ),
            tabelaEditorial({ cols: colsProduto, rows: listaVendas.map(linhaProduto) }),
          ]
        : []),
      ...(op.produtos && !op.itensFluxo && produtosUnificados.length
        ? [
            ...titulo('Produtos', 'Os 10 maiores valores, com o imposto de cada um.'),
            tabelaEditorial({ cols: colsProdutoUni, rows: rowsProdutoUni }),
          ]
        : []),
      ...(op.produtos && !produtosUnificados.length && !(mostraCompras && maisComprados.length) && !(mostraVendas && maisVendidos.length)
        ? [{ text: 'Sem produtos neste período.', fontSize: 8.5, color: SUAVE, margin: [0, 2, 0, 10] as [number, number, number, number] }]
        : []),
      // -- quem mais gerou crédito para você (só se marcado; some em só-vendas) ----
      ...(mostraLojas
        ? lojasDestaque.length
          ? [
              ...titulo('Quem mais gerou crédito para você', 'A loja, o produto que mais ajudou e se o imposto dele bate com a lei atual.'),
              tabelaEditorial({ cols: colsLojas, rows: rowsLojas }),
            ]
          : [
              ...titulo('Quem mais gerou crédito para você', undefined),
              {
                text: 'Sem compras de loja comum neste período — nenhum crédito a mostrar.',
                fontSize: 8.5, color: SUAVE, margin: [0, 2, 0, 10] as [number, number, number, number],
              },
            ]
        : []),
      // -- lojas do Simples e o crédito (com a verificação por loja) ------------------
      ...(mostraSimples
        ? [
            ...titulo('Lojas do Simples e o crédito', 'O sistema verificou loja por loja se há crédito disponível.'),
            ...(creditoLojas.length
              ? [
                  {
                    text: totalSemCredito > 0.005
                      ? `Compras de lojas do Simples (${fmtMoeda(totalSemCredito)} em ${qtdSemCredito} nota(s)) não transferem crédito — ficam de fora da sua conta.`
                      : 'Nenhuma compra de loja do Simples neste período — tudo pode gerar crédito.',
                    fontSize: 8, color: SUAVE, margin: [0, 0, 0, 4] as [number, number, number, number],
                  },
                  tabelaEditorial({
                    cols: [
                      { titulo: 'Loja', larg: 40 },
                      { titulo: 'Compras', larg: 12, alin: 'right' },
                      { titulo: 'Valor', larg: 20, alin: 'right' },
                      { titulo: 'Crédito', larg: 28, alin: 'center', forte: true },
                    ],
                    rows: creditoLojas.map((l) => [
                      l.nome.slice(0, 40),
                      l.qtdNotas,
                      fmtMoeda(l.total),
                      l.disponibilidade === 'sem-credito' ? 'Sem crédito disponível' : 'A confirmar',
                    ]),
                  }),
                ]
              : [{
                  text: 'Nenhuma compra de loja do Simples neste período — tudo pode gerar crédito.',
                  fontSize: 8.5, color: SUAVE, margin: [0, 2, 0, 10] as [number, number, number, number],
                }]),
          ]
        : []),
      // -- conta final do imposto (obedece ao modal) -------------------------------------
      ...titulo(tituloResumo, subResumo),
      tabelaEditorial({ cols: colsResumo, rows: rowsResumo }),
      // -- vale saber (recados curtos da Aurum AI, só com seus números) ---------------
      ...(insights.length
        ? [
            ...titulo('Vale saber', 'A Aurum AI separou o que mais importa nos seus dados:'),
            ...insights.flatMap((ins) => {
              const corTom = ins.tom === 'alerta' ? '#d97706' : ins.tom === 'oportunidade' ? '#2563eb' : '#047857'
              const fundo = ins.tom === 'alerta' ? '#fffbeb' : ins.tom === 'oportunidade' ? '#eff6ff' : '#ecfdf5'
              const icone = ins.tom === 'alerta' ? '⚠' : ins.tom === 'oportunidade' ? '◉' : '✓'
              return [
                {
                  table: {
                    widths: [3, '*'],
                    body: [
                      [
                        { text: '', fillColor: corTom, margin: [0, 0, 0, 0] as [number, number, number, number] },
                        {
                          stack: [
                            { text: `${icone}  ${ins.titulo}`, fontSize: 8.5, bold: true, color: corTom },
                            { text: ins.texto, fontSize: 7.8, color: '#334155', margin: [0, 2, 0, 0] as [number, number, number, number] },
                          ],
                          fillColor: fundo,
                          margin: [12, 8, 12, 8] as [number, number, number, number],
                        },
                      ],
                    ],
                  },
                  layout: 'noBorders' as const,
                  margin: [0, 0, 0, 5] as [number, number, number, number],
                },
              ]
            }),
          ]
        : []),
      {
        text: 'Valores estimados pela lei de hoje. O que vale de verdade é a sua nota fiscal.',
        fontSize: 7, italics: true, color: '#94a3b8', margin: [0, 10, 0, 0] as [number, number, number, number],
      },
    ],
  }

  await gerarPdf(doc, `NFe_Apuracao_${empresaNome.replace(/\W+/g, '_') || 'empresa'}_${hojeISO()}.pdf`)
}
