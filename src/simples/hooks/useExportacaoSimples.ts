/**
 * Simples Nacional — construção do payload de exportação e ações CSV/JSON.
 * `montarPayloadSimples` é puro e testável; o hook só liga aos exports.
 */
import { exportarSimplesCSV, exportarSimplesJSON, type PayloadSimples } from '../export'
import type { ResultadoConvencional, ResultadoHibrido } from '../calculo'
import type { ResultadoSegregado } from '../segregacao-receita'
import type { SimplesState } from '../types'

export interface DadosExportacao {
  s: SimplesState
  convExib: ResultadoConvencional
  hibExib: ResultadoHibrido | null
  dasBruto: number
  dasExib: number
  stResumo: { tributo: string; valorST: number; deducao: number; detalhe: string } | null
  segResultado: ResultadoSegregado | null
}

export function montarPayloadSimples(d: DadosExportacao): PayloadSimples | null {
  const { s, convExib, hibExib, dasBruto, dasExib, stResumo, segResultado } = d
  if (!s.convencional) return null
  return {
    anexoId: s.convencional.anexoId,
    rbt12: s.rbt12,
    receitaMes: s.receitaMes,
    folha12: s.folha12,
    rba: s.rbt12,
    cbsRef: s.cbsRef,
    conv: convExib,
    hib: hibExib ?? s.hibrido,
    debitosCBS: s.debitosCBS,
    creditosCBS: s.creditosCBS,
    empresa: s.empresaNome,
    cnae: s.cnaeEscolhido,
    dasReferencia: dasBruto,
    st: stResumo
      ? {
          ativo: true as const,
          tributo: stResumo.tributo,
          valorST: stResumo.valorST,
          deducao: stResumo.deducao,
          detalhe: stResumo.detalhe,
          detalhePorTributo: segResultado?.stDetalhe.map((x) => ({ tributo: x.tributo, valorST: x.valorST, deducao: x.deducao })) ?? [],
          dasIntegral: segResultado?.dasBrutoGuia ?? dasBruto,
          dasFinal: dasExib,
        }
      : {
          ativo: false as const,
          tributo: '',
          valorST: 0,
          deducao: 0,
          detalhe: '',
          detalhePorTributo: [] as Array<{ tributo: string; valorST: number; deducao: number }>,
          dasIntegral: dasBruto,
          dasFinal: dasExib,
        },
    seg: segResultado
      ? {
          ativo: true as const,
          anexos: segResultado.anexos,
          dasBruto: segResultado.dasBrutoGuia,
          parcelas: segResultado.parcelas.map((p) => ({
            anexoId: p.anexoId,
            anexoCalculado: p.anexoCalculado,
            escolhido: p.escolhido,
            receitaMes: p.receitaMes,
            faixa: p.faixa,
            aliquotaEfetiva: p.aliquotaEfetiva,
            das: p.dasGuia,
            dasBruto: p.dasBrutoGuia,
            st: p.st,
            tributoST: p.tributoST,
            deducaoST: p.deducaoST,
            resto: p.resto,
          })),
        }
      : { ativo: false as const, anexos: [], dasBruto: 0, parcelas: [] },
  }
}

export function useExportacaoSimples(dados: DadosExportacao) {
  const payload = () => montarPayloadSimples(dados)
  return {
    payload,
    csv: () => {
      const p = payload()
      if (p) exportarSimplesCSV(p)
    },
    json: () => {
      const p = payload()
      if (p) exportarSimplesJSON(p)
    },
  }
}
