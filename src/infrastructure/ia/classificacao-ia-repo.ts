/**
 * Repositório IA da Consulta — Phase 6 / 06-06 (IA-06).
 *
 * Camada de infraestrutura sobre o GATE (`src/application/classificacao-ia.ts`):
 * - determinístico primeiro (`classificarPorDescricao` → `ncm_provavel` +
 *   confiança `alta` devolve `via: 'deterministico'` sem acordar o worker);
 * - senão Top-5 RAG (`buscarNomenclaturaPorTexto`, índice lexical) → worker
 *   `ia:classificar` (ou mock local) → `resolverClassificacoes` (única verdade);
 * - `NÃO SEI` sob baixa similaridade/confiança (sem código fictício);
 * - `calcularTributos` com as alíquotas padrão (`REF_DEFAULT`) para o painel;
 * - trilha: `audit_log` (SQLite) + `logs/consultas-ia.jsonl` (best-effort Node).
 *
 * Sem deps novas de produção. O append em `.jsonl` só acontece em ambiente
 * Node (vitest/scripts/Electron-main); no renderer é no-op silencioso — o
 * `audit_log` continua valendo como trilha auditável.
 */
import { REF_DEFAULT } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm, ResultadoCalculo } from '@/domain/entities'
import { calcularTributos } from '@/domain/services/calculo'
import { norm } from '@/domain/services/format'
import { classificarComIa } from '@/application/classificacao-ia'
import type { EntradaDescricao, SugestaoNcmJson } from '@/application/classificacao-inteligente'
import { registrarAuditoria } from '@/application/auditoria'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'
import type { CandidatoIa } from '@/infrastructure/bridge'
import type { ViaClassificacao } from '@/store/ia'

export type { ViaClassificacao }

/** Base de cálculo exemplificativa para o painel IA (R$ 1.000,00). */
export const VALOR_BASE_IA = 1000

export interface ResultadoConsultaIa {
  via: ViaClassificacao
  descricao: string
  candidatos: CandidatoIa[]
  codigoEscolhido: string | null
  /** Classificação validada pelo resolvedor (null quando NÃO SEI). */
  decisao: Classificacao | null
  nomenclatura: NomenclaturaNcm | null
  regraGeral: boolean
  /** Tributos sobre `VALOR_BASE_IA` com `REF_DEFAULT` (null quando NÃO SEI). */
  calculo: ResultadoCalculo | null
  confiancaIa: number
  motivo: string
  mock: boolean
  ms: number
  sugestao: SugestaoNcmJson
  /** Ficha absoluta lida pela Aurum AI (conjunto de dados completo). */
  ficha: import('@/application/aurum-ai-contexto').FichaAbsoluta | null
  /** Veredito unificado vigente vs hipótese (sem divergência). */
  veredito: import('@/application/aurum-ai-contexto').VereditoAurumAI | null
  /** Bases lidas nesta predição. */
  fontes: string[]
  /** Trilha do grafo (`via:grafo` auditável — cypher + caminhos). */
  grafoCypher?: string | null
  graphPaths?: string[][]
  caminhoGrafo?: string[] | null
  provenienciaGrafo?: Array<{
    de: string
    para: string
    tipo: string
    origem: string
    confianca: number
    anoReferencia?: number | null
  }> | null
  boostGrafo?: 'uso_local' | null
  boostValorGrafo?: number
}

export interface FeedbackIa {
  descricao: string
  via: ViaClassificacao
  decisao: string | null
  confianca: number
  motivo?: string | null
  mock?: boolean
}

function ehNode(): boolean {
  try {
    return typeof process !== 'undefined' && !!(process as unknown as { versions?: { node?: string } }).versions?.node
  } catch {
    return false
  }
}

/**
 * Append best-effort em `logs/consultas-ia.jsonl`.
 * No renderer (browser/Electron sem Node) é no-op — nunca quebra a consulta.
 */
export async function anexarConsultaIaJsonl(entrada: Record<string, unknown>): Promise<void> {
  if (!ehNode()) return
  try {
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    const path = await import(/* @vite-ignore */ 'node:path')
    const cwd = typeof process.cwd === 'function' ? process.cwd() : '.'
    const dir = path.join(cwd, 'logs')
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, 'consultas-ia.jsonl'), `${JSON.stringify(entrada)}\n`, 'utf-8')
  } catch {
    /* trilha em disco é best-effort; o audit_log já cobre a auditoria */
  }
}

/**
 * Classifica com IA como camada superior.
 * O GATE (`classificarComIa`) já aplica: determinístico primeiro, Top-5 RAG →
 * worker → `resolverClassificacoes`. Aqui só enriquecemos com o `calculo`
 * (IBS/CBS via `calcularTributos` + `REF_DEFAULT`) e a trilha auditável.
 */
export async function classificarComIA(
  descricao: string | EntradaDescricao,
  opts?: { valorBase?: number; aoWorker?: (usou: boolean) => void },
): Promise<ResultadoConsultaIa> {
  const entrada: EntradaDescricao =
    typeof descricao === 'string' ? { descricao } : (descricao as EntradaDescricao)
  const texto = String(entrada.descricao ?? '').trim()
  const valorBase = Number(opts?.valorBase) > 0 ? Number(opts?.valorBase) : VALOR_BASE_IA
  const gate = await classificarComIa(entrada, opts?.aoWorker ? { aoWorker: opts.aoWorker } : undefined)

  // NÃO SEI: sem código, sem decisão, sem cálculo (falha segura).
  if (!gate.codigoEscolhido || !gate.ncmValidado) {
    const vazio: ResultadoConsultaIa = {
      via: gate.via,
      descricao: texto,
      candidatos: gate.candidatos,
      codigoEscolhido: null,
      decisao: null,
      nomenclatura: null,
      regraGeral: false,
      calculo: null,
      confiancaIa: 0,
      motivo: gate.motivo,
      mock: gate.mock,
      ms: gate.ms,
      sugestao: gate.sugestao,
      ficha: gate.ficha,
      veredito: gate.veredito,
      fontes: gate.fontes,
      grafoCypher: gate.grafoCypher ?? null,
      graphPaths: gate.graphPaths ?? [],
      caminhoGrafo: gate.caminhoGrafo ?? null,
      provenienciaGrafo: gate.provenienciaGrafo ?? null,
      boostGrafo: gate.boostGrafo ?? null,
      boostValorGrafo: gate.boostValorGrafo ?? 0,
    }
    void registrarAuditoria('consultas_ia', texto.slice(0, 80) || '(vazia)', 'criar', null, {
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: gate.motivo,
      ...(gate.grafoCypher ? { cypher: gate.grafoCypher, graphPaths: gate.graphPaths ?? [] } : {}),
    })
    void anexarConsultaIaJsonl({
      quando: new Date().toISOString(),
      descricao: texto,
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: gate.motivo,
      mock: gate.mock,
      candidatos: gate.candidatos,
      ms: gate.ms,
      ...(gate.grafoCypher ? { cypher: gate.grafoCypher, graphPaths: gate.graphPaths ?? [] } : {}),
    })
    return vazio
  }

  // Caminho válido: resolve a classificação oficial (única verdade) e calcula.
  const codigoLimpo = norm(gate.ncmValidado)
  const resolvido = await resolverClassificacoes(codigoLimpo)
  const decisao = resolvido.lista[0] ?? null
  let calculo: ResultadoCalculo | null = null
  if (decisao) {
    const redIBS = Number(decisao.resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(decisao.resumo?.percentualReducaoCBS) || 0
    calculo = calcularTributos(valorBase, redIBS, redCBS, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  }

  const resultado: ResultadoConsultaIa = {
    via: gate.via,
    descricao: texto,
    candidatos: gate.candidatos,
    codigoEscolhido: gate.codigoEscolhido,
    decisao,
    nomenclatura: resolvido.nomenclatura,
    regraGeral: resolvido.regraGeral,
    calculo,
    confiancaIa: gate.confiancaIa,
    motivo: gate.motivo,
    mock: gate.mock,
    ms: gate.ms,
    sugestao: gate.sugestao,
    ficha: gate.ficha,
    veredito: gate.veredito,
    fontes: gate.fontes,
    grafoCypher: gate.grafoCypher ?? null,
    graphPaths: gate.graphPaths ?? [],
    caminhoGrafo: gate.caminhoGrafo ?? null,
    provenienciaGrafo: gate.provenienciaGrafo ?? null,
    boostGrafo: gate.boostGrafo ?? null,
    boostValorGrafo: gate.boostValorGrafo ?? 0,
  }

  void registrarAuditoria('consultas_ia', texto.slice(0, 80) || '(vazia)', 'criar', null, {
    via: resultado.via,
    decisao: resultado.codigoEscolhido,
    confianca: resultado.confiancaIa,
    motivo: resultado.motivo,
    ...(gate.grafoCypher ? { cypher: gate.grafoCypher, graphPaths: gate.graphPaths ?? [] } : {}),
  })
  void anexarConsultaIaJsonl({
    quando: new Date().toISOString(),
    descricao: texto,
    via: resultado.via,
    decisao: resultado.codigoEscolhido,
    confianca: resultado.confiancaIa,
    motivo: resultado.motivo,
    mock: resultado.mock,
    candidatos: resultado.candidatos,
    ms: resultado.ms,
    ...(gate.grafoCypher ? { cypher: gate.grafoCypher, graphPaths: gate.graphPaths ?? [] } : {}),
  })
  return resultado
}

/**
 * Registra o feedback "Não é esse" (SQLite `ia_feedback` + `audit_log` +
 * `.jsonl`). Best-effort: falha de trilha nunca quebra a UI.
 * Phase 10-05 (GRAFO-08): feedback ± alimenta o overlay (demote com TTL).
 */
export async function registrarFeedbackIa(fb: FeedbackIa): Promise<void> {
  const quando = new Date().toISOString()
  try {
    await db.table('ia_feedback').add({
      quando,
      descricao: fb.descricao,
      via: fb.via,
      decisao: fb.decisao,
      confianca: fb.confianca,
      motivo: fb.motivo ?? 'feedback-negativo',
      mock: fb.mock ?? true,
    })
  } catch {
    /* SQLite indisponível (ex.: teste sem banco) — segue p/ auditoria */
  }
  // GRAFO-08: demote por feedback negativo (boost zerado, TTL 90d).
  try {
    const { registrarFeedbackUso } = await import('@/application/grafo-overlay')
    const negativo = String(fb.motivo ?? 'feedback-negativo').includes('negativo') || fb.motivo === 'feedback-negativo'
    registrarFeedbackUso(String(fb.descricao ?? ''), fb.decisao ? String(fb.decisao) : null, !negativo)
  } catch {
    /* overlay nunca quebra o feedback */
  }
  void registrarAuditoria('ia_feedback', fb.descricao.slice(0, 80) || '(vazia)', 'criar', null, {
    via: fb.via,
    decisao: fb.decisao,
    confianca: fb.confianca,
    motivo: fb.motivo ?? 'feedback-negativo',
  })
  void anexarConsultaIaJsonl({
    quando,
    tipo: 'feedback',
    descricao: fb.descricao,
    via: fb.via,
    decisao: fb.decisao,
    confianca: fb.confianca,
    motivo: fb.motivo ?? 'feedback-negativo',
  })
}
