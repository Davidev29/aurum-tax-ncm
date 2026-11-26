/**
 * Repositório da busca determinística de serviços (NBS).
 * `classificarServicoPorDescricao` → `resolverClassificacoesNbs` → cálculo
 * exemplificativo. Sem modelo, sem motor e sem NBS inventado.
 */
import { REF_DEFAULT } from '@/domain/constants'
import type { Classificacao, ResultadoCalculo } from '@/domain/entities'
import { calcularTributos } from '@/domain/services/calculo'
import { norm } from '@/domain/services/format'
import {
  classificarServicoPorDescricao,
  type EntradaDescricaoServico,
  type SugestaoNbsJson,
} from '@/application/classificacao-inteligente-servicos'
import { registrarAuditoria } from '@/application/auditoria'
import { resolverClassificacoesNbs } from '@/infrastructure/base/classificacao-repo'
import { anexarConsultaJsonl, VALOR_BASE_BUSCA, type CandidatoBusca, type ViaClassificacao } from './classificacao-repo'

export type { ViaClassificacao }

export interface ResultadoConsultaServicosBusca {
  via: ViaClassificacao
  descricao: string
  candidatos: CandidatoBusca[]
  codigoEscolhido: string | null
  decisao: Classificacao | null
  regraGeral: boolean
  calculo: ResultadoCalculo | null
  confianca: number
  motivo: string
  ms: number
  sugestao: SugestaoNbsJson
  fontes: string[]
  cnaeOrigem: string | null
}

const CONFIANCA_NUMERICA: Record<SugestaoNbsJson['confianca'], number> = {
  alta: 0.85,
  media: 0.55,
  baixa: 0.25,
}

export async function classificarComBuscaServicos(
  descricao: string | EntradaDescricaoServico,
  opts?: { valorBase?: number; cnaeOrigem?: string | null },
): Promise<ResultadoConsultaServicosBusca> {
  const entrada: EntradaDescricaoServico = typeof descricao === 'string' ? { descricao } : descricao
  const texto = String(entrada.descricao ?? '').trim()
  const valorBase = Number(opts?.valorBase) > 0 ? Number(opts?.valorBase) : VALOR_BASE_BUSCA
  const cnaeOrigem = opts?.cnaeOrigem ? norm(opts.cnaeOrigem) || null : null
  const iniciado = Date.now()
  const sugestao = await classificarServicoPorDescricao(entrada)
  const codigo = sugestao.nbs_provavel ? norm(sugestao.nbs_provavel) : null
  const candidatos: CandidatoBusca[] = sugestao.alternativas.map((a) => ({ codigo: norm(a), descricao: a }))

  if (!codigo) {
    const vazio: ResultadoConsultaServicosBusca = {
      via: 'sem-resultado',
      descricao: texto,
      candidatos,
      codigoEscolhido: null,
      decisao: null,
      regraGeral: false,
      calculo: null,
      confianca: 0,
      motivo: sugestao.justificativa,
      ms: Date.now() - iniciado,
      sugestao,
      fontes: ['Nomenclatura NBS vigente', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
      cnaeOrigem,
    }
    void registrarAuditoria('consultas_busca_servicos', texto.slice(0, 80) || '(vazia)', 'criar', null, {
      via: vazio.via, decisao: null, confianca: 0, motivo: vazio.motivo, cnaeOrigem,
    })
    void anexarConsultaJsonl({
      quando: new Date().toISOString(), dominio: 'nbs', descricao: texto, via: vazio.via,
      decisao: null, confianca: 0, motivo: vazio.motivo, candidatos, ms: vazio.ms,
    })
    return vazio
  }

  const resolvido = await resolverClassificacoesNbs(codigo)
  const decisao = resolvido.lista[0] ?? null
  let calculo: ResultadoCalculo | null = null
  if (decisao) {
    const redIBS = Number(decisao.resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(decisao.resumo?.percentualReducaoCBS) || 0
    calculo = calcularTributos(valorBase, redIBS, redCBS, REF_DEFAULT.IBS, REF_DEFAULT.CBS)
  }
  const confianca = CONFIANCA_NUMERICA[sugestao.confianca] ?? 0.25
  const resultado: ResultadoConsultaServicosBusca = {
    via: 'deterministico',
    descricao: texto,
    candidatos,
    codigoEscolhido: codigo,
    decisao,
    regraGeral: resolvido.regraGeral,
    calculo,
    confianca,
    motivo: sugestao.justificativa,
    ms: Date.now() - iniciado,
    sugestao,
    fontes: ['Nomenclatura NBS vigente', 'Vínculos oficiais da Reforma (CST × cClassTrib)'],
    cnaeOrigem,
  }
  void registrarAuditoria('consultas_busca_servicos', texto.slice(0, 80) || '(vazia)', 'criar', null, {
    via: resultado.via, decisao: codigo, confianca, motivo: resultado.motivo, cnaeOrigem,
  })
  void anexarConsultaJsonl({
    quando: new Date().toISOString(), dominio: 'nbs', descricao: texto, via: resultado.via,
    decisao: codigo, confianca, motivo: resultado.motivo, candidatos, ms: resultado.ms,
  })
  return resultado
}
