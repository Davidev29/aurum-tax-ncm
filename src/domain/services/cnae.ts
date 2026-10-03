/**
 * CNAE — domínio de Serviços (Phase 7).
 *
 * Ponte entre o CNAE da empresa (BrasilAPI, 7 dígitos) e a tabela viva
 * `CNAE X ANEXO.json`. Funções puras, sem Dexie: o repositório resolve o
 * `CnaeAnexo` e este módulo decide o que fazer com ele.
 *
 * ATENÇÃO: `anexos` do CNAE são os Anexos I–V do **Simples Nacional**
 * (elegibilidade + Fator R), NUNCA os anexos da LC 214/2025.
 */
import type { CnaeAnexo } from '../entities'
import { fmtCnae } from '@/infrastructure/base/normalizacao'

export type { CnaeAnexo }

/** CNAE 7 dígitos (`0111-3/01` → `0111301`). */
export const codigo7De = (v: unknown): string => String(v ?? '').replace(/\D+/g, '')

export const ehCodigo7Valido = (v: unknown): boolean => codigo7De(v).length === 7

/** Texto que alimenta o pipeline NBS (busca textual + IA): código + descrição. */
export function textoBuscavelCnae(cnae: Pick<CnaeAnexo, 'codigoFormatado' | 'descricao'>): string {
  return `${cnae.codigoFormatado} ${cnae.descricao}`.trim()
}

/** Rótulo "Anexo Simples" — sempre com o prefixo (nunca "Anexo" seco). */
export function rotuloAnexoSimples(anexos: string[]): string {
  if (!anexos.length) return 'Anexo Simples —'
  return `Anexo Simples ${anexos.join(' / ')}`
}

/**
 * Palavras-chave NBS por divisão CNAE (ponte heurística CNAE→NBS).
 *
 * A descrição oficial do CNAE ("Formação de condutores") nunca matcha o
 * juridiquês dos NBS — a divisão (2 primeiros dígitos) diz o setor, e o
 * setor mapeia para o vocabulário dos benefícios (educação/saúde/cultura).
 * Divisões sem benefício mapeado retornam `[]` (→ tributação integral).
 */
const PALAVRAS_CHAVE_NBS_POR_DIVISAO: Record<string, string[]> = {
  // Educação → Anexo LC214 II (200028)
  '85': ['educacao'],
  // Saúde → Anexo LC214 III (200029)
  '86': ['saude'],
  '87': ['saude'],
  '88': ['saude'],
  // Artes, cultura, eventos, audiovisual → Anexo LC214 X (200039)
  '58': ['filme'],
  '59': ['filme'],
  '60': ['programa'],
  '90': ['espetaculo'],
  '91': ['espetaculo'],
  '92': ['espetaculo'],
  '93': ['espetaculo'],
  '74': ['evento'],
  '82': ['evento'],
}

export function palavrasChaveNbsPorCnae(codigo7: unknown): string[] {
  const d = codigo7De(codigo7)
  if (d.length !== 7) return []
  return PALAVRAS_CHAVE_NBS_POR_DIVISAO[d.slice(0, 2)] ?? []
}

/** `true` quando o CNAE exige a pergunta do Fator R (folha ≥ 28%). */
export function exigePerguntaFatorR(cnae: Pick<CnaeAnexo, 'fatorR' | 'anexos'>): boolean {
  return cnae.fatorR || cnae.anexos.includes('V') || cnae.anexos.includes('III')
}

export const PERGUNTA_FATOR_R =
  'A folha de salários (incluindo pró-labore) dos últimos 12 meses representa 28% ou mais do faturamento? Se sim, o enquadramento tende ao Anexo Simples III; se não, ao Anexo V.'

/**
 * Teto de confiança imposto pela Situação do CNAE (a matriz veta, a IA pontua).
 * `Permitido` não veta; `Permitido com ressalvas` veta em média (0.60);
 * `Depende da atividade` nunca ancora sozinho (força modo manual/IA com contexto).
 */
export function tetoConfiancaCnae(situacao: CnaeAnexo['situacao']): number {
  switch (situacao) {
    case 'Permitido':
      return 1
    case 'Permitido com ressalvas':
      return 0.6
    case 'Depende da atividade':
      return 0
  }
}

/** Badge da Situação (cor do kit). */
export function corSituacaoCnae(
  situacao: CnaeAnexo['situacao'],
): 'emerald' | 'amber' | 'slate' {
  switch (situacao) {
    case 'Permitido':
      return 'emerald'
    case 'Permitido com ressalvas':
      return 'amber'
    case 'Depende da atividade':
      return 'slate'
  }
}

export { fmtCnae }
