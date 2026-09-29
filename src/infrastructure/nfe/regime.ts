/**
 * Regime tributário do emitente — decide se a nota **transfere crédito de
 * IBS/CBS**.
 *
 * Regra da Reforma (LC 214/2025): optante do **Simples Nacional** (inclui MEI)
 * não destaca IBS/CBS em regime regular, logo suas notas **não transferem
 * crédito** ao destinatário — salvo a exceção do optante que recolhe pelo
 * regime regular (aviso exibido na UI como ressalva, sem bloquear).
 *
 * Fonte primária: `emit/CRT` do XML (`1` Simples, `2` excesso de sublimite,
 * `3` Normal, `4` MEI). Fallback: CSOSN dos itens — o Simples usa códigos de
 * 3 dígitos (`101`, `102`, … `900`); o regime normal usa CST de 2 dígitos
 * (`00`, `10`, … `90`). Sem nenhum sinal, o regime é `desconhecido` (a UI
 * não afirma nada nesse caso).
 */

export type RegimeTributario = 'simples' | 'mei' | 'normal' | 'desconhecido'

export const REGIME_LABELS: Record<Exclude<RegimeTributario, 'desconhecido'>, string> = {
  simples: 'Simples Nacional',
  mei: 'MEI',
  normal: 'Regime Normal',
}

/** CSOSN do Simples: 3 dígitos iniciando por 1, 2, 5 ou 9. */
const CSOSN_RE = /^[1259]\d\d$/

/**
 * Regime pelos CSTs de ICMS dos itens (fallback quando o XML não traz CRT).
 * Qualquer CSOSN denuncia emitente Simples; só CSTs clássicos indicam regime
 * normal; lista vazia/sem CST = desconhecido.
 */
export function regimePorCsts(csts: (string | null | undefined)[]): RegimeTributario {
  let viuClassico = false
  for (const bruto of csts) {
    const cst = String(bruto ?? '').trim()
    if (!cst) continue
    if (CSOSN_RE.test(cst)) return 'simples'
    viuClassico = true
  }
  return viuClassico ? 'normal' : 'desconhecido'
}

/**
 * Regime do emitente: CRT manda; sem CRT, infere pelos itens.
 * `cstsIcms` aceita os itens ou só os códigos — puro e leve para a tabela.
 */
export function regimeDoEmitente(
  crt: string | null | undefined,
  itensOuCsts: { cstIcms?: string | null }[] | (string | null | undefined)[],
): RegimeTributario {
  const c = String(crt ?? '').trim()
  if (c === '1' || c === '2') return 'simples'
  if (c === '4') return 'mei'
  if (c === '3') return 'normal'
  const csts = itensOuCsts.map((it) => (typeof it === 'string' ? it : (it?.cstIcms ?? '')))
  return regimePorCsts(csts)
}

/**
 * A nota transfere crédito de IBS/CBS? Só quando o emitente é do regime
 * normal. Simples/MEI não destacam; desconhecido não permite afirmar
 * (a UI trata como "sem confirmação", sem selo).
 */
export function transfereCreditoIbsCbs(regime: RegimeTributario): boolean {
  return regime === 'normal'
}
