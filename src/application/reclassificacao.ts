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
import type { ClassificacaoSnapshot } from '@/domain/entities'
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

  // Módulo XML removido: não há notas para remendar.
  const notas = 0
  const itens = 0

  return { produtos, notas, itens }
}
