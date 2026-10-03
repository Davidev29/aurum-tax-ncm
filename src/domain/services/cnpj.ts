/**
 * CNPJ — validação local com dígito verificador (Phase 7).
 *
 * Pura, sem I/O: usada antes de qualquer rede (BrasilAPI) para recusar
 * CNPJs impossíveis sem gastar timeout/rate-limit.
 */

/** Rejeita sequências triviais (`000…`, `111…`). */
function todosIguais(d: string): boolean {
  return d.length > 0 && d.split('').every((c) => c === d[0])
}

function digitoVerificador(base12: string): [string, string] {
  const calc = (digitos: string, pesos: number[]): number => {
    let soma = 0
    for (let i = 0; i < digitos.length; i++) soma += Number(digitos[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(`${base12}${d1}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return [String(d1), String(d2)]
}

export type MotivoCnpjInvalido =
  | 'cnpj-vazio'
  | 'cnpj-tamanho'
  | 'cnpj-sequencia'
  | 'cnpj-digito'

/** `true` quando o CNPJ tem 14 dígitos válidos (tamanho + DV). */
export function ehCnpjValido(v: unknown): boolean {
  return validarCnpj(v).ok
}

export function validarCnpj(v: unknown): { ok: boolean; cnpj: string; motivo?: MotivoCnpjInvalido } {
  const d = String(v ?? '').replace(/\D+/g, '')
  if (!d) return { ok: false, cnpj: '', motivo: 'cnpj-vazio' }
  if (d.length !== 14) return { ok: false, cnpj: d, motivo: 'cnpj-tamanho' }
  if (todosIguais(d)) return { ok: false, cnpj: d, motivo: 'cnpj-sequencia' }
  const [d1, d2] = digitoVerificador(d.slice(0, 12))
  if (d[12] !== d1 || d[13] !== d2) return { ok: false, cnpj: d, motivo: 'cnpj-digito' }
  return { ok: true, cnpj: d }
}

/** Mensagem pt-BR por motivo (UI/toasts). */
export function mensagemCnpjInvalido(motivo: MotivoCnpjInvalido): string {
  switch (motivo) {
    case 'cnpj-vazio':
      return 'Informe o CNPJ (14 dígitos).'
    case 'cnpj-tamanho':
      return 'CNPJ deve ter exatamente 14 dígitos.'
    case 'cnpj-sequencia':
      return 'CNPJ inválido: sequência repetida.'
    case 'cnpj-digito':
      return 'CNPJ inválido: dígito verificador não confere.'
  }
}
