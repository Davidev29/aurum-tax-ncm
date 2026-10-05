/**
 * CEST × Substituição Tributária — consulta estática/offline.
 *
 * O XML já traz `prod/CEST` (7 dígitos, parse em
 * `src/infrastructure/nfe/parse.ts`). Aqui o código do item é cruzado com
 * a lista ST embutida (`src/domain/constants/cest-dados.ts`, 1010
 * registros): bateu = marcador de possível ST com segmento + descrição
 * oficial. Não bateu = sem marcador (sem afirmar nada).
 *
 * A lista indica que o produto *pode* estar sujeito a ST/antecipação pelo
 * Convênio ICMS — a aplicação efetiva depende de UF, protocolo e operação.
 * Por isso os textos dizem "sujeito a ST", nunca "com ST".
 */
import { CEST_DADOS } from '@/domain/constants/cest-dados'

export interface InfoCest {
  /** 7 dígitos (`0100100`). */
  codigo: string
  /** `01.001.00` — como vem na lista oficial. */
  formatado: string
  descricao: string
  segmento: string
}

/** Só dígitos, máx. 7 (o XML já grava assim; aqui tolera `01.001.00`). */
export function normalizarCest(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '').slice(0, 7)
}

/** `0100100` → `01.001.00`. Fora do padrão, devolve o original aparado. */
export function formatarCest(v: unknown): string {
  const d = normalizarCest(v)
  if (d.length !== 7) return String(v ?? '').trim()
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 7)}`
}

const POR_CODIGO: Map<string, InfoCest> = new Map()
for (const r of CEST_DADOS) {
  const codigo = normalizarCest(r.cest)
  if (codigo.length !== 7 || POR_CODIGO.has(codigo)) continue
  POR_CODIGO.set(codigo, {
    codigo,
    formatado: formatarCest(codigo),
    descricao: String(r.descricao ?? '').trim(),
    segmento: String(r.segmento ?? '').trim(),
  })
}

/** Total da lista ST embutida (auditoria/testes). */
export const TOTAL_CEST_ST = POR_CODIGO.size

/**
 * Detalhes ST do CEST — `null` quando ausente ou fora da lista
 * (o chamador simplesmente não exibe marcador).
 */
export function buscarCest(v: unknown): InfoCest | null {
  const codigo = normalizarCest(v)
  if (codigo.length !== 7) return null
  return POR_CODIGO.get(codigo) ?? null
}

/** Atalho booleano para contadores e filtros. */
export function temSt(v: unknown): boolean {
  return buscarCest(v) !== null
}

/**
 * Resumo ST de uma nota — quantos itens bateram na lista e quais
 * segmentos apareceram (para o selo "N itens ST" do cabeçalho).
 */
export function resumoStNota(itens: Array<{ cest?: string | null }>): {
  total: number
  comSt: number
  segmentos: string[]
} {
  const total = itens.length
  let comSt = 0
  const segmentos = new Set<string>()
  for (const it of itens) {
    const info = buscarCest(it?.cest)
    if (!info) continue
    comSt++
    if (info.segmento) segmentos.add(info.segmento)
  }
  return { total, comSt, segmentos: [...segmentos].sort((a, b) => a.localeCompare(b, 'pt-BR')) }
}
