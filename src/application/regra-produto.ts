/**
 * Regra do produto (cadastro) como fonte da escolha por SKU.
 *
 * Quando um produto tem NCM com mais de uma regra e o usuário escolhe uma
 * delas (lote ou conferência do XML), o cadastro passa a ser a fonte dessa
 * escolha — escopo **SKU + empresa** (nunca global por NCM):
 * - a **apuração assistida** (informativo via NCM) adota a regra salva;
 * - a **conferência do XML** pré-seleciona a regra salva;
 * - as **telas de consulta** continuam puras (motor único, sem overlay).
 *
 * Prioridade vigente na análise de notas:
 * base oficial › manual (global, com fonte) › regra do produto (SKU) ›
 * 1ª opção oficial / regra geral.
 */
import { norm } from '@/domain/services/format'
import type { Classificacao } from '@/domain/entities'
import { db } from '@/infrastructure/db/schema'

export interface RegraProduto {
  codigo: string
  ncm: string
  cst: string
  cClassTrib: string
}

export type MapaRegraProduto = Map<string, RegraProduto>

/** Carrega as regras salvas no cadastro de uma empresa, indexadas por SKU. */
export async function mapaRegrasProdutos(
  empresaId: number | null | undefined,
): Promise<MapaRegraProduto> {
  const mapa: MapaRegraProduto = new Map()
  if (empresaId == null) return mapa
  let lista: { codigo: string; ncm: string; cstReforma: string; cClassTrib: string }[] = []
  try {
    lista = await db.produtos.where('empresaId').equals(empresaId).toArray()
  } catch {
    return mapa
  }
  for (const p of lista) {
    const codigo = String(p.codigo ?? '').trim()
    if (!codigo || mapa.has(codigo)) continue
    mapa.set(codigo, {
      codigo,
      ncm: norm(p.ncm),
      cst: String(p.cstReforma ?? ''),
      cClassTrib: String(p.cClassTrib ?? ''),
    })
  }
  return mapa
}

/**
 * Encontra a regra salva entre as opções resolvidas para o NCM do item.
 * Só vale quando o NCM do cadastro coincide com o do item e a combinação
 * CST × cClassTrib existe na lista (inclui a integral de segurança).
 */
export function escolherComRegraProduto(
  lista: Classificacao[],
  ncmItem: string,
  regra: RegraProduto | null | undefined,
): Classificacao | null {
  if (!regra || !lista.length) return null
  if (norm(regra.ncm) !== norm(ncmItem)) return null
  if (!regra.cst || !regra.cClassTrib) return null
  return lista.find((x) => x.cst === regra.cst && x.cClassTrib === regra.cClassTrib) ?? null
}
