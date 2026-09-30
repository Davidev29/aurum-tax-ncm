import { anexoReal, calcularTributos, observacoesFiscais, round2 } from '@/domain/services/calculo'
import { classificacaoNcmInvalido, interpretarEntradaNcm } from '@/domain/services/classificacao'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import {
  buscarNomenclatura,
  classificacaoRegraGeral,
  resolverClassificacoes,
} from '../base/classificacao-repo'
import type {
  ItemSped,
  ResumoC190,
  ResultadoItem,
  ResultadoResumo,
} from './tipos'

export interface AliquotasRef {
  refIBS: number
  refCBS: number
}

/**
 * Análise dos itens de saída (SPEC R4.4–R4.7).
 * Dois caches por execução evitam repetir as mesmas consultas por NCM.
 */
export async function analisarItens(
  itens: ItemSped[],
  ref: AliquotasRef,
  onProgress?: (feito: number, total: number) => void,
): Promise<ResultadoItem[]> {
  const cacheNcm = new Map<string, { lista: Classificacao[]; regraGeral: boolean; manual: boolean }>()
  const cacheNomen = new Map<string, NomenclaturaNcm | null>()

  const resultados: ResultadoItem[] = []

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i]
    // Entrada pelo intérprete único: >8 dígitos (possível NBS/EX) reduz aos
    // 8 do NCM com aviso — mesma regra do XML, mesmo motor em seguida.
    // O NCM pode chegar mascarado ("0201.10.00") ou com sufixo EX/NBS — reduz
    // aos 8 dígitos do NCM para que nenhum produto válido caia em "inválido",
    // mas sinaliza o truncamento para auditoria.
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
      classificacao = lista[0]
      // O fallback da regra geral também devolve `lista` com um item — o
      // discriminador é a flag do resolvedor, não o tamanho da lista.
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
    const base = Number(item.vlItem) || 0
    const calc = calcularTributos(base, redIBS, redCBS, ref.refIBS, ref.refCBS)

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
          ? [{ titulo: 'NCM truncado — conferir', texto: `Original "${ncmOriginal}" tinha ${entrada.digitos} dígitos (possível NBS/EX). Usado ${cod}.`, cor: 'amber' as const }]
          : []),
        ...(!valido
          ? [{ titulo: 'NCM inválido', texto: `Original "${ncmOriginal}" não tem 8 dígitos. Tributação integral aplicada como estimativa.`, cor: 'red' as const }]
          : []),
        ...(lista.length > 1
          ? [{ titulo: 'Múltiplas classificações', texto: `Este NCM tem ${lista.length} enquadramentos. Usada a 1ª opção como estimativa — escolha a correta.`, cor: 'amber' as const }]
          : []),
        ...observacoesFiscais(cod, classificacao, cacheNomen.get(cod) ?? null),
      ],
    })

    onProgress?.(i + 1, itens.length)
  }

  return resultados
}

/**
 * Modo resumo: agrupa por `CST ICMS | CFOP` e estima tudo pela regra geral
 * com redução zero (SPEC R4.8–R4.10).
 */
export function analisarResumo(
  registros: ResumoC190[],
  ref: AliquotasRef,
): ResultadoResumo[] {
  const grupos = new Map<
    string,
    { cstIcms: string; cfop: string; qtdNotas: number; totalOperacao: number; totalBcIcms: number; totalIcms: number }
  >()

  for (const r of registros) {
    const chave = `${r.cstIcms}|${r.cfop}`
    let g = grupos.get(chave)
    if (!g) {
      g = {
        cstIcms: r.cstIcms,
        cfop: r.cfop,
        qtdNotas: 0,
        totalOperacao: 0,
        totalBcIcms: 0,
        totalIcms: 0,
      }
      grupos.set(chave, g)
    }
    g.qtdNotas += 1
    g.totalOperacao += Number(r.vlOpr) || 0
    g.totalBcIcms += Number(r.vlBcIcms) || 0
    g.totalIcms += Number(r.vlIcms) || 0
  }

  const saida: ResultadoResumo[] = []

  grupos.forEach((g) => {
    const calc = calcularTributos(g.totalOperacao, 0, 0, ref.refIBS, ref.refCBS)
    saida.push({
      cstIcms: g.cstIcms,
      cfop: g.cfop,
      qtdNotas: g.qtdNotas,
      totalOperacao: g.totalOperacao,
      totalBcIcms: g.totalBcIcms,
      totalIcms: g.totalIcms,
      descricaoProduto: `Resumo CST ${g.cstIcms} / CFOP ${g.cfop}`,
      classificacao: {
        id: `RESUMO|${g.cstIcms}|${g.cfop}`,
        codigo: '',
        codigoFormatado: '',
        cst: '000',
        cClassTrib: '000001',
        baseLegal: '',
        descricao: '',
        vinculo: null,
        cstDetalhes: null,
        cstClassTribDetalhes: null,
        referencia: null,
        resumo: {
          descricaoCClassTrib: `Estimativa por CST ${g.cstIcms} + CFOP ${g.cfop}`,
          percentualReducaoIBS: 0,
          percentualReducaoCBS: 0,
          anexo: null,
          urlLegislacao: null,
          documentosHabilitados: null,
        },
        regraGeral: true,
      },
      regraGeral: true,
      redIBS: 0,
      redCBS: 0,
      ibs: calc.vIBS,
      cbs: calc.vCBS,
      totalTributos: calc.total,
      carga: calc.carga,
      anexo: 'isento',
      observacoes: [
        {
          titulo: 'Análise resumida (sem NCM)',
          texto:
            'Este arquivo SPED contém apenas registros C190 (resumo por CST/CFOP) para as saídas. Sem detalhamento por item (C170) com NCM, a classificação da Reforma é estimada pela REGRA GERAL (alíquota cheia). Para classificação precisa, exporte um SPED com os C170 das saídas ou use a aba "Classificação em lote" com um CSV de produtos.',
          cor: 'amber' as const,
        },
      ],
      _isResumo: true,
    })
  })

  return saida.sort((a, b) => b.totalOperacao - a.totalOperacao)
}

/** Totais agregados de uma lista de resultados (SPEC R4.15). */
export function totaisItens(resultados: ResultadoItem[]) {
  let totalBase = 0
  let totalIBS = 0
  let totalCBS = 0
  for (const r of resultados) {
    totalBase = round2(totalBase + (Number(r.vlItem) || 0))
    totalIBS = round2(totalIBS + r.ibs)
    totalCBS = round2(totalCBS + r.cbs)
  }
  const totalTributos = round2(totalIBS + totalCBS)
  return {
    itens: resultados.length,
    totalBase,
    totalIBS,
    totalCBS,
    totalTributos,
    cargaMedia: totalBase > 0 ? (totalTributos / totalBase) * 100 : 0,
  }
}
