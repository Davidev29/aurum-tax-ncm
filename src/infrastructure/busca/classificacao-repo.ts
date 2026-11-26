/**
 * Repositório da busca determinística de NCM (Consulta por descrição).
 *
 * Cadeia: `classificarPorDescricao` (tokenização + dicionário curado + base
 * embutida) → `resolverClassificacoes` (única fonte de verdade tributária) →
 * `calcularTributos` com `REF_DEFAULT`. Sem modelo, sem motor, sem chute:
 * sem lastro oficial o resultado é NÃO SEI (código null).
 */
import { REF_DEFAULT } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm, ResultadoCalculo } from '@/domain/entities'
import { calcularTributos } from '@/domain/services/calculo'
import { norm } from '@/domain/services/format'
import { classificarPorDescricao, type EntradaDescricao, type SugestaoNcmJson } from '@/application/classificacao-inteligente'
import { registrarAuditoria } from '@/application/auditoria'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

export type ViaClassificacao = 'deterministico' | 'sem-resultado'

export interface CandidatoBusca {
  codigo: string
  descricao?: string
  score?: number
}

/** Base de cálculo exemplificativa para o painel (R$ 1.000,00). */
export const VALOR_BASE_BUSCA = 1000

export interface ResultadoConsultaBusca {
  via: ViaClassificacao
  descricao: string
  candidatos: CandidatoBusca[]
  codigoEscolhido: string | null
  decisao: Classificacao | null
  nomenclatura: NomenclaturaNcm | null
  regraGeral: boolean
  calculo: ResultadoCalculo | null
  confianca: number
  motivo: string
  ms: number
  sugestao: SugestaoNcmJson
  fontes: string[]
}

export interface FeedbackBusca {
  descricao: string
  via: ViaClassificacao
  decisao: string | null
  confianca: number
  motivo?: string | null
}

const FONTES_BUSCA = [
  'Nomenclatura vigente (TEC)',
  'Vínculos oficiais da Reforma (CST × cClassTrib)',
  'Capítulos NCM + flags in natura (Art. 137) e alimentos (Art. 135)',
  'Anexo IX / diferimento (Art. 138)',
  'Vigência (NCM extinto · cClassTrib · revogação CFF)',
] as const

const CONFIANCA_NUMERICA: Record<SugestaoNcmJson['confianca'], number> = {
  alta: 0.85,
  media: 0.55,
  baixa: 0.25,
}

/** Append em `logs/consultas.jsonl` com rotação + scrub de PII (best-effort). */
export async function anexarConsultaJsonl(entrada: Record<string, unknown>): Promise<void> {
  const { acrescentarLog } = await import('@/application/log-rotacao')
  await acrescentarLog('consultas.jsonl', entrada)
}

export async function classificarComBusca(
  descricao: string | EntradaDescricao,
  opts?: { valorBase?: number },
): Promise<ResultadoConsultaBusca> {
  const entrada: EntradaDescricao = typeof descricao === 'string' ? { descricao } : descricao
  const texto = String(entrada.descricao ?? '').trim()
  const valorBase = Number(opts?.valorBase) > 0 ? Number(opts?.valorBase) : VALOR_BASE_BUSCA
  const iniciado = Date.now()
  const sugestao = await classificarPorDescricao(entrada)
  const codigo = sugestao.ncm_provavel ? norm(sugestao.ncm_provavel) : null
  const candidatos: CandidatoBusca[] = sugestao.alternativas.map((a) => ({ codigo: norm(a), descricao: a }))

  if (!codigo) {
    const vazio: ResultadoConsultaBusca = {
      via: 'sem-resultado',
      descricao: texto,
      candidatos,
      codigoEscolhido: null,
      decisao: null,
      nomenclatura: null,
      regraGeral: false,
      calculo: null,
      confianca: 0,
      motivo: sugestao.justificativa,
      ms: Date.now() - iniciado,
      sugestao,
      fontes: [...FONTES_BUSCA],
    }
    void registrarAuditoria('consultas_busca', texto.slice(0, 80) || '(vazia)', 'criar', null, {
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: vazio.motivo,
    })
    void anexarConsultaJsonl({
      quando: new Date().toISOString(),
      descricao: texto,
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: vazio.motivo,
      candidatos,
      ms: vazio.ms,
    })
    return vazio
  }

  const resolvido = await resolverClassificacoes(codigo)
  const decisao = resolvido.lista[0] ?? null
  let calculo: ResultadoCalculo | null = null
  if (decisao) {
    const redIBS = Number(decisao.resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(decisao.resumo?.percentualReducaoCBS) || 0
    calculo = calcularTributos(valorBase, redIBS, redCBS, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  }
  const confianca = CONFIANCA_NUMERICA[sugestao.confianca] ?? 0.25
  const resultado: ResultadoConsultaBusca = {
    via: 'deterministico',
    descricao: texto,
    candidatos,
    codigoEscolhido: codigo,
    decisao,
    nomenclatura: resolvido.nomenclatura,
    regraGeral: resolvido.regraGeral,
    calculo,
    confianca,
    motivo: sugestao.justificativa,
    ms: Date.now() - iniciado,
    sugestao,
    fontes: [...FONTES_BUSCA],
  }
  void registrarAuditoria('consultas_busca', texto.slice(0, 80) || '(vazia)', 'criar', null, {
    via: resultado.via,
    decisao: codigo,
    confianca,
    motivo: resultado.motivo,
  })
  void anexarConsultaJsonl({
    quando: new Date().toISOString(),
    descricao: texto,
    via: resultado.via,
    decisao: codigo,
    confianca,
    motivo: resultado.motivo,
    candidatos,
    ms: resultado.ms,
  })
  return resultado
}

/** Registra o feedback "Não é esse" (SQLite + auditoria + JSONL). */
export async function registrarFeedbackBusca(fb: FeedbackBusca): Promise<void> {
  const quando = new Date().toISOString()
  try {
    await db.table('feedback_busca').add({
      quando,
      descricao: fb.descricao,
      via: fb.via,
      decisao: fb.decisao,
      confianca: fb.confianca,
      motivo: fb.motivo ?? 'feedback-negativo',
    })
  } catch {
    /* SQLite indisponível — segue para trilha */
  }
  void registrarAuditoria('feedback_busca', fb.descricao.slice(0, 80) || '(vazia)', 'criar', null, {
    via: fb.via,
    decisao: fb.decisao,
    confianca: fb.confianca,
    motivo: fb.motivo ?? 'feedback-negativo',
  })
  void anexarConsultaJsonl({ quando, tipo: 'feedback', ...fb })
}
