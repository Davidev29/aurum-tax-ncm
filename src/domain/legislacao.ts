/**
 * Catálogo de legislações da Reforma Tributária + helpers de ancoragem.
 *
 * Utilidade (pedido do usuário): todos os produtos referenciam algum
 * artigo/parágrafo da lei. Por isso:
 * - o menu **Legislação** abre cada norma **na íntegra em nova aba**;
 * - na **Consulta**, "Visualizar legislação" abre um **modal** com `iframe`
 *   apontando para a URL **com âncora** (`#art128`, `#art137`, …), de modo
 *   que o `scroll` do documento já cai exatamente no trecho citado.
 *
 * As URLs vindas da base (`referencia.urlLegislacao`) já trazem a âncora
 * (`lcp214.htm#art93`, …). Os links genéricos (`LINK_LC214` puro) ganham a
 * âncora via `urlComAncora(url, textoRef)`, que extrai `Art. NNN` do título
 * ou da referência legal.
 */
import {
  LINK_DECRETO_12955,
  LINK_LC214,
  LINK_PORTAL_CFF,
  LINK_RES_CGIBS_6,
} from './constants'

export type TipoLegislacao = 'lei' | 'decreto' | 'resolucao' | 'portal'

export interface ItemLegislacao {
  id: string
  sigla: string
  titulo: string
  descricao: string
  utilidade: string
  url: string
  tipo: TipoLegislacao
  rotuloTipo: string
}

export const LEGISLACOES: ItemLegislacao[] = [
  {
    id: 'lc214',
    sigla: 'LC 214/2025',
    titulo: 'Lei Complementar nº 214/2025',
    descricao:
      'Institui o IBS, a CBS e o Imposto Seletivo. É a norma-mãe da Reforma — todos os trechos citados nos produtos (artigos, parágrafos e anexos) vêm daqui.',
    utilidade:
      'Referência direta dos trechos citados na Consulta. Use "Visualizar legislação" no produto para cair exatamente no artigo citado.',
    url: LINK_LC214,
    tipo: 'lei',
    rotuloTipo: 'Lei Complementar',
  },
  {
    id: 'dec12955',
    sigla: 'Decreto 12.955/2026',
    titulo: 'Decreto nº 12.955, de 29.04.2026 — CBS',
    descricao:
      'Regulamenta a Contribuição sobre Bens e Serviços (CBS) no âmbito federal, detalhando operacionalização, apuração e recolhimento.',
    utilidade:
      'Consulta operacional da CBS: prazos, apuração e obrigações acessórias federais.',
    url: LINK_DECRETO_12955,
    tipo: 'decreto',
    rotuloTipo: 'Decreto Federal',
  },
  {
    id: 'res-cgibs-6',
    sigla: 'Res. CGIBS nº 6/2026',
    titulo: 'Resolução CGIBS nº 6, de 30.04.2026 — Regulamenta o IBS',
    descricao:
      'Regulamentação do Imposto sobre Bens e Serviços (IBS) pelo Comitê Gestor — regras de transição, regimes específicos e procedimentos (PDF oficial).',
    utilidade: 'Consulta operacional do IBS: regulamento do Comitê Gestor.',
    url: LINK_RES_CGIBS_6,
    tipo: 'resolucao',
    rotuloTipo: 'Resolução CGIBS',
  },
  {
    id: 'portal-cff',
    sigla: 'Conformidade Fácil',
    titulo: 'Portal da Conformidade Fácil (CFF)',
    descricao:
      'Ambiente oficial da SEFAZ-RS para emissão assistida, conformidade e serviços do IBS/CBS em produção.',
    utilidade: 'Acesso operacional ao portal oficial (ambiente externo).',
    url: LINK_PORTAL_CFF,
    tipo: 'portal',
    rotuloTipo: 'Portal oficial',
  },
]

/** Extrai `art128` de textos como "Art. 128 — Redução…", "art133", "Artigo 137". */
export function ancoraParaArtigo(texto?: string | null): string | null {
  if (!texto) return null
  const m = texto.match(/art(?:igo|\.)?\s*\.?\s*(\d{1,3})\s*(?:-[A-Z])?/i)
  if (!m) return null
  return `art${m[1]}`
}

/**
 * Devolve a URL com âncora para o artigo citado.
 *
 * - Se a URL já tem `#…`, mantém como está (a base já referencia o ponto exato).
 * - Se for página HTML do Planalto/CGIBS e o texto cita `Art. NNN`, anexa `#artNNN`.
 * - PDFs e portais não aceitam âncora de artigo: devolve a URL pura.
 */
export function urlLegislacaoComAncora(
  url?: string | null,
  textoRef?: string | null,
): string | null {
  if (!url) return null
  if (url.includes('#')) return url
  const ancora = ancoraParaArtigo(textoRef)
  if (!ancora) return url
  if (/\.pdf(\?|$)/i.test(url)) return url
  if (/planalto\.gov\.br| identif|legislacao/i.test(url) || url.startsWith(LINK_LC214))
    return `${url}#${ancora}`
  if (/cgibs\.gov\.br/i.test(url) && !/\.pdf/i.test(url)) return `${url}#${ancora}`
  // LC 214 e decretos do Planalto usam âncoras `artNNN` — tenta mesmo assim.
  if (/planalto/i.test(url)) return `${url}#${ancora}`
  return url
}

/** Rótulo curto do destino exibido no modal ("lcp214.htm · art. 128"). */
export function rotuloDestino(url: string): string {
  try {
    const u = new URL(url)
    const base = u.pathname.split('/').pop() || u.hostname
    const hash = u.hash ? ` · ${u.hash.replace('#', '').replace(/^art/i, 'art. ')}` : ''
    return `${base}${hash}`
  } catch {
    return url
  }
}
