/**
 * Aurum AI — PACOTE DE CONTEXTO RAG (o que o modelo recebe).
 *
 * Resolve a fragmentação diagnosticada: ficha absoluta + filtros de dados +
 * memória + intenção + ferramentas candidatas, serializados em UM pacote
 * JSON compacto com ORÇAMENTO de chars derivado do perfil do modelo
 * (`orcamentoContextoChars`). Prioridade: ficha > dados > memória > histórico.
 *
 * Uso pelo orquestrador (atual): continua determinístico; o pacote serve para
 * (a) auditoria, (b) prompt futuro de modelo com tools, (c) DebugIA.
 * Uso futuro: serializar `paraModelo()` direto no `sistema`/`pergunta` do
 * worker quando o GGUF suportar contexto maior (ver `modelo.json`).
 */

import { orcamentoContextoChars, type PerfilModelo } from '@/domain/ia/perfil-modelo'
import { ferramentasParaIntencao } from './aurum-ai-registro-ferramentas'
import type { AnaliseChat } from '@/domain/services/detector-chat'
import type { ContextoConversa } from './aurum-ai-tools'

export interface FichaResumo {
  codigo: string
  nome?: string
  capitulo?: string
  vinculo?: string
  score?: number
}

export interface PacoteContextoRag {
  versao: 'rag-v1'
  intencao: AnaliseChat['intencao']
  termoBusca: string | null
  ferramentas: string[]
  fichas: FichaResumo[]
  filtrosDados?: string | null
  memoria?: { assunto?: string | null; codigoNcm?: string | null; codigoNbs?: string | null } | null
  historico?: Array<{ papel: string; texto: string }>
  truncado: boolean
}

function cortar(s: string, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

export function montarPacoteContextoRag(args: {
  analise: AnaliseChat
  contexto?: ContextoConversa | null
  memoria?: PacoteContextoRag['memoria']
  fichas?: FichaResumo[]
  filtrosDados?: string | null
  historico?: Array<{ papel: string; texto: string }>
  perfil?: PerfilModelo | null
}): PacoteContextoRag {
  const orcamento = orcamentoContextoChars(args.perfil)
  let truncado = false
  const ferramentas = ferramentasParaIntencao(args.analise.intencao)
  // Fichas: Top-N compactas (nome 80 + vínculo 40, como o prompt do worker).
  const fichas = (args.fichas ?? []).slice(0, 10).map((f) => ({
    codigo: f.codigo,
    ...(f.nome ? { nome: cortar(f.nome, 80) } : {}),
    ...(f.capitulo ? { capitulo: f.capitulo } : {}),
    ...(f.vinculo ? { vinculo: cortar(f.vinculo, 40) } : {}),
    ...(typeof f.score === 'number' ? { score: f.score } : {}),
  }))
  const historico = (args.historico ?? []).slice(-6).map((m) => ({
    papel: m.papel === 'assistant' ? 'assistant' : 'user',
    texto: cortar(m.texto, 300),
  }))
  let pacote: PacoteContextoRag = {
    versao: 'rag-v1',
    intencao: args.analise.intencao,
    termoBusca: args.analise.termoBusca ?? args.contexto?.ultimoAssunto ?? null,
    ferramentas,
    fichas,
    filtrosDados: args.filtrosDados ? cortar(args.filtrosDados, 300) : null,
    memoria: args.memoria ?? null,
    historico,
    truncado: false,
  }
  // Enforça orçamento: reduz histórico → fichas → filtros, nessa ordem.
  let json = JSON.stringify(pacote)
  if (json.length > orcamento) {
    pacote = { ...pacote, historico: pacote.historico?.slice(-3) }
    json = JSON.stringify(pacote)
  }
  if (json.length > orcamento) {
    pacote = { ...pacote, fichas: pacote.fichas.slice(0, 5), historico: [] }
    json = JSON.stringify(pacote)
  }
  if (json.length > orcamento) {
    pacote = { ...pacote, fichas: pacote.fichas.slice(0, 3), filtrosDados: null }
    json = JSON.stringify(pacote)
  }
  if (JSON.stringify(pacote).length > orcamento) truncado = true
  return { ...pacote, truncado }
}

/**
 * Serialização compacta para injeção em prompt (quando o perfil permitir).
 * NUNCA inclui números fora das fichas do motor.
 */
export function pacoteParaTexto(pacote: PacoteContextoRag, limite = 2000): string {
  const linhas: string[] = [`intencao=${pacote.intencao}`]
  if (pacote.termoBusca) linhas.push(`busca="${cortar(pacote.termoBusca, 80)}"`)
  for (const f of pacote.fichas.slice(0, 6)) {
    linhas.push(`- ${f.codigo}${f.nome ? ` — ${f.nome}` : ''}${f.vinculo ? ` [${f.vinculo}]` : ''}`)
  }
  if (pacote.filtrosDados) linhas.push(`filtros: ${cortar(pacote.filtrosDados, 200)}`)
  linhas.push(`ferramentas: ${pacote.ferramentas.slice(0, 6).join(',')}`)
  return cortar(linhas.join('\n'), limite)
}
