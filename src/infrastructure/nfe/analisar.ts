import { calcularTributos, anexoReal, observacoesFiscais, round2 } from '@/domain/services/calculo'
import { classificacaoNcmInvalido, interpretarEntradaNcm } from '@/domain/services/classificacao'
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
 *
 * Alíquotas de referência: vêm do parâmetro `ref` (nota/sessão, editável e
 * exibido na UI). A base oficial NÃO guarda "alíquota cheia por NCM" — os
 * campos `vinculo.aliquotaIBS/CBS` são frações sub-1% da planilha de origem
 * e JAMAIS podem alimentar `refIBS/refCBS` (zerariam o imposto). Por isso
 * não há lookup por NCM aqui: reduções vêm da classificação oficial por
 * NCM; a referência cheia é o parâmetro global declarado.
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
    // Entrada pelo intérprete único: >8 dígitos (possível NBS/EX) reduz aos
    // 8 do NCM com aviso — mesma regra do SPED, mesmo motor em seguida.
    const ncmOriginal = String(item.ncm ?? '')
    const entrada = interpretarEntradaNcm(item.ncm)
    const ncmTruncado = entrada.kind === 'truncado'
    const cod = entrada.codigo
    const valido = entrada.kind !== 'invalido'

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
      // Múltiplas classificações: mantém lista[0] como estimativa, mas
      // sinaliza ambiguidade via opcoesClassificacao para UI/relatório.
      // Phase 10-05: desempate via caminho do grafo (só reordena; o
      // resolvedor continua sendo a única verdade). Best-effort.
      let listaEfetiva = lista
      try {
        if (lista.length > 1) {
          const { consultarGrafoPrimeiro, desempatarPorGrafo } = await import('@/application/grafo-consumo')
          const textoItem = String((item as { descricao?: unknown }).descricao || String(item.ncm || cod) || cod)
          const g = await consultarGrafoPrimeiro(textoItem.slice(0, 120), 5).catch(() => null)
          if (g && g.trilha.usouGrafo) {
            const r = desempatarPorGrafo(lista, g.trilha, cod)
            if (r.usouGrafo) listaEfetiva = r.lista
          }
        }
      } catch {
        /* mantém a ordem oficial */
      }
      classificacao = listaEfetiva[0]
      regraGeral = regraGeralDaBase
      manual = manualDoNcm || listaEfetiva[0].manual != null
      // Expõe a contagem original (o desempate não cria nem remove opções).
      lista = listaEfetiva
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

    // Reduções vêm SEMPRE da classificação vigente (fonte fiscal única).
    // A base oficial não guarda "alíquota cheia por NCM": a referência cheia
    // é o parâmetro da nota/sessão (ver docstring de analisarItensNfe).
    const redIBS = Number(classificacao.resumo.percentualReducaoIBS) || 0
    const redCBS = Number(classificacao.resumo.percentualReducaoCBS) || 0

    const base = Number(item.vlTotal) || 0
    // Referência cheia = parâmetro da nota/sessão (declarado na UI e nos
    // relatórios como "refs X% / Y%"). Nunca por NCM: a base oficial não tem
    // alíquota cheia por NCM (ver docstring acima). Nunca zera por falta de base.
    const refIBS = Number(ref.refIBS) || 0
    const refCBS = Number(ref.refCBS) || 0
    const calc = calcularTributos(base, redIBS, redCBS, refIBS, refCBS)

    resultados.push({
      ...item,
      ncm: cod,
      ncmOriginal,
      ncmTruncado,
      ncmInvalido: !valido,
      opcoesClassificacao: lista.length,
      classificacao,
      regraGeral,
      manual,
      redIBS,
      redCBS,
      ibs: calc.vIBS,
      cbs: calc.vCBS,
      totalTributos: calc.total,
      carga: calc.carga,
      anexo: anexoReal(classificacao.resumo?.anexo ?? (classificacao as { referencia?: { anexo?: unknown } }).referencia?.anexo, redIBS, redCBS),
      nomenclatura: cacheNomen.get(cod) ?? null,
      observacoes: [
        ...(ncmTruncado
          ? [{ titulo: 'NCM truncado — conferir', texto: `Original "${ncmOriginal}" tinha ${entrada.digitos} dígitos (possível NBS/EX). Usado ${cod}. Confira o enquadramento.`, cor: 'amber' as const }]
          : []),
        ...(!valido
          ? [{ titulo: 'NCM inválido', texto: `Original "${ncmOriginal}" não tem 8 dígitos. Tributação integral aplicada como estimativa — corrija o cadastro.`, cor: 'red' as const }]
          : []),
        ...(lista.length > 1
          ? (() => {
            const oficiais = lista.filter((x) => !x.integralFallback).length || lista.length
            const temFallback = lista.some((x) => x.integralFallback)
            return [{ titulo: 'Múltiplas classificações', texto: `Este NCM tem ${oficiais} enquadramentos oficiais${temFallback ? ' + tributação integral de segurança (última opção)' : ''}. Foi usada a 1ª opção como estimativa — escolha a correta na Consulta/Lote. Não se encaixa nessa qualificação? Aplique a tributação integral.`, cor: 'amber' as const }]
          })()
          : []),
        ...observacoesFiscais(cod, classificacao, cacheNomen.get(cod) ?? null),
      ],
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
    totalBase = round2(totalBase + (Number(r.vlTotal) || 0))
    totalIBS = round2(totalIBS + r.ibs)
    totalCBS = round2(totalCBS + r.cbs)
  }
  const totalTributos = round2(totalIBS + totalCBS)
  return {
    totalBase,
    totalIBS,
    totalCBS,
    totalTributos,
    cargaMedia: totalBase > 0 ? (totalTributos / totalBase) * 100 : 0,
  }
}
