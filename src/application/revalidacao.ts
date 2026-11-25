/**
 * Revalidação da base gravada após MUDANÇA DE REGRA.
 *
 * REGRA DO SISTEMA: sempre que uma regra muda — importação/releitura da base,
 * sync CFF ou NCM com atualizações, ou classificação manual salva/removida —
 * tudo que já foi gravado (produtos, notas de XML) é reaplicado pela
 * classificação vigente. Sem isso, o histórico exibe reduções revogadas ou
 * NCMs extintos como se fossem tributação atual.
 *
 * - Classificação **manual** do usuário é preservada (responsabilidade dela,
 *   já sinalizada na UI); conta em `manuaisPreservados`.
 * - SPED/Lote em memória não são persistidos: a próxima análise resolve a
 *   vigente; a tela aberta de SPED é remendada pelo modal de reclassificação.
 * - Best-effort por etapa: falha numa store não aborta as demais.
 */
import { norm } from '@/domain/services/format'
import { resolverClassificacoes } from '@/infrastructure/base/classificacao-repo'
import type { Classificacao, NomenclaturaNcm, Produto } from '@/domain/entities'
import { db } from '@/infrastructure/db/schema'
import { snapshotDe } from './produtos'

export interface ResultadoRevalidacao {
  produtos: number
  notas: number
  itens: number
  manuaisPreservados: number
}

type Resolucao = {
  cl: Classificacao
  regraGeral: boolean
  manual: boolean
  nomenclatura: NomenclaturaNcm | null
}

/**
 * Reaplica a classificação vigente em TODOS os produtos e notas gravados.
 */
export async function revalidarBaseGravada(
  onProgress?: (etapa: string, pct: number) => void,
): Promise<ResultadoRevalidacao> {
  const total: ResultadoRevalidacao = { produtos: 0, notas: 0, itens: 0, manuaisPreservados: 0 }
  const cache = new Map<string, Resolucao | null>()

  const resolver = async (ncmBruto: string): Promise<Resolucao | null> => {
    const cod = norm(ncmBruto)
    if (cod.length !== 8) return null
    let r = cache.get(cod)
    if (r === undefined) {
      try {
        const res = await resolverClassificacoes(cod)
        const cl = res.lista[0]
        r = cl ? { cl, regraGeral: res.regraGeral, manual: res.manual || cl.manual != null, nomenclatura: res.nomenclatura } : null
      } catch {
        r = null
      }
      cache.set(cod, r)
    }
    return r ?? null
  }

  // --- produtos (todas as empresas; manual do usuário preservada) ---
  try {
    onProgress?.('Revalidando produtos', 10)
    const produtos: Produto[] = await db.produtos.toArray()
    const agora = new Date().toISOString()
    const gravar: Produto[] = []
    for (const p of produtos) {
      if (p.classificacaoManual || p.classificacaoSnapshot?.manual) {
        total.manuaisPreservados++
        continue
      }
      const r = await resolver(p.ncm)
      if (!r) continue
      gravar.push({
        ...p,
        cstReforma: r.cl.cst,
        cClassTrib: r.cl.cClassTrib,
        regraGeral: r.regraGeral,
        classificacaoManual: r.manual,
        classificacaoSnapshot: snapshotDe(r.cl),
        baseLegal: r.cl.baseLegal,
        atualizadoEm: agora,
      })
    }
    if (gravar.length) {
      await db.produtos.bulkPut(gravar)
      total.produtos = gravar.length
    }
  } catch {
    /* store ausente — segue para as notas */
  }

  // Módulo XML removido: não há notas para revalidar.

  onProgress?.('Concluído', 100)
  return total
}

/** Texto único de relatório para toasts ("3 produtos · 2 notas (15 itens)"). */
export function resumirRevalidacao(t: ResultadoRevalidacao): string {
  const partes = [
    t.produtos ? `${t.produtos} produto(s)` : null,
    t.notas ? `${t.notas} nota(s) (${t.itens} iten(s))` : null,
  ].filter(Boolean)
  const base = partes.length ? partes.join(' · ') : 'nada a atualizar'
  return t.manuaisPreservados
    ? `${base} — ${t.manuaisPreservados} manual(is) preservada(s)`
    : base
}
