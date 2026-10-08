/**
 * Marcador de Substituição Tributária por CEST (módulo XML).
 *
 * Aparece somente quando o CEST do item bate com a lista ST embutida —
 * `buscarCest` retorna `null` fora da lista e nada é renderizado.
 * O texto diz "sujeito a ST" (a lista indica sujeição pelo Convênio ICMS;
 * a aplicação efetiva depende de UF/protocolo/operação).
 */
import { buscarCest, resumoStNota } from '@/domain/services/cest'
import { Pill } from '@/ui/kit'

/** Selo compacto do item — `ST · 01.001.00` com segmento/descrição no título. */
export function SeloST({ cest }: { cest: unknown }) {
  const info = buscarCest(cest)
  if (!info) return null
  const titulo = `${info.segmento ? `${info.segmento} — ` : ''}${info.descricao} (sujeito a ST — conferir convênio/protocolo e UF)`
  return (
    <span title={titulo} className="mt-1 inline-flex">
      <Pill cor="amber">ST · {info.formatado}</Pill>
    </span>
  )
}

/** Contador da nota — `N item(ns) ST` (nada quando nenhum item bateu). */
export function SeloSTNota({ itens }: { itens: Array<{ cest?: string | null }> }) {
  const r = resumoStNota(itens ?? [])
  if (!r.comSt) return null
  const titulo =
    r.segmentos.length > 0
      ? `Itens sujeitos a ST: ${r.comSt} de ${r.total} · ${r.segmentos.join(' · ')}`
      : `Itens sujeitos a ST: ${r.comSt} de ${r.total}`
  return (
    <span title={titulo}>
      <Pill cor="amber">
        ST · {r.comSt} de {r.total} item(ns)
      </Pill>
    </span>
  )
}

/** Bloco detalhado do modal do item — segmento + descrição oficial + ressalva. */
export function BlocoST({ cest }: { cest: unknown }) {
  const info = buscarCest(cest)
  if (!info) return null
  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 to-white p-3.5 text-xs leading-relaxed dark:border-amber-900 dark:from-amber-950/40 dark:to-slate-900">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-amber-100 text-base dark:bg-amber-950">
        🏷
      </span>
      <div className="min-w-0">
        <div className="font-bold text-amber-800 dark:text-amber-300">
          Sujeito a ST · CEST {info.formatado}
        </div>
        {info.segmento ? (
          <div className="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{info.segmento}</div>
        ) : null}
        <div className="mt-0.5 text-slate-500 dark:text-slate-400">{info.descricao}</div>
        <div className="mt-1 text-[11px] text-slate-400">
          CEST na lista de ST (Convênio ICMS) — conferir protocolo/convênio e UF da operação antes de destacar ou
          recolher.
        </div>
      </div>
    </div>
  )
}
