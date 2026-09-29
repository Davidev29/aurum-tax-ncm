/**
 * Propagação de reclassificação manual (NCM → base já gravada).
 *
 * Quando o usuário classifica um NCM manualmente, a escolha passa a ser a
 * vigente para aquele NCM (`resolverClassificacoes`). Como produtos e notas
 * de XML congelam a classificação no momento da gravação/importação
 * (snapshot + `itensAnalisados`), é preciso reaplicar a vigente em tudo que
 * já existe com aquele NCM — senão o histórico fica com a regra geral antiga.
 *
 * Cobertura:
 * - `produtos` (todas as empresas — manual é global por NCM);
 * - `nfeNotas.itensAnalisados` + totais da nota (usa o `refIBS/refCBS`
 *   guardado em cada nota para recalcular IBS/CBS).
 *
 * SPED/lote em memória não são persistidos: a próxima análise já resolve a
 * vigente automaticamente; a tela de SPED aberta é remendada em memória pelo
 * modal (ver `ModalReclassificacao`).
 */
import { REF_DEFAULT } from '@/domain/constants'
import type { ClassificacaoSnapshot } from '@/domain/entities'
import { anexoDeReducao, calcularTributos, observacoesLegais } from '@/domain/services/calculo'
import { norm } from '@/domain/services/format'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import { db } from '@/infrastructure/db/schema'

export interface ResultadoPropagacao {
  produtos: number
  notas: number
  itens: number
}

/** Reaplica a classificação vigente de um NCM em produtos e notas já gravados. */
export async function propagarClassificacaoNcm(codigoInput: unknown): Promise<ResultadoPropagacao> {
  const cod = norm(codigoInput)
  const vazio: ResultadoPropagacao = { produtos: 0, notas: 0, itens: 0 }
  if (cod.length !== 8) return vazio

  const r = await resolverClassificacoes(cod)
  const cl = r.lista[0]
  if (!cl) return vazio

  const agora = new Date().toISOString()
  const resumo = cl.resumo
  const snapshot: ClassificacaoSnapshot = {
    codigo: cl.codigo,
    codigoFormatado: cl.codigoFormatado,
    cst: cl.cst,
    cClassTrib: cl.cClassTrib,
    descricao: cl.descricao,
    baseLegal: cl.baseLegal,
    pRedIBS: resumo?.percentualReducaoIBS ?? null,
    pRedCBS: resumo?.percentualReducaoCBS ?? null,
    anexo: resumo?.anexo ?? null,
    classificacao: resumo?.descricaoCClassTrib ?? cl.baseLegal ?? '',
    manual: cl.manual ?? null,
  }
  const manualFlag = cl.manual != null || r.manual

  // Produtos com o NCM (todas as empresas — a manual é global por NCM).
  let produtos = 0
  try {
    const alvos = await db.produtos.where('ncm').equals(cod).toArray()
    if (alvos.length) {
      const atualizados = alvos.map((p) => ({
        ...p,
        cstReforma: cl.cst,
        cClassTrib: cl.cClassTrib,
        regraGeral: r.regraGeral,
        classificacaoManual: manualFlag,
        classificacaoSnapshot: snapshot,
        baseLegal: cl.baseLegal,
        atualizadoEm: agora,
      }))
      await db.produtos.bulkPut(atualizados)
      produtos = atualizados.length
    }
  } catch {
    /* tabela ausente em testes parciais — segue para as notas */
  }

  // Notas de XML: remenda os itens do NCM e recalcula os totais da nota.
  let notas = 0
  let itens = 0
  try {
    const todas = await db.nfeNotas.toArray()
    const redIBS = Number(resumo?.percentualReducaoIBS) || 0
    const redCBS = Number(resumo?.percentualReducaoCBS) || 0
    const sujas = []
    for (const n of todas) {
      const lista = n.itensAnalisados ?? []
      if (!lista.some((it) => norm(it.ncm) === cod)) continue
      const refIBS = Number(n.refIBS) || REF_DEFAULT.IBS
      const refCBS = Number(n.refCBS) || REF_DEFAULT.CBS
      let tocados = 0
      const refeitos = lista.map((it) => {
        if (norm(it.ncm) !== cod) return it
        tocados++
        const base = Number(it.vlTotal) || 0
        const calc = calcularTributos(base, redIBS, redCBS, refIBS, refCBS)
        return {
          ...it,
          ncm: cod,
          classificacao: cl,
          regraGeral: r.regraGeral,
          manual: manualFlag,
          redIBS,
          redCBS,
          ibs: calc.vIBS,
          cbs: calc.vCBS,
          totalTributos: calc.total,
          carga: calc.carga,
          anexo: anexoDeReducao(redIBS),
          observacoes: observacoesLegais(cod, redIBS),
        }
      })
      let totalIBS = 0
      let totalCBS = 0
      for (const it of refeitos) {
        totalIBS += Number(it.ibs) || 0
        totalCBS += Number(it.cbs) || 0
      }
      sujas.push({
        ...n,
        itensAnalisados: refeitos,
        totalIBS,
        totalCBS,
        totalTributos: totalIBS + totalCBS,
      })
      itens += tocados
    }
    if (sujas.length) {
      await db.nfeNotas.bulkPut(sujas)
      notas = sujas.length
    }
  } catch {
    /* sem notas no banco — nada a remendar */
  }

  return { produtos, notas, itens }
}
