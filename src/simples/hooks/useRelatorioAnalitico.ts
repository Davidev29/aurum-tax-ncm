/**
 * Simples Nacional — orquestração do relatório analítico sob demanda.
 * O motor determinístico só é executado quando o usuário pede insights/PDF,
 * evitando ~15 cálculos no render comum da página.
 */
import { useMemo } from 'react'
import { orquestrarRelatorio } from '../relatorio-analitico'
import { gerarInsightsFallback } from '../ia-insights'
import { exportarRelatorioAnaliticoPDF } from '../export-relatorio-analitico'
import { normalizarListaAnexosSimples } from '../store'
import type { SimplesState } from '../types'
import type { ResultadoSegregado } from '../segregacao-receita'
import type { AnexoSimplesId } from '../tabelas'
import { useAcaoTatil } from '@/ui/kit'
import { toast } from '@/store/ui'
import { useSessao } from '@/store/sessao'
import { EMITENTE_PADRAO } from '@/domain/entities'

export function useRelatorioAnalitico(
  s: SimplesState,
  segResultado: ResultadoSegregado | null,
  enabled: boolean
) {
  const relatorio = useMemo(() => {
    if (!enabled || !s.convencional) return null
    const opAtiva = s.modo === 'cnpj' ? (s.opcoes.find((o) => o.cnae7 === s.cnaeEscolhido) ?? null) : null
    const elegiveis = segResultado
      ? segResultado.anexos
      : s.modo === 'cnpj'
        ? normalizarListaAnexosSimples(opAtiva?.anexos ?? []).filter((a): a is AnexoSimplesId => ['I', 'II', 'III', 'IV', 'V'].includes(a))
        : [s.convencional.anexoId]
    return orquestrarRelatorio({
      empresa: {
        origem: s.modo === 'manual' ? 'MANUAL' : 'CNPJ_API',
        razaoSocial: s.modo === 'cnpj' && s.empresaNome ? s.empresaNome : 'Contribuinte — cálculo manual',
        cnpj: s.modo === 'cnpj' ? s.cnpj : null,
        cnaePrincipal: s.modo === 'cnpj' ? s.cnaeEscolhido || null : null,
        cnaesSecundarios: s.modo === 'cnpj' ? s.opcoes.filter((o) => o.cnae7 !== s.cnaeEscolhido).map((o) => o.cnae7) : [],
        regimeAtual: s.modo === 'cnpj' && s.opcaoSimples != null ? (s.opcaoSimples ? 'Optante do Simples' : 'Não optante (simulação)') : null,
      },
      competencia: new Date().toISOString().slice(0, 7),
      exercicioReferencia: new Date().getFullYear(),
      rbt12: s.rbt12,
      rba: s.rbt12,
      receitaMes: s.receitaMes,
      folha12: s.folha12,
      cbsRef: s.cbsRef,
      despesas: s.despesas.map((d) => ({ rotulo: d.rotulo, valor: d.valor, regra: d.regra })),
      aliqRefICMS: s.aliqRefICMS,
      aliqRefISS: s.aliqRefISS,
      contexto: {
        modo: s.modo,
        anexoSelecionado: s.convencional.anexoId,
        anexosElegiveis: elegiveis.length > 0 ? elegiveis : [s.convencional.anexoId],
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled, s.modo, s.empresaNome, s.cnpj, s.cnaeEscolhido, s.opcoes, s.rbt12,
    s.receitaMes, s.folha12, s.cbsRef, s.despesas, s.convencional, segResultado,
    s.aliqRefICMS, s.aliqRefISS, s.opcaoSimples,
  ])

  const insights = useMemo(
    () => (relatorio ? gerarInsightsFallback(relatorio) : []),
    [relatorio]
  )

  const pdf = useAcaoTatil(async () => {
    if (!relatorio) {
      toast('Visualize o cálculo antes de exportar.', 'warn')
      return
    }
    const emitente = useSessao.getState().emitente ?? EMITENTE_PADRAO
    await exportarRelatorioAnaliticoPDF(relatorio, insights, emitente)
    toast('Relatório analítico em PDF gerado.', 'ok')
  })

  return { relatorio, insights, pdf }
}
