/**
 * Interpretação ÚNICA da entrada NBS (Phase 7) — paridade com
 * `interpretarEntradaNcm`: 9 dígitos classificam, o resto é inválido
 * (NBS não trunca: 8 dígitos são NCM, não prefixo de serviço).
 */
import { REGRA_GERAL_NBS } from '../constants'
import type { Classificacao } from '../entities'
import { contextoRegraGeral } from '@/infrastructure/base/classificacao-repo'
import { montarRegraGeral } from './classificacao'
import { fmtNbs, norm } from './format'

export type EntradaNbsKind = 'ok' | 'invalido'

export interface EntradaNbs {
  kind: EntradaNbsKind
  /** 9 dígitos quando `ok`; dígitos crus quando `invalido`. */
  codigo: string
  digitos: number
}

export function interpretarEntradaNbs(v: unknown): EntradaNbs {
  const digitos = norm(v)
  if (digitos.length === 9) return { kind: 'ok', codigo: digitos, digitos: 9 }
  return { kind: 'invalido', codigo: digitos, digitos: digitos.length }
}

/** Regra geral dos serviços: `000|000001` (tributação integral). */
export async function classificacaoRegraGeralNbs(codigo: unknown): Promise<Classificacao> {
  const ctx = await contextoRegraGeral()
  const cl = montarRegraGeral(norm(codigo), ctx)
  // Regra geral NÃO tem vínculo em `db.nbs` (só os 122 com benefício) — sem
  // este passo a `descricao` vira o texto genérico do cClassTrib
  // ("Situações tributadas integralmente…") e o usuário não identifica o
  // serviço. Busca a legenda na ponte LC 116 → NBS (`db.lcNbs`, 676 NBS):
  // `descricao` passa a ser o nome do serviço; o significado tributário
  // continua em `resumo.descricaoCClassTrib`.
  let detalheNbs: Classificacao['detalheNbs'] = null
  let descricao = cl.descricao
  try {
    const { buscarLegendaNbs } = await import('@/infrastructure/base/classificacao-repo')
    const legenda = await buscarLegendaNbs(norm(codigo))
    if (legenda && (legenda.descricaoNbs || legenda.descricaoLc)) {
      detalheNbs = legenda
      descricao = legenda.descricaoNbs || legenda.descricaoLc
    }
  } catch {
    /* legenda é enriquecimento — nunca quebra a regra geral */
  }
  return {
    ...cl,
    codigoFormatado: fmtNbs(cl.codigo),
    cst: cl.cst || REGRA_GERAL_NBS.cst,
    cClassTrib: cl.cClassTrib || REGRA_GERAL_NBS.cClassTrib,
    descricao,
    detalheNbs,
    regraGeral: true,
  }
}

/** Objeto sintético para NBS inválido (fora dos 9 dígitos). */
export function classificacaoNbsInvalido(codigo: string): Classificacao {
  const cod = norm(codigo)
  return {
    id: `INVALIDO|${cod}`,
    codigo: cod,
    codigoFormatado: fmtNbs(cod),
    cst: REGRA_GERAL_NBS.cst,
    cClassTrib: REGRA_GERAL_NBS.cClassTrib,
    baseLegal: '',
    descricao: 'NBS inválido',
    vinculo: null,
    cstDetalhes: null,
    cstClassTribDetalhes: null,
    referencia: null,
    resumo: {
      descricaoCClassTrib: 'NBS inválido',
      percentualReducaoIBS: 0,
      percentualReducaoCBS: 0,
      anexo: null,
      urlLegislacao: null,
      documentosHabilitados: null,
    },
    regraGeral: true,
  }
}
