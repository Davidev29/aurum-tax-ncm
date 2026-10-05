/**
 * Aurum AI — PDF customizado a partir dos DADOS (não da conversa).
 *
 * A IA propõe a estrutura no chat e, ao escolher o formato, este módulo
 * programa o layout seguindo o padrão do sistema (timbrado + rodapé +
 * `tabelaRelatorio` + marca-d'água — mesmo motor pdfMake dos demais PDFs):
 * - capa com escopo (cliente, período, filtros) + 3 KPIs + veredito;
 * - blocos escolhidos pela IA conforme a pergunta: fornecedores por crédito,
 *   produtos por débito/crédito, reduções encontradas, diferidos, NCM com
 *   CST/cClassTrib/anexo, apuração resumida;
 * - só blocos com dado entram (sem seção vazia); números vêm do motor.
 *
 * `montarDocumentoDadosPDF` é puro (testável); `exportarRelatorioDadosPDF`
 * baixa via lazy do motor pesado.
 */

import { fmtMoeda, fmtNcm, hexToRgb } from '@/domain/services/format'
import type { Emitente } from '@/domain/entities'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { timbrado, rodape, tabelaRelatorio } from '@/infrastructure/exporters/relatorios'
import { fundoMarcaDagua } from '@/infrastructure/pdf/marca-dagua'
import type {
  FiltroDados,
  LinhaDiferido,
  LinhaFornecedor,
  LinhaNcm,
  LinhaProduto,
  LinhaReducao,
  ResumoApuracao,
} from './aurum-ai-dados'
import { rotuloFiltros } from './aurum-ai-dados'
import { limparMarkdownChat } from './aurum-ai-chat-pdf'

export type BlocoDadosPDF =
  | 'fornecedores'
  | 'produtos'
  | 'reducoes'
  | 'diferidos'
  | 'ncm'
  | 'apuracao'

export interface DadosRelatorioIA {
  titulo: string
  escopo: string
  empresaNome: string
  qtdNotas: number
  filtro: FiltroDados
  resumo: ResumoApuracao
  fornecedores: LinhaFornecedor[]
  produtos: LinhaProduto[]
  reducoes: LinhaReducao[]
  diferidosEfetivos: LinhaDiferido[]
  diferidosCondicionais: LinhaDiferido[]
  ncms: LinhaNcm[]
  blocos: BlocoDadosPDF[]
  geradoEm: string
}

function corTimbre(emitente: Emitente): string {
  try {
    const [r, g, b] = hexToRgb(emitente.cor || '#0f215c')
    const p = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
    return `#${p(r)}${p(g)}${p(b)}`
  } catch {
    return '#0f215c'
  }
}

const fmtPct = (v: number): string => `${(Number(v) || 0).toFixed(2).replace('.', ',')}%`
const fmtInt = (v: number): string => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })

/**
 * A IA escolhe os blocos pela pergunta — esta função documenta a escolha
 * (usada no chat para "propor a estrutura" antes de gerar).
 */
export function blocosParaPergunta(pergunta: string, filtro: FiltroDados): BlocoDadosPDF[] {
  const n = String(pergunta ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  const blocos: BlocoDadosPDF[] = []
  if (/fornecedor|credito|quem.*(da|gera)|comprou de/.test(n)) blocos.push('fornecedores')
  if (/produto|debito|vendi|vendeu|vendidos?|comprei|comprou|comprados?|mais|top|ranking|lista/.test(n)) blocos.push('produtos')
  if (/reducao|reducao|isento|anexo|beneficio/.test(n)) blocos.push('reducoes')
  if (/diferid|diferimento/.test(n)) blocos.push('diferidos')
  if (/ncm|cst|cclasstrib|tributacao por/.test(n) || filtro.ncm || filtro.cstReforma || filtro.cClassTrib) blocos.push('ncm')
  // Apuração sempre fecha (veredito), salvo pergunta ultra-específica de 1 bloco.
  if (!blocos.length || /apurac|saldo|pagar|resumo|relatorio|geral|tudo/.test(n)) {
    if (!blocos.includes('fornecedores')) blocos.push('fornecedores')
    if (!blocos.includes('produtos')) blocos.push('produtos')
    if (!blocos.includes('ncm')) blocos.push('ncm')
  }
  if (!blocos.includes('apuracao')) blocos.push('apuracao')
  return blocos
}

/** Estrutura proposta em texto (a IA mostra no chat antes de gerar). */
export function descreverEstrutura(blocos: BlocoDadosPDF[]): string[] {
  const mapa: Record<BlocoDadosPDF, string> = {
    fornecedores: 'Fornecedores que mais deram crédito (entradas, com badge Simples/sem-crédito)',
    produtos: 'Produtos que mais geraram crédito (compras) e débito (vendas)',
    reducoes: 'Reduções encontradas nas notas (IBS/CBS por faixa)',
    diferidos: 'Produtos com diferimento (efetivo 510/515 + condicional Anexo IX)',
    ncm: 'Tributação por NCM (CST, cClassTrib, anexo, reduções, base e tributos)',
    apuracao: 'Apuração resumida (débitos − créditos = saldo)',
  }
  return blocos.map((b) => mapa[b])
}

export function montarDocumentoDadosPDF(d: DadosRelatorioIA, emitente: Emitente): TDocumentDefinitions {
  const cor = corTimbre(emitente)
  const data = d.geradoEm || new Date().toLocaleString('pt-BR')
  const veredito =
    d.resumo.resultado === 'a pagar'
      ? `Imposto a pagar ${fmtMoeda(d.resumo.saldo)}`
      : d.resumo.resultado === 'saldo credor'
        ? `Saldo credor ${fmtMoeda(Math.abs(d.resumo.saldo))}`
        : 'Sem saldo a pagar'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [
    { text: limparMarkdownChat(d.titulo) || 'Aurum AI — relatório de dados', fontSize: 14, bold: true, color: cor, margin: [0, 2, 0, 1] as [number, number, number, number] },
    { text: `${d.empresaNome} · ${d.qtdNotas} nota(s) · ${d.escopo}`, fontSize: 7.6, color: '#64748b', margin: [0, 0, 0, 2] as [number, number, number, number] },
    { text: `Gerado em ${data} · pela Aurum AI a partir dos XMLs importados`, fontSize: 7.6, color: '#7a8896', margin: [0, 0, 0, 8] as [number, number, number, number] },
    tabelaRelatorio({
      corCabecalho: cor,
      cols: [
        { titulo: 'Crédito (entradas)', larg: 33, alin: 'right' },
        { titulo: 'Débito (saídas)', larg: 33, alin: 'right' },
        { titulo: 'Saldo', larg: 34, alin: 'right', forte: true },
      ],
      rows: [[fmtMoeda(d.resumo.credito), fmtMoeda(d.resumo.debito), `${fmtMoeda(d.resumo.saldo)} · ${veredito}`]],
    }),
  ]

  if (d.blocos.includes('fornecedores') && d.fornecedores.length) {
    content.push({ text: 'Fornecedores que mais deram crédito', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'Fornecedor', larg: 46 },
          { titulo: 'Notas', larg: 10, alin: 'right' },
          { titulo: 'Base', larg: 22, alin: 'right' },
          { titulo: 'Crédito', larg: 22, alin: 'right', forte: true },
        ],
        rows: d.fornecedores.slice(0, 8).map((f) => [
          `${f.nome.slice(0, 44)}${f.simples ? ' [Simples · sem crédito]' : ''}`,
          String(f.qtdNotas),
          fmtMoeda(f.base),
          f.simples ? '—' : fmtMoeda(f.creditoTotal),
        ]),
      }),
    )
  }

  if (d.blocos.includes('produtos') && d.produtos.length) {
    content.push({ text: 'Produtos — crédito × débito', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'Produto', larg: 40 },
          { titulo: 'Mov.', larg: 12, alin: 'center' },
          { titulo: 'Base', larg: 20, alin: 'right' },
          { titulo: 'IBS+CBS', larg: 20, alin: 'right', forte: true },
          { titulo: 'Carga', larg: 8, alin: 'right' },
        ],
        rows: d.produtos.slice(0, 10).map((p) => [
          `${p.nome.slice(0, 38)}${p.ncm ? ` · ${p.ncm}` : ''}`,
          p.direcao === 'entrada' ? 'Compra' : 'Venda',
          fmtMoeda(p.base),
          fmtMoeda(p.trib),
          fmtPct(p.carga),
        ]),
      }),
    )
  }

  if (d.blocos.includes('reducoes') && d.reducoes.length) {
    content.push({ text: 'Reduções encontradas nas notas', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'Redução', larg: 40 },
          { titulo: 'Itens', larg: 12, alin: 'right' },
          { titulo: 'Base', larg: 24, alin: 'right' },
          { titulo: 'Tributos', larg: 24, alin: 'right', forte: true },
        ],
        rows: d.reducoes.slice(0, 8).map((r) => [r.rotulo.slice(0, 48), fmtInt(r.itens), fmtMoeda(r.base), fmtMoeda(r.trib)]),
      }),
    )
  }

  if (d.blocos.includes('diferidos') && (d.diferidosEfetivos.length || d.diferidosCondicionais.length)) {
    content.push({ text: 'Produtos com diferimento', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    const linhas: string[][] = [
      ...d.diferidosEfetivos.slice(0, 6).map((x) => [
        `${x.nome.slice(0, 36)}${x.ncm ? ` · ${fmtNcm(x.ncm)}` : ''}`,
        `CST ${x.cst} · ${x.cct} (efetivo)`,
        fmtMoeda(x.base),
      ]),
      ...d.diferidosCondicionais.slice(0, 4).map((x) => [
        `${x.nome.slice(0, 36)}${x.ncm ? ` · ${fmtNcm(x.ncm)}` : ''}`,
        `CST ${x.cst} · ${x.cct} (Anexo IX condicional)`,
        fmtMoeda(x.base),
      ]),
    ]
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'Produto', larg: 44 },
          { titulo: 'Enquadramento', larg: 32 },
          { titulo: 'Base', larg: 24, alin: 'right', forte: true },
        ],
        rows: linhas,
      }),
    )
  }

  if (d.blocos.includes('ncm') && d.ncms.length) {
    content.push({ text: 'Tributação por NCM', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'NCM', larg: 16, mono: true, alin: 'center', forte: true },
          { titulo: 'CST/cClass', larg: 20, alin: 'center', mono: true },
          { titulo: 'Red.', larg: 14, alin: 'center' },
          { titulo: 'Base', larg: 25, alin: 'right' },
          { titulo: 'Tributos', larg: 25, alin: 'right', forte: true },
        ],
        rows: d.ncms.slice(0, 10).map((x) => [
          fmtNcm(x.ncm),
          `${x.cst}/${x.cct}`,
          `${x.redIBS}%/${x.redCBS}%`,
          fmtMoeda(x.base),
          fmtMoeda(x.trib),
        ]),
      }),
    )
  }

  if (d.blocos.includes('apuracao')) {
    content.push({ text: 'Apuração resumida (estimativa LC 214/2025)', fontSize: 10, bold: true, color: cor, margin: [0, 10, 0, 4] as [number, number, number, number] })
    content.push(
      tabelaRelatorio({
        corCabecalho: cor,
        cols: [
          { titulo: 'Conta', larg: 60 },
          { titulo: 'Valor', larg: 40, alin: 'right', forte: true },
        ],
        rows: [
          [`Débitos — saídas (${d.resumo.saidas} notas)`, fmtMoeda(d.resumo.debito)],
          [`(−) Créditos — entradas (${d.resumo.entradas} notas)`, fmtMoeda(d.resumo.credito)],
          [`(=) Saldo — ${veredito}`, fmtMoeda(d.resumo.saldo)],
        ],
      }),
    )
  }

  content.push({
    text: `Filtros: ${rotuloFiltros(d.filtro)} · Base: ${d.qtdNotas} nota(s) · Fontes: XMLs importados (NF-e/NFC-e) · Vínculos oficiais CST × cClassTrib (LC 214/2025). Valores estimados — confirme com o contador antes de escriturar.`,
    fontSize: 7, color: '#7a8896', margin: [0, 8, 0, 0] as [number, number, number, number],
  })

  return {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 8, color: '#1e293b' },
    background: fundoMarcaDagua(300, 0.07),
    info: { title: limparMarkdownChat(d.titulo), author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: (() => timbrado(emitente, cor, limparMarkdownChat(d.titulo).slice(0, 60), `Aurum AI · dados reais · Gerado em ${data}`)) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content,
  }
}

export async function exportarRelatorioDadosPDF(d: DadosRelatorioIA, emitente: Emitente): Promise<void> {
  const doc = montarDocumentoDadosPDF(d, emitente)
  const { baixarPdf } = await import('@/infrastructure/pdf/setup')
  const dia = new Date().toISOString().slice(0, 10)
  const sufixo = (d.empresaNome || 'dados').replace(/\W+/g, '_').slice(0, 24) || 'dados'
  await baixarPdf(doc, `AurumAI_dados_${sufixo}_${dia}.pdf`)
}

/** CSV simples do relatório de dados (mesmo conteúdo, formato planilha). */
export function montarCSVDados(d: DadosRelatorioIA): { nome: string; conteudo: string; mime: string } {
  const { montarCSV } = { montarCSV: (linhas: string[][]): string => '\uFEFF' + linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n') }
  const linhas: string[][] = [
    [d.titulo, d.empresaNome, d.escopo],
    [],
    ['Bloco', 'Linha', 'Valor'],
    ...d.fornecedores.slice(0, 8).map((f): string[] => ['Fornecedor', `${f.nome}${f.simples ? ' [Simples]' : ''}`, String(f.creditoTotal.toFixed(2))]),
    ...d.produtos.slice(0, 10).map((p): string[] => ['Produto', `${p.nome} (${p.direcao})`, String(p.trib.toFixed(2))]),
    ...d.reducoes.map((r): string[] => ['Redução', r.rotulo, String(r.base.toFixed(2))]),
    ['Apuração', 'Saldo', String(d.resumo.saldo.toFixed(2))],
  ]
  return { nome: `aurum-ai-dados-${new Date().toISOString().slice(0, 10)}.csv`, conteudo: montarCSV(linhas), mime: 'text/csv;charset=utf-8' }
}
