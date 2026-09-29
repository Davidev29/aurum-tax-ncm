import { REGRA_GERAL } from '@/domain/constants'
import type { Classificacao, NomenclaturaNcm, VinculoNcm } from '@/domain/entities'
import {
  montarClassificacao,
  montarRegraGeral,
  isNcmExtinto,
  type ContextoClassificacao,
} from '@/domain/services/classificacao'
import { revogacaoDe, type Revogacao } from '@/domain/services/revogacao'
import { norm } from '@/domain/services/format'
import { db } from '../db/schema'
import { obterRevogacoesCff } from '../cff/cff-sync'
import { buscarReclassificacaoManual, classificacaoManual } from './reclassificacao-repo'

/**
 * Repositório de classificação — todas as leituras do núcleo passam por aqui
 * (SPEC R1.6: busca por NCM exclusivamente pelo índice `codigo`).
 */

/** Resolve o join 3NF de um vínculo (CST + cClassTrib + referência). */
async function contextoDe(vinculo: VinculoNcm): Promise<ContextoClassificacao> {
  const [cstDetalhes, cstClassTribDetalhes, referencia] = await Promise.all([
    db.cst.get(vinculo.cst),
    db.cstClassTrib.get(`${vinculo.cst}|${vinculo.cClassTrib}`),
    db.referencia.get(`${vinculo.cst}|${vinculo.cClassTrib}`),
  ])
  return { cstDetalhes: cstDetalhes ?? null, cstClassTribDetalhes: cstClassTribDetalhes ?? null, referencia: referencia ?? null }
}

/** Resolve o join 3NF da regra geral (SPEC R2.4). */
export async function contextoRegraGeral(): Promise<ContextoClassificacao> {
  let cstDetalhes = null
  let cstClassTribDetalhes = null
  try {
    cstDetalhes = (await db.cst.get(REGRA_GERAL.cst)) ?? null
  } catch {
    cstDetalhes = null
  }
  try {
    cstClassTribDetalhes = (await db.cstClassTrib.get(`${REGRA_GERAL.cst}|${REGRA_GERAL.cClassTrib}`)) ?? null
  } catch {
    cstClassTribDetalhes = null
  }
  return { cstDetalhes, cstClassTribDetalhes, referencia: null }
}

/** R2.1 — `[]` imediatamente quando o NCM não tem 8 dígitos. */
export async function buscarClassificacoesDoNcm(codigo: unknown): Promise<Classificacao[]> {
  const c = norm(codigo)
  if (c.length !== 8) return []
  const vinculos = await db.ncm.where('codigo').equals(c).toArray()
  if (!vinculos.length) return []
  const nomen = await buscarNomenclatura(c)
  const ctxs = await Promise.all(vinculos.map(contextoDe))
  return vinculos.map((v, i) =>
    montarClassificacao(v, nomen ? { ...ctxs[i], nomenclatura: nomen } : ctxs[i]),
  )
}

/** R2.2 — `null` para código vazio; `undefined` viria do Dexie, então normalizamos. */
export async function buscarNomenclatura(codigo: unknown): Promise<NomenclaturaNcm | null> {
  const c = norm(codigo)
  if (!c) return null
  return (await db.ncmNomenclatura.get(c)) ?? null
}

/** R2.3 — prefixo com no mínimo 2 dígitos; limite por SPEC (30 na busca). */
export async function sugerirNomenclatura(
  prefixo: unknown,
  limite = 30,
): Promise<NomenclaturaNcm[]> {
  const t = norm(prefixo)
  if (t.length < 2) return []
  // Busca folga extra para ordenar vigentes antes dos extintos ("negados")
  // sem ocultar os extintos (o usuário pode estar com o NCM antigo na nota).
  const folga = Math.min(limite + 20, 100)
  const achados = await db.ncmNomenclatura
    .where('codigo')
    .between(t, `${t}\uffff`, true, true)
    .limit(folga)
    .toArray()
  achados.sort((a, b) => Number(Boolean(a.dataFim)) - Number(Boolean(b.dataFim)))
  return achados.slice(0, limite)
}

/** Monta a classificação de regra geral já com a nomenclatura do NCM. */
export async function classificacaoRegraGeral(
  codigo: unknown,
  nomenclatura?: NomenclaturaNcm | null,
): Promise<Classificacao> {
  const ctx = await contextoRegraGeral()
  const nomen = nomenclatura === undefined ? await buscarNomenclatura(codigo) : nomenclatura
  return montarRegraGeral(norm(codigo), { ...ctx, nomenclatura: nomen })
}

/**
 * Fluxo 0 / 1 / N (SPEC §2.3) usado por consulta, formulário, lote e SPED.
 * Retorna também a nomenclatura resolvida para reaproveitamento na UI.
 *
 * Prioridade (reclassificação manual):
 * 1. vínculos oficiais da base (sempre preferidos);
 * 2. reclassificação manual do usuário (só quando não há vínculo);
 * 3. regra geral (fallback universal).
 *
 * Rebaixamentos (nunca apresentam redução como vigente):
 * - NCM extinto (`dataFim` na nomenclatura) COM vínculo: o vínculo é
 *   histórico — lista vira regra geral com `extinto: true`.
 * - Vínculo com anexo/cct revogado: filtrado; se nada restar, regra geral
 *   com `revogado` (ato + motivo). A manual do usuário prevalece sobre ambos
 *   (responsabilidade dela, sinalizada na UI).
 */
export async function resolverClassificacoes(
  codigo: unknown,
): Promise<{
  vinculos: VinculoNcm[]
  lista: Classificacao[]
  nomenclatura: NomenclaturaNcm | null
  regraGeral: boolean
  manual: boolean
  extinto: boolean
  revogado: Revogacao | null
}> {
  const c = norm(codigo)
  const nomenclatura = await buscarNomenclatura(c)
  const vinculos = c.length === 8 ? await db.ncm.where('codigo').equals(c).toArray() : []
  const extinto = isNcmExtinto(nomenclatura) && c.length === 8
  if (c.length !== 8) {
    return { vinculos: [], lista: [], nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null }
  }
  // NCM extinto: o vínculo virou histórico, sem valor como tributação vigente.
  // A manual do usuário prevalece (responsabilidade dela, sinalizada na UI).
  if (extinto) {
    const manualReg = await buscarReclassificacaoManual(c)
    if (manualReg) {
      const cl = await classificacaoManual(manualReg, nomenclatura)
      return { vinculos, lista: [cl], nomenclatura, regraGeral: false, manual: true, extinto, revogado: null }
    }
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado: null }
  }
  // Vínculos vivos: filtra anexo/cct revogado (curadoria + achados do CFF).
  let revogado: Revogacao | null = null
  let vivos = vinculos
  if (vivos.length) {
    const dinamicas = await obterRevogacoesCff()
    const mantidos: VinculoNcm[] = []
    for (const v of vivos) {
      const ctx = await contextoDe(v)
      const rev = revogacaoDe(v.cClassTrib, ctx.referencia?.anexo, dinamicas)
      if (rev && !revogado) revogado = rev
      if (!rev) mantidos.push(v)
    }
    vivos = mantidos
  }
  if (!vivos.length) {
    // Manual do usuário prevalece sobre ausência total de vínculo vivo.
    const manualReg = await buscarReclassificacaoManual(c)
    if (manualReg) {
      const cl = await classificacaoManual(manualReg, nomenclatura)
      return { vinculos, lista: [cl], nomenclatura, regraGeral: false, manual: true, extinto, revogado }
    }
    const rg = await classificacaoRegraGeral(c, nomenclatura)
    if (revogado) rg.revogado = revogado
    return { vinculos, lista: [rg], nomenclatura, regraGeral: true, manual: false, extinto, revogado }
  }
  const ctxs = await Promise.all(vivos.map(contextoDe))
  const lista = vivos.map((v, i) =>
    montarClassificacao(v, nomenclatura ? { ...ctxs[i], nomenclatura } : ctxs[i]),
  )
  return { vinculos, lista, nomenclatura, regraGeral: false, manual: false, extinto: false, revogado: null }
}
