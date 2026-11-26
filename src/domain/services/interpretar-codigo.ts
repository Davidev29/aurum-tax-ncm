/**
 * Interpretação única de códigos digitados pelo usuário (NCM, NBS, CNAE, CNPJ).
 *
 * Antes desta camada, cada tela/classificador usava sua própria regex: um NCM
 * completo pontuado (`3913.90.50`) virava "descrição" e casava fuzzy com outro
 * código; um CNAE (`8599-6/01`) virava prefixo NCM; um CNPJ virava "número".
 * Aqui a intenção é decidida UMA vez, com normalização unicode e detecção de
 * formato. Máscaras (`fmt*`) continuam apenas para exibição.
 */
import { fmtCnpj, fmtNbs, fmtNcm } from './format'

export type TipoCodigo = 'ncm' | 'nbs' | 'cnae' | 'cnpj'

export type KindCodigo =
  | 'vazio'
  | 'texto'
  | 'ok'
  | 'parcial'
  | 'truncado'
  | 'legado'
  | 'misto'
  | 'invalido'

export type FormatoCodigo = 'cru' | 'ncm' | 'nbs200' | 'nbs11' | 'cnae' | 'cnpj' | 'desconhecido'

export interface CodigoInterpretado {
  kind: KindCodigo
  tipo: TipoCodigo
  /** Dígitos ASCII extraídos uma única vez. */
  digitos: string
  /** Entrada original trimada (auditoria/mensagens). */
  bruto: string
  /** Código canônico para exibição (máscara do tipo). */
  formatado: string
  formato: FormatoCodigo
  /** Quando o tamanho/formato aponta para outro tipo de código. */
  suspeitoDe?: TipoCodigo
  motivo?: 'letras' | 'tamanho' | 'formato' | 'separadores'
}

const TAMANHO: Record<TipoCodigo, number> = { ncm: 8, nbs: 9, cnae: 7, cnpj: 14 }

const PREFIXOS: Record<TipoCodigo, RegExp> = {
  ncm: /^(ncm|código ncm|codigo ncm)\s*[:#-]?\s*/i,
  nbs: /^(nbs|código nbs|codigo nbs)\s*[:#-]?\s*/i,
  cnae: /^(cnae|código cnae|codigo cnae)\s*[:#-]?\s*/i,
  cnpj: /^(cnpj|código cnpj|codigo cnpj)\s*[:#-]?\s*/i,
}

/** Converte dígitos unicode (fullwidth, arábico-indic, devanagari) para ASCII. */
function substituirDigitosUnicode(s: string): string {
  return s.replace(/[\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g, (d) => {
    const cp = d.charCodeAt(0)
    const base = cp >= 0xFF10 ? 0xFF10 : cp >= 0x0966 ? 0x0966 : cp >= 0x06F0 ? 0x06F0 : 0x0660
    return String(cp - base)
  })
}

export function digitosAscii(v: unknown): string {
  return substituirDigitosUnicode(String(v ?? '')).replace(/\D+/g, '')
}

function detectarFormato(s: string): FormatoCodigo {
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(s)) return 'ncm'
  if (/^\d{3}\.\d{3}\.\d{3}$/.test(s)) return 'nbs200'
  if (/^\d\.\d{4}\.\d{2}\.\d{2}$/.test(s)) return 'nbs11'
  if (/^\d{4}-\d\/{0,1}\d{2}$/.test(s) || /^\d{4}-\d-\d{2}$/.test(s)) return 'cnae'
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(s)) return 'cnpj'
  return 'cru'
}

function formatar(digitos: string, tipo: TipoCodigo, formato: FormatoCodigo): string {
  if (formato === 'nbs11') return digitos // legado não ganha máscara 2.00
  if (tipo === 'ncm') return fmtNcm(digitos)
  if (tipo === 'nbs') return fmtNbs(digitos)
  if (tipo === 'cnpj') return fmtCnpj(digitos)
  if (tipo === 'cnae' && digitos.length === 7) {
    return `${digitos.slice(0, 4)}-${digitos[4]}/${digitos.slice(5)}`
  }
  return digitos
}

function suspeito(length: number, formato: FormatoCodigo): TipoCodigo | undefined {
  if (formato === 'cnpj' || length === 14) return 'cnpj'
  if (formato === 'cnae') return 'cnae'
  if (formato === 'nbs11' || formato === 'nbs200' || length === 9) return 'nbs'
  if (formato === 'ncm' || length === 8) return 'ncm'
  return undefined
}

/**
 * Interpreta a entrada para o tipo esperado. Nunca lança; sempre devolve um
 * `CodigoInterpretado` com `digitos` ASCII e `bruto` preservado.
 */
export function interpretarCodigo(entrada: unknown, tipo: TipoCodigo): CodigoInterpretado {
  const bruto = String(entrada ?? '').trim()
  const semPrefixo = substituirDigitosUnicode(bruto).replace(PREFIXOS[tipo], '')
  const digitos = digitosAscii(semPrefixo)
  const formato = detectarFormato(semPrefixo)
  const base: CodigoInterpretado = {
    kind: 'invalido',
    tipo,
    digitos,
    bruto,
    formatado: formatar(digitos, tipo, formato),
    formato,
  }
  if (!bruto) return { ...base, kind: 'vazio', formatado: '' }
  // Texto puro (descrição) não é erro: o classificador segue o fluxo normal.
  if (!/[0-9\uFF10-\uFF19\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/.test(bruto)) {
    return { ...base, kind: 'texto' }
  }
  // Letras misturadas com dígitos: separadores abaixo não bastam — é descrição.
  if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(semPrefixo)) {
    return { ...base, kind: 'misto', motivo: 'letras' }
  }
  if (!/^[\d.\s/-]+$/.test(semPrefixo)) {
    return { ...base, kind: 'misto', motivo: 'separadores' }
  }

  const esperado = TAMANHO[tipo]
  if (tipo === 'nbs' && formato === 'nbs11') {
    return { ...base, kind: 'legado', suspeitoDe: 'nbs', motivo: 'formato' }
  }
  const outro = suspeito(digitos.length, formato)
  if (digitos.length === esperado) {
    return {
      ...base,
      kind: 'ok',
      suspeitoDe: outro && outro !== tipo ? outro : undefined,
      formatado: formatar(digitos, tipo, formato),
    }
  }
  if (digitos.length > esperado) {
    return { ...base, kind: 'truncado', suspeitoDe: outro, motivo: 'tamanho' }
  }
  if (digitos.length >= 2) {
    return {
      ...base,
      kind: 'parcial',
      suspeitoDe: outro && outro !== tipo ? outro : undefined,
      motivo: 'tamanho',
    }
  }
  return { ...base, kind: 'invalido', suspeitoDe: outro, motivo: 'tamanho' }
}

/** `true` quando a entrada é predominantemente um código (para tokenizadores). */
export function pareceCodigo(entrada: unknown, tipo: TipoCodigo = 'ncm'): boolean {
  const r = interpretarCodigo(entrada, tipo)
  return r.kind !== 'texto' && r.kind !== 'vazio' && r.kind !== 'misto'
}
