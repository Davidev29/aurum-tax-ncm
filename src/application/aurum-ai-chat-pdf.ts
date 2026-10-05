/**
 * Aurum AI — relatório do chat em PDF (timbrado do emitente).
 *
 * O chat gerava só CSV/JSON/TXT em memória (`montarRelatorio*` em
 * `aurum-ai-chat.ts`). Aqui o PDF sai pelo mesmo motor dos demais módulos
 * (pdfMake + timbrado + `Página X de Y`), com o emitente da sessão
 * (ou o padrão quando ausente).
 *
 * - `montarDocumentoChatPDF` é puro (constrói o doc, sem download) — testável;
 * - `exportarRelatorioChatPDF` serializa e baixa (lazy do motor pesado).
 */
import { hexToRgb, fmtMoeda, fmtNcm } from '@/domain/services/format'
import type { Emitente } from '@/domain/entities'
import type { TDocumentDefinitions } from 'pdfmake/interfaces'
import { timbrado, rodape, tabelaRelatorio } from '@/infrastructure/exporters/relatorios'
import { fundoMarcaDagua } from '@/infrastructure/pdf/marca-dagua'
import type { DadosCalculo, DadosConversa, DadosSimplesChat } from './aurum-ai-chat'

function corTimbre(emitente: Emitente): string {
  const [r, g, b] = hexToRgb(emitente.cor || '#0f215c')
  const p = (n: number) => n.toString(16).padStart(2, '0')
  return `#${p(r)}${p(g)}${p(b)}`
}

/** PDF é texto puro: remove os marcadores do markdown-lite do chat. */
export function limparMarkdownChat(s: string): string {
  return String(s ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const FONTES_CHAT = ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)', 'LC 214/2025']
const AVISO_CHAT = 'Conteúdo informativo — confirme com o contador antes de escriturar.'

/** Documento pdfMake do relatório do chat (puro, sem I/O). */
export function montarDocumentoChatPDF(
  base: 'conversa' | 'calculo' | 'simples',
  dados: DadosConversa | DadosCalculo | DadosSimplesChat,
  emitente: Emitente,
): TDocumentDefinitions {
  const cor = corTimbre(emitente)
  const data = new Date().toLocaleString('pt-BR')

  if (base === 'calculo') {
    const d = dados as DadosCalculo
    return {
      pageSize: 'A4',
      pageMargins: [34, 102, 34, 52],
      defaultStyle: { font: 'Roboto', fontSize: 8, color: '#1e293b' },
      background: fundoMarcaDagua(300, 0.07),
      info: { title: 'Aurum AI — relatório de cálculo', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
      header: (() => timbrado(emitente, cor, 'Aurum AI — cálculo IBS/CBS', `LC 214/2025 · Gerado em ${data}`)) as TDocumentDefinitions['header'],
      footer: rodape(emitente) as TDocumentDefinitions['footer'],
      content: [
        { text: 'Aurum AI — relatório de cálculo', fontSize: 14, bold: true, color: cor, margin: [0, 2, 0, 1] as [number, number, number, number] },
        { text: `Gerado em ${data} · pela Aurum AI`, fontSize: 7.6, color: '#7a8896', margin: [0, 0, 0, 8] as [number, number, number, number] },
        tabelaRelatorio({
          cols: [
            { titulo: 'NCM', larg: 20, mono: true, alin: 'center', forte: true },
            { titulo: 'Base', larg: 20, alin: 'right' },
            { titulo: 'IBS', larg: 20, alin: 'right' },
            { titulo: 'CBS', larg: 20, alin: 'right' },
            { titulo: 'Total tributos', larg: 20, alin: 'right', forte: true },
          ],
          rows: [[fmtNcm(d.codigo), fmtMoeda(d.base), fmtMoeda(d.ibs), fmtMoeda(d.cbs), fmtMoeda(d.total)]],
          corCabecalho: cor,
        }),
        { text: `Fontes: ${FONTES_CHAT.join(' · ')}`, fontSize: 7, color: '#7a8896', margin: [0, 4, 0, 0] as [number, number, number, number] },
        { text: `Aviso: ${AVISO_CHAT}`, fontSize: 7, bold: true, color: '#92400e', margin: [0, 2, 0, 0] as [number, number, number, number] },
      ],
    }
  }

  const d = dados as DadosConversa
  // Simples exploratório: tabela 5 anexos Conv × Híb (mesmos números do chat).
  if (base === 'simples') {
    const s = dados as DadosSimplesChat
    const rows = s.resultado.linhas.map((l) => [
      `Anexo ${l.anexo}`,
      fmtMoeda(l.das),
      fmtMoeda(l.cbsDentroDAS),
      fmtMoeda(l.totalHibrido),
      l.vencedorRegime,
    ])
    return {
      pageSize: 'A4',
      pageMargins: [34, 102, 34, 52],
      defaultStyle: { font: 'Roboto', fontSize: 8, color: '#1e293b' },
      background: fundoMarcaDagua(300, 0.07),
      info: { title: 'Aurum AI — Simples exploratório', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
      header: (() => timbrado(emitente, cor, 'Aurum AI — Simples I–V', `RBT12 ${fmtMoeda(s.entrada.rbt12)} · receita ${fmtMoeda(s.entrada.receitaMes)} · Gerado em ${data}`)) as TDocumentDefinitions['header'],
      footer: rodape(emitente) as TDocumentDefinitions['footer'],
      content: [
        { text: 'Aurum AI — Simples exploratório (I–V · Conv × Híb)', fontSize: 14, bold: true, color: cor, margin: [0, 2, 0, 1] as [number, number, number, number] },
        { text: `RBT12 ${fmtMoeda(s.entrada.rbt12)} · receita ${fmtMoeda(s.entrada.receitaMes)} · folha ${s.entrada.folha12 != null ? fmtMoeda(s.entrada.folha12) : '—'} · CBS ref ${((s.entrada.cbsRef ?? 0) * 100).toFixed(2)}% · Gerado em ${data}`, fontSize: 7.6, color: '#7a8896', margin: [0, 0, 0, 8] as [number, number, number, number] },
        tabelaRelatorio({
          cols: [
            { titulo: 'Anexo', larg: 14, forte: true },
            { titulo: 'DAS conv', larg: 20, alin: 'right' },
            { titulo: 'CBS dentro', larg: 20, alin: 'right' },
            { titulo: 'Total híbrido', larg: 22, alin: 'right', forte: true },
            { titulo: 'Vence', larg: 14, alin: 'center' },
          ],
          rows,
          corCabecalho: cor,
        }),
        { text: `Menor carga geral: Anexo ${s.resultado.vencedorGeralId} ${s.resultado.vencedorGeralRegime} (${fmtMoeda(s.resultado.vencedorGeralValor)})`, fontSize: 8, bold: true, color: cor, margin: [0, 4, 0, 0] as [number, number, number, number] },
        { text: `Fontes: Tabela Simples Nacional — Anexos I–V + Reforma (CBS/IBS)`, fontSize: 7, color: '#7a8896', margin: [0, 4, 0, 0] as [number, number, number, number] },
        { text: `Aviso: ${AVISO_CHAT}`, fontSize: 7, bold: true, color: '#92400e', margin: [0, 2, 0, 0] as [number, number, number, number] },
      ],
    }
  }

  const mensagens = d.historico.slice(-20).map((m) => [
    m.papel === 'user' ? 'Você' : 'Aurum AI',
    limparMarkdownChat(m.texto).slice(0, 500),
  ])
  return {
    pageSize: 'A4',
    pageMargins: [34, 102, 34, 52],
    defaultStyle: { font: 'Roboto', fontSize: 8, color: '#1e293b' },
    background: fundoMarcaDagua(300, 0.07),
    info: { title: 'Aurum AI — relatório da conversa', author: 'Aurum Tax NCM', creator: 'Aurum Tax NCM' },
    header: (() => timbrado(emitente, cor, 'Aurum AI — conversa', `LC 214/2025 · ${d.historico.length} mensagens · Gerado em ${data}`)) as TDocumentDefinitions['header'],
    footer: rodape(emitente) as TDocumentDefinitions['footer'],
    content: [
      { text: 'Aurum AI — relatório da conversa', fontSize: 14, bold: true, color: cor, margin: [0, 2, 0, 1] as [number, number, number, number] },
      { text: `Gerado em ${d.geradoEm || data} · pela Aurum AI`, fontSize: 7.6, color: '#7a8896', margin: [0, 0, 0, 8] as [number, number, number, number] },
      tabelaRelatorio({
        cols: [
          { titulo: 'Quem', larg: 15, forte: true },
          { titulo: 'Mensagem', larg: 85 },
        ],
        rows: mensagens.length ? mensagens : [['—', 'Conversa vazia']],
        corCabecalho: cor,
      }),
      { text: `Pedido atual: ${limparMarkdownChat(d.pergunta).slice(0, 300)}`, fontSize: 7.6, color: '#334155', margin: [0, 4, 0, 0] as [number, number, number, number] },
      { text: `Fontes: ${FONTES_CHAT.join(' · ')}`, fontSize: 7, color: '#7a8896', margin: [0, 2, 0, 0] as [number, number, number, number] },
      { text: `Aviso: ${AVISO_CHAT}`, fontSize: 7, bold: true, color: '#92400e', margin: [0, 2, 0, 0] as [number, number, number, number] },
    ],
  }
}

/** Gera e baixa o PDF do chat (carrega o motor pdfMake sob demanda). */
export async function exportarRelatorioChatPDF(
  base: 'conversa' | 'calculo' | 'simples',
  dados: DadosConversa | DadosCalculo | DadosSimplesChat,
  emitente: Emitente,
): Promise<void> {
  const doc = montarDocumentoChatPDF(base, dados, emitente)
  const { baixarPdf } = await import('@/infrastructure/pdf/setup')
  const dia = new Date().toISOString().slice(0, 10)
  await baixarPdf(doc, base === 'calculo' ? `aurum-ai-calculo-${dia}.pdf` : base === 'simples' ? `aurum-ai-simples-${dia}.pdf` : `aurum-ai-conversa-${dia}.pdf`)
}
