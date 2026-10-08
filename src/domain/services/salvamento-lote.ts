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
  const base = origemLinhaLoteBase(item)
  // Conferência do XML: a escolha veio da regra salva no cadastro (SKU).
  // O lote nunca marca este flag — comportamento dele inalterado.
  const doCadastro = (item as { usouRegraDoCadastro?: boolean }).usouRegraDoCadastro === true
  return doCadastro ? `${base} · 📦 do cadastro` : base
}

function origemLinhaLoteBase(item: ItemLote): string {
  const a = item.analiseIA
  if (item.manual) return 'manual · sua regra'
  if (item.nomenclatura?.dataFim) return 'NCM extinto · referência histórica'
  if (item.regraGeral) return 'regra geral'
  if (!a) return 'classificada'
  const idx = Math.max(
    0,
    item.classificacoes.findIndex((x) => x.id === item.escolhida?.id && x.cst === item.escolhida?.cst),
  )
  if (a.situacao === 'unica') {
    // Única com integral trocável: oficial fixada ou troca do usuário.
    if (item.classificacoes.length > 1 && idx !== a.maisProvavelIndice) {
      return `sua escolha: integral (segurança) (Opção ${idx + 1})`
    }
    return 'única · confirmada'
  }
  if (a.situacao === 'multipla') {
    const sugerida = a.maisProvavelIndice
    const escolhida = item.classificacoes[idx]
    const ehIntegral = Boolean(
      escolhida && (escolhida.integralFallback || (escolhida.cst === '000' && escolhida.cClassTrib === '000001')),
    )
    if (idx === sugerida) {
      return ehIntegral ? `integral sugerida (segurança) Opção ${sugerida + 1} · a escolher` : `IA sugere Opção ${sugerida + 1} ✓`
    }
    return ehIntegral ? `sua escolha: integral (Opção ${idx + 1})` : `sua escolha (Opção ${idx + 1})`
  }
  return 'classificada'
}
