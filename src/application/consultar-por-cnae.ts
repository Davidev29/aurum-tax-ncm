/**
 * Consulta por CNAE (Phase 9 / 09-02) — orquestra as duas camadas do motor.
 *
 * Fluxo: `regrasDoCnae` (sempre) → `enriquecerNbsDoCnae` (só 508) →
 * `resumirCnae()` + `registrarAuditoria`. Espelha o padrão de
 * `consultar-por-cnpj.ts`: nunca lança — CNAE fora dos 1.090 vira
 * `cnae-desconhecido` com orientação manual.
 */

import type { HipoteseLegal } from '@/domain/services/verificacao-servicos'
import type { CoerenciaServico } from '@/domain/services/verificacao-servicos'
import {
  ANO_REFERENCIA_PADRAO,
  enriquecerNbsDoCnae,
  normalizarAnoReferencia,
  refPorAno,
  regrasDoCnae,
  type EstadoNbsCnae,
  type ItemRankingNbs,
  type RegraCnae,
  type VereditoNbs,
} from '@/domain/services/cnae-nbs'
import { registrarAuditoria } from '@/application/auditoria'

export type EstadoConsultaCnae = EstadoNbsCnae | 'cnae-desconhecido'

export interface ConsultaCnae {
  regra: RegraCnae
  estadoNbs: EstadoConsultaCnae
  vereditos: VereditoNbs[]
  maisProvavel: string | null
  ranking: ItemRankingNbs[]
  ambiguo: boolean
  coerencia: CoerenciaServico
  hipoteses: HipoteseLegal[]
  anoReferencia: number
  emTransicao: boolean
  resumo: string
}

/**
 * Linha-resumo da consulta (`resumirCnae`): código + Anexo Simples +
 * Situação + contagem/estado NBS + ano de referência. Pura.
 */
export function resumirCnae(
  regra: RegraCnae,
  estadoNbs: EstadoConsultaCnae,
  totalVereditos: number,
  anoReferencia: number,
): string {
  const ano = `(ref. ${anoReferencia})`
  if (regra.estado !== 'ok') return `${regra.codigoFormatado} · CNAE desconhecido ${ano}`
  const base = `${regra.codigoFormatado} · ${regra.rotuloAnexo} · ${regra.situacao}`
  if (estadoNbs === 'bens→NCM') return `${base} · sem NBS aplicável — atividade de bens (ver NCM) ${ano}`
  if (estadoNbs === 'sem-mapeamento-NBS') {
    return `${base} · sem mapeamento NBS (fallback Phase 7) ${ano}`
  }
  const n = totalVereditos === 1 ? '1 NBS' : `${totalVereditos} NBS`
  return `${base} · ${n} ${ano}`
}

/**
 * Consulta completa por CNAE. `anoReferencia` default 2033 (regime pleno).
 * Nunca lança — erro de banco vira `cnae-desconhecido`.
 */
export async function consultarPorCnae(
  cnaeBruto: unknown,
  opts?: { anoReferencia?: number },
): Promise<ConsultaCnae> {
  const ano = normalizarAnoReferencia(opts?.anoReferencia ?? ANO_REFERENCIA_PADRAO)
  const regra = await regrasDoCnae(cnaeBruto)

  if (regra.estado !== 'ok') {
    const consulta: ConsultaCnae = {
      regra,
      estadoNbs: 'cnae-desconhecido',
      vereditos: [],
      maisProvavel: null,
      ranking: [],
      ambiguo: false,
      coerencia: 'sem-base',
      hipoteses: [],
      anoReferencia: ano,
      emTransicao: refPorAno(ano).emTransicao,
      resumo: resumirCnae(regra, 'cnae-desconhecido', 0, ano),
    }
    await registrarAuditoria('consultas_cnae', consulta.resumo.slice(0, 80), 'criar', null, {
      cnae7: regra.cnae7,
      estadoNbs: consulta.estadoNbs,
      anoReferencia: ano,
    })
    return consulta
  }

  const enr = await enriquecerNbsDoCnae(regra, { anoReferencia: ano })
  const consulta: ConsultaCnae = {
    regra,
    estadoNbs: enr.estadoNbs,
    vereditos: enr.vereditos,
    maisProvavel: enr.maisProvavel,
    ranking: enr.ranking,
    ambiguo: enr.ambiguo,
    coerencia: enr.coerencia,
    hipoteses: enr.hipoteses,
    anoReferencia: enr.anoReferencia,
    emTransicao: enr.emTransicao,
    resumo: resumirCnae(regra, enr.estadoNbs, enr.vereditos.length, enr.anoReferencia),
  }
  await registrarAuditoria('consultas_cnae', consulta.resumo.slice(0, 80), 'criar', null, {
    cnae7: regra.cnae7,
    estadoNbs: consulta.estadoNbs,
    vereditos: consulta.vereditos.length,
    maisProvavel: consulta.maisProvavel,
    anoReferencia: ano,
  })
  return consulta
}
