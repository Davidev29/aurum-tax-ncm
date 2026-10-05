/**
 * Informações adicionais da classificação — leituras tipadas das tabelas CFF.
 *
 * - `anexosDoNcm`: match por NCM (8 dígitos) na store `anexos`;
 * - `anexosDoNbs` / `anexosDoCodigo`: match por NBS (9 dígitos) ou qualquer
 *   código (8/9) na store `anexos`;
 * - `regrasCreditoPresumido` / `locaisOperacao`: tabelas de referência
 *   versionadas em `meta` (sem chave com o NCM — exibidas quando a regra
 *   casa, ex.: classificação com crédito presumido).
 */
import { norm } from '@/domain/services/format'
import type { AnexoNcm, CreditoPresumido, LocalOperacao } from '@/domain/entities'
import { META_BASES_CFF } from './base-service'
import { db } from '../db/schema'

/** Anexos que citam o NCM (Permitido × Não Permitido). */
export async function anexosDoNcm(ncm: unknown): Promise<AnexoNcm[]> {
  const cod = norm(ncm)
  if (cod.length !== 8) return []
  try {
    return await db.anexos.where('codigo').equals(cod).toArray()
  } catch {
    return []
  }
}

/** Anexos que citam o NBS (9 dígitos). */
export async function anexosDoNbs(nbs: unknown): Promise<AnexoNcm[]> {
  const cod = norm(nbs)
  if (cod.length !== 9) return []
  try {
    return await db.anexos.where('codigo').equals(cod).toArray()
  } catch {
    return []
  }
}

/** Anexos que citam o código, seja NCM (8) ou NBS (9). */
export async function anexosDoCodigo(codigo: unknown): Promise<AnexoNcm[]> {
  const cod = norm(codigo)
  if (cod.length === 8) return anexosDoNcm(cod)
  if (cod.length === 9) return anexosDoNbs(cod)
  return []
}

/** Lote: anexos por NCM para vários códigos de uma vez (uma consulta). */
export async function anexosParaNcms(ncms: unknown[]): Promise<Record<string, AnexoNcm[]>> {
  const cods = [...new Set((ncms ?? []).map((n) => norm(n)).filter((c) => c.length === 8))]
  if (!cods.length) return {}
  try {
    const linhas = await db.anexos.where('codigo').anyOf(cods).toArray()
    const out: Record<string, AnexoNcm[]> = {}
    for (const l of linhas) {
      if (!l.codigo) continue
      ;(out[l.codigo] ??= []).push(l)
    }
    return out
  } catch {
    return {}
  }
}

/** Somente as linhas "Não Permitido" para os NCMs (alerta fiscal dos relatórios). */
export async function anexosNegadosPara(ncms: unknown[]): Promise<AnexoNcm[]> {
  const mapa = await anexosParaNcms(ncms)
  return Object.values(mapa).flat().filter((a) => a.permissao === 'negado')
}

/** Regras de crédito presumido vigentes (tabela de referência). */
export async function regrasCreditoPresumido(): Promise<CreditoPresumido[]> {
  try {
    const meta = await db.meta.get(META_BASES_CFF.CRED_PRESUMIDO)
    const dados = (meta?.valor as { dados?: unknown } | undefined)?.dados
    return Array.isArray(dados) ? (dados as CreditoPresumido[]) : []
  } catch {
    return []
  }
}

/** Locais de operação/fornecimento (tabela de referência). */
export async function locaisOperacao(): Promise<LocalOperacao[]> {
  try {
    const meta = await db.meta.get(META_BASES_CFF.IND_OPER)
    const dados = (meta?.valor as { dados?: unknown } | undefined)?.dados
    return Array.isArray(dados) ? (dados as LocalOperacao[]) : []
  } catch {
    return []
  }
}
