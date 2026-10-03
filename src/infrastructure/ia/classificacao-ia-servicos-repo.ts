/**
 * Repositório IA de Serviços (Phase 7) — paridade com
 * `classificacao-ia-repo.ts`: GATE + cálculo exemplificativo + trilha.
 */
import { REF_DEFAULT } from '@/domain/constants'
import type { Classificacao, ResultadoCalculo } from '@/domain/entities'
import { calcularTributos } from '@/domain/services/calculo'
import { norm } from '@/domain/services/format'
import {
  classificarComIaServicos,
  type FichaAbsolutaServico,
  type VereditoServico,
} from '@/application/classificacao-ia-servicos'
import type { EntradaDescricaoServico, SugestaoNbsJson } from '@/application/classificacao-inteligente-servicos'
import { registrarAuditoria } from '@/application/auditoria'
import { resolverClassificacoesNbs } from '@/infrastructure/base/classificacao-repo'
import type { CandidatoIa } from '@/infrastructure/bridge'
import type { ViaClassificacao } from '@/store/ia'
import { anexarConsultaIaJsonl, VALOR_BASE_IA } from './classificacao-ia-repo'

export type { ViaClassificacao }

export interface ResultadoConsultaIaServicos {
  via: ViaClassificacao
  descricao: string
  candidatos: CandidatoIa[]
  codigoEscolhido: string | null
  decisao: Classificacao | null
  regraGeral: boolean
  calculo: ResultadoCalculo | null
  confiancaIa: number
  motivo: string
  mock: boolean
  ms: number
  sugestao: SugestaoNbsJson
  ficha: FichaAbsolutaServico | null
  veredito: VereditoServico | null
  fontes: string[]
  cnaeOrigem: string | null
}

export async function classificarComIAServicos(
  descricao: string | EntradaDescricaoServico,
  opts?: { valorBase?: number; aoWorker?: (usou: boolean) => void; cnaeOrigem?: string | null },
): Promise<ResultadoConsultaIaServicos> {
  const entrada: EntradaDescricaoServico =
    typeof descricao === 'string' ? { descricao } : (descricao as EntradaDescricaoServico)
  const texto = String(entrada.descricao ?? '').trim()
  const valorBase = Number(opts?.valorBase) > 0 ? Number(opts?.valorBase) : VALOR_BASE_IA
  const cnaeOrigem = opts?.cnaeOrigem ? norm(opts.cnaeOrigem) || null : null
  const gate = await classificarComIaServicos(entrada, {
    aoWorker: opts?.aoWorker,
    cnaeOrigem,
  })

  if (!gate.codigoEscolhido || !gate.nbsValidado) {
    const vazio: ResultadoConsultaIaServicos = {
      via: gate.via,
      descricao: texto,
      candidatos: gate.candidatos,
      codigoEscolhido: null,
      decisao: null,
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
      cnaeOrigem,
    }
    void registrarAuditoria('consultas_ia_servicos', texto.slice(0, 80) || '(vazia)', 'criar', null, {
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: gate.motivo,
      cnaeOrigem,
    })
    void anexarConsultaIaJsonl({
      quando: new Date().toISOString(),
      dominio: 'nbs',
      descricao: texto,
      via: vazio.via,
      decisao: null,
      confianca: 0,
      motivo: gate.motivo,
      mock: gate.mock,
      candidatos: gate.candidatos,
      ms: gate.ms,
    })
    return vazio
  }

  const codigoLimpo = norm(gate.nbsValidado)
  const resolvido = await resolverClassificacoesNbs(codigoLimpo)
  const decisao = resolvido.lista[0] ?? null
  let calculo: ResultadoCalculo | null = null
  if (decisao) {
    const redIBS = Number(decisao.resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(decisao.resumo?.percentualReducaoCBS) || 0
    calculo = calcularTributos(valorBase, redIBS, redCBS, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  }

  const resultado: ResultadoConsultaIaServicos = {
    via: gate.via,
    descricao: texto,
    candidatos: gate.candidatos,
    codigoEscolhido: gate.codigoEscolhido,
    decisao,
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
    cnaeOrigem,
  }

  void registrarAuditoria('consultas_ia_servicos', texto.slice(0, 80) || '(vazia)', 'criar', null, {
    via: resultado.via,
    decisao: resultado.codigoEscolhido,
    confianca: resultado.confiancaIa,
    motivo: resultado.motivo,
    cnaeOrigem,
  })
  void anexarConsultaIaJsonl({
    quando: new Date().toISOString(),
    dominio: 'nbs',
    descricao: texto,
    via: resultado.via,
    decisao: resultado.codigoEscolhido,
    confianca: resultado.confiancaIa,
    motivo: resultado.motivo,
    mock: resultado.mock,
    candidatos: resultado.candidatos,
    ms: resultado.ms,
  })
  return resultado
}
