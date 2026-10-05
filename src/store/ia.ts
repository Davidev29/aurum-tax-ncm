/**
 * Store da IA offline — Phase 6 / IA-05 (tracer 06-05).
 *
 * Estado observável do worker (`utilityProcess`) e da última decisão:
 * `status` do worker, candidatos RAG, decisão validada, `via`
 * (`deterministico` = caminho primário venceu; `ia` = fallback acionado) e
 * a métrica `taxa_uso_ia` (meta <30% — IA como camada superior, nunca
 * substituta do determinístico).
 */
import { create } from 'zustand'
import type { CandidatoIa, StatusIaBridge } from '@/infrastructure/bridge'
import type { SugestaoNcmJson } from '@/application/classificacao-inteligente'

export type ViaClassificacao = 'deterministico' | 'ia'

export type StatusWorkerIa = 'desligado' | 'carregando' | 'pronto' | 'erro'

/** Decisão auditável exibida na DebugIA (snapshot por inferência). */
export interface DecisaoIa {
  descricao: string
  via: ViaClassificacao
  codigoEscolhido: string
  confiancaIa: number
  motivo: string
  mock: boolean
  candidatos: CandidatoIa[]
  /** Carimbo do resolvedor (única fonte de verdade tributária). */
  ncmValidado: string | null
  regraGeral: boolean
  ms: number
  em: string
}

interface IaState {
  status: StatusWorkerIa
  modo: StatusIaBridge['modo']
  mock: boolean
  erro: string | null
  /** Arquivo .gguf efetivo (só o nome) + troca automática ativa. */
  modeloArquivo: string | null
  observandoModelo: boolean
  candidatos: CandidatoIa[]
  ultimaDecisao: DecisaoIa | null
  historico: DecisaoIa[]
  /** Contadores da métrica `taxa_uso_ia = consultasIa / totalConsultas`. */
  totalConsultas: number
  consultasIa: number
  setConexao: (s: Pick<IaState, 'status' | 'modo' | 'mock' | 'erro'> & Partial<Pick<IaState, 'modeloArquivo' | 'observandoModelo'>>) => void
  registrarDecisao: (d: DecisaoIa) => void
  limpar: () => void
}

const MAX_HISTORICO = 20

export const useIa = create<IaState>((set) => ({
  status: 'desligado',
  modo: 'desligado',
  mock: true,
  erro: null,
  modeloArquivo: null,
  observandoModelo: false,
  candidatos: [],
  ultimaDecisao: null,
  historico: [],
  totalConsultas: 0,
  consultasIa: 0,

  setConexao: (s) => set(s),

  registrarDecisao: (d) =>
    set((s) => ({
      ultimaDecisao: d,
      candidatos: d.candidatos,
      historico: [d, ...s.historico].slice(0, MAX_HISTORICO),
      totalConsultas: s.totalConsultas + 1,
      consultasIa: s.consultasIa + (d.via === 'ia' ? 1 : 0),
    })),

  limpar: () =>
    set({
      candidatos: [],
      ultimaDecisao: null,
      historico: [],
      totalConsultas: 0,
      consultasIa: 0,
    }),
}))

/** Fração de consultas que acionaram o fallback IA (meta <30%). */
export function taxaUsoIa(total: number, viaIa: number): number {
  if (total <= 0) return 0
  return Math.round((viaIa / total) * 1000) / 10
}

export type { CandidatoIa, SugestaoNcmJson }
