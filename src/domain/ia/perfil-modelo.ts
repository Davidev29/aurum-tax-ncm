/**
 * Aurum AI — tipos do perfil de modelo (espelho TS da camada de
 * compatibilidade `electron/ia/perfil-modelo.cjs`).
 *
 * O renderer NUNCA decide parâmetros por modelo específico: ele lê o
 * `perfil` do status IA (`bridge.ia.status()`) e ajusta orçamento de
 * contexto/verbosidade. Sem worker (web/testes), usa `PERFIL_GENERICO_TS`.
 */

export type FamiliaModelo = 'qwen3' | 'qwen' | 'llama' | 'mistral' | 'phi' | 'gemma' | 'generico'

export type TemplateChat = 'chatml-qwen' | 'llama3' | 'mistral' | 'phi' | 'gemma' | 'generico'

export interface PerfilModelo {
  familia: FamiliaModelo
  templateChat: TemplateChat | string
  contextSize: number
  thinkTag?: string | null
  suportaGramatica?: boolean
  classificacao?: { maxTokens: number; temperature: number; topP: number }
  conversa?: {
    maxTokensPadrao: number
    maxTokensThink: number
    temperature: number
    topP: number
    topK: number
    repeatPenalty: number
  }
  maxCandidatos?: number
  systemPromptExtra?: string
  arquivo?: string | null
}

export const PERFIL_GENERICO_TS: PerfilModelo = {
  familia: 'generico',
  templateChat: 'generico',
  contextSize: 4096,
  thinkTag: null,
  suportaGramatica: true,
  classificacao: { maxTokens: 8, temperature: 0, topP: 1 },
  conversa: {
    maxTokensPadrao: 320,
    maxTokensThink: 512,
    temperature: 0.4,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.15,
  },
  maxCandidatos: 6,
  systemPromptExtra: '',
  arquivo: null,
}

/**
 * Orçamento de contexto (chars) derivado do perfil: ~4 chars/token,
 * reserva 25% para a resposta + margem do envelope.
 */
export function orcamentoContextoChars(perfil?: PerfilModelo | null): number {
  const ctx = Number(perfil?.contextSize) || PERFIL_GENERICO_TS.contextSize
  return Math.max(1500, Math.floor(ctx * 4 * 0.7))
}
