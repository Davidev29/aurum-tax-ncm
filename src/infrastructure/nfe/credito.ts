/**
 * Leitura do **crédito que veio no XML** — o que a nota já traz destacado —
 * lado a lado com a tributação da Reforma que o sistema estima.
 *
 * Heurística transparente (lida dos CSTs e valores do próprio XML):
 * - **ICMS**: há crédito quando existe `vICMS > 0` destacado **ou** o CST/CSOSN
 *   é de operação com aproveitamento (`00`, `10`, `20`, `70`, `90`; Simples
 *   `101`, que permite crédito pelo art. 23 da LC 123/2006). `40/41` (isenta/
 *   não tributada), `50/51` (suspensão/diferimento), `60` (ST retido) e
 *   `102/103/400` (Simples sem crédito) **não** geram crédito;
 * - **PIS/COFINS**: há crédito quando o CST é de operação com direito a
 *   crédito (`50–56`) ou crédito presumido (`60–66`);
 * - **IBS/CBS (Reforma, LC 214/2025)**: há crédito quando o item traz valores
 *   destacados no grupo `imposto/IBSCBS` (`vIBSUF`/`vIBSMun`/`vIBS`/`vCBS`).
 *   É **este** o crédito que o sistema destaca na UI (novo bloco dedicado);
 *   ICMS/PIS/COFINS seguem como indício auxiliar do regime anterior.
 *
 * Não é apuração fiscal — é um indício para o confronto visual com a Reforma.
 */
import type { ItemNotaXml } from './tipos'

export type FonteCredito = 'ICMS' | 'PIS' | 'COFINS'

/** CSTs de ICMS com aproveitamento de crédito na entrada. */
const CST_ICMS_COM_CREDITO = new Set(['00', '10', '20', '70', '90', '101'])

/** CSTs de PIS/COFINS com direito a crédito ou crédito presumido. */
const CST_PIS_COFINS_COM_CREDITO = new Set([
  '50', '51', '52', '53', '54', '55', '56',
  '60', '61', '62', '63', '64', '65', '66',
])

export interface CreditoItem {
  temCredito: boolean
  fontes: FonteCredito[]
  vlIcms: number
}

/** Crédito de um item — puro e leve (chamado por linha da tabela). */
export function creditoDoItem(
  item: Pick<ItemNotaXml, 'cstIcms' | 'cstPis' | 'cstCofins' | 'vlIcms'>,
): CreditoItem {
  const fontes: FonteCredito[] = []
  const cstIcms = String(item.cstIcms ?? '').trim()
  const vlIcms = Number(item.vlIcms) || 0
  if (vlIcms > 0 || CST_ICMS_COM_CREDITO.has(cstIcms)) fontes.push('ICMS')
  if (CST_PIS_COFINS_COM_CREDITO.has(String(item.cstPis ?? '').trim())) fontes.push('PIS')
  if (CST_PIS_COFINS_COM_CREDITO.has(String(item.cstCofins ?? '').trim())) fontes.push('COFINS')
  return { temCredito: fontes.length > 0, fontes, vlIcms }
}

export interface CreditoNota {
  totalItens: number
  itensComCredito: number
  /** Soma do `vICMS` destacado nos itens (crédito potencial de ICMS). */
  icmsDestacado: number
  /** Fontes presentes em ao menos um item (para os chips do confronto). */
  fontes: FonteCredito[]
}

/** Agrega o crédito dos itens de uma nota. */
export function creditoDaNota(
  itens: Pick<ItemNotaXml, 'cstIcms' | 'cstPis' | 'cstCofins' | 'vlIcms'>[],
): CreditoNota {
  const fontes = new Set<FonteCredito>()
  let itensComCredito = 0
  let icmsDestacado = 0
  for (const item of itens) {
    const c = creditoDoItem(item)
    if (c.temCredito) itensComCredito++
    for (const f of c.fontes) fontes.add(f)
    icmsDestacado += c.vlIcms
  }
  return {
    totalItens: itens.length,
    itensComCredito,
    icmsDestacado,
    fontes: (['ICMS', 'PIS', 'COFINS'] as const).filter((f) => fontes.has(f)),
  }
}

/* ------------------------------------------------- crédito IBS/CBS (Reforma) --- */

/**
 * Crédito de IBS/CBS **destacado no XML** — o crédito da Reforma que o
 * sistema deve evidenciar (LC 214/2025, grupo `imposto/IBSCBS`).
 * É `0` em XMLs anteriores à Reforma (sem o grupo) — a UI exibe "sem
 * destaque" nesses casos em vez de afirmar crédito zerado.
 */
export interface CreditoIbsCbsItem {
  temCredito: boolean
  vIbs: number
  vCbs: number
  vTotal: number
  cstIbsCbs: string
  cClassTrib: string
}

export interface CreditoIbsCbsNota {
  totalItens: number
  itensComCredito: number
  ibsDestacado: number
  cbsDestacado: number
  totalDestacado: number
  temDestaque: boolean
}

type EntradaIbsCbs = Pick<
  ItemNotaXml,
  'vIbsItem' | 'vCbsItem' | 'cstIbsCbs' | 'cClassTribIbsCbs'
>

/** Crédito IBS/CBS de um item — soma direta dos valores destacados. */
export function creditoIbsCbsDoItem(item: Partial<EntradaIbsCbs> | null | undefined): CreditoIbsCbsItem {
  const vIbs = Math.round((Number(item?.vIbsItem) || 0) * 100) / 100
  const vCbs = Math.round((Number(item?.vCbsItem) || 0) * 100) / 100
  const vTotal = Math.round((vIbs + vCbs) * 100) / 100
  const cstIbsCbs = String(item?.cstIbsCbs ?? '').trim()
  const cClassTrib = String(item?.cClassTribIbsCbs ?? '').trim()
  return { temCredito: vTotal > 0, vIbs, vCbs, vTotal, cstIbsCbs, cClassTrib }
}

/** Agrega o IBS/CBS destacado dos itens; `totaisXml` valida a soma. */
export function creditoIbsCbsDaNota(
  itens: Partial<EntradaIbsCbs>[],
  totaisXml?: { totalIbsXml?: number | null; totalCbsXml?: number | null } | null,
): CreditoIbsCbsNota {
  let itensComCredito = 0
  let ibs = 0
  let cbs = 0
  for (const item of itens) {
    const c = creditoIbsCbsDoItem(item)
    if (c.temCredito) itensComCredito++
    ibs += c.vIbs
    cbs += c.vCbs
  }
  ibs = Math.round(ibs * 100) / 100
  cbs = Math.round(cbs * 100) / 100
  const somaItens = Math.round((ibs + cbs) * 100) / 100
  // Prefere o total declarado no XML quando presente (IBSCBSTot); senão a
  // soma dos itens. Divergência > R$ 0,05 indica inconsistência do emissor.
  const declarado = Math.round(((Number(totaisXml?.totalIbsXml) || 0) + (Number(totaisXml?.totalCbsXml) || 0)) * 100) / 100
  const totalDestacado = declarado > 0 ? declarado : somaItens
  const ibsDeclarado = Number(totaisXml?.totalIbsXml)
  const cbsDeclarado = Number(totaisXml?.totalCbsXml)
  return {
    totalItens: itens.length,
    itensComCredito,
    ibsDestacado: ibsDeclarado != null && !(ibsDeclarado === 0 && ibs > 0) ? Math.round(ibsDeclarado * 100) / 100 || ibs : ibs,
    cbsDestacado: cbsDeclarado != null && !(cbsDeclarado === 0 && cbs > 0) ? Math.round(cbsDeclarado * 100) / 100 || cbs : cbs,
    totalDestacado,
    temDestaque: totalDestacado > 0,
  }
}

/* ----------------------------------- divergência XML × sistema (Reforma) --- */

/**
 * Confronto por item entre **o que veio na nota** (grupo `imposto/IBSCBS` do
 * XML: CST, cClassTrib e valores destacados) e **o que diz a legislação**
 * (classificação do sistema + estimativa).
 *
 * - `temXml`: o item traz enquadramento ou valores de IBS/CBS no XML;
 * - `divergeEnquadramento`: CST ou cClassTrib do emitente ≠ do sistema;
 * - `divergeValores`: valores destacados ≠ estimados (tolerância R$ 0,05);
 * - `diverge`: qualquer uma das duas (é o que a UI sinaliza com `≠ XML`).
 */
export interface DivergenciaXml {
  temXml: boolean
  divergeEnquadramento: boolean
  divergeValores: boolean
  diverge: boolean
}

export function divergenciaXmlSistema(item: {
  cstIbsCbs?: string | null
  cClassTribIbsCbs?: string | null
  vIbsItem?: number | null
  vCbsItem?: number | null
  classificacao?: { cst?: string | null; cClassTrib?: string | null } | null
  ibs?: number | null
  cbs?: number | null
}): DivergenciaXml {
  const cstXml = String(item?.cstIbsCbs ?? '').trim()
  const cctXml = String(item?.cClassTribIbsCbs ?? '').trim()
  const vIbs = Number(item?.vIbsItem) || 0
  const vCbs = Number(item?.vCbsItem) || 0
  const temEnquadramento = cstXml !== '' || cctXml !== ''
  const temValores = vIbs + vCbs > 0.005
  const temXml = temEnquadramento || temValores

  const cstSis = String(item?.classificacao?.cst ?? '').trim()
  const cctSis = String(item?.classificacao?.cClassTrib ?? '').trim()
  const divergeEnquadramento =
    temEnquadramento && ((cstXml !== '' && cstXml !== cstSis) || (cctXml !== '' && cctXml !== cctSis))

  const divergeValores =
    temValores && Math.abs(vIbs + vCbs - ((Number(item?.ibs) || 0) + (Number(item?.cbs) || 0))) > 0.05

  return { temXml, divergeEnquadramento, divergeValores, diverge: divergeEnquadramento || divergeValores }
}
