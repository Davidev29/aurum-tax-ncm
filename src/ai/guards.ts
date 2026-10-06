/**
 * Guards transversais código-first (C-007/C-008) — NÃO delegar ao prompt/fine-tune.
 * - `detectarInjection`: re-export do detector fiscal-independente.
 * - `removerPII`: strip de CNPJ/CPF/email/telefone antes de grafo/MCP/IPC/log/histórico.
 * - `hashEmitente`: identifica o emitente no overlay sem persistir CNPJ cru.
 * - `MENSAGEM_RECUSA_INJECTION`: recusa fixa (auditoria + consistência).
 */
import { detectarInjection as detectarInjectionBase } from '@/domain/services/escopo-consulta'

export const detectarInjection = detectarInjectionBase

export const MENSAGEM_RECUSA_INJECTION =
  'Não sigo essa instrução. Trabalho só com dados oficiais e cálculo determinístico: informe CNPJ (14 dígitos), NCM/NBS, ou RBT12 + anexo + receita, que eu consulto a ferramenta correta.'

const RE_CNPJ = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\b\d{14}\b/g
const RE_CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/g
const RE_EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/g
const RE_FONE = /\(?\d{2}\)?\s?\d{4,5}-?\d{4}/g

/** Remove PII de texto livre antes de enviar a grafo/MCP/IPC/log/modelo. */
export function removerPII(texto: unknown): string {
  return String(texto ?? '')
    .replace(RE_CNPJ, '[CNPJ]')
    .replace(RE_CPF, '[CPF]')
    .replace(RE_EMAIL, '[EMAIL]')
    .replace(RE_FONE, '[FONE]')
}

/** True quando o texto ainda contém PII aparente (pós-filtro de saída da IA). */
export function contemPII(texto: unknown): boolean {
  const s = String(texto ?? '')
  RE_CNPJ.lastIndex = 0; RE_CPF.lastIndex = 0; RE_EMAIL.lastIndex = 0; RE_FONE.lastIndex = 0
  return RE_CNPJ.test(s) || RE_CPF.test(s) || RE_EMAIL.test(s) || RE_FONE.test(s)
}

/**
 * Hash estável (cyrb53, hex 16) do emitente para o overlay/IPC.
 * Troca o CNPJ cru por ID — o vínculo de aprendizado não precisa do número.
 */
export function hashEmitente(cnpjBruto: unknown): string {
  const d = String(cnpjBruto ?? '').replace(/\D+/g, '').slice(0, 14) || 'anonimo'
  let h1 = 0xdeadbeef ^ 42
  let h2 = 0x41c6ce57 ^ 42
  for (let i = 0; i < d.length; i++) {
    const ch = d.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `emit_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`
}
