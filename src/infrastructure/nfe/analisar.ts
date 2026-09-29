import { anexoDeReducao, calcularTributos, observacoesLegais } from '@/domain/services/calculo'
import { classificacaoNcmInvalido } from '@/domain/services/classificacao'
import { norm } from '@/domain/services/format'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import {
  buscarNomenclatura,
  classificacaoRegraGeral,
  resolverClassificacoes,
} from '../base/classificacao-repo'
import type { ItemNotaXml, ResultadoItemNfe } from './tipos'

export interface AliquotasRefNfe {
  refIBS: number
  refCBS: number
}

/**
 * Análise dos itens da nota (mesmo motor do SPED, SPEC R4.4–R4.7).
 * Caches por execução evitam repetir consultas por NCM repetido.
 */
export async function analisarItensNfe(
  itens: ItemNotaXml[],
  ref: AliquotasRefNfe,
  onProgress?: (feito: number, total: number) => void,
): Promise<ResultadoItemNfe[]> {
  const cacheNcm = new Map<string, { lista: Classificacao[]; regraGeral: boolean; manual: boolean }>()
  const cacheNomen = new Map<string, NomenclaturaNcm | null>()

  const resultados: ResultadoItemNfe[] = []

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i]
    const digitos = norm(item.ncm)
    const cod = digitos.length > 8 ? digitos.slice(0, 8) : digitos
    const valido = cod.length === 8

    let lista: Classificacao[] = []
    let regraGeralDaBase = false
    let manualDoNcm = false
    if (valido) {
      let entrada = cacheNcm.get(cod)
      if (!entrada) {
        const r = await resolverClassificacoes(cod)
        entrada = { lista: r.lista, regraGeral: r.regraGeral, manual: r.manual }
        cacheNcm.set(cod, entrada)
        if (!cacheNomen.has(cod)) cacheNomen.set(cod, r.nomenclatura)
      }
      lista = entrada.lista
      regraGeralDaBase = entrada.regraGeral
      manualDoNcm = entrada.manual
    }

    let classificacao: Classificacao
    let regraGeral: boolean
    let manual = false

    if (lista.length > 0) {
      classificacao = lista[0]
      regraGeral = regraGeralDaBase
      manual = manualDoNcm || lista[0].manual != null
    } else if (valido) {
      let nom = cacheNomen.get(cod)
      if (nom === undefined) {
        nom = await buscarNomenclatura(cod)
        cacheNomen.set(cod, nom)
      }
      classificacao = await classificacaoRegraGeral(cod, nom)
      regraGeral = true
    } else {
      classificacao = classificacaoNcmInvalido(cod)
      regraGeral = true
    }

    const redIBS = Number(classificacao.resumo.percentualReducaoIBS) || 0
    const redCBS = Number(classificacao.resumo.percentualReducaoCBS) || 0
    const base = Number(item.vlTotal) || 0
    const calc = calcularTributos(base, redIBS, redCBS, ref.refIBS, ref.refCBS)

    resultados.push({
      ...item,
      ncm: cod,
      classificacao,
      regraGeral,
      manual,
      redIBS,
      redCBS,
      ibs: calc.vIBS,
      cbs: calc.vCBS,
      totalTributos: calc.total,
      carga: calc.carga,
      anexo: anexoDeReducao(redIBS),
      observacoes: observacoesLegais(cod, redIBS),
    })

    onProgress?.(i + 1, itens.length)
  }

  return resultados
}

/** Totais agregados dos itens analisados de uma nota. */
export function totaisItensNfe(resultados: ResultadoItemNfe[]) {
  let totalBase = 0
  let totalIBS = 0
  let totalCBS = 0
  for (const r of resultados) {
    totalBase += Number(r.vlTotal) || 0
    totalIBS += r.ibs
    totalCBS += r.cbs
  }
  const totalTributos = totalIBS + totalCBS
  return {
    totalBase,
    totalIBS,
    totalCBS,
    totalTributos,
    cargaMedia: totalBase > 0 ? (totalTributos / totalBase) * 100 : 0,
  }
}
