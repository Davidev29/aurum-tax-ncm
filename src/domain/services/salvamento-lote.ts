/**
 * Divisão do lote para a revisão obrigatória antes de salvar.
 *
 * Puro e sem I/O: a mesma conta usada pelo modal "Revisar antes de salvar"
 * e pelo `salvarTodos` — o que o usuário vê é exatamente o que será gravado.
 * Sem dependência de parser/xlsx/store: importável pela UI e pelos testes.
 */
import type { ItemLote } from '@/infrastructure/parsers/lote'

export interface IgnoradoLote {
  /** Posição em `itens` (para rastreabilidade). */
  indiceOriginal: number
  item: ItemLote
  motivo: string
}

export function dividirLoteParaSalvamento(itens: ItemLote[]): {
  gravaveis: ItemLote[]
  ignorados: IgnoradoLote[]
} {
  const gravaveis: ItemLote[] = []
  const ignorados: IgnoradoLote[] = []
  itens.forEach((item, indiceOriginal) => {
    if (!item.codigo) {
      ignorados.push({ indiceOriginal, item, motivo: 'sem SKU — preencha COD/SKU na planilha' })
      return
    }
    if (item.ncm.length !== 8) {
      ignorados.push({ indiceOriginal, item, motivo: 'NCM inválido — corrija para 8 dígitos' })
      return
    }
    if (!item.escolhida) {
      ignorados.push({ indiceOriginal, item, motivo: 'sem classificação resolvida' })
      return
    }
    gravaveis.push(item)
  })
  return { gravaveis, ignorados }
}

/** Origem da linha gravável para o preview de revisão (pílula por linha). */
export function origemLinhaLote(item: ItemLote): string {
  const a = item.analiseIA
  if (item.manual) return 'manual · sua regra'
  if (item.nomenclatura?.dataFim) return 'NCM extinto · referência histórica'
  if (item.regraGeral) return 'regra geral'
  if (!a || a.situacao === 'unica') return 'única · confirmada'
  if (a.situacao === 'multipla') {
    const sugerida = a.maisProvavelIndice
    const idx = Math.max(
      0,
      item.classificacoes.findIndex((x) => x.id === item.escolhida?.id && x.cst === item.escolhida?.cst),
    )
    return idx === sugerida ? `IA sugere Opção ${sugerida + 1} ✓` : `sua escolha (Opção ${idx + 1})`
  }
  return 'classificada'
}
