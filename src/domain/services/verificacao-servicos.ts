/**
 * Conferência da decisão de serviços contra a tabela da Reforma (Phase 7).
 *
 * Dois papéis, ambos puros e auditáveis:
 * - `HipoteseLegal`: benefício da LC 214 que o texto do CNAE sugere, VINDO
 *   DA REFERÊNCIA OFICIAL (nunca inventado). Quando não há NBS mapeado para
 *   ele, é exibido como hipótese a verificar — jamais como decisão;
 * - `verificarCoerenciaServico`: a decisão NBS da IA é coerente com as
 *   hipóteses? Divergência vira aviso âmbar, nunca bloqueio silencioso.
 */
import type { ReferenciaCClassTrib } from '../entities'

/** Benefício oficial candidato para um CNAE (texto da referência + lcRef). */
export interface HipoteseLegal {
  cst: string
  cClassTrib: string
  reducaoIBS: number
  reducaoCBS: number
  /** Anexo LC 214 (`2`, `3`, …) ou `null`. */
  anexo: string | null
  descricao: string
  /** Fundamento (ex.: `Art. 275`) — da tabela CST×cClassTrib oficial. */
  baseLegal: string | null
  urlLegislacao: string | null
  /** Existe ao menos um NBS vinculado a este cct na base atual? */
  temNbs: boolean
  /** Cobertura textual CNAE×referência (0–1, auditoria). */
  cobertura: number
  /** `texto` = match lexical; `setor` = pin curado divisão→cct. */
  origem: 'texto' | 'setor'
}

/**
 * Pins curados divisão CNAE → ccts de benefício (hipótese, nunca vínculo).
 * Educação (85) tende ao Anexo LC 214 II (+ ProUni quando houver vínculo);
 * saúde (86–88) ao Anexo III; cultura/esporte (58–60, 90, 91, 93) ao X/desporto;
 * profissões (69, 71) ao art. 127 (−30%); hotelaria (55) e turismo (79) aos
 * arts. 281/289; imóveis (68) à locação (art. 261).
 * O pin só aparece se o cct existir na referência com redução > 0.
 */
export const PIN_HIPOTESE_POR_DIVISAO: Record<string, string[]> = {
  '55': ['200048'],
  '58': ['200039'],
  '59': ['200039'],
  '60': ['200039'],
  '68': ['200027', '200046'],
  '69': ['200052'],
  '71': ['200052'],
  '79': ['200051'],
  // Educação → Anexo LC214 II (200028) + ProUni (200025, quando aplicável)
  '85': ['200028', '200025'],
  // Saúde → Anexo LC214 III (200029)
  '86': ['200029'],
  '87': ['200029'],
  '88': ['200029'],
  // Artes, cultura, eventos, audiovisual → Anexo LC214 X (200039)
  '90': ['200039'],
  '91': ['200039'],
  // Esporte e lazer federado → art. 141 (200041/200042)
  '93': ['200041', '200042'],
  '74': ['200039'],
  '82': ['200039'],
}

/** Ccts sugeridos pelo setor do CNAE (7 dígitos → divisão). */
export function pinsHipotesesPorCnae(codigo7: unknown): string[] {
  const d = String(codigo7 ?? '').replace(/\D+/g, '')
  if (d.length !== 7) return []
  return PIN_HIPOTESE_POR_DIVISAO[d.slice(0, 2)] ?? []
}

export type CoerenciaServico = 'coerente' | 'divergente' | 'sem-base'

/**
 * A decisão NBS é coerente com as hipóteses legais?
 * - sem hipóteses → `sem-base` (nada a confrontar);
 * - cct decidido entre as hipóteses → `coerente`;
 * - senão → `divergente` (aviso: conferir destinação/operação).
 */
export function verificarCoerenciaServico(
  cctDecisao: string | null | undefined,
  hipoteses: HipoteseLegal[],
): CoerenciaServico {
  if (!hipoteses.length) return 'sem-base'
  if (!cctDecisao) return 'divergente'
  const dig = String(cctDecisao).replace(/\D+/g, '')
  return hipoteses.some((h) => h.cClassTrib === dig) ? 'coerente' : 'divergente'
}

export function descricaoHipotese(h: HipoteseLegal): string {
  const red = Math.max(h.reducaoIBS, h.reducaoCBS)
  const efeito = red >= 100 ? 'alíquota zero' : `redução de ${red}%`
  // Só anexos reais da LC 214 (I–XV); códigos internos de regime (ex.:
  // `91271` do 200/200052) não são anexos — exibi-los seria falso.
  const anexoOk = h.anexo && (/^(1[0-5]|[1-9])$/.test(h.anexo) || /^[IVX]+$/.test(h.anexo)) ? h.anexo : null
  return `${h.cst}/${h.cClassTrib} — ${efeito}${anexoOk ? ` (Anexo LC 214 ${anexoOk})` : ''}${h.baseLegal ? ` — ${h.baseLegal}` : ''}`
}

export type { ReferenciaCClassTrib }
